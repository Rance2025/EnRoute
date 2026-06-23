from __future__ import annotations

import sqlite3

from enroute_api.footprints.store import initialize_schema


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
