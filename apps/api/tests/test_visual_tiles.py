from __future__ import annotations

import calendar
import sqlite3
import time

from fastapi.testclient import TestClient

from enroute_api.config import Settings
from enroute_api.footprints.store import FootprintStore
from enroute_api.footprints.store import initialize_schema
from enroute_api.footprints.visual_tile_codec import (
    VisualCellRecord,
    decode_visual_cells,
    encode_visual_cells,
)
from enroute_api.footprints.visual_tiles import (
    CELLS_PER_ROW,
    STATUS_DIRTY,
    STATUS_READY,
    TIME_BUCKET_ALL,
    TIME_BUCKET_DAY,
    TIME_BUCKET_MONTH,
    TIME_BUCKET_YEAR,
    MAX_VISUAL_TILE_ZOOM,
    VISUAL_TILE_ALGORITHM_SIGNATURE,
    VISUAL_TILE_ALGORITHM_SIGNATURE_KEY,
    VISUAL_CELL_SIZE,
    build_visual_tile,
    build_visual_tiles,
    backfill_visual_tile_counts,
    mark_visual_tile_dirty,
    summarize_visual_tiles_for_viewport,
    split_time_range_into_buckets,
    tile_bounds,
)
from enroute_api.main import create_app


def column_names(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info({table_name})")]


def test_visual_tile_grid_uses_four_mvt_units_per_cell():
    assert VISUAL_CELL_SIZE == 4
    assert CELLS_PER_ROW == 1024


def test_visual_tile_zoom_ceiling_is_16():
    assert MAX_VISUAL_TILE_ZOOM == 16


def test_build_visual_tiles_rejects_zoom_above_current_ceiling(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        try:
            build_visual_tiles(connection, min_zoom=17, max_zoom=17, bucket="all")
        except ValueError as error:
            assert str(error) == "max_zoom must be less than or equal to 16"
        else:
            raise AssertionError("expected ValueError")
    finally:
        connection.close()


def test_initializes_visual_tiles_table(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        assert column_names(connection, "visual_tiles") == [
            "z",
            "x",
            "y",
            "t_type",
            "t",
            "status",
            "cells",
            "raw_count",
            "representative_count",
            "updated_at",
        ]
        indexes = list(connection.execute("PRAGMA index_list(visual_tiles)"))
        assert indexes
    finally:
        connection.close()


def test_backfills_visual_tile_counts_without_rewriting_cells(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        rows = [
            (100, -100.0, 10.0),
            (101, -100.00001, 10.00001),
            (102, -100.00002, 10.00002),
        ]
        for timestamp, longitude, latitude in rows:
            connection.execute(
                """
                INSERT INTO footprints (
                  timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
                ) VALUES (?, ?, ?, 5, 0, 0, 0, 0)
                """,
                (timestamp, longitude, latitude),
            )
            connection.execute(
                """
                INSERT INTO footprint_spatial (
                  footprint_rowid, min_lng, max_lng, min_lat, max_lat
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (timestamp, longitude, longitude, latitude, latitude),
            )

        build_visual_tile(
            connection,
            z=1,
            x=0,
            y=0,
            t_type=TIME_BUCKET_ALL,
            t=0,
            start_timestamp_seconds=0,
            end_timestamp_seconds=200,
            updated_at=1234,
        )
        before = connection.execute(
            "SELECT cells, raw_count, representative_count FROM visual_tiles",
        ).fetchone()

        updated_count = backfill_visual_tile_counts(connection, commit_interval=1)

        after = connection.execute(
            "SELECT cells, raw_count, representative_count FROM visual_tiles",
        ).fetchone()
        assert updated_count == 1
        assert after["cells"] == before["cells"]
        assert after["raw_count"] == 3
        assert after["representative_count"] == len(decode_visual_cells(after["cells"]))
    finally:
        connection.close()


def test_backfill_visual_tile_counts_uses_bulk_scan(tmp_path, monkeypatch):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (100, -100, 10, 5, 0, 0, 0, 0)
            """,
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (100, -100, -100, 10, 10)
            """,
        )
        build_visual_tile(
            connection,
            z=1,
            x=0,
            y=0,
            t_type=TIME_BUCKET_ALL,
            t=0,
            start_timestamp_seconds=0,
            end_timestamp_seconds=200,
            updated_at=1234,
        )
        monkeypatch.setattr(
            "enroute_api.footprints.visual_tiles.count_raw_footprints_for_visual_tile",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("per-tile raw count called")),
        )

        updated_count = backfill_visual_tile_counts(connection, commit_interval=1)

        row = connection.execute("SELECT raw_count, representative_count FROM visual_tiles").fetchone()
        assert updated_count == 1
        assert tuple(row) == (1, 1)
    finally:
        connection.close()


def test_summarizes_visual_tiles_for_current_viewport_without_creating_empty_rows(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        inside_blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=1, footprint_id=100, geom_x=10, geom_y=20),
                VisualCellRecord(cell_id=2, footprint_id=101, geom_x=30, geom_y=40),
            ],
        )
        outside_blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=3, footprint_id=200, geom_x=10, geom_y=20),
            ],
        )
        connection.execute(
            """
            INSERT INTO visual_tiles (
              z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
            )
            VALUES (2, 2, 1, 0, 0, ?, ?, 10, 2, 1000)
            """,
            (STATUS_READY, inside_blob),
        )
        connection.execute(
            """
            INSERT INTO visual_tiles (
              z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
            )
            VALUES (2, 3, 1, 0, 0, ?, ?, 5, 1, 1000)
            """,
            (STATUS_READY, outside_blob),
        )
        west, south, east, north = tile_bounds(z=2, x=2, y=1)

        stats = summarize_visual_tiles_for_viewport(
            connection,
            z=2,
            west=west + 0.01,
            south=south + 0.01,
            east=east - 0.01,
            north=north - 0.01,
            buckets=[(TIME_BUCKET_ALL, 0)],
        )

        assert stats == {
            "tileZoom": 2,
            "requestedTileCount": 1,
            "populatedTileCount": 1,
            "readyTileCount": 1,
            "dirtyTileCount": 0,
            "rawCount": 10,
            "representativeCount": 2,
            "renderRatio": 0.2,
        }
        assert connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0] == 2
    finally:
        connection.close()


def test_builds_first_timestamp_representative_per_cell(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        rows = [
            (100, 0.1, 1.0),
            (101, 0.100001, 1.000001),
            (102, 1.0, 2.0),
        ]
        for timestamp, longitude, latitude in rows:
            connection.execute(
                """
                INSERT INTO footprints (
                  timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
                ) VALUES (?, ?, ?, 5, 0, 0, 0, 0)
                """,
                (timestamp, longitude, latitude),
            )
            connection.execute(
                """
                INSERT INTO footprint_spatial (
                  footprint_rowid, min_lng, max_lng, min_lat, max_lat
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (timestamp, longitude, longitude, latitude, latitude),
            )

        build_visual_tile(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=TIME_BUCKET_DAY,
            t=19700101,
            start_timestamp_seconds=0,
            end_timestamp_seconds=200,
            updated_at=1234,
        )

        row = connection.execute(
            "SELECT status, cells, updated_at FROM visual_tiles WHERE z = 1 AND x = 1 AND y = 0",
        ).fetchone()
        assert row["status"] == STATUS_READY
        assert row["updated_at"] == 1234
        records = decode_visual_cells(row["cells"])
        assert records
        assert records[0].footprint_id == 100
    finally:
        connection.close()


def test_builds_visual_tiles_only_for_existing_all_bucket_tile_keys(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        rows = [
            (100, -100.0, 10.0),
            (200, 100.0, -10.0),
        ]
        for timestamp, longitude, latitude in rows:
            connection.execute(
                """
                INSERT INTO footprints (
                  timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
                ) VALUES (?, ?, ?, 5, 0, 0, 0, 0)
                """,
                (timestamp, longitude, latitude),
            )
            connection.execute(
                """
                INSERT INTO footprint_spatial (
                  footprint_rowid, min_lng, max_lng, min_lat, max_lat
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (timestamp, longitude, longitude, latitude, latitude),
            )

        result = build_visual_tiles(
            connection,
            min_zoom=1,
            max_zoom=1,
            bucket="all",
            updated_at=1234,
            commit_interval=1,
        )

        rows = connection.execute(
            """
            SELECT z, x, y, t_type, t, status, cells, updated_at
            FROM visual_tiles
            ORDER BY z, x, y, t_type, t
            """,
        ).fetchall()
        assert result.built_count == 2
        assert [(row["z"], row["x"], row["y"], row["t_type"], row["t"]) for row in rows] == [
            (1, 0, 0, TIME_BUCKET_ALL, 0),
            (1, 1, 1, TIME_BUCKET_ALL, 0),
        ]
        assert [row["status"] for row in rows] == [STATUS_READY, STATUS_READY]
        assert [row["updated_at"] for row in rows] == [1234, 1234]
        assert [decode_visual_cells(row["cells"])[0].footprint_id for row in rows] == [100, 200]
    finally:
        connection.close()


def test_build_visual_tiles_uses_bulk_builder_instead_of_per_candidate_queries(tmp_path, monkeypatch):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (100, -100, 10, 5, 0, 0, 0, 0)
            """,
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (100, -100, -100, 10, 10)
            """,
        )
        monkeypatch.setattr(
            "enroute_api.footprints.visual_tiles.build_visual_tile",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("per-candidate builder called")),
        )

        result = build_visual_tiles(
            connection,
            min_zoom=1,
            max_zoom=1,
            bucket="all",
            updated_at=1234,
        )

        rows = connection.execute("SELECT cells FROM visual_tiles").fetchall()
        assert result.built_count == 1
        assert len(rows) == 1
        assert decode_visual_cells(rows[0]["cells"])[0].footprint_id == 100
    finally:
        connection.close()


def test_build_visual_tiles_records_current_algorithm_signature(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (100, -100, 10, 5, 0, 0, 0, 0)
            """,
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (100, -100, -100, 10, 10)
            """,
        )

        build_visual_tiles(
            connection,
            min_zoom=1,
            max_zoom=1,
            bucket="all",
            updated_at=1234,
        )

        row = connection.execute(
            "SELECT value FROM footprint_meta WHERE key = ?",
            (VISUAL_TILE_ALGORITHM_SIGNATURE_KEY,),
        ).fetchone()
        assert tuple(row) == (VISUAL_TILE_ALGORITHM_SIGNATURE,)
    finally:
        connection.close()


def test_build_visual_tiles_default_updated_at_uses_unix_milliseconds(tmp_path, monkeypatch):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (100, 0, 0, 5, 0, 0, 0, 0)
            """,
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (100, 0, 0, 0, 0)
            """,
        )
        monkeypatch.setattr("enroute_api.footprints.visual_tiles.time.time", lambda: 1234.567)

        build_visual_tiles(
            connection,
            min_zoom=1,
            max_zoom=1,
            bucket="all",
            commit_interval=0,
        )

        row = connection.execute("SELECT updated_at FROM visual_tiles").fetchone()
        assert row["updated_at"] == 1234567
    finally:
        connection.close()


def test_tile_boundary_point_belongs_to_single_webmercator_tile(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (100, 0, 0, 5, 0, 0, 0, 0)
            """,
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (100, 0, 0, 0, 0)
            """,
        )

        for x in [0, 1]:
            build_visual_tile(
                connection,
                z=1,
                x=x,
                y=1,
                t_type=TIME_BUCKET_ALL,
                t=0,
                start_timestamp_seconds=0,
                end_timestamp_seconds=200,
                updated_at=1234,
            )

        rows = connection.execute(
            """
            SELECT x
            FROM visual_tiles
            WHERE z = 1 AND y = 1 AND t_type = ? AND t = 0
            ORDER BY x
            """,
            (TIME_BUCKET_ALL,),
        ).fetchall()
        assert [row["x"] for row in rows] == [1]
    finally:
        connection.close()


def test_builds_visual_tiles_for_shanghai_day_month_and_year_buckets(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        timestamp = calendar.timegm((2024, 2, 9, 16, 0, 0))
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (?, 0, 0, 5, 0, 0, 0, 0)
            """,
            (timestamp,),
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (?, 0, 0, 0, 0)
            """,
            (timestamp,),
        )

        for bucket in ["day", "month", "year"]:
            build_visual_tiles(
                connection,
                min_zoom=1,
                max_zoom=1,
                bucket=bucket,
                updated_at=1234,
                commit_interval=0,
            )

        rows = connection.execute(
            """
            SELECT z, x, y, t_type, t
            FROM visual_tiles
            ORDER BY t_type, t
            """,
        ).fetchall()

        assert [(row["z"], row["x"], row["y"], row["t_type"], row["t"]) for row in rows] == [
            (1, 1, 1, TIME_BUCKET_YEAR, 2024),
            (1, 1, 1, TIME_BUCKET_MONTH, 202402),
            (1, 1, 1, TIME_BUCKET_DAY, 20240210),
        ]
    finally:
        connection.close()


def test_empty_visual_tile_deletes_existing_row_instead_of_storing_empty_blob(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 0, 3, 19700101, 1, X'455654430100000000', 1000)
            """,
        )

        build_visual_tile(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=TIME_BUCKET_DAY,
            t=19700101,
            start_timestamp_seconds=0,
            end_timestamp_seconds=200,
            updated_at=1234,
        )

        row = connection.execute(
            """
            SELECT 1 FROM visual_tiles
            WHERE z = 1 AND x = 1 AND y = 0 AND t_type = 3 AND t = 19700101
            """,
        ).fetchone()
        assert row is None
    finally:
        connection.close()


def test_marks_existing_visual_tile_dirty_on_same_row(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 0, 3, 19700101, ?, X'455654430100000000', 1000)
            """,
            (STATUS_READY,),
        )

        mark_visual_tile_dirty(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=3,
            t=19700101,
            updated_at=2000,
        )

        rows = list(
            connection.execute(
                """
                SELECT status, cells, updated_at FROM visual_tiles
                WHERE z = 1 AND x = 1 AND y = 0 AND t_type = 3 AND t = 19700101
                """,
            ),
        )
        assert len(rows) == 1
        assert rows[0]["status"] == STATUS_DIRTY
        assert rows[0]["cells"] == bytes.fromhex("455654430100000000")
        assert rows[0]["updated_at"] == 2000
    finally:
        connection.close()


def test_mark_dirty_does_not_create_missing_visual_tile_row(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)

        mark_visual_tile_dirty(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=3,
            t=19700101,
            updated_at=2000,
        )

        count = connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
        assert count == 0
    finally:
        connection.close()


def test_splits_custom_range_into_year_month_day_buckets():
    buckets = split_time_range_into_buckets("2024-02-10", "2026-03-09")

    assert (TIME_BUCKET_YEAR, 2025) in buckets
    assert (TIME_BUCKET_MONTH, 202403) in buckets
    assert (TIME_BUCKET_MONTH, 202602) in buckets
    assert (TIME_BUCKET_DAY, 20240210) in buckets
    assert (TIME_BUCKET_DAY, 20260309) in buckets


def test_serves_footprint_mvt_from_ready_visual_tile(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "100,1,0,0,0,5,0,0,1,0,0",
            ],
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        store.import_footprints()
        blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=1, footprint_id=100, geom_x=2048, geom_y=2048),
            ],
        )
        store.connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 1, 0, 0, 1, ?, 1234)
            """,
            (blob,),
        )
        store.connection.commit()
        client = TestClient(
                create_app(
                    settings=Settings(
                        footprint_db_path=db_path,
                        footprint_data_path=data_path,
                        footprint_coordinate_system="wgs84",
                        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
                    ),
            ),
        )

        response = client.get("/api/map/tiles/footprints/1/1/1.mvt?range=all")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.mapbox-vector-tile"
        assert response.content
    finally:
        store.close()


def test_serves_whole_world_footprint_tile_debug_metrics_below_z2(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "100,1,0,0,0,5,0,0,1,0,0",
            ],
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        store.import_footprints()
        blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=1, footprint_id=100, geom_x=2048, geom_y=2048),
                VisualCellRecord(cell_id=2, footprint_id=101, geom_x=2050, geom_y=2050),
            ],
        )
        store.connection.execute(
            """
            INSERT INTO visual_tiles (
              z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
            )
            VALUES (1, 1, 1, 0, 0, ?, ?, 5, 2, 1234)
            """,
            (STATUS_READY, blob),
        )
        store.connection.commit()
        client = TestClient(
            create_app(
                settings=Settings(
                    footprint_db_path=db_path,
                    footprint_data_path=data_path,
                    footprint_coordinate_system="wgs84",
                    admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
                ),
            ),
        )

        response = client.get(
            "/api/map/tiles/footprints/debug?z=1&west=0&south=-80&east=179&north=0&range=all",
        )

        assert response.status_code == 200
        assert response.json() == {
            "tileZoom": 1,
            "requestedTileCount": 4,
            "populatedTileCount": 1,
            "readyTileCount": 1,
            "dirtyTileCount": 0,
            "rawCount": 5,
            "representativeCount": 2,
            "renderRatio": 0.4,
        }
    finally:
        store.close()


def test_serves_footprint_tile_debug_metrics_for_explicit_tile_keys(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "100,1,0,0,0,5,0,0,1,0,0",
            ],
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        store.import_footprints()
        inside_blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=1, footprint_id=100, geom_x=2048, geom_y=2048),
                VisualCellRecord(cell_id=2, footprint_id=101, geom_x=2050, geom_y=2050),
            ],
        )
        outside_blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=3, footprint_id=200, geom_x=10, geom_y=10),
            ],
        )
        store.connection.execute(
            """
            INSERT INTO visual_tiles (
              z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
            )
            VALUES (1, 1, 0, 0, 0, ?, ?, 5, 2, 1234)
            """,
            (STATUS_READY, inside_blob),
        )
        store.connection.execute(
            """
            INSERT INTO visual_tiles (
              z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
            )
            VALUES (1, 0, 0, 0, 0, ?, ?, 7, 1, 1234)
            """,
            (STATUS_READY, outside_blob),
        )
        store.connection.commit()
        client = TestClient(
            create_app(
                settings=Settings(
                    footprint_db_path=db_path,
                    footprint_data_path=data_path,
                    footprint_coordinate_system="wgs84",
                    admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
                ),
            ),
        )

        response = client.get(
            "/api/map/tiles/footprints/debug?z=1&tiles=1/0,1/1&range=all",
        )

        assert response.status_code == 200
        assert response.json() == {
            "tileZoom": 1,
            "requestedTileCount": 2,
            "populatedTileCount": 1,
            "readyTileCount": 1,
            "dirtyTileCount": 0,
            "rawCount": 5,
            "representativeCount": 2,
            "renderRatio": 0.4,
        }
    finally:
        store.close()


