from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from shapely.geometry import shape
from mapbox_vector_tile import encode

from scripts import patch_admin_region_tiles as patch_admin_region_tiles_module
from scripts.patch_admin_region_tiles import (
    load_taiwan_admin_region_features,
    main,
    patch_taiwan_mainland_overlaps,
    patch_taiwan_admin_levels,
)
from enroute_api.admin_regions.store import find_finest_region_id
from enroute_api.admin_regions.tiles import (
    ADMIN_REGION_TILE_LAYER_NAME,
    ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
    decode_admin_region_tile,
)


def make_square(west: float, south: float, east: float, north: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    }


def write_taiwan_source_files(
    tmp_path: Path,
    *,
    county_features: list[dict],
    town_features: list[dict],
) -> tuple[Path, Path]:
    county_path = tmp_path / "taiwan-counties.geojson"
    town_path = tmp_path / "taiwan-towns.geojson"
    county_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": county_features}),
        encoding="utf-8",
    )
    town_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": town_features}),
        encoding="utf-8",
    )
    return county_path, town_path


def make_taiwan_county_feature(
    county_code: str = "63000",
    county_name: str = "\u81fa\u5317\u5e02",
    geometry: dict | None = None,
) -> dict:
    return {
        "type": "Feature",
        "properties": {
            "COUNTYCODE": county_code,
            "COUNTYNAME": county_name,
            "COUNTYENG": "Taipei City",
        },
        "geometry": geometry or make_square(121.4, 25.0, 121.7, 25.2),
    }


def make_taiwan_town_feature(
    town_code: str = "63000010",
    town_name: str = "\u5927\u5b89\u5340",
    county_code: str = "63000",
    geometry: dict | None = None,
) -> dict:
    return {
        "type": "Feature",
        "properties": {
            "COUNTYCODE": county_code,
            "COUNTYNAME": "\u81fa\u5317\u5e02",
            "TOWNCODE": town_code,
            "TOWNNAME": town_name,
            "TOWNENG": "Daan District",
        },
        "geometry": geometry or make_square(121.5, 25.0, 121.6, 25.1),
    }


