import sqlite3
from pathlib import Path

from enroute_api.admin_regions.store import (
    format_admin_region,
    get_region_chain,
    initialize_admin_region_schema,
    load_admin_regions,
    query_admin_regions_by_level,
)
from enroute_api.footprints.store import ensure_imported, initialize_schema


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
