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
        "depth": 3,
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
        "depth": 4,
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


def test_stops_recursive_ancestry_at_a_repeated_region(connection: sqlite3.Connection):
    connection.executemany(
        """
        INSERT INTO admin_regions (
          id, name, level, geometry, min_lng, max_lng, min_lat, max_lat
        ) VALUES (?, ?, ?, '{}', ?, ?, ?, ?)
        """,
        [
            ("cycle-parent", "Cycle parent", 3, 100.0, 101.0, 20.0, 21.0),
            ("cycle-child", "Cycle child", 4, 100.2, 100.8, 20.2, 20.8),
        ],
    )
    connection.executemany(
        "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
        [
            ("cycle-parent", "cycle-child"),
            ("cycle-child", "cycle-parent"),
        ],
    )
    footprint_timestamp = SECOND_DAY_START + 100
    connection.execute(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed,
          distance, heading, altitude, region_id
        ) VALUES (?, 100.5, 20.5, 5, 0, 0, 0, 0, 'cycle-child')
        """,
        (footprint_timestamp,),
    )
    connection.commit()

    progress_calls = 0

    def interrupt_runaway_query() -> int:
        nonlocal progress_calls
        progress_calls += 1
        return int(progress_calls >= 100)

    connection.set_progress_handler(interrupt_runaway_query, 1_000)
    try:
        result = query_admin_region_statistics(
            connection,
            depth=3,
            start_timestamp_seconds=footprint_timestamp,
            end_timestamp_seconds=footprint_timestamp,
        )
    finally:
        connection.set_progress_handler(None, 0)

    assert progress_calls < 100
    assert result == {
        "depth": 3,
        "totalCount": 3,
        "visitedCount": 1,
        "visitedRegionIds": ["cycle-parent"],
        "rankings": [
            {
                "rank": 1,
                "regionId": "cycle-parent",
                "name": "Cycle parent",
                "footprintCount": 1,
                "bounds": {
                    "west": 100.0,
                    "south": 20.0,
                    "east": 101.0,
                    "north": 21.0,
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
            ("antarctica-by-chinese-name", "南极洲"),
            ("aq", "Southern region"),
            ("country:010", "Southern country code"),
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


def test_query_is_read_only_and_only_accesses_summary_tables(connection: sqlite3.Connection):
    allowed_actions = {
        sqlite3.SQLITE_SELECT,
        sqlite3.SQLITE_READ,
        sqlite3.SQLITE_FUNCTION,
        sqlite3.SQLITE_RECURSIVE,
    }
    attempted_non_read_actions: list[tuple[int, str | None]] = []
    accessed_tables: set[str] = set()

    def authorize(
        action_code: int,
        table_name: str | None,
        _column_name: str | None,
        _database_name: str | None,
        _trigger_name: str | None,
    ) -> int:
        if action_code == sqlite3.SQLITE_READ and table_name is not None:
            accessed_tables.add(table_name)
        if action_code not in allowed_actions:
            attempted_non_read_actions.append((action_code, table_name))
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    connection.set_authorizer(authorize)
    try:
        result = query_admin_region_statistics(
            connection,
            depth=3,
            start_timestamp_seconds=FIRST_DAY_START,
            end_timestamp_seconds=SECOND_DAY_START - 1,
        )
    finally:
        connection.set_authorizer(None)

    assert result["visitedCount"] == 2
    assert attempted_non_read_actions == []
    assert accessed_tables == {"footprints", "admin_region_tree", "admin_regions"}


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
