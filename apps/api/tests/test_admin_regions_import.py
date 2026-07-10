import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

from enroute_api.admin_regions.store import (
    create_region_matcher,
    format_admin_region,
    get_region_chain,
    initialize_admin_region_schema,
    load_admin_regions,
    query_admin_regions_by_level,
)
from enroute_api.config import Settings
from enroute_api.main import create_app
from enroute_api.footprints.store import (
    ADMIN_REGION_STATS_SIGNATURE_KEY,
    FootprintStore,
    classify_footprint_admin_region,
    create_import_compatibility_signature,
    create_import_signature,
    ensure_imported,
    initialize_schema,
    set_meta_value,
)


REGION_COLLECTION = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"id": "cn", "name": "中国", "level": 1},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "sh", "name": "上海市", "level": 2, "parentId": "cn"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [80, 0], [80, 80], [0, 80], [0, 0]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "pudong", "name": "浦东新区", "level": 3, "parentId": "sh"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[30, 30], [60, 30], [60, 60], [30, 60], [30, 30]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "sanlin", "name": "三林镇", "level": 3, "parentId": "sh"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]],
            },
        },
    ],
}

AREACITY_COLLECTION = {
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
}

OVERTURE_COLLECTION = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "id": "overture:country:us",
                "names": {"primary": "United States"},
                "subtype": "country",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-125, 24], [-66, 24], [-66, 50], [-125, 50], [-125, 24]]],
            },
        },
        {
            "type": "Feature",
            "properties": {
                "id": "overture:region:us-ca",
                "names": {"primary": "California"},
                "subtype": "region",
                "parent": "overture:country:us",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-125, 32], [-114, 32], [-114, 42], [-125, 42], [-125, 32]]],
            },
        },
        {
            "type": "Feature",
            "properties": {
                "id": "overture:locality:sf",
                "names": {"primary": "San Francisco"},
                "subtype": "locality",
                "parent_id": "overture:region:us-ca",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[-122.55, 37.7], [-122.35, 37.7], [-122.35, 37.84], [-122.55, 37.84], [-122.55, 37.7]],
                ],
            },
        },
        {
            "type": "Feature",
            "properties": {
                "id": "overture:county:sf",
                "names": {"primary": "San Francisco County"},
                "subtype": "county",
                "parent": "overture:region:us-ca",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[-122.6, 37.68], [-122.34, 37.68], [-122.34, 37.85], [-122.6, 37.85], [-122.6, 37.68]],
                ],
            },
        },
    ],
}


