from __future__ import annotations

import sqlite3

import pytest

from enroute_api.admin_regions.summary import query_admin_region_statistics
from enroute_api.footprints.store import initialize_schema


FIRST_DAY_START = 1_782_835_200
SECOND_DAY_START = 1_782_921_600


@pytest.fixture
def connection():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    seed_admin_regions(connection)
    try:
        yield connection
    finally:
        connection.close()


def test_aggregates_finest_regions_to_requested_depth(connection: sqlite3.Connection):
    result = query_admin_region_statistics(
        connection,
        depth=3,
        start_timestamp_seconds=FIRST_DAY_START,
        end_timestamp_seconds=SECOND_DAY_START - 1,
    )

    assert result == {
        "totalCount": 2,
        "visitedCount": 2,
        "visitedRegionIds": ["310100", "330100"],
        "rankings": [
            {
                "rank": 1,
                "regionId": "310100",
                "name": "Shanghai",
                "footprintCount": 2,
                "bounds": {
                    "west": 120.85,
                    "south": 30.65,
                    "east": 122.15,
                    "north": 31.9,
                },
            },
            {
                "rank": 2,
                "regionId": "330100",
                "name": "Hangzhou",
                "footprintCount": 1,
                "bounds": {
                    "west": 118.3,
                    "south": 29.1,
                    "east": 120.8,
                    "north": 30.6,
                },
            },
        ],
    }


def test_filters_the_ranking_by_date_and_depth(connection: sqlite3.Connection):
    result = query_admin_region_statistics(
        connection,
        depth=4,
        start_timestamp_seconds=SECOND_DAY_START,
        end_timestamp_seconds=SECOND_DAY_START + 86_399,
    )

    assert result == {
        "totalCount": 2,
        "visitedCount": 1,
        "visitedRegionIds": ["330106"],
        "rankings": [
            {
                "rank": 1,
                "regionId": "330106",
                "name": "Xihu",
                "footprintCount": 1,
                "bounds": {
                    "west": 120.0,
                    "south": 30.0,
                    "east": 120.3,
                    "north": 30.4,
                },
            },
        ],
    }


def test_orders_ties_by_name_then_region_id(connection: sqlite3.Connection):
    result = query_admin_region_statistics(
        connection,
        depth=3,
        start_timestamp_seconds=FIRST_DAY_START + 20,
        end_timestamp_seconds=FIRST_DAY_START + 30,
    )

    assert [row["regionId"] for row in result["rankings"]] == ["330100", "310100"]
    assert result["visitedRegionIds"] == ["310100", "330100"]

    connection.execute(
        "UPDATE admin_regions SET name = 'Same name' WHERE id IN ('310100', '330100')",
    )
    result = query_admin_region_statistics(
        connection,
        depth=3,
        start_timestamp_seconds=FIRST_DAY_START + 20,
        end_timestamp_seconds=FIRST_DAY_START + 30,
    )

    assert [row["regionId"] for row in result["rankings"]] == ["310100", "330100"]


def test_excludes_antarctica_from_depth_one_total(connection: sqlite3.Connection):
    connection.executemany(
        """
        INSERT INTO admin_regions (
          id, name, level, geometry, min_lng, max_lng, min_lat, max_lat
        ) VALUES (?, ?, 1, '{}', -180, 180, -90, -60)
        """,
        [
            ("antarctica-by-name", "Antarctica"),
            ("aq", "Southern region"),
            ("overture:division:country:ata", "Southern division"),
        ],
    )

    result = query_admin_region_statistics(
        connection,
        depth=1,
        start_timestamp_seconds=FIRST_DAY_START,
        end_timestamp_seconds=SECOND_DAY_START - 1,
    )

    assert result["totalCount"] == 1
    assert result["visitedRegionIds"] == ["cn"]


@pytest.mark.parametrize("depth", [0, 5])
def test_rejects_unsupported_depth(connection: sqlite3.Connection, depth: int):
    with pytest.raises(ValueError, match=r"^depth must be one of 1, 2, 3, or 4$"):
        query_admin_region_statistics(
            connection,
            depth=depth,
            start_timestamp_seconds=FIRST_DAY_START,
            end_timestamp_seconds=SECOND_DAY_START - 1,
        )


def seed_admin_regions(connection: sqlite3.Connection) -> None:
    connection.executemany(
        """
        INSERT INTO admin_regions (
          id, name, level, geometry, min_lng, max_lng, min_lat, max_lat
        ) VALUES (?, ?, ?, '{}', ?, ?, ?, ?)
        """,
        [
            ("cn", "China", 1, 73.0, 135.0, 18.0, 54.0),
            ("310000", "Shanghai", 2, 120.8, 122.2, 30.6, 31.9),
            ("330000", "Zhejiang", 2, 118.0, 123.0, 27.0, 31.5),
            ("310100", "Shanghai", 3, 120.85, 122.15, 30.65, 31.9),
            ("330100", "Hangzhou", 3, 118.3, 120.8, 29.1, 30.6),
            ("310115", "Pudong", 4, 121.45, 122.0, 30.68, 31.4),
            ("330106", "Xihu", 4, 120.0, 120.3, 30.0, 30.4),
        ],
    )
    connection.executemany(
        "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
        [
            ("cn", "310000"),
            ("cn", "330000"),
            ("310000", "310100"),
            ("330000", "330100"),
            ("310100", "310115"),
            ("330100", "330106"),
        ],
    )
    connection.executemany(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed,
          distance, heading, altitude, region_id
        ) VALUES (?, ?, ?, 5, 0, 0, 0, 0, ?)
        """,
        [
            (FIRST_DAY_START + 10, 121.5, 31.2, "310115"),
            (FIRST_DAY_START + 20, 121.6, 31.25, "310115"),
            (FIRST_DAY_START + 30, 120.1, 30.25, "330106"),
            (SECOND_DAY_START + 10, 120.15, 30.3, "330106"),
        ],
    )
    connection.commit()
