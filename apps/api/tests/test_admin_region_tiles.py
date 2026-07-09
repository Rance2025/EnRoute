from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path

from fastapi.testclient import TestClient
from mapbox_vector_tile import decode

from enroute_api.admin_regions import tiles as admin_region_tiles
from enroute_api.admin_regions.store import initialize_admin_region_schema, load_admin_regions
from enroute_api.admin_regions.tiles import (
    ADMIN_REGION_FILL_FEATURE_KIND,
    ADMIN_REGION_LINE_FEATURE_KIND,
    ADMIN_REGION_TILE_LAYER_NAME,
    ADMIN_REGION_WORLD_FOCUS_ID,
    DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM,
    MAX_ADMIN_REGION_TILE_ZOOM,
    build_admin_region_tile,
    build_admin_region_tile_keys,
    build_admin_region_tiles,
    initialize_admin_region_tile_schema,
    read_admin_region_tile,
    resolve_focused_region_rows,
)
from enroute_api.config import Settings
from enroute_api.footprints.store import (
    ADMIN_REGION_LOADER_VERSION,
    FootprintStore,
    create_source_signature,
    initialize_schema,
    set_meta_value,
)
from enroute_api.footprints.coordinates import transform_wgs84_to_gcj02_coordinate
from enroute_api.footprints.visual_tiles import STATUS_READY
from enroute_api.main import create_app


GLOBAL_REGION_COLLECTION = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"id": "cn", "name": "China", "level": 1},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "310000", "name": "Shanghai", "level": 2, "parentId": "cn"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[120, 30], [123, 30], [123, 33], [120, 33], [120, 30]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "310100", "name": "Shanghai City", "level": 3, "parentId": "310000"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "310115", "name": "Pudong", "level": 4, "parentId": "310100"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[121.4, 31.1], [121.8, 31.1], [121.8, 31.4], [121.4, 31.4], [121.4, 31.1]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "us", "name": "United States", "level": 1},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-125, 24], [-66, 24], [-66, 50], [-125, 50], [-125, 24]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "ca", "name": "California", "level": 2, "parentId": "us"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-125, 32], [-114, 32], [-114, 42], [-125, 42], [-125, 32]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "sf", "name": "San Francisco", "level": 3, "parentId": "ca"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[-122.55, 37.7], [-122.35, 37.7], [-122.35, 37.84], [-122.55, 37.84], [-122.55, 37.7]],
                ],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "jp", "name": "Japan", "level": 1},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[129, 31], [146, 31], [146, 46], [129, 46], [129, 31]]],
            },
        },
    ],
}


