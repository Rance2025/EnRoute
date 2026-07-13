from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from unittest.mock import ANY

import pytest
from fastapi.testclient import TestClient
from mapbox_vector_tile import encode

from enroute_api.admin_regions import thumbnail as thumbnail_module
from enroute_api.admin_regions.summary import query_admin_region_statistics
from enroute_api.admin_regions.thumbnail import create_admin_region_thumbnail
from enroute_api.config import Settings
from enroute_api.footprints.store import initialize_schema
from enroute_api.main import create_app


FIRST_DAY_START = 1_781_539_200
SECOND_DAY_START = 1_781_625_600
CSV_HEADER = (
    "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,"
    "isBackForeground,stepType,altitude\n"
)


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


@pytest.mark.parametrize(
    ("depth", "frame"),
    [
        (1, thumbnail_module.WORLD_BOUNDS),
        (2, thumbnail_module.CHINA_BOUNDS),
        (3, thumbnail_module.CHINA_BOUNDS),
        (4, thumbnail_module.CHINA_BOUNDS),
    ],
)
def test_thumbnail_projection_uses_one_scale_for_both_axes(
    depth: int,
    frame: tuple[float, float, float, float],
):
    west, south, east, north = frame
    projected_west, projected_north, projected_east, projected_south = (
        thumbnail_module.project_geographic_bounds(west, south, east, north, depth=depth)
    )
    horizontal_scale = (projected_east - projected_west) / (east - west)
    vertical_scale = (projected_south - projected_north) / (north - south)

    assert horizontal_scale == pytest.approx(vertical_scale)
    assert projected_west >= thumbnail_module.VIEWBOX_PADDING
    assert projected_north >= thumbnail_module.VIEWBOX_PADDING
    assert projected_east <= thumbnail_module.VIEWBOX_WIDTH - thumbnail_module.VIEWBOX_PADDING
    assert projected_south <= thumbnail_module.VIEWBOX_HEIGHT - thumbnail_module.VIEWBOX_PADDING


def test_thumbnail_uses_fixed_world_and_china_frames_without_presentation_attributes(
    connection: sqlite3.Connection,
):
    world = create_admin_region_thumbnail(
        connection,
        depth=1,
        visited_region_ids={"cn"},
    )
    province = create_admin_region_thumbnail(
        connection,
        depth=2,
        visited_region_ids={"310000"},
    )
    city = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"310100"},
    )
    district = create_admin_region_thumbnail(
        connection,
        depth=4,
        visited_region_ids={"310115"},
    )

    for thumbnail in (world, province, city, district):
        assert thumbnail.keys() == {"viewBox", "basePath", "visitedPath"}
        assert all(isinstance(value, str) for value in thumbnail.values())
        assert thumbnail["viewBox"] == "0 0 320 150"
        assert thumbnail["basePath"].startswith("M")
        assert thumbnail["visitedPath"].startswith("M")
        assert not ({"stroke", "style", "label"} & thumbnail.keys())
        assert not re.search(r"\d+\.\d{2,}", thumbnail["basePath"])

    assert json.dumps(city).find("stroke") == -1


def test_thumbnail_visited_path_only_contains_requested_regions(
    connection: sqlite3.Connection,
):
    shanghai = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"310100"},
    )
    hangzhou = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"330100"},
    )
    none = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids=set(),
    )

    assert shanghai["basePath"] == hangzhou["basePath"] == none["basePath"]
    assert shanghai["visitedPath"] != hangzhou["visitedPath"]
    assert shanghai["visitedPath"] + hangzhou["visitedPath"] == shanghai["basePath"]
    assert shanghai["visitedPath"].count("M") == 2  # Exterior plus one interior hole.
    assert hangzhou["visitedPath"].count("M") == 1  # Polygon from a GeometryCollection.
    assert none["visitedPath"] == ""


