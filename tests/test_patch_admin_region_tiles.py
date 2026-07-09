from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from scripts.patch_admin_region_tiles import main


def test_patch_admin_region_tiles_inserts_greenland_and_keeps_existing_tiles(tmp_path: Path):
    database_path = tmp_path / "footprints.sqlite"
    source_path = tmp_path / "greenland-source.geojson"
    source_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "name": "Greenland",
                            "ISO3166-1-Alpha-3": "GRL",
                            "ISO3166-1-Alpha-2": "GL",
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-52, 70], [-48, 70], [-48, 72], [-52, 72], [-52, 70]]],
                        },
                    },
                ],
            },
        ),
        encoding="utf-8",
    )
    connection = sqlite3.connect(database_path)
    try:
        connection.executescript(
            """
            CREATE TABLE admin_regions (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              level INTEGER NOT NULL,
              geometry TEXT NOT NULL,
              line_geometry TEXT,
              line_mask_geometry TEXT,
              min_lng REAL NOT NULL,
              max_lng REAL NOT NULL,
              min_lat REAL NOT NULL,
              max_lat REAL NOT NULL,
              first_seen_timestamp INTEGER,
              footprint_count INTEGER NOT NULL DEFAULT 0,
              stay_duration_seconds INTEGER NOT NULL DEFAULT 0,
              travel_distance_meters REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE admin_region_tree (
              parent_id TEXT NOT NULL,
              child_id TEXT NOT NULL,
              PRIMARY KEY (parent_id, child_id)
            );
            CREATE TABLE admin_region_tiles (
              z INTEGER NOT NULL,
              x INTEGER NOT NULL,
              y INTEGER NOT NULL,
              focus_region_id TEXT NOT NULL,
              depth INTEGER NOT NULL,
              algorithm_signature TEXT NOT NULL DEFAULT '',
              tile BLOB NOT NULL,
              feature_count INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (z, x, y, focus_region_id, depth)
            ) WITHOUT ROWID;
            INSERT INTO admin_region_tiles
              (z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at)
            VALUES
              (0, 0, 0, 'world', 2, 'sentinel', x'00', 1, 111);
            """,
        )
        connection.commit()
    finally:
        connection.close()

    exit_code = main(
        [
            "--database",
            str(database_path),
            "--greenland-source",
            str(source_path),
            "--min-zoom",
            "0",
            "--max-zoom",
            "0",
            "--depth",
            "1",
        ],
    )

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        greenland = connection.execute(
            "SELECT id, name, level FROM admin_regions WHERE id = 'gl'",
        ).fetchone()
        sentinel = connection.execute(
            """
            SELECT algorithm_signature, updated_at
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 2
            """,
        ).fetchone()
        country_tile = connection.execute(
            """
            SELECT feature_count
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 1
            """,
        ).fetchone()
    finally:
        connection.close()

    assert exit_code == 0
    assert dict(greenland) == {"id": "gl", "name": "Greenland", "level": 1}
    assert dict(sentinel) == {"algorithm_signature": "sentinel", "updated_at": 111}
    assert country_tile["feature_count"] > 0
