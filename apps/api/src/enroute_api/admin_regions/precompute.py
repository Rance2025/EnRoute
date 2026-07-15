from __future__ import annotations

import json
import sqlite3

from .precompute_meta import (
    ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE,
    THUMBNAIL_BASE_TILE_KEYS,
    THUMBNAIL_PATH_TILE_KEYS,
)


class AdminRegionPrecomputeSourceError(RuntimeError):
    pass


def initialize_admin_region_summary_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS admin_region_thumbnail_bases (
          scope TEXT PRIMARY KEY,
          view_box TEXT NOT NULL,
          path TEXT NOT NULL,
          source_depth INTEGER NOT NULL,
          source_z INTEGER NOT NULL,
          source_x INTEGER NOT NULL,
          source_y INTEGER NOT NULL,
          source_signature TEXT NOT NULL,
          algorithm_signature TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          CHECK (scope IN ('world', 'china'))
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS admin_region_thumbnail_region_paths (
          depth INTEGER NOT NULL,
          region_id TEXT NOT NULL,
          path TEXT NOT NULL,
          source_signature TEXT NOT NULL,
          algorithm_signature TEXT NOT NULL,
          PRIMARY KEY (depth, region_id),
          CHECK (depth BETWEEN 1 AND 4)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS admin_region_daily_stats (
          depth INTEGER NOT NULL,
          day INTEGER NOT NULL,
          region_id TEXT NOT NULL,
          footprint_count INTEGER NOT NULL,
          PRIMARY KEY (depth, day, region_id),
          CHECK (depth BETWEEN 1 AND 4),
          CHECK (footprint_count > 0)
        ) WITHOUT ROWID;
        """,
    )


def create_admin_region_thumbnail_base_source_signature(
    connection: sqlite3.Connection,
) -> str:
    return create_admin_region_thumbnail_source_signature(
        connection,
        required_tile_keys=THUMBNAIL_BASE_TILE_KEYS,
    )


def create_admin_region_thumbnail_path_source_signature(
    connection: sqlite3.Connection,
) -> str:
    return create_admin_region_thumbnail_source_signature(
        connection,
        required_tile_keys=THUMBNAIL_PATH_TILE_KEYS,
    )


def create_admin_region_thumbnail_source_signature(
    connection: sqlite3.Connection,
    *,
    required_tile_keys: tuple[tuple[int, int, int, int], ...],
) -> str:
    predicate = " OR ".join(
        "(depth = ? AND z = ? AND x = ? AND y = ?)" for _key in required_tile_keys
    )
    parameters = tuple(value for key in required_tile_keys for value in key)
    rows = connection.execute(
        f"""
        SELECT
          depth,
          z,
          x,
          y,
          algorithm_signature,
          updated_at,
          LENGTH(tile) AS byte_length
        FROM admin_region_tiles
        WHERE focus_region_id = 'world'
          AND ({predicate})
        ORDER BY depth, z, x, y
        """,
        parameters,
    ).fetchall()
    metadata_by_key = {
        (int(row[0]), int(row[1]), int(row[2]), int(row[3])): {
            "depth": int(row[0]),
            "z": int(row[1]),
            "x": int(row[2]),
            "y": int(row[3]),
            "algorithmSignature": str(row[4]),
            "updatedAt": int(row[5]),
            "byteLength": int(row[6]),
        }
        for row in rows
    }
    missing_keys = [key for key in required_tile_keys if key not in metadata_by_key]
    if missing_keys:
        missing = ", ".join("/".join(str(value) for value in key) for key in missing_keys)
        raise AdminRegionPrecomputeSourceError(
            f"required admin-region thumbnail tile is missing: {missing}",
        )
    return json.dumps(
        {
            "algorithmSignature": ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE,
            "tiles": [metadata_by_key[key] for key in required_tile_keys],
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