def test_thumbnail_reuses_compact_precomputed_paths_without_reading_raw_geometry(
    connection: sqlite3.Connection,
    monkeypatch: pytest.MonkeyPatch,
):
    connection.execute(
        "UPDATE admin_regions SET geometry = ? WHERE id = '310100'",
        (dense_rectangle_geometry(120.85, 30.65, 122.15, 31.9),),
    )
    insert_thumbnail_tile(connection, depth=3)
    traced_statements: list[str] = []
    connection.set_trace_callback(traced_statements.append)
    shape_calls = 0
    real_shape = thumbnail_module.shape

    def count_shape_calls(geometry):
        nonlocal shape_calls
        shape_calls += 1
        return real_shape(geometry)

    monkeypatch.setattr(thumbnail_module, "shape", count_shape_calls)
    try:
        shanghai = create_admin_region_thumbnail(
            connection,
            depth=3,
            visited_region_ids={"310100"},
        )
        first_shape_call_count = shape_calls
        hangzhou = create_admin_region_thumbnail(
            connection,
            depth=3,
            visited_region_ids={"330100"},
        )
    finally:
        connection.set_trace_callback(None)

    normalized_statements = [" ".join(statement.lower().split()) for statement in traced_statements]
    assert not any("from admin_regions" in statement for statement in normalized_statements)
    assert sum("select tile" in statement for statement in normalized_statements) == 1
    assert first_shape_call_count > 0
    assert shape_calls == first_shape_call_count
    assert shanghai["basePath"] == hangzhou["basePath"]
    assert shanghai["visitedPath"] != hangzhou["visitedPath"]
    assert len(shanghai["basePath"]) < 10_000
    assert len(shanghai["visitedPath"]) < 10_000


def test_thumbnail_queries_bounds_for_visited_regions_missing_from_the_tile(
    connection: sqlite3.Connection,
):
    insert_thumbnail_tile(
        connection,
        depth=3,
        included_region_ids={"310100"},
    )
    traced_statements: list[str] = []
    connection.set_trace_callback(traced_statements.append)
    try:
        thumbnail = create_admin_region_thumbnail(
            connection,
            depth=3,
            visited_region_ids={"330100"},
        )
    finally:
        connection.set_trace_callback(None)

    bounds_queries = [
        " ".join(statement.lower().split())
        for statement in traced_statements
        if "from admin_regions" in statement.lower()
    ]
    assert thumbnail["visitedPath"].startswith("M")
    assert len(bounds_queries) == 1
    assert "id in ('330100')" in bounds_queries[0]
    assert "310100" not in bounds_queries[0]


def test_thumbnail_cache_keeps_connections_with_identical_tile_metadata_isolated(
    monkeypatch: pytest.MonkeyPatch,
):
    first_connection = sqlite3.connect(":memory:")
    second_connection = sqlite3.connect(":memory:")
    for connection in (first_connection, second_connection):
        connection.row_factory = sqlite3.Row
        initialize_schema(connection)
        seed_admin_regions(connection)
    first_tile = insert_thumbnail_tile(first_connection, depth=3, x_offset=0)
    second_tile = insert_thumbnail_tile(second_connection, depth=3, x_offset=100)
    assert len(first_tile) == len(second_tile)
    monkeypatch.setattr(thumbnail_module, "id", lambda _connection: 7, raising=False)

    try:
        first = create_admin_region_thumbnail(
            first_connection,
            depth=3,
            visited_region_ids={"310100"},
        )
        second = create_admin_region_thumbnail(
            second_connection,
            depth=3,
            visited_region_ids={"310100"},
        )
    finally:
        first_connection.close()
        second_connection.close()

    assert first["basePath"] != second["basePath"]
    assert first["visitedPath"] != second["visitedPath"]


def test_thumbnail_ignores_z_coordinates(connection: sqlite3.Connection):
    geometry_3d = json.dumps(
        {
            "type": "Polygon",
            "coordinates": [
                [
                    [120.85, 30.65, 80.0],
                    [122.15, 30.65, 90.0],
                    [122.15, 31.9, 100.0],
                    [120.85, 31.9, 110.0],
                    [120.85, 30.65, 80.0],
                ],
            ],
        },
    )
    connection.execute(
        "UPDATE admin_regions SET geometry = ? WHERE id = '310100'",
        (geometry_3d,),
    )

    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"310100"},
    )

    assert thumbnail["visitedPath"].startswith("M")
    assert "80.0" not in thumbnail["visitedPath"]


def test_admin_region_summary_api_returns_thumbnail_and_rankings_without_writes(
    tmp_path: Path,
):
    client, db_path = create_test_client_with_summary_fixture(tmp_path)
    before = read_table_counts(db_path)

    response = client.get(
        "/api/admin-regions/summary",
        params={"depth": 3, "start": "2026-06-16", "end": "2026-06-16"},
    )

    after = read_table_counts(db_path)
    assert response.status_code == 200
    assert response.json() == {
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
        "thumbnail": {
            "viewBox": "0 0 320 150",
            "basePath": ANY,
            "visitedPath": ANY,
        },
    }
    assert response.json()["thumbnail"]["basePath"].startswith("M")
    assert response.json()["thumbnail"]["visitedPath"].startswith("M")
    assert after == before == {
        "footprints": 4,
        "visual_tiles": 0,
        "admin_region_tiles": 0,
    }