def test_initializes_admin_region_tile_cache_table(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        columns = [row[1] for row in connection.execute("PRAGMA table_info(admin_region_tiles)")]
    finally:
        connection.close()

    assert columns == [
        "z",
        "x",
        "y",
        "focus_region_id",
        "depth",
        "algorithm_signature",
        "tile",
        "feature_count",
        "updated_at",
    ]


def test_resolves_world_focus_to_country_level_or_china_domestic_scope(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)

        depth_1 = resolve_focused_region_rows(connection, focus_region_id="world", depth=1)
        depth_2 = resolve_focused_region_rows(connection, focus_region_id="world", depth=2)
        depth_3 = resolve_focused_region_rows(connection, focus_region_id="world", depth=3)
        depth_4 = resolve_focused_region_rows(connection, focus_region_id="world", depth=4)
    finally:
        connection.close()

    assert [row["id"] for row in depth_1] == ["cn", "jp", "us"]
    assert [row["id"] for row in depth_2] == ["310000"]
    assert [row["id"] for row in depth_3] == ["310100"]
    assert [row["id"] for row in depth_4] == ["310115"]


def test_builds_world_depth_four_admin_region_tile_blob(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=4,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=4,
        )
        row = connection.execute(
            """
            SELECT feature_count, updated_at
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 4
            """,
        ).fetchone()
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    fill_feature_ids = sorted(
        feature["properties"]["region_id"]
        for feature in layer_features
        if feature["properties"]["kind"] == "fill"
    )

    assert built is True
    assert row["feature_count"] == len(layer_features)
    assert row["updated_at"] == 1234
    assert fill_feature_ids == ["310115"]
    assert layer_features[0]["properties"].keys() >= {"region_id", "parent_id", "level", "name", "kind"}


def test_reads_legacy_admin_tiles_only_for_non_country_depths(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)

        build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        depth_1_tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
        )
        connection.execute(
            """
            UPDATE admin_region_tiles
            SET algorithm_signature = 'admin-region-mvt-v5-cn-worldview-line-mask'
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 1
            """,
        )
        legacy_depth_1_tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
        )

        build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=4,
            updated_at=1234,
        )
        depth_4_tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=4,
        )
        connection.execute(
            """
            UPDATE admin_region_tiles
            SET algorithm_signature = 'admin-region-mvt-v5-cn-worldview-line-mask'
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 4
            """,
        )
        legacy_depth_4_tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=4,
        )
    finally:
        connection.close()

    assert depth_1_tile
    assert legacy_depth_1_tile == depth_1_tile
    assert depth_4_tile
    assert legacy_depth_4_tile == depth_4_tile
    legacy_depth_4_features = decode(legacy_depth_4_tile)[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    assert legacy_depth_4_features
    assert all(
        feature["properties"]["level"] == 4
        for feature in legacy_depth_4_features
    )


def test_reading_legacy_admin_tile_derives_boundary_lines_from_fill_features(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    fill_only_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[2048, 0], [4096, 0], [4096, 4096], [2048, 4096], [2048, 0]]],
                        },
                        "properties": {
                            "region_id": "east",
                            "parent_id": "",
                            "level": 4,
                            "name": "East",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 4, 'admin-region-mvt-v5-cn-worldview-line-mask', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, fill_only_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    line_features = [
        feature
        for feature in layer_features
        if feature["properties"]["kind"] == ADMIN_REGION_LINE_FEATURE_KIND
    ]
    shared_line_segments = [
        segment
        for segment in iter_tile_feature_segments(line_features)
        if segment[0][0] == 2048 and segment[1][0] == 2048
    ]

    assert len([feature for feature in layer_features if feature["properties"]["kind"] == "fill"]) == 2
    assert tile == fill_only_tile
    assert line_features == []
    assert shared_line_segments == []


def test_reading_legacy_admin_tile_filters_to_requested_non_country_level(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    mixed_level_tile = admin_region_tiles.encode(
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
                            "region_id": "province",
                            "parent_id": "cn",
                            "level": 2,
                            "name": "Province",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[512, 512], [3584, 512], [3584, 3584], [512, 3584], [512, 512]]],
                        },
                        "properties": {
                            "region_id": "city",
                            "parent_id": "province",
                            "level": 3,
                            "name": "City",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 3, 'admin-region-mvt-v5-cn-worldview-line-mask', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, mixed_level_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=3,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    fill_features = [
        feature
        for feature in layer_features
        if feature["properties"]["kind"] == ADMIN_REGION_FILL_FEATURE_KIND
    ]
    line_features = [
        feature
        for feature in layer_features
        if feature["properties"]["kind"] == ADMIN_REGION_LINE_FEATURE_KIND
    ]

    assert [feature["properties"]["region_id"] for feature in fill_features] == ["province", "city"]
    assert line_features == []


def test_reading_low_zoom_legacy_non_country_tile_uses_cached_tile_without_rebuild(
    tmp_path: Path,
    monkeypatch,
):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    fill_only_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[2048, 0], [4096, 0], [4096, 4096], [2048, 4096], [2048, 0]]],
                        },
                        "properties": {
                            "region_id": "east",
                            "parent_id": "",
                            "level": 4,
                            "name": "East",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )

    def fail_rebuild(*args, **kwargs):
        raise AssertionError("low zoom legacy admin tiles should be served from cached tile bytes")

    monkeypatch.setattr(
        admin_region_tiles,
        "rebuild_admin_region_tile_from_current_rows",
        fail_rebuild,
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (7, 104, 48, ?, 4, 'admin-region-mvt-v5-cn-worldview-line-mask', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, fill_only_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=7,
            x=104,
            y=48,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    fill_region_ids = [
        feature["properties"]["region_id"]
        for feature in layer_features
        if feature["properties"]["kind"] == ADMIN_REGION_FILL_FEATURE_KIND
    ]

    assert fill_region_ids == ["west", "east"]
    assert tile == fill_only_tile
    assert not any(feature["properties"]["kind"] == ADMIN_REGION_LINE_FEATURE_KIND for feature in layer_features)


def test_reading_low_zoom_v10_non_country_tile_preserves_cached_lines_without_deriving(
    tmp_path: Path,
    monkeypatch,
):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    cached_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[2048, 0], [2048, 4096]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_LINE_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )

    def fail_rebuild(*args, **kwargs):
        raise AssertionError("low zoom v10 admin tiles should be served from cached tile bytes")

    def fail_derive(*args, **kwargs):
        raise AssertionError("low zoom v10 admin tiles already carry cached line features")

    monkeypatch.setattr(
        admin_region_tiles,
        "rebuild_admin_region_tile_from_current_rows",
        fail_rebuild,
    )
    monkeypatch.setattr(
        admin_region_tiles,
        "derive_admin_region_tile_lines_from_fill_features",
        fail_derive,
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (7, 104, 48, ?, 4, 'admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, cached_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=7,
            x=104,
            y=48,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]

    assert [feature["properties"]["kind"] for feature in layer_features] == [
        ADMIN_REGION_FILL_FEATURE_KIND,
        ADMIN_REGION_LINE_FEATURE_KIND,
    ]


def test_reading_low_zoom_line_ready_admin_tile_returns_cached_bytes_without_filtering(
    tmp_path: Path,
    monkeypatch,
):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    cached_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[2048, 0], [2048, 4096]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_LINE_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )

    def fail_filter(*args, **kwargs):
        raise AssertionError("low zoom line-ready admin tiles must be served from cached bytes")

    monkeypatch.setattr(
        admin_region_tiles,
        "filter_admin_region_tile_edge_line_segments",
        fail_filter,
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (3, 6, 3, ?, 4, 'admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, cached_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=3,
            x=6,
            y=3,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=4,
        )
    finally:
        connection.close()

    assert tile == cached_tile


def test_reading_line_ready_cached_admin_tile_filters_tile_edge_line_segments(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    cached_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "MultiLineString",
                            "coordinates": [
                                [[2048, 0], [2048, 4096]],
                                [[0, 128], [0, 2048]],
                                [[128, 4096], [1024, 4096]],
                            ],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 4,
                            "name": "West",
                            "kind": ADMIN_REGION_LINE_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (7, 104, 48, ?, 4, 'admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, cached_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=7,
            x=104,
            y=48,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    line_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == ADMIN_REGION_LINE_FEATURE_KIND
    ]
    line_segments = list(iter_tile_feature_segments(line_features))

    assert tile == cached_tile
    assert len(line_segments) == 3


def test_reading_legacy_country_admin_tile_derives_boundary_lines_from_fill_features(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    legacy_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]]],
                        },
                        "properties": {
                            "region_id": "west",
                            "parent_id": "",
                            "level": 1,
                            "name": "West",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[2048, 0], [4096, 0], [4096, 4096], [2048, 4096], [2048, 0]]],
                        },
                        "properties": {
                            "region_id": "east",
                            "parent_id": "",
                            "level": 1,
                            "name": "East",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[128, 0], [128, 4096]],
                        },
                        "properties": {
                            "region_id": "stale",
                            "parent_id": "",
                            "level": 1,
                            "name": "Stale",
                            "kind": ADMIN_REGION_LINE_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 1, 'admin-region-mvt-v6-country-fill-boundary-line-mask', ?, 3, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, legacy_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    line_features = [
        feature
        for feature in layer_features
        if feature["properties"]["kind"] == ADMIN_REGION_LINE_FEATURE_KIND
    ]
    vertical_segments = [
        segment
        for segment in iter_tile_feature_segments(line_features)
        if segment[0][0] == segment[1][0]
    ]
    tile_edge_segments = [
        segment
        for segment in iter_tile_feature_segments(line_features)
        if (
            segment[0][0] == segment[1][0]
            and segment[0][0] in {0, admin_region_tiles.MVT_EXTENT}
        )
        or (
            segment[0][1] == segment[1][1]
            and segment[0][1] in {0, admin_region_tiles.MVT_EXTENT}
        )
    ]

    assert tile == legacy_tile
    assert any(feature["properties"]["region_id"] == "stale" for feature in line_features)
    assert all(segment[0][0] != 2048 for segment in vertical_segments)
    assert any(segment[0][0] == 128 for segment in vertical_segments)
    assert tile_edge_segments == []


def test_reading_v1_country_admin_tile_preserves_rollback_baseline_cache(tmp_path: Path, monkeypatch):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    v1_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[512, 512], [1024, 512], [1024, 1024], [512, 1024], [512, 512]]],
                        },
                        "properties": {
                            "region_id": "country:baseline",
                            "parent_id": "",
                            "level": 1,
                            "name": "Baseline",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )

    def fail_filter(*args, **kwargs):
        raise AssertionError("v1 rollback country tiles must be returned directly")

    monkeypatch.setattr(
        admin_region_tiles,
        "filter_admin_region_tile_edge_line_segments",
        fail_filter,
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 1, 'admin-region-mvt-v1-wgs84-global-l1-l3', ?, 1, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, v1_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]

    assert [feature["properties"]["region_id"] for feature in layer_features] == ["country:baseline"]


def test_reading_legacy_country_admin_tile_preserves_mapbox_y_down_fill_coordinates(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    legacy_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[3072, 512], [3584, 512], [3584, 1024], [3072, 1024], [3072, 512]]],
                        },
                        "properties": {
                            "region_id": "country",
                            "parent_id": "",
                            "level": 1,
                            "name": "Country",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 1, 'admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe', ?, 1, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, legacy_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile, default_options={"y_coord_down": True})
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == ADMIN_REGION_FILL_FEATURE_KIND
    ]
    fill_y_values = {point[1] for point in iter_tile_feature_points(fill_features)}

    assert fill_y_values == {512, 1024}


