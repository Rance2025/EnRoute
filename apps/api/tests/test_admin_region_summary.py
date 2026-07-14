from __future__ import annotations

import json
import math
import re
import sqlite3
from pathlib import Path
from unittest.mock import ANY

import pytest
from fastapi.testclient import TestClient
from mapbox_vector_tile import encode
from shapely.geometry import MultiPolygon, Polygon

from enroute_api.admin_regions import tiles as admin_region_tiles_module
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


def assert_svg_path_within_viewbox(path: str) -> None:
    coordinates = [float(value) for value in re.findall(r"-?\d+(?:\.\d+)?", path)]
    assert coordinates
    assert len(coordinates) % 2 == 0
    assert all(0 <= x <= 320 for x in coordinates[::2])
    assert all(0 <= y <= 180 for y in coordinates[1::2])


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
def test_thumbnail_projection_uses_equidistant_cylindrical_scale(
    depth: int,
    frame: tuple[float, float, float, float],
):
    west, south, east, north = frame
    projected_west, projected_north, projected_east, projected_south = (
        thumbnail_module.project_geographic_bounds(west, south, east, north, depth=depth)
    )
    horizontal_scale = (projected_east - projected_west) / (east - west)
    vertical_scale = (projected_south - projected_north) / (north - south)

    assert horizontal_scale / vertical_scale == pytest.approx(
        math.cos(math.radians(35.0)),
    )
    assert projected_west >= thumbnail_module.VIEWBOX_PADDING
    assert projected_north >= thumbnail_module.VIEWBOX_PADDING
    assert projected_east <= thumbnail_module.VIEWBOX_WIDTH - thumbnail_module.VIEWBOX_PADDING
    assert projected_south <= thumbnail_module.VIEWBOX_HEIGHT - thumbnail_module.VIEWBOX_PADDING


def test_thumbnail_uses_fixed_world_and_china_frames_without_presentation_attributes(
    connection: sqlite3.Connection,
):
    assert thumbnail_module.VIEWBOX == "0 0 320 180"
    assert thumbnail_module.WORLD_BOUNDS == (-180.0, -58.0, 180.0, 85.0)
    assert thumbnail_module.CHINA_BOUNDS == (73.0, 4.0, 136.0, 55.0)

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
        assert thumbnail["viewBox"] == "0 0 320 180"
        assert thumbnail["basePath"].startswith("M")
        assert thumbnail["visitedPath"].startswith("M")
        assert_svg_path_within_viewbox(thumbnail["basePath"])
        assert_svg_path_within_viewbox(thumbnail["visitedPath"])
        assert not ({"stroke", "style", "label"} & thumbnail.keys())
        assert not re.search(r"\d+\.\d{2,}", thumbnail["basePath"])

    assert json.dumps(city).find("stroke") == -1


@pytest.mark.parametrize(
    ("tile", "local_position"),
    [
        (thumbnail_module.AdminRegionThumbnailTile(0, 0, 0, b""), (2048.0, 2048.0)),
        (thumbnail_module.AdminRegionThumbnailTile(1, 1, 0, b""), (0.0, 4096.0)),
    ],
)
def test_thumbnail_restores_global_mercator_position_before_frame_projection(
    tile: thumbnail_module.AdminRegionThumbnailTile,
    local_position: tuple[float, float],
):
    for depth in (1, 2, 3, 4):
        assert thumbnail_module.project_tile_position(
            *local_position,
            depth=depth,
            tile=tile,
        ) == pytest.approx(
            thumbnail_module.project_geographic_position(0.0, 0.0, depth=depth),
        )


def test_china_z1_base_preserves_disconnected_south_china_sea_components(
    connection: sqlite3.Connection,
):
    components = (
        ("mainland", ((80.0, 20.0, 119.0, 45.0), (95.0, 28.0, 100.0, 34.0))),
        ("hainan", ((108.0, 18.0, 111.0, 19.8),)),
        ("taiwan", ((120.5, 22.0, 122.5, 25.0),)),
        ("south-sea-west", ((111.5, 13.5, 112.5, 14.5),)),
        ("south-sea-east", ((115.0, 6.5, 116.0, 7.5),)),
    )
    tile = insert_geographic_thumbnail_tile(connection, depth=2, components=components)
    decoded_mainland = thumbnail_module.decode_fill_geometries(tile)["mainland"]
    assert sum(
        len(polygon.interiors)
        for geometry in decoded_mainland
        for polygon in thumbnail_module.iter_polygons(geometry)
    ) == 1

    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=2,
        visited_region_ids=set(),
    )

    base_path = thumbnail["basePath"]
    assert base_path.count("M") == len(components)
    assert base_path != thumbnail_module.bounds_to_svg_path(
        thumbnail_module.project_geographic_bounds(
            80.0,
            6.5,
            122.5,
            45.0,
            depth=2,
        ),
    )
    assert len(base_path) <= thumbnail_module.MAX_THUMBNAIL_PATH_LENGTH
    assert_svg_path_within_viewbox(base_path)