def test_admin_region_summary_api_uses_ranking_bounds_for_visited_regions_missing_from_tile(
    tmp_path: Path,
):
    client, db_path = create_test_client_with_summary_fixture(tmp_path)
    with sqlite3.connect(db_path) as connection:
        insert_thumbnail_tile(
            connection,
            depth=3,
            included_region_ids={"310100"},
        )

    response = client.get(
        "/api/admin-regions/summary",
        params={"depth": 3, "start": "2026-06-17", "end": "2026-06-17"},
    )

    assert response.status_code == 200
    assert response.json()["visitedRegionIds"] == ["330100"]
    assert response.json()["thumbnail"]["visitedPath"].startswith("M")


def test_admin_region_summary_api_rejects_unknown_depth(tmp_path: Path):
    client, _ = create_test_client_with_summary_fixture(tmp_path)

    response = client.get("/api/admin-regions/summary?depth=5")

    assert response.status_code == 400
    assert response.json() == {"detail": "depth must be one of 1, 2, 3, or 4"}


def test_admin_region_summary_api_maps_invalid_dates_to_bad_request(tmp_path: Path):
    client, _ = create_test_client_with_summary_fixture(tmp_path)

    response = client.get(
        "/api/admin-regions/summary",
        params={"depth": 3, "start": "not-a-date", "end": "2026-06-16"},
    )

    assert response.status_code == 400
    assert "detail" in response.json()


def test_admin_region_summary_api_does_not_report_geometry_errors_as_bad_requests(
    tmp_path: Path,
):
    client, db_path = create_test_client_with_summary_fixture(tmp_path)
    client = TestClient(client.app, raise_server_exceptions=False)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE admin_regions SET geometry = 'not-json' WHERE id = '310100'",
        )
        connection.commit()

    response = client.get(
        "/api/admin-regions/summary",
        params={"depth": 3, "start": "2026-06-16", "end": "2026-06-16"},
    )

    assert response.status_code == 500
    assert "error" in response.json()


def test_admin_region_summary_api_returns_base_for_empty_range(tmp_path: Path):
    client, _ = create_test_client_with_summary_fixture(tmp_path)

    response = client.get(
        "/api/admin-regions/summary",
        params={"depth": 3, "start": "2030-01-01", "end": "2030-01-01"},
    )

    assert response.status_code == 200
    assert response.json()["visitedCount"] == 0
    assert response.json()["rankings"] == []
    assert response.json()["thumbnail"]["basePath"].startswith("M")
    assert response.json()["thumbnail"]["visitedPath"] == ""