def test_mvt_request_reads_existing_visual_tile_when_csv_changes(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956",
            ],
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        store.import_footprints()
        blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=1, footprint_id=1768144456, geom_x=2048, geom_y=2048),
            ],
        )
        store.connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (16, 54888, 26764, 0, 0, ?, ?, 1000)
            """,
            (STATUS_READY, blob),
        )
        store.connection.commit()
    finally:
        store.close()

    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956",
                "1768144457,1,121.511384,31.296565,0.000000,4.729415,-1.000000,12.500000,1,0,10.146956",
            ],
        ),
        encoding="utf-8",
    )
    client = TestClient(
        create_app(
            settings=Settings(
                footprint_db_path=db_path,
                footprint_data_path=data_path,
                footprint_coordinate_system="wgs84",
                admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
            ),
        ),
    )

    response = client.get("/api/map/tiles/footprints/16/54888/26764.mvt?range=all")

    assert response.status_code == 200
    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT status
            FROM visual_tiles
            WHERE z = 16 AND x = 54888 AND y = 26764 AND t_type = 0 AND t = 0
            """,
        ).fetchone()
        footprint_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0]
    assert row == (STATUS_READY,)
    assert footprint_count == 1


def test_dirty_mvt_request_rebuilds_visual_tile_after_serving_old_cells(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956",
                "1768144457,1,121.511484,31.296665,0.000000,4.729415,-1.000000,12.500000,1,0,10.146956",
            ],
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        store.import_footprints()
        blob = encode_visual_cells(
            [
                VisualCellRecord(cell_id=1, footprint_id=1768144456, geom_x=2048, geom_y=2048),
            ],
        )
        store.connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (16, 54888, 26764, 0, 0, ?, ?, 1000)
            """,
            (STATUS_DIRTY, blob),
        )
        store.connection.commit()

        content = store.get_footprint_mvt(z=16, x=54888, y=26764, range_value="all")

        deadline = time.monotonic() + 5
        row = None
        while time.monotonic() < deadline:
            row = store.connection.execute(
                """
                SELECT status, cells
                FROM visual_tiles
                WHERE z = 16 AND x = 54888 AND y = 26764 AND t_type = 0 AND t = 0
                """,
            ).fetchone()
            if row is not None and row["status"] == STATUS_READY:
                break
            time.sleep(0.05)
        row = store.connection.execute(
            """
            SELECT status, cells
            FROM visual_tiles
            WHERE z = 16 AND x = 54888 AND y = 26764 AND t_type = 0 AND t = 0
            """,
        ).fetchone()
    finally:
        store.close()

    assert content
    assert row is not None
    assert row["status"] == STATUS_READY
    rebuilt_records = decode_visual_cells(row["cells"])
    assert len(rebuilt_records) >= 2
    assert {record.footprint_id for record in rebuilt_records} >= {1768144456, 1768144457}


def test_mvt_request_treats_missing_visual_tile_row_as_empty_even_when_raw_points_exist(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1781840000,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956",
            ],
        ),
        encoding="utf-8",
    )
    client = TestClient(
        create_app(
            settings=Settings(
                footprint_db_path=db_path,
                footprint_data_path=data_path,
                footprint_coordinate_system="wgs84",
                admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
            ),
        ),
    )

    response = client.get(
        "/api/map/tiles/footprints/16/54888/26764.mvt?start=2026-06-19&end=2026-06-19",
    )

    assert response.status_code == 204
    assert response.content == b""
    with sqlite3.connect(db_path) as connection:
        visual_tile_count = connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()
    assert visual_tile_count == (0,)


def test_missing_visual_tile_row_means_empty_without_creating_row(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        client = TestClient(
                create_app(
                    settings=Settings(
                        footprint_db_path=db_path,
                        footprint_data_path=data_path,
                        footprint_coordinate_system="wgs84",
                        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
                    ),
            ),
        )

        response = client.get("/api/map/tiles/footprints/1/1/1.mvt?range=all")

        assert response.status_code == 204
        assert response.content == b""
        count = store.connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
        assert count == 0
    finally:
        store.close()