def test_bounded_path_simplification_preserves_disconnected_components(
    monkeypatch: pytest.MonkeyPatch,
):
    dense_shell = [(0.0, 0.0), (40.0, 0.0), (40.0, 20.0)]
    dense_shell.extend(
        (index / 2, 20.0 + (0.6 if index % 2 else 0.0))
        for index in range(80, -1, -1)
    )
    dense_shell.append((0.0, 0.0))
    geometry = MultiPolygon(
        [
            Polygon(dense_shell),
            Polygon([(60.0, 0.0), (60.2, 0.0), (60.2, 0.2), (60.0, 0.2)]),
        ],
    )
    topology_preserving_path = thumbnail_module.geometry_to_svg_path(
        geometry.simplify(1.2, preserve_topology=True),
    )
    monkeypatch.setattr(
        thumbnail_module,
        "MAX_THUMBNAIL_PATH_LENGTH",
        len(topology_preserving_path),
    )

    path = thumbnail_module.bounded_geometry_path(geometry)

    assert len(path) <= thumbnail_module.MAX_THUMBNAIL_PATH_LENGTH
    assert path.count("M") == 2


@pytest.mark.parametrize("depth", [2, 3, 4])
def test_china_thumbnail_prefers_current_depth_z1_tile_with_coordinate_context(
    connection: sqlite3.Connection,
    depth: int,
):
    insert_thumbnail_tile(connection, depth=depth, x_offset=-2000)
    insert_thumbnail_tile(connection, depth=2, z=1, x=1, y=0, adjacent=True)
    if depth != 2:
        insert_thumbnail_tile(connection, depth=depth, z=1, x=1, y=0)
    connection.execute("DELETE FROM admin_regions WHERE id = '310100'")
    connection.commit()

    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=depth,
        visited_region_ids={"310100"},
    )

    assert thumbnail["viewBox"] == "0 0 320 180"
    assert thumbnail["basePath"].startswith("M")
    assert thumbnail["visitedPath"].startswith("M")
    assert_svg_path_within_viewbox(thumbnail["basePath"])
    assert_svg_path_within_viewbox(thumbnail["visitedPath"])


def test_world_thumbnail_keeps_depth_one_z0_tile(
    connection: sqlite3.Connection,
):
    insert_thumbnail_tile(connection, depth=1, included_region_ids={"310100"})
    insert_thumbnail_tile(
        connection,
        depth=1,
        z=1,
        x=1,
        y=0,
        included_region_ids={"330100"},
    )

    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=1,
        visited_region_ids={"310100"},
    )

    assert thumbnail["visitedPath"].startswith("M")


def test_province_city_and_district_share_depth_two_z1_base_and_use_own_z1_visit(
    connection: sqlite3.Connection,
):
    for depth in (2, 3, 4):
        insert_thumbnail_tile(connection, depth=depth, x_offset=-2000, adjacent=True)
    insert_thumbnail_tile(connection, depth=2, z=1, x=1, y=0, adjacent=True)
    insert_thumbnail_tile(connection, depth=3, z=1, x=1, y=0, x_offset=20, adjacent=True)
    insert_thumbnail_tile(connection, depth=4, z=1, x=1, y=0, x_offset=40, adjacent=True)

    province = create_admin_region_thumbnail(
        connection,
        depth=2,
        visited_region_ids={"310100"},
    )
    city = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"310100"},
    )
    district = create_admin_region_thumbnail(
        connection,
        depth=4,
        visited_region_ids={"310100"},
    )

    assert province["basePath"] == city["basePath"] == district["basePath"]
    assert province["basePath"].count("M") == 1
    assert len({province["visitedPath"], city["visitedPath"], district["visitedPath"]}) == 3


def test_china_base_falls_back_to_depth_two_z0_tile(
    connection: sqlite3.Connection,
):
    insert_thumbnail_tile(connection, depth=2, adjacent=True)
    insert_thumbnail_tile(connection, depth=3, x_offset=-2000, adjacent=True)
    insert_thumbnail_tile(connection, depth=3, z=1, x=1, y=0, x_offset=20)

    province = create_admin_region_thumbnail(
        connection,
        depth=2,
        visited_region_ids=set(),
    )
    city = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"310100"},
    )

    assert province["basePath"] == city["basePath"]
    assert province["basePath"].count("M") == 1
    assert_svg_path_within_viewbox(city["basePath"])
    assert_svg_path_within_viewbox(city["visitedPath"])


