import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from enroute_api.admin_regions.store import (
    format_admin_region,
    get_region_chain,
    initialize_admin_region_schema,
    load_admin_regions,
    query_admin_regions_by_level,
)
from enroute_api.config import Settings
from enroute_api.main import create_app
from enroute_api.footprints.coordinates import transform_footprint_coordinate
from enroute_api.footprints.store import FootprintStore, ensure_imported, initialize_schema


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
            "properties": {"id": "pudong", "name": "浦东新区", "level": 4, "parentId": "sh"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [60, 0], [60, 60], [0, 60], [0, 0]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "sanlin", "name": "三林镇", "level": 5, "parentId": "pudong"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]],
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


def test_loads_regions_and_walks_chain(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        chain = get_region_chain(connection, "sanlin")
        regions = query_admin_regions_by_level(connection, 5)
    finally:
        connection.close()

    assert chain == ["sanlin", "pudong", "sh", "cn"]
    assert [format_admin_region(row)["id"] for row in regions] == ["sanlin"]
    assert format_admin_region(regions[0]) == {
        "id": "sanlin",
        "name": "三林镇",
        "level": 5,
        "geometry": REGION_COLLECTION["features"][3]["geometry"],
        "firstSeenTimestamp": None,
        "footprintCount": 0,
        "stayDurationSeconds": 0,
        "travelDistanceMeters": 0,
    }


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
    assert stats["pudong"]["footprint_count"] == 3
    assert stats["pudong"]["stay_duration_seconds"] == 60
    assert stats["pudong"]["travel_distance_meters"] == 100
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
        "unlocked_region_count": 4,
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
    assert stats["pudong"]["footprint_count"] == 3
    assert stats["pudong"]["stay_duration_seconds"] == 60
    assert stats["pudong"]["travel_distance_meters"] == 100


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


def test_store_normalizes_osm_level8_boundary_file_and_converts_geometry_to_gcj02(tmp_path: Path):
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
                            "fclass": "admin_level8",
                            "name": "三林镇",
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
        region = store.connection.execute(
            "SELECT id, name, level, geometry, footprint_count FROM admin_regions",
        ).fetchone()
    finally:
        store.close()

    expected_first_position = transform_footprint_coordinate(
        longitude=121.399,
        latitude=31.199,
        source_coordinate_system="wgs84",
    )
    stored_geometry = json.loads(region["geometry"])

    assert result == {
        "new_count": 1,
        "total_count": 1,
        "matched_count": 1,
        "region_count": 1,
        "unlocked_region_count": 1,
    }
    assert footprint["region_id"] == "osm:14179226"
    assert dict(region) | {"geometry": {}} == {
        "id": "osm:14179226",
        "name": "三林镇",
        "level": 5,
        "geometry": {},
        "footprint_count": 1,
    }
    assert stored_geometry["coordinates"][0][0] == list(expected_first_position)


def test_serves_admin_regions_by_level_from_cached_region_rows(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
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
    response = client.get("/api/admin-regions?level=5")

    assert response.status_code == 200
    assert response.json()["regions"][0] | {"geometry": {}} == {
        "id": "sanlin",
        "name": "三林镇",
        "level": 5,
        "geometry": {},
        "firstSeenTimestamp": 100,
        "footprintCount": 2,
        "stayDurationSeconds": 30,
        "travelDistanceMeters": 40,
    }