def test_reading_legacy_country_admin_tile_filters_antarctica_features(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    legacy_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 3072], [4096, 3072], [4096, 4096], [0, 4096], [0, 3072]]],
                        },
                        "properties": {
                            "region_id": "country:aq",
                            "parent_id": "",
                            "level": 1,
                            "name": "Antarctica",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[256, 256], [768, 256], [768, 768], [256, 768], [256, 256]]],
                        },
                        "properties": {
                            "region_id": "country:nz",
                            "parent_id": "",
                            "level": 1,
                            "name": "New Zealand",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 1, 'admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, legacy_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]

    assert tile == legacy_tile
    assert {feature["properties"]["region_id"] for feature in layer_features} == {
        "country:aq",
        "country:nz",
    }


def test_reading_v11_country_admin_tile_filters_antarctica_without_rebuild(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    v11_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 3072], [4096, 3072], [4096, 4096], [0, 4096], [0, 3072]]],
                        },
                        "properties": {
                            "region_id": "2ba5ad8b-6784-4088-87bb-50c14f2cbdc0",
                            "parent_id": "",
                            "level": 1,
                            "name": "Antarctica",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[256, 256], [768, 256], [768, 768], [256, 768], [256, 256]]],
                        },
                        "properties": {
                            "region_id": "country:nz",
                            "parent_id": "",
                            "level": 1,
                            "name": "New Zealand",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 1, 'admin-region-mvt-v11-render-wgs84-fill-derived-boundary-line-dedupe', ?, 2, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, v11_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]

    assert tile == v11_tile
    assert {feature["properties"]["region_id"] for feature in layer_features} == {
        "2ba5ad8b-6784-4088-87bb-50c14f2cbdc0",
        "country:nz",
    }


