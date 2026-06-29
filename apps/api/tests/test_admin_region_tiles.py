from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient
from mapbox_vector_tile import decode

from enroute_api.admin_regions.store import initialize_admin_region_schema, load_admin_regions
from enroute_api.admin_regions.tiles import (
    ADMIN_REGION_TILE_LAYER_NAME,
    DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM,
    MAX_ADMIN_REGION_TILE_ZOOM,
    build_admin_region_tile,
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
from enroute_api.main import create_app


GLOBAL_REGION_COLLECTION = {
    "type": "FeatureCollection",
    "features": [
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


def test_resolves_world_focus_to_global_level_one_through_three(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, GLOBAL_REGION_COLLECTION)

        depth_1 = resolve_focused_region_rows(connection, focus_region_id="world", depth=1)
        depth_2 = resolve_focused_region_rows(connection, focus_region_id="world", depth=2)
        depth_3 = resolve_focused_region_rows(connection, focus_region_id="world", depth=3)
    finally:
        connection.close()

    assert [row["id"] for row in depth_1] == ["jp", "us"]
    assert [row["id"] for row in depth_2] == ["ca", "jp", "us"]
    assert [row["id"] for row in depth_3] == ["ca", "jp", "sf", "us"]


def test_builds_world_depth_three_admin_region_tile_blob(tmp_path: Path):
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
            depth=3,
            updated_at=1234,
        )
        tile = read_admin_region_tile(
            connection,
            z=0,
            x=0,
            y=0,
            focus_region_id="world",
            depth=3,
        )
        row = connection.execute(
            """
            SELECT feature_count, updated_at
            FROM admin_region_tiles
            WHERE z = 0 AND x = 0 AND y = 0 AND focus_region_id = 'world' AND depth = 3
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
    assert fill_feature_ids == ["ca", "jp", "sf", "us"]
    assert layer_features[0]["properties"].keys() >= {"region_id", "parent_id", "level", "name", "kind"}


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
    finally:
        connection.close()

    assert result.built_count == len(rows)
    assert result.feature_count == 4
    assert all(row["focus_region_id"] == "world" for row in rows)
    assert all(row["depth"] == 3 for row in rows)
    assert all(row["updated_at"] == 1234 for row in rows)


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
    assert region_count == 4
    assert tile


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


def test_rejects_admin_region_tile_depth_above_three(tmp_path: Path):
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

    response = client.get("/api/map/tiles/admin-regions/0/0/0.mvt?focusRegionId=world&depth=4")

    assert response.status_code == 400
    assert response.json()["detail"] == "depth must be one of 1, 2, or 3"


def test_admin_region_tile_zoom_limits_keep_a_safe_default_below_the_absolute_ceiling():
    assert DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM == 8
    assert MAX_ADMIN_REGION_TILE_ZOOM == 16