@pytest.mark.parametrize(
    ("depth", "visited_region_id", "force_bounds", "tile_region_ids"),
    [
        (2, "310000", False, ("310000", "330000")),
        (3, "310100", False, ("310100", "330100")),
        (4, "310115", True, ("310115", "330106")),
    ],
)
def test_missing_current_z1_keeps_depth_two_z1_base_with_read_only_fallback(
    connection: sqlite3.Connection,
    monkeypatch: pytest.MonkeyPatch,
    depth: int,
    visited_region_id: str,
    force_bounds: bool,
    tile_region_ids: tuple[str, str],
):
    if depth == 2:
        connection.execute(
            "UPDATE admin_regions SET geometry = ? WHERE id = '310000'",
            (rectangle_geometry(120.8, 30.6, 122.2, 31.9, holes=[(121.1, 30.9, 121.5, 31.3)]),),
        )
        connection.commit()
        province_base = None
    else:
        insert_thumbnail_tile(connection, depth=2, z=1, x=1, y=0, adjacent=True)
        province_base = create_admin_region_thumbnail(
            connection,
            depth=2,
            visited_region_ids=set(),
        )["basePath"]
    same_depth_z0_tile = insert_thumbnail_tile(
        connection,
        depth=depth,
        region_ids=tile_region_ids,
        included_region_ids={visited_region_id},
    )
    if force_bounds:
        monkeypatch.setattr(thumbnail_module, "RAW_FALLBACK_MAX_GEOMETRY_BYTES", -1)

    traced_statements: list[str] = []
    decoded_tiles: list[bytes] = []
    shape_calls = 0
    real_decode = thumbnail_module.decode
    real_shape = thumbnail_module.shape

    def track_decoded_tiles(tile: bytes, *, default_options: dict[str, bool]):
        decoded_tiles.append(tile)
        return real_decode(tile, default_options=default_options)

    def count_shape_calls(geometry):
        nonlocal shape_calls
        shape_calls += 1
        return real_shape(geometry)

    def fail_admin_region_tile_builder(*_args, **_kwargs):
        pytest.fail("thumbnail fallback must not build admin-region tiles")

    for builder_name in (
        "build_admin_region_tile",
        "build_admin_region_tile_keys",
        "build_admin_region_tiles",
        "rebuild_admin_region_tile_from_current_rows",
    ):
        monkeypatch.setattr(
            admin_region_tiles_module,
            builder_name,
            fail_admin_region_tile_builder,
        )
    monkeypatch.setattr(thumbnail_module, "decode", track_decoded_tiles)
    monkeypatch.setattr(thumbnail_module, "shape", count_shape_calls)
    connection.set_trace_callback(traced_statements.append)
    try:
        first = create_admin_region_thumbnail(
            connection,
            depth=depth,
            visited_region_ids={visited_region_id},
        )
        first_shape_call_count = shape_calls
        second = create_admin_region_thumbnail(
            connection,
            depth=depth,
            visited_region_ids={visited_region_id},
        )
    finally:
        connection.set_trace_callback(None)

    normalized_statements = [" ".join(statement.lower().split()) for statement in traced_statements]
    write_prefixes = ("insert ", "update ", "delete ", "drop ", "create ")
    assert first["basePath"] == second["basePath"]
    if province_base is not None:
        assert first["basePath"] == province_base
    assert first["basePath"].count("M") == 1
    assert first["visitedPath"].startswith("M")
    if depth in {2, 3}:
        assert first["visitedPath"].count("M") == 2
    if depth > 2:
        assert same_depth_z0_tile not in decoded_tiles
    assert first_shape_call_count > 0
    assert shape_calls == first_shape_call_count
    assert not any(statement.startswith(write_prefixes) for statement in normalized_statements)


def test_thumbnail_unions_adjacent_visited_regions_before_writing_path(
    connection: sqlite3.Connection,
):
    insert_thumbnail_tile(connection, depth=3, z=1, x=1, y=0, adjacent=True)
    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"310100", "330100"},
    )

    assert thumbnail["visitedPath"].count("M") == 1


