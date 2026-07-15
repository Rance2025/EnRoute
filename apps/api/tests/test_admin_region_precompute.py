from __future__ import annotations

import importlib
import json
import sqlite3

import pytest

from enroute_api.admin_regions.precompute_meta import (
    DAILY_STATS_SIGNATURE_KEY,
    THUMBNAIL_BASE_SIGNATURE_KEY,
    THUMBNAIL_PATH_SIGNATURE_KEY,
)
from enroute_api.admin_regions.store import load_admin_regions
from enroute_api.admin_regions.tiles import delete_admin_region_tile
from enroute_api.footprints.store import initialize_schema
from enroute_api.footprints.store import backfill_footprint_region_ids, insert_footprint_if_new


def test_initialize_admin_region_summary_schema_creates_constrained_without_rowid_tables() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")

    precompute.initialize_admin_region_summary_schema(connection)

    schema_by_name = {
        str(row[0]): str(row[1])
        for row in connection.execute(
            """
            SELECT name, sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name LIKE 'admin_region_%'
            ORDER BY name
            """,
        )
    }
    assert set(schema_by_name) == {
        "admin_region_daily_stats",
        "admin_region_thumbnail_bases",
        "admin_region_thumbnail_region_paths",
    }
    assert all("WITHOUT ROWID" in sql.upper() for sql in schema_by_name.values())
    assert primary_key_columns(connection, "admin_region_thumbnail_bases") == ["scope"]
    assert primary_key_columns(connection, "admin_region_thumbnail_region_paths") == [
        "depth",
        "region_id",
    ]
    assert primary_key_columns(connection, "admin_region_daily_stats") == [
        "depth",
        "day",
        "region_id",
    ]

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_thumbnail_bases (
              scope, view_box, path, source_depth, source_z, source_x, source_y,
              source_signature, algorithm_signature, updated_at
            ) VALUES ('invalid', '0 0 320 180', 'M0 0Z', 1, 0, 0, 0, 'source', 'algorithm', 1)
            """,
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_thumbnail_region_paths (
              depth, region_id, path, source_signature, algorithm_signature
            ) VALUES (5, 'region', 'M0 0Z', 'source', 'algorithm')
            """,
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_daily_stats (
              depth, day, region_id, footprint_count
            ) VALUES (1, 20260715, 'CN', 0)
            """,
        )


def test_initialize_footprint_schema_includes_admin_region_summary_tables() -> None:
    connection = sqlite3.connect(":memory:")

    initialize_schema(connection)

    table_names = {
        str(row[0])
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    assert {
        "admin_region_thumbnail_bases",
        "admin_region_thumbnail_region_paths",
        "admin_region_daily_stats",
    } <= table_names


def test_thumbnail_source_signatures_cover_only_their_required_z0_and_z1_tiles() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    for depth, z, x, y, marker in (
        (1, 0, 0, 0, b"world"),
        (2, 1, 1, 0, b"province"),
        (3, 1, 1, 0, b"city"),
        (4, 1, 1, 0, b"district"),
        (4, 0, 0, 0, b"unrelated"),
    ):
        insert_admin_region_tile(
            connection,
            depth=depth,
            z=z,
            x=x,
            y=y,
            marker=marker,
        )

    base_signature = json.loads(
        precompute.create_admin_region_thumbnail_base_source_signature(connection),
    )
    path_signature = json.loads(
        precompute.create_admin_region_thumbnail_path_source_signature(connection),
    )

    assert base_signature["algorithmSignature"] == precompute.ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE
    assert [
        (row["depth"], row["z"], row["x"], row["y"], row["byteLength"])
        for row in base_signature["tiles"]
    ] == [(1, 0, 0, 0, 5), (2, 1, 1, 0, 8)]
    assert [
        (row["depth"], row["z"], row["x"], row["y"])
        for row in path_signature["tiles"]
    ] == [
        (1, 0, 0, 0),
        (2, 1, 1, 0),
        (3, 1, 1, 0),
        (4, 1, 1, 0),
    ]

    connection.execute(
        "UPDATE admin_region_tiles SET updated_at = 99 WHERE depth = 4 AND z = 0",
    )
    assert json.loads(
        precompute.create_admin_region_thumbnail_base_source_signature(connection),
    ) == base_signature
    connection.execute(
        "UPDATE admin_region_tiles SET updated_at = 99 WHERE depth = 3 AND z = 1",
    )
    assert json.loads(
        precompute.create_admin_region_thumbnail_path_source_signature(connection),
    ) != path_signature


def test_thumbnail_source_signature_rejects_missing_required_tile() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_admin_region_tile(
        connection,
        depth=1,
        z=0,
        x=0,
        y=0,
        marker=b"world",
    )

    with pytest.raises(precompute.AdminRegionPrecomputeSourceError, match="2/1/1/0"):
        precompute.create_admin_region_thumbnail_base_source_signature(connection)


def test_new_footprint_invalidates_only_daily_stats_precompute_signature() -> None:
    connection = create_connection_with_ready_signatures()

    inserted = insert_footprint_if_new(
        connection,
        {
            "timestampSeconds": 1_721_016_000,
            "longitude": 121.47,
            "latitude": 31.23,
            "accuracy": 5.0,
            "speed": 0.0,
            "distance": 0.0,
            "heading": 0.0,
            "altitude": 3.0,
        },
        region_matcher=StaticRegionMatcher(None),
    )

    assert inserted is True
    assert read_ready_signature_keys(connection) == {
        THUMBNAIL_BASE_SIGNATURE_KEY,
        THUMBNAIL_PATH_SIGNATURE_KEY,
    }


def test_region_id_backfill_invalidates_daily_stats_precompute_signature() -> None:
    connection = create_connection_with_ready_signatures()
    connection.execute(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed,
          distance, heading, altitude, region_id
        ) VALUES (1, 121.47, 31.23, 5, 0, 0, 0, 3, NULL)
        """,
    )

    result = backfill_footprint_region_ids(
        connection,
        region_matcher=StaticRegionMatcher("310100"),
    )

    assert result["updated_count"] == 1
    assert read_ready_signature_keys(connection) == {
        THUMBNAIL_BASE_SIGNATURE_KEY,
        THUMBNAIL_PATH_SIGNATURE_KEY,
    }