def test_initializes_admin_region_tables_and_new_footprint_contract(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        footprint_columns = column_names(connection, "footprints")
        region_columns = column_names(connection, "admin_regions")
        tree_columns = column_names(connection, "admin_region_tree")
    finally:
        connection.close()

    assert footprint_columns == [
        "timestamp_seconds",
        "longitude",
        "latitude",
        "accuracy",
        "speed",
        "distance",
        "heading",
        "altitude",
        "region_id",
    ]
    assert "loc_type" not in footprint_columns
    assert region_columns == [
        "id",
        "name",
        "level",
        "geometry",
        "line_geometry",
        "line_mask_geometry",
        "min_lng",
        "max_lng",
        "min_lat",
        "max_lat",
        "first_seen_timestamp",
        "footprint_count",
        "stay_duration_seconds",
        "travel_distance_meters",
    ]
    assert tree_columns == ["parent_id", "child_id"]


def test_initialize_schema_migrates_country_id_out_of_existing_footprints(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        connection.execute(
            """
            CREATE TABLE footprints (
              timestamp_seconds INTEGER PRIMARY KEY,
              longitude REAL NOT NULL,
              latitude REAL NOT NULL,
              accuracy REAL NOT NULL,
              speed REAL NOT NULL,
              distance REAL NOT NULL,
              heading REAL NOT NULL,
              altitude REAL NOT NULL,
              region_id TEXT,
              country_id TEXT
            )
            """,
        )
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude, region_id, country_id
            ) VALUES (100, 121.5, 31.2, 5, -1, 0, 0, 3, '310115', 'CHN')
            """,
        )
        connection.commit()

        initialize_schema(connection)

        footprint_columns = column_names(connection, "footprints")
        row = connection.execute(
            """
            SELECT timestamp_seconds, longitude, latitude, region_id
            FROM footprints
            """,
        ).fetchone()
    finally:
        connection.close()

    assert footprint_columns == [
        "timestamp_seconds",
        "longitude",
        "latitude",
        "accuracy",
        "speed",
        "distance",
        "heading",
        "altitude",
        "region_id",
    ]
    assert dict(row) == {
        "timestamp_seconds": 100,
        "longitude": 121.5,
        "latitude": 31.2,
        "region_id": "310115",
    }


def test_loads_regions_and_walks_chain(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        chain = get_region_chain(connection, "pudong")
        regions = query_admin_regions_by_level(connection, 3)
    finally:
        connection.close()

    assert chain == ["pudong", "sh", "cn"]
    assert [format_admin_region(row)["id"] for row in regions] == ["pudong", "sanlin"]
    assert format_admin_region(regions[0]) == {
        "id": "pudong",
        "name": "浦东新区",
        "level": 3,
        "geometry": REGION_COLLECTION["features"][2]["geometry"],
        "firstSeenTimestamp": None,
        "footprintCount": 0,
        "stayDurationSeconds": 0,
        "travelDistanceMeters": 0,
    }


def test_normalizes_areacity_province_city_district_geojson_without_coordinate_transform(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, AREACITY_COLLECTION)

        rows = connection.execute(
            "SELECT id, name, level, geometry FROM admin_regions ORDER BY level",
        ).fetchall()
        chain = get_region_chain(connection, "310115")
    finally:
        connection.close()

    stored_geometry = json.loads(rows[0]["geometry"])

    assert [(row["id"], row["level"]) for row in rows] == [
        ("310000", 2),
        ("310100", 3),
        ("310115", 4),
    ]
    assert chain == ["310115", "310100", "310000"]
    assert stored_geometry["coordinates"][0][0] == [120, 30]


def test_normalizes_overture_country_only_for_global_default_scope_without_coordinate_transform(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, OVERTURE_COLLECTION)

        rows = connection.execute(
            "SELECT id, name, level, geometry FROM admin_regions ORDER BY level",
        ).fetchall()
    finally:
        connection.close()

    stored_geometry = json.loads(rows[0]["geometry"])

    assert [(row["id"], row["name"], row["level"]) for row in rows] == [
        ("overture:country:us", "United States", 1),
    ]
    assert stored_geometry["coordinates"][0][0] == [-125, 24]


def test_excludes_antarctica_from_country_level_admin_regions(tmp_path: Path):
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "country:aq", "name": "Antarctica", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-180, -85], [180, -85], [180, -60], [-180, -60], [-180, -85]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "country:nz", "name": "New Zealand", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[166, -47], [179, -47], [179, -34], [166, -34], [166, -47]]],
                },
            },
        ],
    }
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, collection)

        rows = connection.execute("SELECT id, name, level FROM admin_regions ORDER BY id").fetchall()
    finally:
        connection.close()

    assert [(row["id"], row["name"], row["level"]) for row in rows] == [
        ("country:nz", "New Zealand", 1),
    ]


def test_admin_region_level_query_excludes_existing_antarctica_rows(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        connection.executemany(
            """
            INSERT INTO admin_regions (
              id, name, level, geometry, min_lng, max_lng, min_lat, max_lat
            )
            VALUES (?, ?, 1, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "2ba5ad8b-6784-4088-87bb-50c14f2cbdc0",
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

        rows = query_admin_regions_by_level(connection, 1)
    finally:
        connection.close()

    assert [(row["id"], row["name"], row["level"]) for row in rows] == [
        ("country:nz", "New Zealand", 1),
    ]


def test_keeps_areacity_district_features_for_china_level_four_scope(tmp_path: Path):
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "id": "441900:city",
                    "adcode": "441900",
                    "parent": "440000",
                    "name": "Dongguan City",
                    "level": "city",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[113, 22], [114, 22], [114, 24], [113, 24], [113, 22]]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "id": "441900:district",
                    "adcode": "441900",
                    "parent": "441900:city",
                    "name": "Dongguan District",
                    "level": "district",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[113, 22], [114, 22], [114, 24], [113, 24], [113, 22]]],
                },
            },
        ],
    }
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, collection)

        rows = connection.execute("SELECT id, level FROM admin_regions ORDER BY level").fetchall()
    finally:
        connection.close()

    assert [(row["id"], row["level"]) for row in rows] == [
        ("441900:city", 3),
        ("441900:district", 4),
    ]