def initialize_admin_region_patch_test_schema(connection: sqlite3.Connection) -> None:
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
        CREATE TABLE visual_tiles (
          z INTEGER NOT NULL,
          x INTEGER NOT NULL,
          y INTEGER NOT NULL,
          t_type TEXT NOT NULL,
          t TEXT NOT NULL,
          tile BLOB NOT NULL,
          PRIMARY KEY (z, x, y, t_type, t)
        );
        CREATE TABLE footprint_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """
    )


def insert_test_admin_region(
    connection: sqlite3.Connection,
    *,
    region_id: str,
    name: str,
    level: int,
    geometry: dict | None = None,
) -> None:
    resolved_geometry = geometry or make_square(0, 0, 1, 1)
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
            region_id,
            name,
            level,
            json.dumps(resolved_geometry, separators=(",", ":")),
            resolved_geometry["coordinates"][0][0][0],
            resolved_geometry["coordinates"][0][1][0],
            resolved_geometry["coordinates"][0][0][1],
            resolved_geometry["coordinates"][0][2][1],
        ),
    )


def fetch_region_geometry(connection: sqlite3.Connection, region_id: str):
    row = connection.execute(
        "SELECT geometry FROM admin_regions WHERE id = ?",
        (region_id,),
    ).fetchone()
    return shape(json.loads(str(row["geometry"])))


def test_loads_taiwan_official_boundaries_as_level_three_and_four(tmp_path: Path):
    county_path, town_path = write_taiwan_source_files(
        tmp_path,
        county_features=[make_taiwan_county_feature()],
        town_features=[make_taiwan_town_feature()],
    )

    features = load_taiwan_admin_region_features(county_path, town_path)

    properties_by_id = {
        str(feature["properties"]["id"]): feature["properties"]
        for feature in features
    }

    assert properties_by_id["tw-county-63000"] == {
        "id": "tw-county-63000",
        "name": "\u81fa\u5317\u5e02",
        "level": 3,
        "parentId": "710000",
    }
    assert properties_by_id["tw-town-63000010"] == {
        "id": "tw-town-63000010",
        "name": "\u5927\u5b89\u5340",
        "level": 4,
        "parentId": "tw-county-63000",
    }


def test_merges_duplicate_taiwan_town_geometries(tmp_path: Path):
    county_path, town_path = write_taiwan_source_files(
        tmp_path,
        county_features=[make_taiwan_county_feature(geometry=make_square(0, 0, 3, 2))],
        town_features=[
            make_taiwan_town_feature(geometry=make_square(0, 0, 1, 1)),
            make_taiwan_town_feature(geometry=make_square(1, 0, 2, 1)),
        ],
    )

    features = load_taiwan_admin_region_features(county_path, town_path)

    town_features = [
        feature
        for feature in features
        if feature["properties"]["id"] == "tw-town-63000010"
    ]

    assert len(town_features) == 1
    assert shape(town_features[0]["geometry"]).area == 2


def test_preserves_official_taiwan_admin_names(tmp_path: Path):
    county_path, town_path = write_taiwan_source_files(
        tmp_path,
        county_features=[
            make_taiwan_county_feature(
                county_code="68000",
                county_name="\u6843\u5712\u5e02",
                geometry=make_square(120, 24, 123, 26),
            ),
        ],
        town_features=[
            make_taiwan_town_feature(
                town_code="68000010",
                town_name="\u4e2d\u58e2\u5340",
                county_code="68000",
                geometry=make_square(120, 24, 121, 25),
            ),
            make_taiwan_town_feature(
                town_code="68000020",
                town_name="\u95dc\u5edf\u5340",
                county_code="68000",
                geometry=make_square(121, 24, 122, 25),
            ),
        ],
    )

    features = load_taiwan_admin_region_features(county_path, town_path)

    names_by_id = {
        str(feature["properties"]["id"]): str(feature["properties"]["name"])
        for feature in features
    }

    assert names_by_id["tw-county-68000"] == "\u6843\u5712\u5e02"
    assert names_by_id["tw-town-68000010"] == "\u4e2d\u58e2\u5340"
    assert names_by_id["tw-town-68000020"] == "\u95dc\u5edf\u5340"


def test_patch_taiwan_admin_levels_preserves_existing_non_taiwan_rows(tmp_path: Path):
    county_path, town_path = write_taiwan_source_files(
        tmp_path,
        county_features=[make_taiwan_county_feature()],
        town_features=[make_taiwan_town_feature()],
    )
    database_path = tmp_path / "footprints.sqlite"
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_patch_test_schema(connection)
        insert_test_admin_region(connection, region_id="cn", name="China", level=1)
        insert_test_admin_region(connection, region_id="710000", name="\u53f0\u6e7e\u7701", level=2)
        insert_test_admin_region(connection, region_id="310000", name="Shanghai", level=2)
        insert_test_admin_region(connection, region_id="tw-county-old", name="Old County", level=3)
        insert_test_admin_region(connection, region_id="tw-town-old", name="Old Town", level=4)
        connection.execute(
            """
            INSERT INTO admin_region_tree (parent_id, child_id)
            VALUES
              ('cn', '710000'),
              ('cn', '310000'),
              ('710000', 'tw-county-old'),
              ('tw-county-old', 'tw-town-old')
            """,
        )
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, tile)
            VALUES (0, 0, 0, 'all', 'all', x'01')
            """,
        )
        connection.commit()

        result = patch_taiwan_admin_levels(
            connection,
            county_geojson_path=county_path,
            town_geojson_path=town_path,
        )

        region_ids = {
            str(row["id"])
            for row in connection.execute("SELECT id FROM admin_regions")
        }
        tree_rows = {
            (str(row["parent_id"]), str(row["child_id"]))
            for row in connection.execute("SELECT parent_id, child_id FROM admin_region_tree")
        }
        visual_tile_count = connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
    finally:
        connection.close()

    assert result == {"county_count": 1, "town_count": 1}
    assert {"cn", "710000", "310000", "tw-county-63000", "tw-town-63000010"} <= region_ids
    assert "tw-county-old" not in region_ids
    assert "tw-town-old" not in region_ids
    assert ("710000", "tw-county-63000") in tree_rows
    assert ("tw-county-63000", "tw-town-63000010") in tree_rows
    assert ("cn", "310000") in tree_rows
    assert visual_tile_count == 1


