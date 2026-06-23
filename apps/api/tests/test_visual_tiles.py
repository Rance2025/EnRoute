from __future__ import annotations

import sqlite3

from enroute_api.footprints.store import initialize_schema
from enroute_api.footprints.visual_tile_codec import decode_visual_cells
from enroute_api.footprints.visual_tiles import (
    STATUS_DIRTY,
    STATUS_READY,
    TIME_BUCKET_DAY,
    build_visual_tile,
    mark_visual_tile_dirty,
)


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
