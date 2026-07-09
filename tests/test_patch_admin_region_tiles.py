from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from mapbox_vector_tile import encode

from scripts.patch_admin_region_tiles import main
from enroute_api.admin_regions.tiles import (
    ADMIN_REGION_TILE_LAYER_NAME,
    ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
    decode_admin_region_tile,
)


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


def test_patch_admin_region_tiles_merges_greenland_into_existing_country_tile(tmp_path: Path):
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
    existing_tile = encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [64, 0], [64, 64], [0, 64], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "existing-country",
                            "name": "Existing Country",
                            "level": 1,
                            "kind": "fill",
                        },
                    },
                ],
            },
        ],
        default_options={"extents": 4096, "y_coord_down": True},
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
            """,
        )
        connection.execute(
            """
            INSERT INTO admin_regions (
              id,
              name,
              level,
              geometry,
              line_geometry,
              line_mask_geometry,
              min_lng,
              max_lng,
              min_lat,
              max_lat,
              first_seen_timestamp,
              footprint_count,
              stay_duration_seconds,
              travel_distance_meters
            ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, 0, 0, 0)
            """,
            (
                "existing-country",
                "Existing Country",
                1,
                json.dumps(
                    {
                        "type": "Polygon",
                        "coordinates": [[[-60, 68], [-46, 68], [-46, 74], [-60, 74], [-60, 68]]],
                    },
                    separators=(",", ":"),
                ),
                -60,
                -46,
                68,
                74,
            ),
        )
        connection.execute(
            """
            INSERT INTO admin_region_tiles
              (z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at)
            VALUES
              (0, 0, 0, 'world', 1, 'existing-signature', ?, 1, 222)
            """,
            (existing_tile,),
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
            "--skip-build-zooms",
            "--greenland-min-zoom",
            "0",
            "--greenland-max-zoom",
            "0",
        ],
    )

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        tile_row = connection.execute(
            """
            SELECT tile, feature_count
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 1
            """,
        ).fetchone()
    finally:
        connection.close()

    decoded = decode_admin_region_tile(bytes(tile_row["tile"]))
    properties = [
        feature["properties"]
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    ]
    region_ids = {str(property_values.get("region_id")) for property_values in properties}

    assert exit_code == 0
    assert "existing-country" in region_ids
    assert "gl" in region_ids
    assert tile_row["feature_count"] == len(properties)


def test_patch_admin_region_tiles_builds_only_missing_country_tiles(tmp_path: Path):
    database_path = tmp_path / "footprints.sqlite"
    sentinel_tile = encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [4096, 0], [4096, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "sentinel",
                            "name": "Sentinel",
                            "level": 1,
                            "kind": "fill",
                        },
                    },
                ],
            },
        ],
        default_options={"extents": 4096, "y_coord_down": True},
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
            """,
        )
        for region_id, name, geometry, bbox in [
            (
                "west",
                "West Country",
                {"type": "Polygon", "coordinates": [[[-170, 5], [-160, 5], [-160, 15], [-170, 15], [-170, 5]]]},
                (-170, -160, 5, 15),
            ),
            (
                "east",
                "East Country",
                {"type": "Polygon", "coordinates": [[[160, 5], [170, 5], [170, 15], [160, 15], [160, 5]]]},
                (160, 170, 5, 15),
            ),
        ]:
            connection.execute(
                """
                INSERT INTO admin_regions (
                  id,
                  name,
                  level,
                  geometry,
                  line_geometry,
                  line_mask_geometry,
                  min_lng,
                  max_lng,
                  min_lat,
                  max_lat,
                  first_seen_timestamp,
                  footprint_count,
                  stay_duration_seconds,
                  travel_distance_meters
                ) VALUES (?, ?, 1, ?, NULL, NULL, ?, ?, ?, ?, NULL, 0, 0, 0)
                """,
                (
                    region_id,
                    name,
                    json.dumps(geometry, separators=(",", ":")),
                    bbox[0],
                    bbox[1],
                    bbox[2],
                    bbox[3],
                ),
            )
        connection.execute(
            """
            INSERT INTO admin_region_tiles
              (z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at)
            VALUES
              (1, 0, 0, 'world', 1, 'sentinel-signature', ?, 1, 222)
            """,
            (sentinel_tile,),
        )
        connection.commit()
    finally:
        connection.close()

    exit_code = main(
        [
            "--database",
            str(database_path),
            "--skip-greenland",
            "--skip-build-zooms",
            "--patch-missing-tiles",
            "--depth",
            "1",
            "--min-zoom",
            "1",
            "--max-zoom",
            "1",
        ],
    )

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        sentinel = connection.execute(
            """
            SELECT algorithm_signature, updated_at
            FROM admin_region_tiles
            WHERE z = 1 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 1
            """,
        ).fetchone()
        new_tile = connection.execute(
            """
            SELECT tile, feature_count
            FROM admin_region_tiles
            WHERE z = 1 AND x = 1 AND y = 0 AND focus_region_id = 'world' AND depth = 1
            """,
        ).fetchone()
    finally:
        connection.close()

    decoded = decode_admin_region_tile(bytes(new_tile["tile"]))
    region_ids = {
        str(feature["properties"].get("region_id"))
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"].get("kind") == "fill"
    }

    assert exit_code == 0
    assert dict(sentinel) == {"algorithm_signature": "sentinel-signature", "updated_at": 222}
    assert "east" in region_ids
    assert new_tile["feature_count"] > 0