def test_reading_country_admin_tile_returns_empty_when_only_antarctica_would_remain(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    antarctica_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 3072], [4096, 3072], [4096, 4096], [0, 4096], [0, 3072]]],
                        },
                        "properties": {
                            "region_id": "country:aq",
                            "parent_id": "",
                            "level": 1,
                            "name": "Antarctica",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (0, 0, 0, ?, 1, 'admin-region-mvt-v11-render-wgs84-fill-derived-boundary-line-dedupe', ?, 1, 1234)
            """,
            (ADMIN_REGION_WORLD_FOCUS_ID, antarctica_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
        )
    finally:
        connection.close()

    assert tile == antarctica_tile


def test_building_country_admin_tile_skips_existing_antarctica_row(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.executemany(
            """
            INSERT INTO admin_regions (
              id, name, level, geometry, line_geometry, line_mask_geometry,
              min_lng, max_lng, min_lat, max_lat,
              first_seen_timestamp, footprint_count, stay_duration_seconds, travel_distance_meters
            )
            VALUES (?, ?, 1, ?, NULL, NULL, ?, ?, ?, ?, NULL, 0, 0, 0)
            """,
            [
                (
                    "country:aq",
                    "Antarctica",
                    json.dumps(
                        {
                            "type": "Polygon",
                            "coordinates": [[[-180, -85], [180, -85], [180, -60], [-180, -60], [-180, -85]]],
                        },
                    ),
                    -180,
                    180,
                    -85,
                    -60,
                ),
                (
                    "country:nz",
                    "New Zealand",
                    json.dumps(
                        {
                            "type": "Polygon",
                            "coordinates": [[[166, -47], [179, -47], [179, -34], [166, -34], [166, -47]]],
                        },
                    ),
                    166,
                    179,
                    -47,
                    -34,
                ),
            ],
        )

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]

    assert built is True
    assert {feature["properties"]["region_id"] for feature in layer_features} == {"country:nz"}
    assert {feature["properties"]["kind"] for feature in layer_features} == {
        ADMIN_REGION_FILL_FEATURE_KIND,
        ADMIN_REGION_LINE_FEATURE_KIND,
    }


def test_builds_admin_region_tiles_only_for_intersecting_tile_keys(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)

        result = build_admin_region_tiles(
            connection,
            focus_region_id="world",
            depth=3,
            min_zoom=1,
            max_zoom=1,
            updated_at=1234,
            commit_interval=1,
        )
        rows = connection.execute(
            """
            SELECT z, x, y, focus_region_id, depth, feature_count, updated_at
            FROM admin_region_tiles
            ORDER BY z, x, y
            """,
        ).fetchall()
        tile_rows = connection.execute(
            """
            SELECT tile
            FROM admin_region_tiles
            WHERE focus_region_id = 'world' AND depth = 3
            ORDER BY z, x, y
            """,
        ).fetchall()
    finally:
        connection.close()

    fill_feature_ids = sorted(
        feature["properties"]["region_id"]
        for row in tile_rows
        for feature in decode(row["tile"])[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
    )

    assert result.built_count == len(rows)
    assert result.feature_count == 1
    assert fill_feature_ids == ["310100"]
    assert all(row["focus_region_id"] == "world" for row in rows)
    assert all(row["depth"] == 3 for row in rows)
    assert all(row["updated_at"] == 1234 for row in rows)


def test_enumerates_multipolygon_tile_keys_from_each_part_not_the_whole_bbox(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "split", "name": "Split Country", "level": 1},
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": [
                        [[[-179, 1], [-170, 1], [-170, 10], [-179, 10], [-179, 1]]],
                        [[[170, 1], [179, 1], [179, 10], [170, 10], [170, 1]]],
                    ],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        result = build_admin_region_tiles(
            connection,
            focus_region_id="world",
            depth=1,
            min_zoom=3,
            max_zoom=3,
            updated_at=1234,
        )
        rows = connection.execute(
            """
            SELECT z, x, y
            FROM admin_region_tiles
            ORDER BY z, x, y
            """,
        ).fetchall()
    finally:
        connection.close()

    assert result.candidate_count == 2
    assert [(row["z"], row["x"], row["y"]) for row in rows] == [(3, 0, 3), (3, 7, 3)]


def test_builds_each_tile_with_only_rows_that_cover_that_tile(tmp_path: Path, monkeypatch):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "split", "name": "Split Country", "level": 1},
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": [
                        [[[-179, 1], [-170, 1], [-170, 10], [-179, 10], [-179, 1]]],
                        [[[170, 1], [179, 1], [179, 10], [170, 10], [170, 1]]],
                    ],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "middle", "name": "Middle Country", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 1], [10, 1], [10, 10], [0, 10], [0, 1]]],
                },
            },
        ],
    }
    captured_rows: dict[tuple[int, int, int], list[tuple[str, tuple[float, float, float, float]]]] = {}

    def capture_tile_rows(
        connection,
        *,
        rows,
        z,
        x,
        y,
        focus_region_id,
        depth,
        updated_at,
    ):
        del connection, focus_region_id, depth, updated_at
        captured_rows[(z, x, y)] = sorted(
            (
                str(row.row["id"]),
                tuple(round(float(value), 6) for value in row.geometry.bounds),
            )
            for row in rows
        )
        return True

    monkeypatch.setattr(
        admin_region_tiles,
        "build_admin_region_tile_from_prepared_rows",
        capture_tile_rows,
    )
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        result = build_admin_region_tiles(
            connection,
            focus_region_id="world",
            depth=1,
            min_zoom=3,
            max_zoom=3,
            updated_at=1234,
        )
    finally:
        connection.close()

    assert result.candidate_count == 3
    assert captured_rows == {
        (3, 0, 3): [("split", (-179.0, 1.0, -170.0, 10.0))],
        (3, 4, 3): [("middle", (0.0, 1.0, 10.0, 10.0))],
        (3, 7, 3): [("split", (170.0, 1.0, 179.0, 10.0))],
    }


def test_incremental_admin_region_tile_build_replaces_only_requested_tile_keys(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "west", "name": "West Country", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-170, 1], [-160, 1], [-160, 10], [-170, 10], [-170, 1]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "east", "name": "East Country", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[160, 1], [170, 1], [170, 10], [160, 10], [160, 1]]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)
        build_admin_region_tiles(
            connection,
            focus_region_id="world",
            depth=1,
            min_zoom=3,
            max_zoom=3,
            updated_at=1000,
        )
        west_tile = connection.execute(
            """
            SELECT z, x, y
            FROM admin_region_tiles
            WHERE z = 3 AND depth = 1
            ORDER BY x
            LIMIT 1
            """,
        ).fetchone()
        east_tile = connection.execute(
            """
            SELECT z, x, y
            FROM admin_region_tiles
            WHERE z = 3 AND depth = 1
            ORDER BY x DESC
            LIMIT 1
            """,
        ).fetchone()

        build_admin_region_tile_keys(
            connection,
            focus_region_id="world",
            depth=1,
            tile_keys=[(west_tile["z"], west_tile["x"], west_tile["y"])],
            updated_at=2000,
        )
        rows = connection.execute(
            """
            SELECT z, x, y, updated_at
            FROM admin_region_tiles
            WHERE z = 3 AND depth = 1
            ORDER BY x
            """,
        ).fetchall()
    finally:
        connection.close()

    assert [(row["z"], row["x"], row["y"], row["updated_at"]) for row in rows] == [
        (west_tile["z"], west_tile["x"], west_tile["y"], 2000),
        (east_tile["z"], east_tile["x"], east_tile["y"], 1000),
    ]


def test_keeps_same_region_geometry_parts_local_to_their_tile(tmp_path: Path, monkeypatch):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "islands", "name": "Island Country", "level": 1},
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": [
                        [[[0, 1], [2, 1], [2, 3], [0, 3], [0, 1]]],
                        [[[4, 1], [6, 1], [6, 3], [4, 3], [4, 1]]],
                    ],
                },
            },
        ],
    }
    captured_geometries: list[tuple[str, tuple[float, float, float, float]]] = []

    def capture_tile_rows(
        connection,
        *,
        rows,
        z,
        x,
        y,
        focus_region_id,
        depth,
        updated_at,
    ):
        del connection, z, x, y, focus_region_id, depth, updated_at
        captured_geometries.extend(
            (
                row.geometry.geom_type,
                tuple(round(float(value), 6) for value in row.geometry.bounds),
            )
            for row in rows
        )
        return True

    monkeypatch.setattr(
        admin_region_tiles,
        "build_admin_region_tile_from_prepared_rows",
        capture_tile_rows,
    )
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        result = build_admin_region_tiles(
            connection,
            focus_region_id="world",
            depth=1,
            min_zoom=3,
            max_zoom=3,
            updated_at=1234,
        )
    finally:
        connection.close()

    assert result.candidate_count == 1
    assert captured_geometries == [
        ("Polygon", (0.0, 1.0, 2.0, 3.0)),
        ("Polygon", (4.0, 1.0, 6.0, 3.0)),
    ]


def test_encodes_clipped_polygon_fill_when_tile_intersection_returns_mixed_geometry_collection(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cross", "name": "Cross Tile", "level": 1},
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": [
                        [[[-179, 1], [-170, 1], [-170, 10], [-179, 10], [-179, 1]]],
                        [[[-160, -5], [-150, -5], [-150, 0], [-160, 0], [-160, -5]]],
                    ],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=1,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=1,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    kinds = {feature["properties"]["kind"] for feature in layer_features}

    assert built is True
    assert "fill" in kinds


def test_encodes_each_projected_multipolygon_part_as_fill_features():
    row = {
        "id": "multi",
        "name": "Multi",
        "level": 1,
        "parent_id": None,
    }
    geometry = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]],
        ],
    }

    features = admin_region_tiles.create_admin_region_fill_features(
        row,
        geometry,
    )

    assert [feature["geometry"] for feature in features] == [
        {"type": "Polygon", "coordinates": geometry["coordinates"][0]},
        {"type": "Polygon", "coordinates": geometry["coordinates"][1]},
    ]
    assert [feature["properties"]["kind"] for feature in features] == ["fill", "fill"]


def test_tile_encoder_masks_boundary_lines_without_changing_fill(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "country", "name": "Country", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
                "lineMaskGeometry": {
                    "type": "Polygon",
                    "coordinates": [[[19, -1], [21, -1], [21, 11], [19, 11], [19, -1]]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    layer_features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    fill_features = [
        feature
        for feature in layer_features
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "country"
    ]
    line_features = [
        feature
        for feature in layer_features
        if feature["properties"]["kind"] == "line"
        and feature["properties"]["region_id"] == "country"
    ]
    masked_line_x = admin_region_tiles.project_to_tile_geometry(
        longitude=20,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    unmasked_line_x = admin_region_tiles.project_to_tile_geometry(
        longitude=0,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    line_points = list(iter_tile_feature_points(line_features))

    assert built is True
    assert fill_features
    assert any(point[0] == unmasked_line_x for point in line_points)
    assert all(point[0] != masked_line_x for point in line_points)


def test_tile_encoder_projects_china_areacity_boundaries_as_wgs84_for_mapbox(tmp_path: Path):
    wgs_longitude = 116.397
    wgs_latitude = 39.908
    gcj_longitude, gcj_latitude = transform_wgs84_to_gcj02_coordinate(
        longitude=wgs_longitude,
        latitude=wgs_latitude,
    )
    tile_z = 8
    tile_x, tile_y = admin_region_tiles.coordinate_to_tile(
        longitude=wgs_longitude,
        latitude=wgs_latitude,
        z=tile_z,
    )
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "id": "110000",
                    "adcode": "110000",
                    "parent": "cn",
                    "name": "Beijing",
                    "level": "province",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [gcj_longitude, gcj_latitude],
                            [gcj_longitude + 0.05, gcj_latitude],
                            [gcj_longitude + 0.05, gcj_latitude + 0.05],
                            [gcj_longitude, gcj_latitude + 0.05],
                            [gcj_longitude, gcj_latitude],
                        ],
                    ],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=2,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=2,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "110000"
    ]
    projected_points = list(iter_tile_feature_points(fill_features))
    expected_wgs_point = admin_region_tiles.project_to_tile_geometry(
        longitude=wgs_longitude,
        latitude=wgs_latitude,
        z=tile_z,
        x=tile_x,
        y=tile_y,
    )
    stale_gcj_point = admin_region_tiles.project_to_tile_geometry(
        longitude=gcj_longitude,
        latitude=gcj_latitude,
        z=tile_z,
        x=tile_x,
        y=tile_y,
    )
    projected_x_values = {point[0] for point in projected_points}

    assert built is True
    assert expected_wgs_point[0] in projected_x_values
    assert stale_gcj_point[0] not in projected_x_values


def test_tile_encoder_clips_china_areacity_fill_after_wgs84_render_transform(tmp_path: Path):
    tile_z = 8
    tile_x, tile_y = admin_region_tiles.coordinate_to_tile(
        longitude=116.397,
        latitude=39.908,
        z=tile_z,
    )
    west, south, east, north = admin_region_tiles.tile_bounds(z=tile_z, x=tile_x, y=tile_y)
    latitude = (south + north) / 2
    wgs_ring = [
        [east - 0.01, latitude - 0.01],
        [east + 0.01, latitude - 0.01],
        [east + 0.01, latitude + 0.01],
        [east - 0.01, latitude + 0.01],
        [east - 0.01, latitude - 0.01],
    ]
    gcj_ring = [
        list(transform_wgs84_to_gcj02_coordinate(longitude=longitude, latitude=latitude))
        for longitude, latitude in wgs_ring
    ]
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110000", "name": "Beijing", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110100", "name": "Beijing City", "level": 3, "parentId": "110000"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110101", "name": "Dongcheng", "level": 4, "parentId": "110100"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [gcj_ring],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=4,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "110101"
    ]
    fill_x_values = [point[0] for point in iter_tile_feature_points(fill_features)]

    assert built is True
    assert fill_features
    assert max(fill_x_values) == admin_region_tiles.MVT_EXTENT


def test_tile_encoder_keeps_china_areacity_fill_when_raw_gcj_bbox_misses_tile(tmp_path: Path):
    tile_z = 8
    tile_x, tile_y = admin_region_tiles.coordinate_to_tile(
        longitude=116.397,
        latitude=39.908,
        z=tile_z,
    )
    west, south, east, north = admin_region_tiles.tile_bounds(z=tile_z, x=tile_x, y=tile_y)
    latitude = (south + north) / 2
    wgs_ring = [
        [east - 0.001, latitude - 0.01],
        [east + 0.001, latitude - 0.01],
        [east + 0.001, latitude + 0.01],
        [east - 0.001, latitude + 0.01],
        [east - 0.001, latitude - 0.01],
    ]
    gcj_ring = [
        list(transform_wgs84_to_gcj02_coordinate(longitude=longitude, latitude=latitude))
        for longitude, latitude in wgs_ring
    ]
    assert min(point[0] for point in gcj_ring) > east

    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110000", "name": "Beijing", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110100", "name": "Beijing City", "level": 3, "parentId": "110000"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110101", "name": "Dongcheng", "level": 4, "parentId": "110100"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [gcj_ring],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=4,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "110101"
    ]
    fill_x_values = [point[0] for point in iter_tile_feature_points(fill_features)]

    assert built is True
    assert fill_features
    assert max(fill_x_values) == admin_region_tiles.MVT_EXTENT


def test_tile_range_builder_indexes_china_areacity_by_wgs84_render_bbox(tmp_path: Path):
    tile_z = 8
    tile_x, tile_y = admin_region_tiles.coordinate_to_tile(
        longitude=116.397,
        latitude=39.908,
        z=tile_z,
    )
    _west, south, east, north = admin_region_tiles.tile_bounds(z=tile_z, x=tile_x, y=tile_y)
    latitude = (south + north) / 2
    wgs_ring = [
        [east - 0.001, latitude - 0.01],
        [east + 0.001, latitude - 0.01],
        [east + 0.001, latitude + 0.01],
        [east - 0.001, latitude + 0.01],
        [east - 0.001, latitude - 0.01],
    ]
    gcj_ring = [
        list(transform_wgs84_to_gcj02_coordinate(longitude=longitude, latitude=latitude))
        for longitude, latitude in wgs_ring
    ]
    assert min(point[0] for point in gcj_ring) > east

    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110000", "name": "Beijing", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110100", "name": "Beijing City", "level": 3, "parentId": "110000"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110101", "name": "Dongcheng", "level": 4, "parentId": "110100"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [gcj_ring],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        result = build_admin_region_tiles(
            connection,
            focus_region_id="world",
            depth=4,
            min_zoom=tile_z,
            max_zoom=tile_z,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "110101"
    ]

    assert result.built_count >= 1
    assert fill_features


def test_tile_range_builder_reuses_china_areacity_wgs84_render_geometry(
    tmp_path: Path,
    monkeypatch,
):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "310000", "name": "Shanghai", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[120, 30], [123, 30], [123, 33], [120, 33], [120, 30]]],
                },
            },
        ],
    }
    transform_calls = 0

    def counted_transform(*, longitude: float, latitude: float):
        nonlocal transform_calls
        transform_calls += 1
        return longitude, latitude

    monkeypatch.setattr(
        admin_region_tiles,
        "transform_gcj02_to_wgs84_coordinate",
        counted_transform,
    )
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        result = build_admin_region_tiles(
            connection,
            focus_region_id="world",
            depth=2,
            min_zoom=0,
            max_zoom=1,
            updated_at=1234,
        )
    finally:
        connection.close()

    assert result.built_count > 0
    assert transform_calls == 5


def test_low_zoom_admin_region_tiles_simplify_dense_china_boundaries(tmp_path: Path):
    dense_ring = [
        [110 + (step / 500), 30 + (0.1 if step % 2 else 0)]
        for step in range(501)
    ]
    dense_ring.extend([[111, 30 + (step / 500)] for step in range(1, 501)])
    dense_ring.extend(
        [
            [111 - (step / 500), 31 + (0.1 if step % 2 else 0)]
            for step in range(1, 501)
        ],
    )
    dense_ring.extend([[110, 31 - (step / 500)] for step in range(1, 501)])
    dense_ring.append(dense_ring[0])
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(
            connection,
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"id": "cn", "name": "China", "level": 1},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                        },
                    },
                    {
                        "type": "Feature",
                        "properties": {"id": "310000", "name": "Shanghai", "level": 2, "parentId": "cn"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [dense_ring],
                        },
                    },
                ],
            },
        )

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=2,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=2,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "310000"
    ]
    point_count = len(list(iter_tile_feature_points(fill_features)))

    assert built is True
    assert point_count < 80


def test_reading_legacy_china_areacity_tile_rebuilds_fill_from_current_rows(tmp_path: Path):
    tile_z = 8
    tile_x, tile_y = admin_region_tiles.coordinate_to_tile(
        longitude=116.397,
        latitude=39.908,
        z=tile_z,
    )
    west, south, east, north = admin_region_tiles.tile_bounds(z=tile_z, x=tile_x, y=tile_y)
    latitude = (south + north) / 2
    wgs_ring = [
        [east - 0.01, latitude - 0.01],
        [east + 0.01, latitude - 0.01],
        [east + 0.01, latitude + 0.01],
        [east - 0.01, latitude + 0.01],
        [east - 0.01, latitude - 0.01],
    ]
    gcj_ring = [
        list(transform_wgs84_to_gcj02_coordinate(longitude=longitude, latitude=latitude))
        for longitude, latitude in wgs_ring
    ]
    stale_tile = admin_region_tiles.encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[4066, 1982], [4078, 1982], [4078, 2114], [4066, 2114], [4066, 1982]]],
                        },
                        "properties": {
                            "region_id": "110101",
                            "parent_id": "110100",
                            "level": 4,
                            "name": "Dongcheng",
                            "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                        },
                    },
                ],
            },
        ],
        default_options={
            "extents": admin_region_tiles.MVT_EXTENT,
            "y_coord_down": True,
        },
    )
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110000", "name": "Beijing", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110100", "name": "Beijing City", "level": 3, "parentId": "110000"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "110101", "name": "Dongcheng", "level": 4, "parentId": "110100"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [gcj_ring],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (?, ?, ?, ?, 4, 'admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe', ?, 1, 1234)
            """,
            (tile_z, tile_x, tile_y, ADMIN_REGION_WORLD_FOCUS_ID, stale_tile),
        )

        tile = read_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "110101"
    ]
    fill_x_values = [point[0] for point in iter_tile_feature_points(fill_features)]

    assert fill_features
    assert tile == stale_tile
    assert max(fill_x_values) == 4078