def test_main_patches_taiwan_admin_levels_without_rebuilding_tiles(tmp_path: Path):
    county_path, town_path = write_taiwan_source_files(
        tmp_path,
        county_features=[make_taiwan_county_feature()],
        town_features=[make_taiwan_town_feature()],
    )
    database_path = tmp_path / "footprints.sqlite"
    connection = sqlite3.connect(database_path)
    try:
        initialize_admin_region_patch_test_schema(connection)
        insert_test_admin_region(connection, region_id="cn", name="China", level=1)
        insert_test_admin_region(connection, region_id="710000", name="\u53f0\u6e7e\u7701", level=2)
        connection.executescript(
            """
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
              (0, 0, 0, 'world', 3, 'sentinel', x'00', 1, 111);
            """
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
            "--patch-taiwan-admin-levels",
            "--skip-taiwan-admin-tile-rebuild",
            "--taiwan-county-data-path",
            str(county_path),
            "--taiwan-town-data-path",
            str(town_path),
            "--depths",
            "3,4",
            "--min-zoom",
            "0",
            "--max-zoom",
            "0",
        ],
    )

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        taiwan_rows = [
            tuple(row)
            for row in connection.execute(
                """
                SELECT id, name, level
                FROM admin_regions
                WHERE id LIKE 'tw-%'
                ORDER BY id
                """,
            )
        ]
        sentinel = connection.execute(
            """
            SELECT algorithm_signature, updated_at
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 3
            """,
        ).fetchone()
    finally:
        connection.close()

    assert exit_code == 0
    assert taiwan_rows == [
        ("tw-county-63000", "\u81fa\u5317\u5e02", 3),
        ("tw-town-63000010", "\u5927\u5b89\u5340", 4),
    ]
    assert dict(sentinel) == {"algorithm_signature": "sentinel", "updated_at": 111}


def test_taiwan_mainland_overlap_patch_clips_generated_rows_for_future_point_matching(tmp_path: Path):
    database_path = tmp_path / "footprints.sqlite"
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_patch_test_schema(connection)
        connection.executescript(
            """
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
        insert_test_admin_region(
            connection,
            region_id="350000",
            name="福建省",
            level=2,
            geometry=make_square(118, 24, 119, 25),
        )
        insert_test_admin_region(
            connection,
            region_id="710000",
            name="台湾省",
            level=2,
            geometry=make_square(118, 24, 122, 26),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-county-09020",
            name="金門縣",
            level=3,
            geometry=make_square(118.5, 24.2, 119.5, 24.8),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-town-09020010",
            name="金城鎮",
            level=4,
            geometry=make_square(118.5, 24.2, 119.5, 24.8),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-county-63000",
            name="臺北市",
            level=3,
            geometry=make_square(121, 25, 122, 26),
        )
        connection.execute(
            """
            INSERT INTO admin_region_tree (parent_id, child_id)
            VALUES
              ('710000', 'tw-county-09020'),
              ('tw-county-09020', 'tw-town-09020010'),
              ('710000', 'tw-county-63000')
            """,
        )
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, tile)
            VALUES (0, 0, 0, 'all', 'all', x'01')
            """,
        )
        connection.commit()

        result = patch_taiwan_mainland_overlaps(
            connection,
            depths=[3, 4],
            min_zoom=0,
            max_zoom=0,
            commit_interval=1000,
            rebuild_tiles=False,
        )

        kinmen = fetch_region_geometry(connection, "tw-county-09020")
        kincheng = fetch_region_geometry(connection, "tw-town-09020010")
        taipei = fetch_region_geometry(connection, "tw-county-63000")
        visual_tile_count = connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
        overlap_point_match = find_finest_region_id(
            connection,
            longitude=118.75,
            latitude=24.5,
        )
        taiwan_only_match = find_finest_region_id(
            connection,
            longitude=119.25,
            latitude=24.5,
        )
    finally:
        connection.close()

    assert result["changed_region_count"] == 2
    assert result["tile_count"] == 0
    assert kinmen.intersection(shape(make_square(118, 24, 119, 25))).area == 0
    assert kincheng.intersection(shape(make_square(118, 24, 119, 25))).area == 0
    assert taipei.equals(shape(make_square(121, 25, 122, 26)))
    assert visual_tile_count == 1
    assert overlap_point_match == "350000"
    assert taiwan_only_match == "tw-town-09020010"