def test_keeps_china_explicit_level_four_and_skips_non_china_levels_above_country(tmp_path: Path):
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
                "properties": {"id": "us-ca", "name": "California", "level": 2, "parentId": "us"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-125, 32], [-114, 32], [-114, 42], [-125, 42], [-125, 32]]],
                },
            },
        ],
    }
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, collection)

        rows = connection.execute("SELECT id, level FROM admin_regions ORDER BY id").fetchall()
    finally:
        connection.close()

    assert [(row["id"], row["level"]) for row in rows] == [
        ("310000", 2),
        ("310100", 3),
        ("310115", 4),
        ("cn", 1),
        ("us", 1),
    ]


def test_does_not_treat_short_numeric_non_china_ids_as_china_adcodes(tmp_path: Path):
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "392", "name": "Japan", "level": 1},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[129, 31], [146, 31], [146, 46], [129, 46], [129, 31]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "tokyo", "name": "Tokyo", "level": 2, "parentId": "392"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]],
                },
            },
        ],
    }
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, collection)

        rows = connection.execute("SELECT id, name, level FROM admin_regions ORDER BY level").fetchall()
    finally:
        connection.close()

    assert [(row["id"], row["name"], row["level"]) for row in rows] == [
        ("392", "Japan", 1),
    ]


def test_region_matcher_reuses_parsed_geometries_across_points(tmp_path: Path, monkeypatch):
    from enroute_api.admin_regions import store as admin_region_store

    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        original_json_loads = admin_region_store.json.loads
        geometry_parse_count = 0

        def counting_json_loads(value, *args, **kwargs):
            nonlocal geometry_parse_count
            if isinstance(value, str) and '"coordinates"' in value:
                geometry_parse_count += 1
            return original_json_loads(value, *args, **kwargs)

        monkeypatch.setattr(admin_region_store.json, "loads", counting_json_loads)

        matcher = create_region_matcher(connection)
        first_match = matcher.find_finest_region_id(longitude=10, latitude=10)
        second_match = matcher.find_finest_region_id(longitude=12, latitude=12)
    finally:
        connection.close()

    assert first_match == "sanlin"
    assert second_match == "sanlin"
    assert geometry_parse_count == 4


def test_classifies_new_footprint_against_finest_cached_admin_region(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)
        matcher = create_region_matcher(connection)

        match = classify_footprint_admin_region(
            connection,
            {"longitude": 10, "latitude": 10},
            region_matcher=matcher,
        )
    finally:
        connection.close()

    assert match == "sanlin"