def test_tile_encoder_keeps_wgs_china_country_geometry_without_second_transform(tmp_path: Path):
    wgs_longitude = 116.397
    wgs_latitude = 39.908
    gcj_longitude, _ = transform_wgs84_to_gcj02_coordinate(
        longitude=wgs_longitude,
        latitude=wgs_latitude,
    )
    tile_z = 8
    tile_x, tile_y = admin_region_tiles.coordinate_to_tile(
        longitude=wgs_longitude,
        latitude=wgs_latitude,
        z=tile_z,
    )
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [wgs_longitude, wgs_latitude],
                            [wgs_longitude + 0.002, wgs_latitude],
                            [wgs_longitude + 0.002, wgs_latitude + 0.002],
                            [wgs_longitude, wgs_latitude + 0.002],
                            [wgs_longitude, wgs_latitude],
                        ],
                    ],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "cn"
    ]
    projected_x_values = {point[0] for point in iter_tile_feature_points(fill_features)}
    expected_wgs_point = admin_region_tiles.project_to_tile_geometry(
        longitude=wgs_longitude,
        latitude=wgs_latitude,
        z=tile_z,
        x=tile_x,
        y=tile_y,
    )
    stale_gcj_point = admin_region_tiles.project_to_tile_geometry(
        longitude=gcj_longitude,
        latitude=wgs_latitude,
        z=tile_z,
        x=tile_x,
        y=tile_y,
    )

    assert built is True
    assert expected_wgs_point[0] in projected_x_values
    assert stale_gcj_point[0] not in projected_x_values