def test_patch_admin_region_tiles_restores_china_levels_and_rebuilds_only_requested_depths(
    tmp_path: Path,
):
    database_path = tmp_path / "footprints.sqlite"
    china_source_path = tmp_path / "china-admin-regions.geojson"
    china_country_id = "china-country-uuid"
    china_source_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "id": "310000",
                            "adcode": "310000",
                            "name": "Shanghai",
                            "level": "province",
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[120, 30], [123, 30], [123, 33], [120, 33], [120, 30]]],
                        },
                    },
                    {
                        "type": "Feature",
                        "properties": {
                            "id": "310100",
                            "adcode": "310100",
                            "parent": "310000",
                            "name": "Shanghai City",
                            "level": "city",
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]]],
                        },
                    },
                    {
                        "type": "Feature",
                        "properties": {
                            "id": "310115",
                            "adcode": "310115",
                            "parent": "310100",
                            "name": "Pudong",
                            "level": "district",
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [[121.4, 31.1], [121.8, 31.1], [121.8, 31.4], [121.4, 31.4], [121.4, 31.1]],
                            ],
                        },
                    },
                ],
            },
        ),
        encoding="utf-8",
    )
    country_tile = encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [4096, 0], [4096, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": china_country_id,
                            "name": "China",
                            "level": 1,
                            "kind": "fill",
                        },
                    },
                ],
            },
        ],
        default_options={"extents": 4096, "y_coord_down": True},
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
            """
        )
        connection.execute(
            """
            INSERT INTO admin_regions (
              id,
              name,
              level,
              geometry,
              line_geometry,
              line_mask_geometry,
              min_lng,
              max_lng,
              min_lat,
              max_lat,
              first_seen_timestamp,
              footprint_count,
              stay_duration_seconds,
              travel_distance_meters
            ) VALUES (?, ?, 1, ?, NULL, NULL, ?, ?, ?, ?, NULL, 0, 0, 0)
            """,
            (
                china_country_id,
                "\u4e2d\u56fd",
                json.dumps(
                    {
                        "type": "Polygon",
                        "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                    },
                    separators=(",", ":"),
                ),
                70,
                135,
                15,
                55,
            ),
        )
        connection.execute(
            """
            INSERT INTO admin_region_tiles
              (z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at)
            VALUES
              (0, 0, 0, 'world', 1, 'sentinel-country-signature', ?, 1, 222),
              (0, 0, 0, 'world', 2, 'legacy-depth2-signature', x'00', 1, 333)
            """,
            (country_tile,),
        )
        connection.commit()
    finally:
        connection.close()

    exit_code = main(
        [
            "--database",
            str(database_path),
            "--skip-greenland",
            "--skip-build-zooms",
            "--china-admin-region-data-path",
            str(china_source_path),
            "--rebuild-china-admin-levels",
            "--depths",
            "2,3,4",
            "--min-zoom",
            "0",
            "--max-zoom",
            "0",
        ],
    )

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        level_counts = [
            tuple(row)
            for row in connection.execute(
                "SELECT level, COUNT(*) FROM admin_regions GROUP BY level ORDER BY level",
            )
        ]
        tree_rows = [
            tuple(row)
            for row in connection.execute(
                "SELECT parent_id, child_id FROM admin_region_tree ORDER BY parent_id, child_id",
            )
        ]
        country_sentinel = connection.execute(
            """
            SELECT algorithm_signature, updated_at
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 1
            """,
        ).fetchone()
        rebuilt_depth_tiles = [
            tuple(row)
            for row in connection.execute(
                """
                SELECT depth, algorithm_signature
                FROM admin_region_tiles
                WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth IN (2, 3, 4)
                ORDER BY depth
                """,
            )
        ]
        depth_4_tile = connection.execute(
            """
            SELECT tile
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 4
            """,
        ).fetchone()
    finally:
        connection.close()

    decoded = decode_admin_region_tile(bytes(depth_4_tile["tile"]))
    depth_4_region_ids = {
        str(feature["properties"].get("region_id"))
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"].get("kind") == "fill"
    }

    assert exit_code == 0
    assert level_counts == [(1, 1), (2, 1), (3, 1), (4, 1)]
    assert tree_rows == [("310000", "310100"), ("310100", "310115"), (china_country_id, "310000")]
    assert dict(country_sentinel) == {"algorithm_signature": "sentinel-country-signature", "updated_at": 222}
    assert rebuilt_depth_tiles == [
        (2, ADMIN_REGION_TILE_ALGORITHM_SIGNATURE),
        (3, ADMIN_REGION_TILE_ALGORITHM_SIGNATURE),
        (4, ADMIN_REGION_TILE_ALGORITHM_SIGNATURE),
    ]
    assert depth_4_region_ids == {"310115"}


def test_patch_admin_region_tiles_rebuilds_existing_admin_tile_range_without_reloading_sources(
    tmp_path: Path,
):
    database_path = tmp_path / "footprints.sqlite"
    country_tile = encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [4096, 0], [4096, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "cn",
                            "name": "China",
                            "level": 1,
                            "kind": "fill",
                        },
                    },
                ],
            },
        ],
        default_options={"extents": 4096, "y_coord_down": True},
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
            INSERT INTO admin_regions (
              id,
              name,
              level,
              geometry,
              line_geometry,
              line_mask_geometry,
              min_lng,
              max_lng,
              min_lat,
              max_lat,
              first_seen_timestamp,
              footprint_count,
              stay_duration_seconds,
              travel_distance_meters
            ) VALUES
              (
                'cn',
                'China',
                1,
                '{"type":"Polygon","coordinates":[[[70,15],[135,15],[135,55],[70,55],[70,15]]]}',
                NULL,
                NULL,
                70,
                135,
                15,
                55,
                NULL,
                0,
                0,
                0
              ),
              (
                '310000',
                'Shanghai',
                2,
                '{"type":"Polygon","coordinates":[[[120,30],[123,30],[123,33],[120,33],[120,30]]]}',
                NULL,
                NULL,
                120,
                123,
                30,
                33,
                NULL,
                0,
                0,
                0
              );
            INSERT INTO admin_region_tree (parent_id, child_id) VALUES ('cn', '310000');
            """
        )
        connection.execute(
            """
            INSERT INTO admin_region_tiles
              (z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at)
            VALUES
              (0, 0, 0, 'world', 1, 'sentinel-country-signature', ?, 1, 222),
              (0, 0, 0, 'world', 2, 'legacy-depth2-signature', x'00', 1, 333)
            """,
            (country_tile,),
        )
        connection.commit()
    finally:
        connection.close()

    exit_code = main(
        [
            "--database",
            str(database_path),
            "--skip-greenland",
            "--skip-build-zooms",
            "--rebuild-admin-region-tiles",
            "--depth",
            "2",
            "--min-zoom",
            "0",
            "--max-zoom",
            "0",
        ],
    )

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        country_sentinel = connection.execute(
            """
            SELECT algorithm_signature, updated_at
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 1
            """,
        ).fetchone()
        rebuilt_depth_tile = connection.execute(
            """
            SELECT algorithm_signature, tile
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 2
            """,
        ).fetchone()
    finally:
        connection.close()

    decoded = decode_admin_region_tile(bytes(rebuilt_depth_tile["tile"]))
    region_ids = {
        str(feature["properties"].get("region_id"))
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"].get("kind") == "fill"
    }

    assert exit_code == 0
    assert dict(country_sentinel) == {"algorithm_signature": "sentinel-country-signature", "updated_at": 222}
    assert rebuilt_depth_tile["algorithm_signature"] == ADMIN_REGION_TILE_ALGORITHM_SIGNATURE
    assert region_ids == {"310000"}
