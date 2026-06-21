import sqlite3
from pathlib import Path

from enroute_api.admin_regions.store import (
    format_admin_region,
    get_region_chain,
    initialize_admin_region_schema,
    load_admin_regions,
    query_admin_regions_by_level,
)
from enroute_api.footprints.store import initialize_schema


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