def test_taiwan_mainland_overlap_patch_skips_far_mainland_authority_rows(
    tmp_path: Path,
    monkeypatch,
):
    database_path = tmp_path / "footprints.sqlite"
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_patch_test_schema(connection)
        insert_test_admin_region(
            connection,
            region_id="350000",
            name="福建省",
            level=2,
            geometry=make_square(118, 24, 119, 25),
        )
        insert_test_admin_region(
            connection,
            region_id="650000",
            name="新疆维吾尔自治区",
            level=2,
            geometry=make_square(80, 40, 90, 50),
        )
        insert_test_admin_region(
            connection,
            region_id="710000",
            name="台湾省",
            level=2,
            geometry=make_square(118, 24, 122, 26),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-county-09020",
            name="金門縣",
            level=3,
            geometry=make_square(118.5, 24.2, 119.5, 24.8),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-town-09020010",
            name="金城鎮",
            level=4,
            geometry=make_square(118.5, 24.2, 119.5, 24.8),
        )
        connection.execute(
            """
            INSERT INTO admin_region_tree (parent_id, child_id)
            VALUES
              ('710000', 'tw-county-09020'),
              ('tw-county-09020', 'tw-town-09020010')
            """,
        )
        connection.commit()

        mainland_repair_labels: list[str] = []
        original_repair = patch_admin_region_tiles_module.repair_polygonal_shapely_geometry

        def record_repaired_geometry(geometry, *, label: str):
            if label.startswith("mainland authority"):
                mainland_repair_labels.append(label)
            return original_repair(geometry, label=label)

        monkeypatch.setattr(
            patch_admin_region_tiles_module,
            "repair_polygonal_shapely_geometry",
            record_repaired_geometry,
        )

        result = patch_taiwan_mainland_overlaps(
            connection,
            depths=[3, 4],
            min_zoom=0,
            max_zoom=0,
            commit_interval=1000,
            rebuild_tiles=False,
        )
    finally:
        connection.close()

    assert result["changed_region_count"] == 2
    assert any("350000" in label for label in mainland_repair_labels)
    assert all("650000" not in label for label in mainland_repair_labels)