def test_tile_encoder_writes_mapbox_y_down_coordinates_for_country_fill(tmp_path: Path):
    tile_z = 1
    tile_x, tile_y = admin_region_tiles.coordinate_to_tile(
        longitude=71,
        latitude=21,
        z=tile_z,
    )
    ring = [[70, 20], [72, 20], [72, 22], [70, 22], [70, 20]]
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "country", "name": "Country", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [ring],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=tile_z,
            x=tile_x,
            y=tile_y,
            focus_region_id="world",
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile, default_options={"y_coord_down": True})
    fill_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "fill"
        and feature["properties"]["region_id"] == "country"
    ]
    raw_tile_points = {tuple(point) for point in iter_tile_feature_points(fill_features)}
    expected_tile_points = {
        admin_region_tiles.project_to_tile_geometry(
            longitude=longitude,
            latitude=latitude,
            z=tile_z,
            x=tile_x,
            y=tile_y,
        )
        for longitude, latitude in ring
    }

    assert built is True
    assert expected_tile_points.issubset(raw_tile_points)


def test_tile_encoder_uses_final_country_fill_geometry_for_boundary_lines(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "country", "name": "Country", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
                "lineGeometry": {
                    "type": "LineString",
                    "coordinates": [[10, 0], [10, 10]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    line_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "line"
        and feature["properties"]["region_id"] == "country"
    ]
    stale_line_x = admin_region_tiles.project_to_tile_geometry(
        longitude=10,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    final_line_x = admin_region_tiles.project_to_tile_geometry(
        longitude=20,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    line_points = list(iter_tile_feature_points(line_features))

    assert built is True
    assert any(point[0] == final_line_x for point in line_points)
    assert all(point[0] != stale_line_x for point in line_points)


def test_tile_encoder_uses_final_fill_geometry_for_non_country_boundary_lines(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "province", "name": "Province", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "city", "name": "City", "level": 3, "parentId": "province"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "west", "name": "West", "level": 4, "parentId": "city"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
                },
                "lineGeometry": {
                    "type": "LineString",
                    "coordinates": [[9, 0], [9, 10]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "east", "name": "East", "level": 4, "parentId": "city"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]],
                },
                "lineGeometry": {
                    "type": "LineString",
                    "coordinates": [[11, 0], [11, 10]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="cn",
            depth=4,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="cn",
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    line_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "line"
    ]
    stale_line_x_values = {
        admin_region_tiles.project_to_tile_geometry(
            longitude=longitude,
            latitude=0,
            z=0,
            x=0,
            y=0,
        )[0]
        for longitude in (9, 11)
    }
    shared_line_x = admin_region_tiles.project_to_tile_geometry(
        longitude=10,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    line_points = list(iter_tile_feature_points(line_features))
    shared_line_segments = [
        segment
        for segment in iter_tile_feature_segments(line_features)
        if segment[0][0] == shared_line_x and segment[1][0] == shared_line_x
    ]

    assert built is True
    assert any(point[0] == shared_line_x for point in line_points)
    assert all(point[0] not in stale_line_x_values for point in line_points)
    assert len(shared_line_segments) == 1


def test_tile_encoder_derives_boundary_lines_from_final_projected_fill_geometry(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "province", "name": "Province", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "city", "name": "City", "level": 3, "parentId": "province"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "west", "name": "West", "level": 4, "parentId": "city"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [10.16, 0], [10.16, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "east", "name": "East", "level": 4, "parentId": "city"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[10.16, 0], [20, 0], [20, 10], [10.16, 10], [10.16, 0]]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="cn",
            depth=4,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="cn",
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    features = decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
    fill_features = [
        feature
        for feature in features
        if feature["properties"]["kind"] == "fill"
    ]
    line_features = [
        feature
        for feature in features
        if feature["properties"]["kind"] == "line"
    ]
    fill_x_values = {point[0] for point in iter_tile_feature_points(fill_features)}
    line_x_values = {point[0] for point in iter_tile_feature_points(line_features)}
    unsnapped_shared_x = admin_region_tiles.project_to_tile_geometry(
        longitude=10.16,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    snapped_shared_x = admin_region_tiles.snap_line_visual_coordinate(unsnapped_shared_x)

    assert built is True
    assert unsnapped_shared_x in fill_x_values
    assert unsnapped_shared_x in line_x_values
    assert snapped_shared_x not in line_x_values


def test_tile_encoder_omits_country_boundary_when_projected_fill_collapses(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "thin", "name": "Thin Country", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [0.001, 0], [0.001, 10], [0, 10], [0, 0]]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
        )
    finally:
        connection.close()

    assert built is False
    assert tile == b""


def test_tile_encoder_deduplicates_visually_equivalent_country_borders(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "west", "name": "West", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "east", "name": "East", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[10.2, 0], [20, 0], [20, 10], [10.2, 10], [10.2, 0]]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    line_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "line"
    ]
    raw_west_border_x = admin_region_tiles.project_to_tile_geometry(
        longitude=10,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    raw_east_border_x = admin_region_tiles.project_to_tile_geometry(
        longitude=10.2,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    expected_west_border_x = raw_west_border_x
    expected_east_border_x = raw_east_border_x
    line_segments = list(iter_tile_feature_segments(line_features))
    west_vertical_segments = [
        segment
        for segment in line_segments
        if segment[0][0] == expected_west_border_x
        and segment[1][0] == expected_west_border_x
        and segment[0][1] != segment[1][1]
    ]
    east_vertical_segments = [
        segment
        for segment in line_segments
        if segment[0][0] == expected_east_border_x
        and segment[1][0] == expected_east_border_x
        and segment[0][1] != segment[1][1]
    ]
    line_points = list(iter_tile_feature_points(line_features))

    assert built is True
    assert raw_west_border_x != raw_east_border_x
    assert any(point[0] == raw_east_border_x for point in line_points)
    assert len(west_vertical_segments) == 1
    assert len(east_vertical_segments) == 1


def test_tile_encoder_deduplicates_shared_borders_with_different_vertex_splits(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "cn", "name": "China", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "province", "name": "Province", "level": 2, "parentId": "cn"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "city", "name": "City", "level": 3, "parentId": "province"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "west", "name": "West", "level": 4, "parentId": "city"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [10, 0], [10, 5], [10, 10], [0, 10], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "east", "name": "East", "level": 4, "parentId": "city"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]],
                },
            },
        ],
    }
    try:
        initialize_schema(connection)
        load_admin_regions(connection, collection)

        built = build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="cn",
            depth=4,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="cn",
            depth=4,
        )
    finally:
        connection.close()

    decoded = decode(tile)
    line_features = [
        feature
        for feature in decoded[ADMIN_REGION_TILE_LAYER_NAME]["features"]
        if feature["properties"]["kind"] == "line"
    ]
    shared_line_x = admin_region_tiles.project_to_tile_geometry(
        longitude=10,
        latitude=0,
        z=0,
        x=0,
        y=0,
    )[0]
    shared_vertical_segments = [
        segment
        for segment in iter_tile_feature_segments(line_features)
        if segment[0][0] == shared_line_x
        and segment[1][0] == shared_line_x
        and segment[0][1] != segment[1][1]
    ]

    assert built is True
    assert len(shared_vertical_segments) == 1


def iter_tile_feature_points(features):
    for feature in features:
        yield from iter_tile_geometry_points(feature["geometry"])


def iter_tile_geometry_points(geometry):
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Point" and isinstance(coordinates, (list, tuple)):
        yield coordinates
        return
    if geometry_type in {"LineString", "MultiPoint"} and isinstance(coordinates, (list, tuple)):
        for point in coordinates:
            if isinstance(point, (list, tuple)):
                yield point
        return
    if geometry_type in {"Polygon", "MultiLineString"} and isinstance(coordinates, (list, tuple)):
        for line in coordinates:
            if isinstance(line, (list, tuple)):
                for point in line:
                    if isinstance(point, (list, tuple)):
                        yield point
        return
    if geometry_type == "MultiPolygon" and isinstance(coordinates, (list, tuple)):
        for polygon in coordinates:
            if isinstance(polygon, (list, tuple)):
                for line in polygon:
                    if isinstance(line, (list, tuple)):
                        for point in line:
                            if isinstance(point, (list, tuple)):
                                yield point


def iter_tile_feature_segments(features):
    for feature in features:
        yield from iter_tile_geometry_segments(feature["geometry"])


def iter_tile_geometry_segments(geometry):
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, (list, tuple)):
        yield from iter_line_segments(coordinates)
        return
    if geometry_type == "MultiLineString" and isinstance(coordinates, (list, tuple)):
        for line in coordinates:
            if isinstance(line, (list, tuple)):
                yield from iter_line_segments(line)