def column_names(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info({table_name})")]


CSV = "\n".join(
    [
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
        "100,1,10,10,0,5,-1,0,1,0,3",
        "130,1,12,12,0,5,-1,40,1,0,3",
        "160,1,45,45,0,5,-1,60,1,0,3",
    ],
)

GLOBAL_CSV = "\n".join(
    [
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
        "100,1,-122.5,37.75,0,5,-1,0,1,0,3",
        "130,1,-122.45,37.76,0,5,-1,40,1,0,3",
        "160,1,-122.4,37.78,0,5,-1,60,1,0,3",
    ],
)


def test_incremental_import_assigns_finest_region_and_updates_cached_stats(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")

        footprints = connection.execute(
            "SELECT timestamp_seconds, region_id FROM footprints ORDER BY timestamp_seconds",
        ).fetchall()
        stats = {
            row["id"]: dict(row)
            for row in connection.execute(
                """
                SELECT id, footprint_count, first_seen_timestamp, stay_duration_seconds, travel_distance_meters
                FROM admin_regions
                ORDER BY id
                """,
            )
        }
    finally:
        connection.close()

    assert [(row["timestamp_seconds"], row["region_id"]) for row in footprints] == [
        (100, "sanlin"),
        (130, "sanlin"),
        (160, "pudong"),
    ]
    assert stats["sanlin"]["footprint_count"] == 2
    assert stats["sanlin"]["first_seen_timestamp"] == 100
    assert stats["sanlin"]["stay_duration_seconds"] == 30
    assert stats["sanlin"]["travel_distance_meters"] == 40
    assert stats["pudong"]["footprint_count"] == 1
    assert stats["pudong"]["stay_duration_seconds"] == 0
    assert stats["pudong"]["travel_distance_meters"] == 0
    assert stats["sh"]["footprint_count"] == 3
    assert stats["cn"]["footprint_count"] == 3


def test_reimporting_same_csv_does_not_double_count_region_stats(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        before = connection.execute(
            """
            SELECT footprint_count, stay_duration_seconds, travel_distance_meters
            FROM admin_regions
            WHERE id = 'pudong'
            """,
        ).fetchone()
        ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        after = connection.execute(
            """
            SELECT footprint_count, stay_duration_seconds, travel_distance_meters
            FROM admin_regions
            WHERE id = 'pudong'
            """,
        ).fetchone()
    finally:
        connection.close()

    assert dict(after) == dict(before)


def test_appended_csv_imports_only_new_rows_without_resetting_region_stats(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    initial_csv = "\n".join(
        [
            "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
            "100,1,10,10,0,5,-1,0,1,0,3",
            "130,1,12,12,0,5,-1,40,1,0,3",
        ],
    )
    appended_csv = "\n".join(
        [
            initial_csv,
            "160,1,45,45,0,5,-1,60,1,0,3",
        ],
    )
    data_path.write_text(initial_csv, encoding="utf-8")
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        first_result = ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        data_path.write_text(appended_csv, encoding="utf-8")
        second_result = ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        footprints = connection.execute(
            "SELECT timestamp_seconds, region_id FROM footprints ORDER BY timestamp_seconds",
        ).fetchall()
        stats = {
            row["id"]: dict(row)
            for row in connection.execute(
                """
                SELECT id, footprint_count, stay_duration_seconds, travel_distance_meters
                FROM admin_regions
                ORDER BY id
                """,
            )
        }
    finally:
        connection.close()

    assert first_result == {
        "new_count": 2,
        "total_count": 2,
        "matched_count": 2,
        "region_count": 4,
        "unlocked_region_count": 3,
    }
    assert second_result == {
        "new_count": 1,
        "total_count": 3,
        "matched_count": 3,
        "region_count": 4,
        "unlocked_region_count": 4,
    }
    assert [(row["timestamp_seconds"], row["region_id"]) for row in footprints] == [
        (100, "sanlin"),
        (130, "sanlin"),
        (160, "pudong"),
    ]
    assert stats["sanlin"]["footprint_count"] == 2
    assert stats["sanlin"]["stay_duration_seconds"] == 30
    assert stats["sanlin"]["travel_distance_meters"] == 40
    assert stats["pudong"]["footprint_count"] == 1
    assert stats["pudong"]["stay_duration_seconds"] == 0
    assert stats["pudong"]["travel_distance_meters"] == 0


def test_appended_csv_rebuilds_missing_region_stats_before_counting_new_rows(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    initial_csv = "\n".join(
        [
            "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
            "100,1,10,10,0,5,-1,0,1,0,3",
            "130,1,12,12,0,5,-1,40,1,0,3",
        ],
    )
    appended_csv = "\n".join(
        [
            initial_csv,
            "160,1,45,45,0,5,-1,60,1,0,3",
        ],
    )
    data_path.write_text(initial_csv, encoding="utf-8")
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        with connection:
            connection.execute(
                "DELETE FROM footprint_meta WHERE key = 'adminRegionStatsSignature'",
            )
            connection.execute(
                """
                UPDATE admin_regions
                SET first_seen_timestamp = NULL,
                    footprint_count = 0,
                    stay_duration_seconds = 0,
                    travel_distance_meters = 0
                """,
            )
        data_path.write_text(appended_csv, encoding="utf-8")

        result = ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        stats = {
            row["id"]: dict(row)
            for row in connection.execute(
                """
                SELECT id, footprint_count, stay_duration_seconds, travel_distance_meters
                FROM admin_regions
                ORDER BY id
                """,
            )
        }
    finally:
        connection.close()

    assert result["new_count"] == 1
    assert stats["sanlin"]["footprint_count"] == 2
    assert stats["sanlin"]["stay_duration_seconds"] == 30
    assert stats["sanlin"]["travel_distance_meters"] == 40
    assert stats["pudong"]["footprint_count"] == 1
    assert stats["pudong"]["stay_duration_seconds"] == 0
    assert stats["pudong"]["travel_distance_meters"] == 0


def test_store_loads_boundary_file_before_incremental_import_and_reports_counts(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    region_path = tmp_path / "regions.geojson"
    region_path.write_text(json.dumps(REGION_COLLECTION), encoding="utf-8")
    store = FootprintStore(
        db_path=tmp_path / "footprints.sqlite",
        data_path=data_path,
        coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    try:
        first_result = store.import_footprints()
        second_result = store.import_footprints()
        matched_count = store.connection.execute(
            "SELECT COUNT(*) FROM footprints WHERE region_id IS NOT NULL",
        ).fetchone()[0]
        region_count = store.connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0]
    finally:
        store.close()

    assert first_result == {
        "new_count": 3,
        "total_count": 3,
        "matched_count": 3,
        "region_count": 4,
        "unlocked_region_count": 4,
    }
    assert second_result["new_count"] == 0
    assert second_result["total_count"] == 3
    assert matched_count == 3
    assert region_count == 4


def test_store_rebuilds_region_stats_when_boundary_reload_clears_cached_rows(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    region_path = tmp_path / "regions.geojson"
    region_path.write_text(json.dumps(REGION_COLLECTION), encoding="utf-8")
    store = FootprintStore(
        db_path=tmp_path / "footprints.sqlite",
        data_path=data_path,
        coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    try:
        first_result = store.import_footprints()
        with store.connection:
            store.connection.execute(
                "DELETE FROM footprint_meta WHERE key = 'adminRegionSourceSignature'",
            )
            store.connection.execute(
                """
                UPDATE admin_regions
                SET first_seen_timestamp = NULL,
                    footprint_count = 0,
                    stay_duration_seconds = 0,
                    travel_distance_meters = 0
                """,
            )

        second_result = store.import_footprints()
        stats = store.connection.execute(
            """
            SELECT footprint_count, stay_duration_seconds, travel_distance_meters
            FROM admin_regions
            WHERE id = 'pudong'
            """,
        ).fetchone()
    finally:
        store.close()

    assert first_result["unlocked_region_count"] == 4
    assert second_result["new_count"] == 0
    assert second_result["unlocked_region_count"] == 4
    assert dict(stats) == {
        "footprint_count": 1,
        "stay_duration_seconds": 0,
        "travel_distance_meters": 0,
    }


def test_runtime_ensure_ready_preserves_prebuilt_admin_regions_with_stored_signature(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    runtime_region_path = tmp_path / "runtime-regions.geojson"
    runtime_region_path.write_text(json.dumps(AREACITY_COLLECTION), encoding="utf-8")
    prebuilt_signature = json.dumps(
        {
            "source": "prebuilt-world-l1-china-l4",
        },
        separators=(",", ":"),
    )
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)
        with connection:
            set_meta_value(connection, "adminRegionSourceSignature", prebuilt_signature)
            set_meta_value(
                connection,
                "sourceSignature",
                create_import_signature(data_path, "gcj02", prebuilt_signature),
            )
            set_meta_value(
                connection,
                "importCompatibilitySignature",
                create_import_compatibility_signature("gcj02", prebuilt_signature),
            )
            set_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY, prebuilt_signature)
    finally:
        connection.close()

    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="gcj02",
        admin_region_data_path=runtime_region_path,
    )
    try:
        store.ensure_ready()
        region_rows = store.connection.execute(
            """
            SELECT level, COUNT(*) AS count
            FROM admin_regions
            GROUP BY level
            ORDER BY level
            """,
        ).fetchall()
        stored_signature = store.connection.execute(
            "SELECT value FROM footprint_meta WHERE key = 'adminRegionSourceSignature'",
        ).fetchone()["value"]
    finally:
        store.close()

    assert [tuple(row) for row in region_rows] == [(1, 1), (2, 1), (3, 2)]
    assert stored_signature == prebuilt_signature


def test_store_serializes_concurrent_initial_imports(tmp_path: Path, monkeypatch):
    from enroute_api.footprints import store as footprint_store

    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    store = FootprintStore(
        db_path=tmp_path / "footprints.sqlite",
        data_path=data_path,
        coordinate_system="gcj02",
    )
    active_imports = 0
    overlapped = False

    def slow_ensure_imported(*args, **kwargs):
        nonlocal active_imports, overlapped
        active_imports += 1
        if active_imports > 1:
            overlapped = True
        time.sleep(0.05)
        active_imports -= 1
        return {
            "new_count": 0,
            "total_count": 0,
            "matched_count": 0,
            "region_count": 0,
            "unlocked_region_count": 0,
        }

    monkeypatch.setattr(footprint_store, "ensure_imported", slow_ensure_imported)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(store.ensure_ready) for _ in range(2)]
            for future in futures:
                future.result(timeout=1)
    finally:
        store.close()

    assert overlapped is False


def test_store_skips_non_country_osm_boundary_file_for_global_default_scope(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "100,1,121.4,31.2,0,5,-1,0,1,0,3",
            ],
        ),
        encoding="utf-8",
    )
    region_path = tmp_path / "osm-regions.geojson"
    wgs84_polygon = {
        "type": "Polygon",
        "coordinates": [
            [
                [121.399, 31.199],
                [121.401, 31.199],
                [121.401, 31.201],
                [121.399, 31.201],
                [121.399, 31.199],
            ],
        ],
    }
    region_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "osm_id": "14179226",
                            "fclass": "admin_level5",
                            "name": "San Francisco",
                        },
                        "geometry": wgs84_polygon,
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=tmp_path / "footprints.sqlite",
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=region_path,
    )
    try:
        result = store.import_footprints()
        footprint = store.connection.execute(
            "SELECT region_id FROM footprints WHERE timestamp_seconds = 100",
        ).fetchone()
        region_count = store.connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0]
    finally:
        store.close()

    assert result == {
        "new_count": 1,
        "total_count": 1,
        "matched_count": 0,
        "region_count": 0,
        "unlocked_region_count": 0,
    }
    assert footprint["region_id"] is None
    assert region_count == 0