def test_taiwan_mainland_overlap_patch_rebuilds_only_affected_depth_tiles(tmp_path: Path, monkeypatch):
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
                            "level": 3,
                            "kind": "fill",
                        },
                    },
                ],
            },
        ],
        default_options={"extents": 4096, "y_coord_down": True},
    )
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_patch_test_schema(connection)
        connection.executescript(
            """
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
        insert_test_admin_region(
            connection,
            region_id="350000",
            name="福建省",
            level=2,
            geometry=make_square(-20, 10, -10, 20),
        )
        insert_test_admin_region(
            connection,
            region_id="710000",
            name="台湾省",
            level=2,
            geometry=make_square(-20, 10, 120, 20),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-county-09020",
            name="金門縣",
            level=3,
            geometry=make_square(-15, 10, -5, 20),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-town-09020010",
            name="金城鎮",
            level=4,
            geometry=make_square(-15, 10, -5, 20),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-county-63000",
            name="臺北市",
            level=3,
            geometry=make_square(100, 10, 110, 20),
        )
        insert_test_admin_region(
            connection,
            region_id="tw-town-63000010",
            name="大安區",
            level=4,
            geometry=make_square(100, 10, 110, 20),
        )
        for index in range(3):
            insert_test_admin_region(
                connection,
                region_id=f"31010{index}",
                name=f"Unrelated City {index}",
                level=3,
                geometry=make_square(100 + index, 30, 101 + index, 31),
            )
            insert_test_admin_region(
                connection,
                region_id=f"31010{index}01",
                name=f"Unrelated District {index}",
                level=4,
                geometry=make_square(100 + index, 30, 101 + index, 31),
            )
        connection.execute(
            """
            INSERT INTO admin_region_tree (parent_id, child_id)
            VALUES
              ('710000', 'tw-county-09020'),
              ('tw-county-09020', 'tw-town-09020010'),
              ('710000', 'tw-county-63000'),
              ('tw-county-63000', 'tw-town-63000010')
            """,
        )
        connection.executemany(
            """
            INSERT INTO admin_region_tiles
              (z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at)
            VALUES
              (1, ?, 0, 'world', ?, ?, ?, 1, 222)
            """,
            [
                (0, 3, "legacy-west-depth3", sentinel_tile),
                (1, 3, "sentinel-east-depth3", sentinel_tile),
                (0, 4, "legacy-west-depth4", sentinel_tile),
                (1, 4, "sentinel-east-depth4", sentinel_tile),
            ],
        )
        connection.commit()

        indexed_row_counts: list[int] = []
        original_index_admin_region_tile_rows = patch_admin_region_tiles_module.index_admin_region_tile_rows

        def track_indexed_row_count(rows, *args, **kwargs):
            indexed_row_counts.append(len(rows))
            return original_index_admin_region_tile_rows(rows, *args, **kwargs)

        monkeypatch.setattr(
            patch_admin_region_tiles_module,
            "index_admin_region_tile_rows",
            track_indexed_row_count,
        )

        def reject_full_tile_query(*args, **kwargs):
            raise AssertionError("affected-key patch must not re-query every focused row for a tile")

        monkeypatch.setattr(
            patch_admin_region_tiles_module,
            "query_focused_region_rows_for_tile",
            reject_full_tile_query,
        )

        result = patch_taiwan_mainland_overlaps(
            connection,
            depths=[3, 4],
            min_zoom=1,
            max_zoom=1,
            commit_interval=1000,
            rebuild_tiles=True,
        )

        tile_signatures = {
            (int(row["x"]), int(row["depth"])): str(row["algorithm_signature"])
            for row in connection.execute(
                """
                SELECT x, depth, algorithm_signature
                FROM admin_region_tiles
                WHERE z = 1 AND y = 0 AND focus_region_id = 'world'
                ORDER BY x, depth
                """,
            )
        }
    finally:
        connection.close()

    assert result["changed_region_count"] == 2
    assert result["tile_count"] == 2
    assert indexed_row_counts == []
    assert tile_signatures[(0, 3)] == ADMIN_REGION_TILE_ALGORITHM_SIGNATURE
    assert tile_signatures[(0, 4)] == ADMIN_REGION_TILE_ALGORITHM_SIGNATURE
    assert tile_signatures[(1, 3)] == "sentinel-east-depth3"
    assert tile_signatures[(1, 4)] == "sentinel-east-depth4"


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
