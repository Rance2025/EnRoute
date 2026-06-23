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
    STATUS_DIRTY,
    STATUS_READY,
    TIME_BUCKET_ALL,
    TIME_BUCKET_DAY,
    TIME_BUCKET_MONTH,
    TIME_BUCKET_YEAR,
    build_visual_tile,
    build_visual_tiles,
    mark_visual_tile_dirty,
    split_time_range_into_buckets,
)
from enroute_api.main import create_app


def column_names(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info({table_name})")]


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
            "updated_at",
        ]
        indexes = list(connection.execute("PRAGMA index_list(visual_tiles)"))
        assert indexes
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


def test_mvt_request_imports_changed_csv_before_reading_visual_tiles(tmp_path):
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
            VALUES (18, 219553, 107056, 0, 0, ?, ?, 1000)
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

    response = client.get("/api/map/tiles/footprints/18/219553/107056.mvt?range=all")

    assert response.status_code == 200
    deadline = time.monotonic() + 5
    row = None
    footprint_count = 0
    while time.monotonic() < deadline:
        with sqlite3.connect(db_path) as connection:
            row = connection.execute(
                """
                SELECT status
                FROM visual_tiles
                WHERE z = 18 AND x = 219553 AND y = 107056 AND t_type = 0 AND t = 0
                """,
            ).fetchone()
            footprint_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0]
        if row == (STATUS_READY,):
            break
        time.sleep(0.05)
    assert row == (STATUS_READY,)
    assert footprint_count == 2


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
            VALUES (18, 219553, 107056, 0, 0, ?, ?, 1000)
            """,
            (STATUS_DIRTY, blob),
        )
        store.connection.commit()

        content = store.get_footprint_mvt(z=18, x=219553, y=107056, range_value="all")

        deadline = time.monotonic() + 5
        row = None
        while time.monotonic() < deadline:
            row = store.connection.execute(
                """
                SELECT status, cells
                FROM visual_tiles
                WHERE z = 18 AND x = 219553 AND y = 107056 AND t_type = 0 AND t = 0
                """,
            ).fetchone()
            if row is not None and row["status"] == STATUS_READY:
                break
            time.sleep(0.05)
        row = store.connection.execute(
            """
            SELECT status, cells
            FROM visual_tiles
            WHERE z = 18 AND x = 219553 AND y = 107056 AND t_type = 0 AND t = 0
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