def test_wgs84_raw_footprint_storage_keeps_region_matching_working(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "100,1,121.4,31.2,0,5,-1,0,1,0,3",
            ],
        ),
        encoding="utf-8",
    )
    region_path = tmp_path / "regions.geojson"
    region_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "id": "cn",
                            "name": "China",
                            "level": 1,
                            "sourceCoordinateSystem": "wgs84",
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]]],
                        },
                    },
                    {
                        "type": "Feature",
                        "properties": {
                            "id": "310000",
                            "name": "Shanghai",
                            "level": 2,
                            "parentId": "cn",
                            "sourceCoordinateSystem": "wgs84",
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
                            "name": "WGS84 Region",
                            "level": 3,
                            "parentId": "310000",
                            "sourceCoordinateSystem": "wgs84",
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [121.399, 31.199],
                                    [121.401, 31.199],
                                    [121.401, 31.201],
                                    [121.399, 31.201],
                                    [121.399, 31.199],
                                ],
                            ],
                        },
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    store = FootprintStore(
        db_path=tmp_path / "footprints.sqlite",
        data_path=data_path,
        coordinate_system="wgs84",
        admin_region_data_path=region_path,
    )
    try:
        result = store.import_footprints()
        footprint = store.connection.execute(
            "SELECT longitude, latitude, region_id FROM footprints WHERE timestamp_seconds = 100",
        ).fetchone()
    finally:
        store.close()

    assert result["matched_count"] == 1
    assert tuple(footprint[:2]) == (121.4, 31.2)
    assert footprint["region_id"] == "310100"