def test_admin_region_reload_invalidates_all_summary_precompute_signatures() -> None:
    connection = create_connection_with_ready_signatures()

    load_admin_regions(connection, {"type": "FeatureCollection", "features": []})

    assert read_ready_signature_keys(connection) == set()


def test_admin_region_tile_delete_invalidates_thumbnail_precompute_signatures() -> None:
    connection = create_connection_with_ready_signatures()
    insert_admin_region_tile(
        connection,
        depth=1,
        z=0,
        x=0,
        y=0,
        marker=b"world",
    )

    delete_admin_region_tile(
        connection,
        z=0,
        x=0,
        y=0,
        focus_region_id="world",
        depth=1,
    )

    assert read_ready_signature_keys(connection) == {DAILY_STATS_SIGNATURE_KEY}


def primary_key_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return [str(row[1]) for row in sorted(rows, key=lambda row: int(row[5])) if int(row[5]) > 0]


def insert_admin_region_tile(
    connection: sqlite3.Connection,
    *,
    depth: int,
    z: int,
    x: int,
    y: int,
    marker: bytes,
) -> None:
    connection.execute(
        """
        INSERT INTO admin_region_tiles (
          z, x, y, focus_region_id, depth, algorithm_signature,
          tile, feature_count, updated_at
        ) VALUES (?, ?, ?, 'world', ?, ?, ?, 1, ?)
        """,
        (z, x, y, depth, f"tile-v{depth}", marker, depth),
    )


def create_connection_with_ready_signatures() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    connection.executemany(
        "INSERT INTO footprint_meta (key, value) VALUES (?, 'ready')",
        (
            (THUMBNAIL_BASE_SIGNATURE_KEY,),
            (THUMBNAIL_PATH_SIGNATURE_KEY,),
            (DAILY_STATS_SIGNATURE_KEY,),
        ),
    )
    return connection


def read_ready_signature_keys(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute(
            "SELECT key FROM footprint_meta WHERE key LIKE 'adminRegion%PrecomputeSignature'",
        )
    }


class StaticRegionMatcher:
    def __init__(self, region_id: str | None) -> None:
        self.region_id = region_id

    def find_finest_region_id(self, *, longitude: float, latitude: float) -> str | None:
        del longitude, latitude
        return self.region_id