def test_thumbnail_repairs_invalid_tile_polygon_before_clipping(
    connection: sqlite3.Connection,
    monkeypatch: pytest.MonkeyPatch,
):
    insert_thumbnail_tile(
        connection,
        depth=4,
        z=1,
        x=1,
        y=0,
        included_region_ids={"310100"},
    )

    def decode_invalid_tile(tile: bytes, *, default_options: dict[str, bool]):
        del tile
        assert default_options == {"y_coord_down": True}
        return {
            "admin_regions": {
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [2704, 3200],
                                    [2764, 3280],
                                    [2704, 3280],
                                    [2764, 3200],
                                    [2704, 3200],
                                ],
                            ],
                        },
                        "properties": {
                            "region_id": "310115",
                            "level": 4,
                            "kind": "fill",
                        },
                    },
                ],
            },
        }

    # The encoder normalizes self-intersections, so inject its decoded shape instead.
    monkeypatch.setattr(thumbnail_module, "decode", decode_invalid_tile)

    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=4,
        visited_region_ids={"310115"},
    )

    assert thumbnail["basePath"].startswith("M")
    assert thumbnail["visitedPath"].startswith("M")


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
    insert_thumbnail_tile(connection, depth=3, z=1, x=1, y=0)
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
    assert len(shanghai["basePath"]) <= thumbnail_module.MAX_THUMBNAIL_PATH_LENGTH
    assert len(shanghai["visitedPath"]) <= thumbnail_module.MAX_THUMBNAIL_PATH_LENGTH


def test_thumbnail_queries_bounds_for_visited_regions_missing_from_the_tile(
    connection: sqlite3.Connection,
):
    insert_thumbnail_tile(
        connection,
        depth=3,
        z=1,
        x=1,
        y=0,
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
    first_tile = insert_thumbnail_tile(first_connection, depth=3, z=1, x=1, y=0)
    second_tile = insert_thumbnail_tile(
        second_connection,
        depth=3,
        z=1,
        x=1,
        y=0,
        x_offset=100,
    )
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
            "viewBox": "0 0 320 180",
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
            z=1,
            x=1,
            y=0,
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
    z: int = 0,
    x: int = 0,
    y: int = 0,
    region_ids: tuple[str, str] = ("310100", "330100"),
    included_region_ids: set[str] | None = None,
    x_offset: int = 0,
    adjacent: bool = False,
) -> bytes:
    first_region_id, second_region_id = region_ids
    included_ids = set(region_ids) if included_region_ids is None else included_region_ids
    tile_scale = 2**z

    def tile_point(global_x: int, global_y: int) -> list[int]:
        return [
            (global_x + x_offset) * tile_scale - x * 4096,
            global_y * tile_scale - y * 4096,
        ]

    second_top = 1600 if adjacent else 1640
    second_bottom = 1640 if adjacent else 1680
    features = [
        {
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        tile_point(3400, 1600),
                        tile_point(3430, 1600),
                        tile_point(3430, 1640),
                        tile_point(3400, 1640),
                        tile_point(3400, 1600),
                    ],
                ],
            },
            "properties": {"region_id": first_region_id, "level": depth, "kind": "fill"},
        },
        {
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        tile_point(3370, second_top),
                        tile_point(3400, second_top),
                        tile_point(3400, second_bottom),
                        tile_point(3370, second_bottom),
                        tile_point(3370, second_top),
                    ],
                ],
            },
            "properties": {"region_id": second_region_id, "level": depth, "kind": "fill"},
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
        ) VALUES (?, ?, ?, 'world', ?, 'thumbnail-test-v1', ?, ?, 1)
        """,
        (z, x, y, depth, tile, len(selected_features)),
    )
    connection.commit()
    return tile


def insert_geographic_thumbnail_tile(
    connection: sqlite3.Connection,
    *,
    depth: int,
    components: tuple[
        tuple[str, tuple[tuple[float, float, float, float], ...]],
        ...,
    ],
) -> bytes:
    z, x, y = 1, 1, 0
    world_extent = 4096 * 2**z

    def tile_position(longitude: float, latitude: float) -> list[int]:
        global_x = (longitude + 180.0) / 360.0 * world_extent
        global_y = (
            0.5
            - math.asinh(math.tan(math.radians(latitude))) / (2.0 * math.pi)
        ) * world_extent
        return [round(global_x - x * 4096), round(global_y - y * 4096)]

    features = [
        {
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [tile_position(*position) for position in rectangle_ring(*bounds)]
                    for bounds in rings
                ],
            },
            "properties": {"region_id": region_id, "level": depth, "kind": "fill"},
        }
        for region_id, rings in components
    ]
    tile = encode(
        [{"name": "admin_regions", "features": features}],
        default_options={"extents": 4096, "y_coord_down": True},
    )
    connection.execute(
        """
        INSERT INTO admin_region_tiles (
          z, x, y, focus_region_id, depth, algorithm_signature,
          tile, feature_count, updated_at
        ) VALUES (?, ?, ?, 'world', ?, 'thumbnail-geographic-test-v1', ?, ?, 1)
        """,
        (z, x, y, depth, tile, len(features)),
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