def seed_admin_regions(connection: sqlite3.Connection) -> None:
    connection.executemany(
        """
        INSERT INTO admin_regions (
          id, name, level, geometry, min_lng, max_lng, min_lat, max_lat
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "cn",
                "China",
                1,
                rectangle_geometry(73.0, 18.0, 135.0, 54.0),
                73.0,
                135.0,
                18.0,
                54.0,
            ),
            (
                "310000",
                "Shanghai",
                2,
                rectangle_geometry(120.8, 30.6, 122.2, 31.9),
                120.8,
                122.2,
                30.6,
                31.9,
            ),
            (
                "330000",
                "Zhejiang",
                2,
                multipolygon_geometry(
                    (118.0, 27.0, 120.4, 31.5),
                    (120.5, 27.5, 123.0, 31.0),
                ),
                118.0,
                123.0,
                27.0,
                31.5,
            ),
            (
                "310100",
                "Shanghai",
                3,
                rectangle_geometry(
                    120.85,
                    30.65,
                    122.15,
                    31.9,
                    holes=[(121.1, 30.9, 121.5, 31.3)],
                ),
                120.85,
                122.15,
                30.65,
                31.9,
            ),
            (
                "330100",
                "Hangzhou",
                3,
                geometry_collection_with_rectangle(118.3, 29.1, 120.8, 30.6),
                118.3,
                120.8,
                29.1,
                30.6,
            ),
            (
                "310115",
                "Pudong",
                4,
                rectangle_geometry(121.45, 30.68, 122.0, 31.4),
                121.45,
                122.0,
                30.68,
                31.4,
            ),
            (
                "330106",
                "Xihu",
                4,
                rectangle_geometry(120.0, 30.0, 120.3, 30.4),
                120.0,
                120.3,
                30.0,
                30.4,
            ),
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


def create_test_client_with_summary_fixture(tmp_path: Path) -> tuple[TestClient, Path]:
    data_path = tmp_path / "footprints.csv"
    data_path.write_text(CSV_HEADER, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    client = TestClient(
        create_app(
            settings=Settings(
                footprint_data_path=data_path,
                footprint_db_path=db_path,
                footprint_coordinate_system="wgs84",
                admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
            ),
        ),
    )
    assert client.get("/api/footprints").status_code == 200
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        seed_admin_regions(connection)
    return client, db_path


def read_table_counts(db_path: Path) -> dict[str, int]:
    with sqlite3.connect(db_path) as connection:
        return {
            table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in ("footprints", "visual_tiles", "admin_region_tiles")
        }


def rectangle_geometry(
    west: float,
    south: float,
    east: float,
    north: float,
    *,
    holes: list[tuple[float, float, float, float]] | None = None,
) -> str:
    return json.dumps(
        {
            "type": "Polygon",
            "coordinates": [
                rectangle_ring(west, south, east, north),
                *(rectangle_ring(*hole) for hole in holes or []),
            ],
        },
    )


def dense_rectangle_geometry(
    west: float,
    south: float,
    east: float,
    north: float,
) -> str:
    tooth_count = 3_000
    top_edge = [
        [
            west + (east - west) * index / tooth_count,
            north - (0.3 if index % 2 else 0.0),
        ]
        for index in range(tooth_count + 1)
    ]
    return json.dumps(
        {
            "type": "Polygon",
            "coordinates": [
                [
                    [west, south],
                    [east, south],
                    *reversed(top_edge),
                    [west, south],
                ],
            ],
        },
    )


def insert_thumbnail_tile(
    connection: sqlite3.Connection,
    *,
    depth: int,
    included_region_ids: set[str] | None = None,
    x_offset: int = 0,
) -> bytes:
    included_ids = {"310100", "330100"} if included_region_ids is None else included_region_ids
    features = [
        {
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [3400 + x_offset, 1600],
                        [3430 + x_offset, 1600],
                        [3430 + x_offset, 1640],
                        [3400 + x_offset, 1640],
                        [3400 + x_offset, 1600],
                    ],
                ],
            },
            "properties": {"region_id": "310100", "level": depth, "kind": "fill"},
        },
        {
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [3370 + x_offset, 1640],
                        [3400 + x_offset, 1640],
                        [3400 + x_offset, 1680],
                        [3370 + x_offset, 1680],
                        [3370 + x_offset, 1640],
                    ],
                ],
            },
            "properties": {"region_id": "330100", "level": depth, "kind": "fill"},
        },
    ]
    selected_features = [
        feature
        for feature in features
        if feature["properties"]["region_id"] in included_ids
    ]
    tile = encode(
        [
            {
                "name": "admin_regions",
                "features": selected_features,
            },
        ],
        default_options={"extents": 4096, "y_coord_down": True},
    )
    connection.execute(
        """
        INSERT INTO admin_region_tiles (
          z, x, y, focus_region_id, depth, algorithm_signature,
          tile, feature_count, updated_at
        ) VALUES (0, 0, 0, 'world', ?, 'thumbnail-test-v1', ?, ?, 1)
        """,
        (depth, tile, len(selected_features)),
    )
    connection.commit()
    return tile


def multipolygon_geometry(*bounds: tuple[float, float, float, float]) -> str:
    return json.dumps(
        {
            "type": "MultiPolygon",
            "coordinates": [[rectangle_ring(*item)] for item in bounds],
        },
    )


def geometry_collection_with_rectangle(
    west: float,
    south: float,
    east: float,
    north: float,
) -> str:
    return json.dumps(
        {
            "type": "GeometryCollection",
            "geometries": [
                json.loads(rectangle_geometry(west, south, east, north)),
                {"type": "LineString", "coordinates": [[west, south], [east, north]]},
            ],
        },
    )


def rectangle_ring(
    west: float,
    south: float,
    east: float,
    north: float,
) -> list[list[float]]:
    return [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ]