def iter_line_segments(line):
    points = [point for point in line if isinstance(point, (list, tuple)) and len(point) >= 2]
    yield from zip(points, points[1:])


def test_admin_region_tile_route_serves_cached_mvt_without_importing_footprints(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    missing_data_path = tmp_path / "missing-points.csv"
    region_path = tmp_path / "regions.geojson"
    region_path.write_text(json.dumps(GLOBAL_REGION_COLLECTION), encoding="utf-8")

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)
        build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=3,
            updated_at=1234,
        )
        connection.commit()
    finally:
        connection.close()

    client = TestClient(
        create_app(
            settings=Settings(
                footprint_db_path=db_path,
                footprint_data_path=missing_data_path,
                footprint_coordinate_system="wgs84",
                admin_region_data_path=region_path,
            ),
        ),
    )

    response = client.get("/api/map/tiles/admin-regions/0/0/0.mvt?focusRegionId=world&depth=3")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    decoded = decode(response.content)
    assert ADMIN_REGION_TILE_LAYER_NAME in decoded
    assert b"FeatureCollection" not in response.content


def test_admin_region_tile_store_read_does_not_import_footprints(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "footprints.sqlite"
    missing_data_path = tmp_path / "missing-points.csv"
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)
        build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=3,
            updated_at=1234,
        )
        connection.commit()
    finally:
        connection.close()

    def fail_if_import_called():
        raise AssertionError("admin-region tile reads must not import footprints")

    store = FootprintStore(
        db_path=db_path,
        data_path=missing_data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-regions.geojson",
    )
    monkeypatch.setattr(store, "ensure_ready", fail_if_import_called)
    try:
        tile = store.get_admin_region_mvt(
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=3,
        )
    finally:
        store.close()

    assert tile


def test_footprint_runtime_keeps_precomputed_admin_tiles_when_region_source_signature_changes(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "points.csv"
    region_path = tmp_path / "regions.geojson"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    region_path.write_text(json.dumps(GLOBAL_REGION_COLLECTION), encoding="utf-8")
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)
        set_meta_value(
            connection,
            "adminRegionSourceSignature",
            create_source_signature(region_path, ADMIN_REGION_LOADER_VERSION),
        )
        build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=3,
            updated_at=1234,
        )
        connection.commit()
    finally:
        connection.close()

    region_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    *GLOBAL_REGION_COLLECTION["features"],
                    {
                        "type": "Feature",
                        "properties": {"id": "fr", "name": "France", "level": 1},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[2, 42], [8, 42], [8, 51], [2, 51], [2, 42]]],
                        },
                    },
                ],
            },
        ),
        encoding="utf-8",
    )

    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=region_path,
    )
    try:
        metrics = store.get_footprint_metrics(start_date="2026-06-19", end_date="2026-06-19")
        tile_count = store.connection.execute("SELECT COUNT(*) FROM admin_region_tiles").fetchone()[0]
        region_count = store.connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0]
        tile = store.get_admin_region_mvt(
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=3,
        )
    finally:
        store.close()

    assert metrics["selectedCount"] == 0
    assert tile_count == 1
    assert region_count == 6
    assert tile