def test_serves_admin_regions_by_level_from_cached_region_rows(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    region_path = tmp_path / "areacity-regions.geojson"
    region_path.write_text(json.dumps(AREACITY_COLLECTION), encoding="utf-8")
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    store = FootprintStore(
        db_path=db_path,
        data_path=data_path,
        coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    try:
        store.import_footprints()
    finally:
        store.close()
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions?level=4")

    assert response.status_code == 200
    assert response.json()["regions"][0] | {"geometry": {}} == {
        "id": "310115",
        "name": "Pudong",
        "level": 4,
        "geometry": {},
        "firstSeenTimestamp": None,
        "footprintCount": 0,
        "stayDurationSeconds": 0,
        "travelDistanceMeters": 0,
    }


def test_serves_admin_regions_intersecting_viewport_bbox(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    region_path = tmp_path / "areacity.geojson"
    region_path.write_text(json.dumps(AREACITY_COLLECTION), encoding="utf-8")
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, AREACITY_COLLECTION)
        connection.commit()
    finally:
        connection.close()
    client = TestClient(create_app(settings=settings))

    included = client.get(
        "/api/admin-regions?level=3&west=121.0&south=30.8&east=122.2&north=32.2&zoom=10",
    )
    excluded = client.get(
        "/api/admin-regions?level=3&west=10&south=10&east=11&north=11&zoom=10",
    )

    assert included.status_code == 200
    assert [region["id"] for region in included.json()["regions"]] == ["310100"]
    assert excluded.status_code == 200
    assert excluded.json()["regions"] == []


def test_serves_admin_regions_while_snapshot_requests_share_store_connection(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    client = TestClient(create_app(settings=settings))

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)
    finally:
        connection.close()

    snapshot_payload = {
        "timeRange": {
            "startTimestampSeconds": 0,
            "endTimestampSeconds": 200,
            "dayCount": 1,
        },
        "zoom": 10,
        "cellSizePx": 8,
        "viewportBounds": {"west": 0, "south": 0, "east": 80, "north": 80},
        "viewportNorthWestWorldPixel": {"x": 0, "y": 0},
    }

    with ThreadPoolExecutor(max_workers=2) as executor:
        snapshot_future = executor.submit(
            client.post,
            "/api/footprints/snapshot",
            json=snapshot_payload,
        )
        regions_future = executor.submit(client.get, "/api/admin-regions?level=3")

        snapshot_response = snapshot_future.result(timeout=3)
        regions_response = regions_future.result(timeout=3)

    assert snapshot_response.status_code == 200
    assert regions_response.status_code == 200
    assert [region["id"] for region in regions_response.json()["regions"]] == ["pudong", "sanlin"]


def test_serves_level3_admin_regions_from_cached_rows(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    client = TestClient(create_app(settings=settings))

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)
    finally:
        connection.close()

    client.get("/api/footprints")
    response = client.get("/api/admin-regions?level=3")

    assert response.status_code == 200
    assert [region["id"] for region in response.json()["regions"]] == ["pudong", "sanlin"]


def test_rejects_unavailable_admin_region_levels(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=tmp_path / "footprints.sqlite",
        footprint_coordinate_system="gcj02",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions?level=5")

    assert response.status_code == 400
    assert response.json()["detail"] == "level must be one of 1, 2, 3, or 4"


def test_admin_regions_endpoint_allows_china_level_four_regions(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    db_path = tmp_path / "footprints.sqlite"
    data_path.write_text(CSV, encoding="utf-8")
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    client = TestClient(create_app(settings=settings))

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, AREACITY_COLLECTION)
    finally:
        connection.close()

    client.get("/api/footprints")
    response = client.get("/api/admin-regions?level=4")

    assert response.status_code == 200
    assert [region["id"] for region in response.json()["regions"]] == ["310115"]


def test_previews_local_shanghai_level4_regions_without_importing_footprints(tmp_path: Path):
    data_path = tmp_path / "missing-points.csv"
    db_path = tmp_path / "footprints.sqlite"
    region_path = tmp_path / "admin-regions.geojson"
    region_path.write_text(json.dumps(AREACITY_COLLECTION, ensure_ascii=False), encoding="utf-8")
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions/preview/shanghai?source=local&level=4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "local"
    assert payload["level"] == 4
    assert payload["available"] is True
    assert payload["coordinateSystem"] == "gcj02"
    assert payload["reason"] is None
    assert payload["regions"] == [
        {
            "id": "310115",
            "name": "Pudong",
            "level": 4,
            "geometry": AREACITY_COLLECTION["features"][2]["geometry"],
        },
    ]
    connection = sqlite3.connect(db_path)
    try:
        assert connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0] == 0
    finally:
        connection.close()


def test_uses_cached_level4_sqlite_rows_for_local_shanghai_preview(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, AREACITY_COLLECTION)
    finally:
        connection.close()
    settings = Settings(
        footprint_data_path=tmp_path / "missing-points.csv",
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions/preview/shanghai?source=local&level=4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "local"
    assert payload["level"] == 4
    assert payload["available"] is True
    assert payload["coordinateSystem"] == "gcj02"
    assert payload["reason"] is None
    assert [region["id"] for region in payload["regions"]] == ["310115"]
def test_preview_marks_local_shanghai_level5_unavailable_when_only_areacity_data_exists(
    tmp_path: Path,
):
    region_path = tmp_path / "admin-regions.geojson"
    region_path.write_text(json.dumps(AREACITY_COLLECTION, ensure_ascii=False), encoding="utf-8")
    settings = Settings(
        footprint_data_path=tmp_path / "missing-points.csv",
        footprint_db_path=tmp_path / "footprints.sqlite",
        footprint_coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions/preview/shanghai?source=local&level=5")

    assert response.status_code == 200
    assert response.json() == {
        "source": "local",
        "level": 5,
        "available": False,
        "coordinateSystem": None,
        "reason": "本地 AreaCity 源只提供上海 level 2-4，level 5 请切换到 OSM 源。",
        "regions": [],
    }


def test_previews_osm_shanghai_level5_regions_from_adjacent_geojson(tmp_path: Path):
    region_path = tmp_path / "admin-regions.geojson"
    region_path.write_text(json.dumps(AREACITY_COLLECTION, ensure_ascii=False), encoding="utf-8")
    osm_path = tmp_path / "osm" / "shanghai-admin-level8.geojson"
    osm_path.parent.mkdir()
    osm_geometry = {
        "type": "Polygon",
        "coordinates": [
            [
                [121.399, 31.199],
                [121.401, 31.199],
                [121.401, 31.201],
                [121.399, 31.201],
                [121.399, 31.199],
            ],
        ],
    }
    osm_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "osm_id": "14179226",
                            "admin_level": "8",
                            "name": "Sanlin",
                        },
                        "geometry": osm_geometry,
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    settings = Settings(
        footprint_data_path=tmp_path / "missing-points.csv",
        footprint_db_path=tmp_path / "footprints.sqlite",
        footprint_coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions/preview/shanghai?source=osm&level=5")

    assert response.status_code == 200
    assert response.json() == {
        "source": "osm",
        "level": 5,
        "available": True,
        "coordinateSystem": "wgs84",
        "reason": None,
        "regions": [
            {
                "id": "osm:14179226",
                "name": "Sanlin",
                "level": 5,
                "geometry": osm_geometry,
            },
        ],
    }


def test_previews_osm_shanghai_level5_regions_from_fclass_geojson(tmp_path: Path):
    region_path = tmp_path / "admin-regions.geojson"
    region_path.write_text(json.dumps(AREACITY_COLLECTION, ensure_ascii=False), encoding="utf-8")
    osm_path = tmp_path / "osm" / "shanghai-admin-level8.geojson"
    osm_path.parent.mkdir()
    osm_geometry = {
        "type": "Polygon",
        "coordinates": [
            [
                [121.399, 31.199],
                [121.401, 31.199],
                [121.401, 31.201],
                [121.399, 31.201],
                [121.399, 31.199],
            ],
        ],
    }
    osm_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "osm_id": "14179226",
                            "fclass": "admin_level8",
                            "name": "Sanlin",
                        },
                        "geometry": osm_geometry,
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    settings = Settings(
        footprint_data_path=tmp_path / "missing-points.csv",
        footprint_db_path=tmp_path / "footprints.sqlite",
        footprint_coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions/preview/shanghai?source=osm&level=5")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["regions"][0]["id"] == "osm:14179226"
    assert payload["regions"][0]["level"] == 5


def test_previews_osm_shanghai_level4_regions_from_adjacent_shapefile(tmp_path: Path):
    import shapefile

    region_path = tmp_path / "admin-regions.geojson"
    region_path.write_text(json.dumps(AREACITY_COLLECTION, ensure_ascii=False), encoding="utf-8")
    shape_base = tmp_path / "osm" / "shanghai-shp" / "gis_osm_adminareas_a_free_1"
    shape_base.parent.mkdir(parents=True)
    writer = shapefile.Writer(str(shape_base), shapeType=shapefile.POLYGON)
    writer.field("osm_id", "C", size=12)
    writer.field("code", "N", size=4)
    writer.field("fclass", "C", size=28)
    writer.field("name", "C", size=100)
    writer.poly([
        [
            [121.45, 31.20],
            [121.46, 31.20],
            [121.46, 31.21],
            [121.45, 31.21],
            [121.45, 31.20],
        ],
    ])
    writer.record("398351", 1206, "boundary", "Hongkou")
    writer.close()

    settings = Settings(
        footprint_data_path=tmp_path / "missing-points.csv",
        footprint_db_path=tmp_path / "footprints.sqlite",
        footprint_coordinate_system="gcj02",
        admin_region_data_path=region_path,
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions/preview/shanghai?source=osm&level=4")

    assert response.status_code == 200
    payload = response.json()
    assert payload | {"regions": []} == {
        "source": "osm",
        "level": 4,
        "available": True,
        "coordinateSystem": "wgs84",
        "reason": None,
        "regions": [],
    }
    assert payload["regions"][0]["id"] == "osm:398351"
    assert payload["regions"][0]["name"] == "Hongkou"
    assert payload["regions"][0]["level"] == 4
    assert payload["regions"][0]["geometry"]["type"] == "Polygon"


def test_rejects_unknown_shanghai_preview_source(tmp_path: Path):
    settings = Settings(
        footprint_data_path=tmp_path / "missing-points.csv",
        footprint_db_path=tmp_path / "footprints.sqlite",
        footprint_coordinate_system="gcj02",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/admin-regions/preview/shanghai?source=unknown&level=4")

    assert response.status_code == 400
    assert response.json()["detail"] == "source must be one of amap, local, or osm"
