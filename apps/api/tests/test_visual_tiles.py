from __future__ import annotations

import sqlite3

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
    TIME_BUCKET_DAY,
    TIME_BUCKET_MONTH,
    TIME_BUCKET_YEAR,
    build_visual_tile,
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
            (100, 0.0, 0.0),
            (101, 0.000001, 0.000001),
            (102, 1.0, 1.0),
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
    store = FootprintStore(
        db_path=db_path,
        data_path=tmp_path / "missing.csv",
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
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
                    footprint_data_path=tmp_path / "missing.csv",
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


def test_missing_visual_tile_row_means_empty_without_creating_row(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    store = FootprintStore(
        db_path=db_path,
        data_path=tmp_path / "missing.csv",
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        client = TestClient(
            create_app(
                settings=Settings(
                    footprint_db_path=db_path,
                    footprint_data_path=tmp_path / "missing.csv",
                    footprint_coordinate_system="wgs84",
                    admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
                ),
            ),
        )

        response = client.get("/api/map/tiles/footprints/1/1/1.mvt?range=all")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.mapbox-vector-tile"
        assert response.content == b""
        count = store.connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
        assert count == 0
    finally:
        store.close()