def test_admin_region_mvt_read_does_not_wait_for_footprint_connection_lock(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "points.csv"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)
        build_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=1,
            updated_at=1234,
        )

    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-regions.geojson",
    )
    executor = ThreadPoolExecutor(max_workers=1)
    timed_out = False
    try:
        with store._connection_lock:
            future = executor.submit(
                store.get_admin_region_mvt,
                z=0,
                x=0,
                y=0,
                focus_region_id="world",
                depth=1,
            )
            try:
                tile = future.result(timeout=0.5)
            except TimeoutError:
                timed_out = True
                tile = None

        if tile is None:
            tile = future.result(timeout=2)
    finally:
        executor.shutdown(wait=True)
        store.close()

    assert timed_out is False
    assert tile


def test_admin_region_source_change_does_not_clear_imported_footprints_or_visual_tiles(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "points.csv"
    region_path = tmp_path / "regions.geojson"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,0,0,0,0,10,0,0,0,0,0",
            ],
        ),
        encoding="utf-8",
    )
    region_path.write_text(json.dumps(GLOBAL_REGION_COLLECTION), encoding="utf-8")
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=region_path,
    )
    try:
        store.import_footprints()
        store.connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (0, 0, 0, 0, 0, ?, X'0102', 1000)
            """,
            (STATUS_READY,),
        )
        store.connection.commit()
    finally:
        store.close()

    region_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    *GLOBAL_REGION_COLLECTION["features"],
                    {
                        "type": "Feature",
                        "properties": {"id": "fr", "name": "France", "level": 1},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[2, 42], [8, 42], [8, 51], [2, 51], [2, 42]]],
                        },
                    },
                ],
            },
        ),
        encoding="utf-8",
    )

    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=region_path,
    )
    try:
        metrics = store.get_footprint_metrics(range_value="all")
        footprint_count = store.connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0]
        visual_tile_count = store.connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
    finally:
        store.close()

    assert metrics["selectedCount"] == 1
    assert footprint_count == 1
    assert visual_tile_count == 1


def test_footprint_metrics_runtime_does_not_load_admin_region_source_file(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "points.csv"
    region_path = tmp_path / "regions.geojson"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    region_path.write_text(json.dumps(GLOBAL_REGION_COLLECTION), encoding="utf-8")
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=region_path,
    )
    try:
        metrics = store.get_footprint_metrics(start_date="2026-06-19", end_date="2026-06-19")
        region_count = store.connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0]
    finally:
        store.close()

    assert metrics["selectedCount"] == 0
    assert region_count == 0


def test_footprint_metrics_runtime_does_not_rebuild_stale_admin_region_stats(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "points.csv"
    region_path = tmp_path / "regions.geojson"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,0,121.5,31.2,0,10,0,0,0,0,0",
            ],
        ),
        encoding="utf-8",
    )
    region_path.write_text(json.dumps(GLOBAL_REGION_COLLECTION), encoding="utf-8")
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=region_path,
    )
    try:
        store.import_footprints()
        store.connection.execute(
            """
            UPDATE admin_regions
            SET footprint_count = 0,
                first_seen_timestamp = NULL,
                stay_duration_seconds = 0,
                travel_distance_meters = 0
            """,
        )
        store.connection.execute(
            """
            INSERT INTO footprint_meta (key, value)
            VALUES ('adminRegionStatsSignature', 'stale')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
        )
        store.connection.commit()

        metrics = store.get_footprint_metrics(range_value="all")
        admin_region_stats_signature = store.connection.execute(
            "SELECT value FROM footprint_meta WHERE key = 'adminRegionStatsSignature'",
        ).fetchone()[0]
        unlocked_region_count = store.connection.execute(
            "SELECT COUNT(*) FROM admin_regions WHERE footprint_count > 0",
        ).fetchone()[0]
    finally:
        store.close()

    assert metrics["selectedCount"] == 1
    assert admin_region_stats_signature == "stale"
    assert unlocked_region_count == 0


def test_footprint_metrics_runtime_uses_existing_rows_when_source_signature_is_stale(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = tmp_path / "points.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,0,121.5,31.2,0,10,0,12,0,0,0",
            ],
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-regions.geojson",
    )
    try:
        store.import_footprints()
        store.connection.execute(
            """
            INSERT INTO footprint_meta (key, value)
            VALUES ('sourceSignature', 'stale')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
        )
        store.connection.commit()

        metrics = store.get_footprint_metrics(range_value="all")
        source_signature = store.connection.execute(
            "SELECT value FROM footprint_meta WHERE key = 'sourceSignature'",
        ).fetchone()[0]
    finally:
        store.close()

    assert metrics["selectedCount"] == 1
    assert metrics["totalDistanceMeters"] == 12
    assert source_signature == "stale"


def test_admin_region_tile_route_treats_missing_cache_row_as_empty(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    client = TestClient(
        create_app(
            settings=Settings(
                footprint_db_path=tmp_path / "footprints.sqlite",
                footprint_data_path=data_path,
                footprint_coordinate_system="wgs84",
                admin_region_data_path=tmp_path / "missing-regions.geojson",
            ),
        ),
    )

    response = client.get("/api/map/tiles/admin-regions/0/0/0.mvt?focusRegionId=world&depth=3")

    assert response.status_code == 204
    with sqlite3.connect(tmp_path / "footprints.sqlite") as connection:
        initialize_admin_region_tile_schema(connection)
        count = connection.execute("SELECT COUNT(*) FROM admin_region_tiles").fetchone()[0]
    assert count == 0


def test_admin_region_tile_route_does_not_rebuild_missing_cache_row_from_loaded_regions(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    db_path = tmp_path / "footprints.sqlite"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        initialize_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)
        region_count = connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0]

    client = TestClient(
        create_app(
            settings=Settings(
                footprint_db_path=db_path,
                footprint_data_path=data_path,
                footprint_coordinate_system="wgs84",
                admin_region_data_path=tmp_path / "missing-regions.geojson",
            ),
        ),
    )

    response = client.get("/api/map/tiles/admin-regions/0/0/0.mvt?focusRegionId=world&depth=4")

    assert region_count > 0
    assert response.status_code == 204
    with sqlite3.connect(db_path) as connection:
        count = connection.execute("SELECT COUNT(*) FROM admin_region_tiles").fetchone()[0]
    assert count == 0


def test_rejects_admin_region_tile_depth_above_four(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    client = TestClient(
        create_app(
            settings=Settings(
                footprint_db_path=tmp_path / "footprints.sqlite",
                footprint_data_path=data_path,
                footprint_coordinate_system="wgs84",
                admin_region_data_path=tmp_path / "missing-regions.geojson",
            ),
        ),
    )

    response = client.get("/api/map/tiles/admin-regions/0/0/0.mvt?focusRegionId=world&depth=5")

    assert response.status_code == 400
    assert response.json()["detail"] == "depth must be one of 1, 2, 3, or 4"


def test_admin_region_tile_zoom_limits_keep_a_safe_default_below_the_absolute_ceiling():
    assert DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM == 9
    assert MAX_ADMIN_REGION_TILE_ZOOM == 16
