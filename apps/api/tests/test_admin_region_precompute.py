from __future__ import annotations

import importlib
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest
from mapbox_vector_tile import encode
from fastapi.testclient import TestClient

from enroute_api.admin_regions.precompute_meta import (
    DAILY_STATS_SIGNATURE_KEY,
    THUMBNAIL_BASE_SIGNATURE_KEY,
    THUMBNAIL_PATH_SIGNATURE_KEY,
)
from enroute_api.admin_regions.store import load_admin_regions
from enroute_api.admin_regions.tiles import delete_admin_region_tile
from enroute_api.admin_regions.thumbnail import AdminRegionThumbnailTile
from enroute_api.footprints.store import initialize_schema
from enroute_api.footprints.store import backfill_footprint_region_ids, insert_footprint_if_new
from enroute_api.config import Settings
from enroute_api.main import create_app


def test_initialize_admin_region_summary_schema_creates_constrained_without_rowid_tables() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")

    precompute.initialize_admin_region_summary_schema(connection)

    schema_by_name = {
        str(row[0]): str(row[1])
        for row in connection.execute(
            """
            SELECT name, sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name LIKE 'admin_region_%'
            ORDER BY name
            """,
        )
    }
    assert set(schema_by_name) == {
        "admin_region_daily_stats",
        "admin_region_thumbnail_bases",
        "admin_region_thumbnail_region_paths",
    }
    assert all("WITHOUT ROWID" in sql.upper() for sql in schema_by_name.values())
    assert primary_key_columns(connection, "admin_region_thumbnail_bases") == ["scope"]
    assert primary_key_columns(connection, "admin_region_thumbnail_region_paths") == [
        "depth",
        "region_id",
    ]
    assert primary_key_columns(connection, "admin_region_daily_stats") == [
        "depth",
        "day",
        "region_id",
    ]
    assert table_columns(connection, "admin_region_daily_stats") == [
        "depth",
        "day",
        "region_id",
        "footprint_count",
        "stay_duration_seconds",
        "travel_distance_meters",
    ]

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_thumbnail_bases (
              scope, view_box, path, source_depth, source_z, source_x, source_y,
              source_signature, algorithm_signature, updated_at
            ) VALUES ('invalid', '0 0 320 180', 'M0 0Z', 1, 0, 0, 0, 'source', 'algorithm', 1)
            """,
        )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_thumbnail_region_paths (
              depth, region_id, path, source_signature, algorithm_signature
            ) VALUES (5, 'region', 'M0 0Z', 'source', 'algorithm')
            """,
        )
    connection.execute(
        """
        INSERT INTO admin_region_daily_stats (
          depth, day, region_id, footprint_count,
          stay_duration_seconds, travel_distance_meters
        ) VALUES (4, 20260716, '310117', 0, 60, 12.5)
        """,
    )
    assert connection.execute(
        """
        SELECT typeof(footprint_count), typeof(stay_duration_seconds),
               typeof(travel_distance_meters)
        FROM admin_region_daily_stats
        WHERE region_id = '310117'
        """,
    ).fetchone() == ("integer", "integer", "real")
    for footprint_count, stay_duration_seconds, travel_distance_meters in (
        (0, 0, 0),
        (-1, 0, 0),
        (0, -1, 0),
        (0, 0, -0.5),
    ):
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO admin_region_daily_stats (
                  depth, day, region_id, footprint_count,
                  stay_duration_seconds, travel_distance_meters
                ) VALUES (1, 20260715, ?, ?, ?, ?)
                """,
                (
                    f"invalid-{footprint_count}-{stay_duration_seconds}-{travel_distance_meters}",
                    footprint_count,
                    stay_duration_seconds,
                    travel_distance_meters,
                ),
            )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_daily_stats (
              depth, day, region_id, footprint_count,
              stay_duration_seconds, travel_distance_meters
            ) VALUES (5, 20260715, 'invalid-depth', 1, 0, 0)
            """,
        )


@pytest.mark.parametrize(
    ("footprint_count", "stay_duration_seconds", "travel_distance_meters"),
    (
        ("not-a-number", 0, 0),
        (0, "not-a-number", 0),
        (0, 0, "not-a-number"),
        (0, 1.5, 0),
    ),
)
def test_admin_region_daily_stats_schema_rejects_invalid_metric_types(
    footprint_count: object,
    stay_duration_seconds: object,
    travel_distance_meters: object,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    precompute.initialize_admin_region_summary_schema(connection)

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_daily_stats (
              depth, day, region_id, footprint_count,
              stay_duration_seconds, travel_distance_meters
            ) VALUES (4, 20260716, 'invalid-types', ?, ?, ?)
            """,
            (footprint_count, stay_duration_seconds, travel_distance_meters),
        )


def test_initialize_admin_region_summary_schema_does_not_migrate_legacy_daily_stats() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.execute(
        """
        CREATE TABLE admin_region_daily_stats (
          depth INTEGER NOT NULL,
          day INTEGER NOT NULL,
          region_id TEXT NOT NULL,
          footprint_count INTEGER NOT NULL,
          PRIMARY KEY (depth, day, region_id),
          CHECK (depth BETWEEN 1 AND 4),
          CHECK (footprint_count > 0)
        ) WITHOUT ROWID
        """,
    )

    precompute.initialize_admin_region_summary_schema(connection)

    assert table_columns(connection, "admin_region_daily_stats") == [
        "depth",
        "day",
        "region_id",
        "footprint_count",
    ]


def test_initialize_footprint_schema_includes_admin_region_summary_tables() -> None:
    connection = sqlite3.connect(":memory:")

    initialize_schema(connection)

    table_names = {
        str(row[0])
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    assert {
        "admin_region_thumbnail_bases",
        "admin_region_thumbnail_region_paths",
        "admin_region_daily_stats",
    } <= table_names


def test_thumbnail_source_signatures_cover_only_their_required_z0_and_z1_tiles() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    for depth, z, x, y, marker in (
        (1, 0, 0, 0, b"world"),
        (2, 1, 1, 0, b"province"),
        (3, 1, 1, 0, b"city"),
        (4, 1, 1, 0, b"district"),
        (4, 0, 0, 0, b"unrelated"),
    ):
        insert_admin_region_tile(
            connection,
            depth=depth,
            z=z,
            x=x,
            y=y,
            marker=marker,
        )

    base_signature = json.loads(
        precompute.create_admin_region_thumbnail_base_source_signature(connection),
    )
    path_signature = json.loads(
        precompute.create_admin_region_thumbnail_path_source_signature(connection),
    )

    assert precompute.ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE == "admin-region-summary-v4"
    assert base_signature["algorithmSignature"] == precompute.ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE
    assert [
        (row["depth"], row["z"], row["x"], row["y"], row["byteLength"])
        for row in base_signature["tiles"]
    ] == [(1, 0, 0, 0, 5), (2, 1, 1, 0, 8)]
    assert [
        (row["depth"], row["z"], row["x"], row["y"])
        for row in path_signature["tiles"]
    ] == [
        (1, 0, 0, 0),
        (2, 1, 1, 0),
        (3, 1, 1, 0),
        (4, 1, 1, 0),
    ]

    connection.execute(
        "UPDATE admin_region_tiles SET updated_at = 99 WHERE depth = 4 AND z = 0",
    )
    assert json.loads(
        precompute.create_admin_region_thumbnail_base_source_signature(connection),
    ) == base_signature
    connection.execute(
        "UPDATE admin_region_tiles SET updated_at = 99 WHERE depth = 3 AND z = 1",
    )
    assert json.loads(
        precompute.create_admin_region_thumbnail_path_source_signature(connection),
    ) != path_signature


def test_thumbnail_source_signature_uses_one_point_lookup_per_required_tile() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    required_tile_keys = precompute.THUMBNAIL_PATH_TILE_KEYS
    for depth, z, x, y in required_tile_keys:
        insert_admin_region_tile(
            connection,
            depth=depth,
            z=z,
            x=x,
            y=y,
            marker=f"{depth}/{z}/{x}/{y}".encode(),
        )
    connection.commit()
    statements: list[str] = []
    connection.set_trace_callback(statements.append)

    try:
        signature = json.loads(
            precompute.create_admin_region_thumbnail_source_signature(
                connection,
                required_tile_keys=required_tile_keys,
            ),
        )
    finally:
        connection.set_trace_callback(None)

    metadata_queries = [
        " ".join(statement.lower().split())
        for statement in statements
        if "from admin_region_tiles" in " ".join(statement.lower().split())
    ]
    assert len(metadata_queries) == len(required_tile_keys) == 4
    for query, (depth, z, x, y) in zip(metadata_queries, required_tile_keys, strict=True):
        assert query.startswith(
            "select algorithm_signature, updated_at, length(tile) as byte_length "
            "from admin_region_tiles",
        )
        assert " or " not in query
        assert "focus_region_id = 'world'" in query
        assert f"depth = {depth}" in query
        assert f"z = {z}" in query
        assert f"x = {x}" in query
        assert f"y = {y}" in query
    assert [
        (tile["depth"], tile["z"], tile["x"], tile["y"])
        for tile in signature["tiles"]
    ] == list(required_tile_keys)


def test_thumbnail_source_signature_rejects_missing_required_tile() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_admin_region_tile(
        connection,
        depth=1,
        z=0,
        x=0,
        y=0,
        marker=b"world",
    )

    with pytest.raises(precompute.AdminRegionPrecomputeSourceError, match="2/1/1/0"):
        precompute.create_admin_region_thumbnail_base_source_signature(connection)


def test_thumbnail_path_signature_tracks_admin_region_coverage() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    before = precompute.create_admin_region_thumbnail_path_source_signature(connection)

    insert_region(connection, region_id="fallback-country", level=1)

    after = precompute.create_admin_region_thumbnail_path_source_signature(connection)

    assert after != before
    assert json.loads(after)["adminRegions"]["levelCounts"] == {
        "1": 2,
        "2": 1,
        "3": 1,
        "4": 1,
    }


def test_new_footprint_invalidates_only_daily_stats_precompute_signature() -> None:
    connection = create_connection_with_ready_signatures()

    inserted = insert_footprint_if_new(
        connection,
        {
            "timestampSeconds": 1_721_016_000,
            "longitude": 121.47,
            "latitude": 31.23,
            "accuracy": 5.0,
            "speed": 0.0,
            "distance": 0.0,
            "heading": 0.0,
            "altitude": 3.0,
        },
        region_matcher=StaticRegionMatcher(None),
    )

    assert inserted is True
    assert read_ready_signature_keys(connection) == {
        THUMBNAIL_BASE_SIGNATURE_KEY,
        THUMBNAIL_PATH_SIGNATURE_KEY,
    }


def test_region_id_backfill_invalidates_daily_stats_precompute_signature() -> None:
    connection = create_connection_with_ready_signatures()
    connection.execute(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed,
          distance, heading, altitude, region_id
        ) VALUES (1, 121.47, 31.23, 5, 0, 0, 0, 3, NULL)
        """,
    )

    result = backfill_footprint_region_ids(
        connection,
        region_matcher=StaticRegionMatcher("310100"),
    )

    assert result["updated_count"] == 1
    assert read_ready_signature_keys(connection) == {
        THUMBNAIL_BASE_SIGNATURE_KEY,
        THUMBNAIL_PATH_SIGNATURE_KEY,
    }


def test_admin_region_reload_invalidates_all_summary_precompute_signatures() -> None:
    connection = create_connection_with_ready_signatures()

    load_admin_regions(connection, {"type": "FeatureCollection", "features": []})

    assert read_ready_signature_keys(connection) == set()


def test_admin_region_tile_delete_invalidates_thumbnail_precompute_signatures() -> None:
    connection = create_connection_with_ready_signatures()
    insert_admin_region_tile(
        connection,
        depth=1,
        z=0,
        x=0,
        y=0,
        marker=b"world",
    )

    delete_admin_region_tile(
        connection,
        z=0,
        x=0,
        y=0,
        focus_region_id="world",
        depth=1,
    )

    assert read_ready_signature_keys(connection) == {DAILY_STATS_SIGNATURE_KEY}


def test_precomputed_china_paths_keep_hainan_and_taiwan_but_clip_remote_south_china_sea() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    tile = AdminRegionThumbnailTile(
        z=1,
        x=1,
        y=0,
        content=encode_geographic_admin_region_tile(
            depth=2,
            components={
                "mainland": (100.0, 23.0, 118.0, 45.0),
                "hainan": (108.5, 18.0, 111.5, 20.5),
                "taiwan": (119.5, 21.5, 122.5, 25.5),
                "remote-south-china-sea": (112.0, 9.0, 114.0, 11.0),
            },
        ),
    )

    paths = precompute.build_precomputed_admin_region_thumbnail_paths(tile, depth=2)

    assert [path.region_id for path in paths.region_paths] == [
        "hainan",
        "mainland",
        "remote-south-china-sea",
        "taiwan",
    ]
    assert paths.base_path.count("M") == 3
    assert next(
        path.path
        for path in paths.region_paths
        if path.region_id == "remote-south-china-sea"
    ) == ""
    assert all(
        path.path
        for path in paths.region_paths
        if path.region_id != "remote-south-china-sea"
    )


@pytest.mark.parametrize(
    "geometry_json",
    (
        '{"type":"Polygon","coordinates":[]}',
        '{"type":"Point","coordinates":[112,25]}',
    ),
    ids=("empty-polygon", "point"),
)
def test_geometry_fallback_rejects_empty_or_non_polygon_geometry(
    geometry_json: str,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match="fallback geometry is empty or non-polygon: invalid-region",
    ):
        precompute.build_admin_region_geometry_fallback_path(
            region_id="invalid-region",
            geometry_json=geometry_json,
            depth=2,
        )


@pytest.mark.parametrize("depth", (2, 3, 4))
def test_geometry_fallback_allows_valid_polygon_south_of_china_thumbnail(
    depth: int,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")

    path = precompute.build_admin_region_geometry_fallback_path(
        region_id="south-china-sea",
        geometry_json=(
            '{"type":"Polygon","coordinates":'
            '[[[112,9],[114,9],[114,11],[112,11],[112,9]]]}'
        ),
        depth=depth,
    )

    assert path.path == ""
    assert path.geometry is not None and path.geometry.is_empty


def test_geometry_fallback_rejects_valid_polygon_outside_world_thumbnail() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match="fallback geometry is outside thumbnail bounds: outside-world",
    ):
        precompute.build_admin_region_geometry_fallback_path(
            region_id="outside-world",
            geometry_json=(
                '{"type":"Polygon","coordinates":'
                '[[[10,-80],[12,-80],[12,-78],[10,-78],[10,-80]]]}'
            ),
            depth=1,
        )


def test_geometry_fallback_rejects_nonempty_geometry_without_bounded_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    monkeypatch.setattr(precompute, "bounded_geometry_path", lambda _geometry: "")

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match="fallback path is empty: unencodable-region",
    ):
        precompute.build_admin_region_geometry_fallback_path(
            region_id="unencodable-region",
            geometry_json=(
                '{"type":"Polygon","coordinates":'
                '[[[112,25],[113,25],[113,26],[112,26],[112,25]]]}'
            ),
            depth=2,
        )


def test_path_coverage_queries_geometry_only_for_missing_or_empty_paths() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    for region_id in ("ready-country", "empty-country", "missing-country"):
        insert_region(connection, region_id=region_id, level=1)
    connection.execute(
        "UPDATE admin_regions SET geometry = 'not-json' WHERE id = 'ready-country'",
    )
    connection.commit()
    paths = precompute.AdminRegionThumbnailPaths(
        base_path="M0 0Z",
        region_paths=(
            precompute.AdminRegionThumbnailPath(
                region_id="ready-country",
                path="M1 1Z",
                coarse_path="M1 1Z",
                bounds=(1.0, 1.0, 1.0, 1.0),
                geometry=None,
            ),
            precompute.AdminRegionThumbnailPath(
                region_id="empty-country",
                path="",
                coarse_path="",
                bounds=(0.0, 0.0, 0.0, 0.0),
                geometry=None,
            ),
        ),
    )
    statements: list[str] = []
    connection.set_trace_callback(statements.append)

    try:
        completed = precompute.complete_precomputed_admin_region_path_coverage(
            connection,
            {1: paths},
        )
    finally:
        connection.set_trace_callback(None)

    geometry_queries = [
        " ".join(statement.lower().split())
        for statement in statements
        if "select id, geometry" in " ".join(statement.lower().split())
    ]
    assert len(geometry_queries) == 1
    assert "id in" in geometry_queries[0]
    assert "'empty-country'" in geometry_queries[0]
    assert "'missing-country'" in geometry_queries[0]
    assert "'ready-country'" not in geometry_queries[0]
    completed_by_id = {
        path.region_id: path
        for path in completed[1].region_paths
    }
    assert completed[1].base_path == paths.base_path
    assert set(completed_by_id) == {
        "empty-country",
        "missing-country",
        "ready-country",
    }
    assert all(
        completed_by_id[region_id].geometry is None
        or completed_by_id[region_id].geometry.is_empty
        for region_id in ("empty-country", "missing-country")
    )


def test_path_coverage_batches_401_geometry_fallbacks_and_completes_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    region_ids = tuple(f"batch-country-{index:03d}" for index in range(401))
    for region_id in region_ids:
        insert_region(connection, region_id=region_id, level=1)
    connection.commit()
    paths = precompute.AdminRegionThumbnailPaths(
        base_path="M0 0Z",
        region_paths=tuple(
            precompute.AdminRegionThumbnailPath(
                region_id=region_id,
                path="",
                coarse_path="",
                bounds=(0.0, 0.0, 0.0, 0.0),
                geometry=None,
            )
            for region_id in region_ids
        ),
    )
    built_ids: list[str] = []

    def build_fallback_path(
        *,
        region_id: str,
        geometry_json: object,
        depth: int,
    ) -> object:
        assert str(geometry_json).startswith('{"type":"Polygon"')
        assert depth == 1
        built_ids.append(region_id)
        path = f"M{region_id[-3:]} 0Z"
        return precompute.AdminRegionThumbnailPath(
            region_id=region_id,
            path=path,
            coarse_path=path,
            bounds=(0.0, 0.0, 1.0, 1.0),
            geometry=None,
        )

    monkeypatch.setattr(
        precompute,
        "build_admin_region_geometry_fallback_path",
        build_fallback_path,
    )
    statements: list[str] = []
    connection.set_trace_callback(statements.append)

    try:
        completed = precompute.complete_precomputed_admin_region_path_coverage(
            connection,
            {1: paths},
        )
    finally:
        connection.set_trace_callback(None)

    geometry_queries = [
        " ".join(statement.lower().split())
        for statement in statements
        if "select id, geometry" in " ".join(statement.lower().split())
    ]
    assert len(geometry_queries) == 2
    assert all("id in (" in query for query in geometry_queries)
    assert [query.count("batch-country-") for query in geometry_queries] == [400, 1]
    assert built_ids == list(region_ids)
    completed_by_id = {path.region_id: path for path in completed[1].region_paths}
    assert set(completed_by_id) == set(region_ids)
    assert all(completed_by_id[region_id].path for region_id in region_ids)


def test_path_coverage_reports_missing_canonical_geometry_row() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="missing-country", level=1)
    connection.commit()
    paths = precompute.AdminRegionThumbnailPaths(
        base_path="M0 0Z",
        region_paths=(
            precompute.AdminRegionThumbnailPath(
                region_id="missing-country",
                path="",
                coarse_path="",
                bounds=(0.0, 0.0, 0.0, 0.0),
                geometry=None,
            ),
        ),
    )

    class MissingCanonicalGeometryConnection:
        def execute(
            self,
            statement: str,
            parameters: tuple[object, ...] = (),
        ) -> object:
            rows = connection.execute(statement, parameters)
            if "SELECT id, geometry" not in statement:
                return rows
            return (row for row in rows if str(row[0]) != "missing-country")

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match=(
            "admin-region fallback geometry query is incomplete at depth 1: "
            "missing-country"
        ),
    ):
        precompute.complete_precomputed_admin_region_path_coverage(
            MissingCanonicalGeometryConnection(),
            {1: paths},
        )


def test_path_coverage_skips_geometry_query_when_all_paths_are_ready() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="ready-country", level=1)
    connection.execute(
        "UPDATE admin_regions SET geometry = 'not-json' WHERE id = 'ready-country'",
    )
    connection.commit()
    paths = precompute.AdminRegionThumbnailPaths(
        base_path="M0 0Z",
        region_paths=(
            precompute.AdminRegionThumbnailPath(
                region_id="ready-country",
                path="M1 1Z",
                coarse_path="M1 1Z",
                bounds=(1.0, 1.0, 1.0, 1.0),
                geometry=None,
            ),
        ),
    )
    statements: list[str] = []
    connection.set_trace_callback(statements.append)

    try:
        completed = precompute.complete_precomputed_admin_region_path_coverage(
            connection,
            {1: paths},
        )
    finally:
        connection.set_trace_callback(None)

    assert completed[1] == paths
    assert not any(
        "select id, geometry" in " ".join(statement.lower().split())
        for statement in statements
    )


def test_daily_stats_precompute_rolls_footprints_up_four_depths_in_shanghai_days() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="CN", level=1)
    insert_region(connection, region_id="310000", level=2, parent_id="CN")
    insert_region(connection, region_id="310100", level=3, parent_id="310000")
    insert_region(connection, region_id="310101", level=4, parent_id="310100")
    before_midnight = int(datetime(2026, 7, 14, 15, 59, tzinfo=timezone.utc).timestamp())
    after_midnight = int(datetime(2026, 7, 14, 16, 1, tzinfo=timezone.utc).timestamp())
    insert_raw_footprint(connection, timestamp_seconds=before_midnight, region_id="310101")
    insert_raw_footprint(connection, timestamp_seconds=after_midnight, region_id="310101")
    insert_raw_footprint(connection, timestamp_seconds=after_midnight + 1, region_id="310101")

    result = precompute.build_admin_region_daily_stat_rows(connection)

    assert [
        (row.depth, row.day, row.region_id, row.footprint_count)
        for row in result.rows
    ] == [
        (1, 20260714, "CN", 1),
        (1, 20260715, "CN", 2),
        (2, 20260714, "310000", 1),
        (2, 20260715, "310000", 2),
        (3, 20260714, "310100", 1),
        (3, 20260715, "310100", 2),
        (4, 20260714, "310101", 1),
        (4, 20260715, "310101", 2),
    ]
    assert result.unresolved_footprint_count == 0


def test_daily_stats_assigns_a_48_hour_interval_only_to_the_later_region_chain() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    for suffix in ("a", "b"):
        insert_region(connection, region_id=f"country-{suffix}", level=1)
        insert_region(
            connection,
            region_id=f"province-{suffix}",
            level=2,
            parent_id=f"country-{suffix}",
        )
        insert_region(
            connection,
            region_id=f"city-{suffix}",
            level=3,
            parent_id=f"province-{suffix}",
        )
        insert_region(
            connection,
            region_id=f"district-{suffix}",
            level=4,
            parent_id=f"city-{suffix}",
        )
    start = int(datetime(2026, 7, 14, 4, 0, tzinfo=timezone.utc).timestamp())
    end = start + 48 * 60 * 60
    insert_raw_footprint(
        connection,
        timestamp_seconds=start,
        region_id="district-a",
        distance=987.0,
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=end,
        region_id="district-b",
        distance=1200.0,
    )

    result = precompute.build_admin_region_daily_stat_rows(connection)

    assert result.unresolved_footprint_count == 0
    for depth, later_region_id in enumerate(
        ("country-b", "province-b", "city-b", "district-b"),
        start=1,
    ):
        later_rows = [
            row
            for row in result.rows
            if row.depth == depth and row.region_id == later_region_id
        ]
        assert sum(row.footprint_count for row in later_rows) == 1
        assert sum(row.stay_duration_seconds for row in later_rows) == 172800
        assert math.fsum(row.travel_distance_meters for row in later_rows) == pytest.approx(
            1200.0,
        )
    for earlier_region_id in ("country-a", "province-a", "city-a", "district-a"):
        earlier_rows = [row for row in result.rows if row.region_id == earlier_region_id]
        assert sum(row.footprint_count for row in earlier_rows) == 1
        assert sum(row.stay_duration_seconds for row in earlier_rows) == 0
        assert math.fsum(row.travel_distance_meters for row in earlier_rows) == 0.0


def test_daily_stats_splits_interval_at_shanghai_midnight() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="country", level=1)
    insert_region(connection, region_id="province", level=2, parent_id="country")
    insert_region(connection, region_id="city", level=3, parent_id="province")
    insert_region(connection, region_id="district", level=4, parent_id="city")
    before_midnight = int(
        datetime(2026, 7, 14, 15, 59, 30, tzinfo=timezone.utc).timestamp()
    )
    after_midnight = int(
        datetime(2026, 7, 14, 16, 1, tzinfo=timezone.utc).timestamp()
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=before_midnight,
        region_id="district",
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=after_midnight,
        region_id="district",
        distance=90.0,
    )

    result = precompute.build_admin_region_daily_stat_rows(connection)

    district_rows = [row for row in result.rows if row.region_id == "district"]
    assert [
        (
            row.day,
            row.footprint_count,
            row.stay_duration_seconds,
            row.travel_distance_meters,
        )
        for row in district_rows
    ] == [
        (20260714, 1, 30, 30.0),
        (20260715, 1, 60, 60.0),
    ]


def test_daily_stats_uses_zoneinfo_for_1988_shanghai_dst_day_boundaries() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="country", level=1)
    before_midnight = int(
        datetime(1988, 6, 1, 14, 30, tzinfo=timezone.utc).timestamp()
    )
    after_midnight = int(
        datetime(1988, 6, 1, 15, 30, tzinfo=timezone.utc).timestamp()
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=before_midnight,
        region_id="country",
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=after_midnight,
        region_id="country",
        distance=60.0,
    )

    result = precompute.build_admin_region_daily_stat_rows(connection)

    assert [
        (
            row.day,
            row.footprint_count,
            row.stay_duration_seconds,
            row.travel_distance_meters,
        )
        for row in result.rows
    ] == [
        (19880601, 1, 1800, 30.0),
        (19880602, 1, 1800, 30.0),
    ]


def test_daily_stats_keeps_zero_footprint_rows_for_full_intermediate_days() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="country-a", level=1)
    insert_region(connection, region_id="country-b", level=1)
    start = int(datetime(2026, 7, 14, 15, 59, 30, tzinfo=timezone.utc).timestamp())
    end = int(datetime(2026, 7, 16, 16, 0, 30, tzinfo=timezone.utc).timestamp())
    distance = 777.7
    insert_raw_footprint(connection, timestamp_seconds=start, region_id="country-a")
    insert_raw_footprint(
        connection,
        timestamp_seconds=end,
        region_id="country-b",
        distance=distance,
    )

    result = precompute.build_admin_region_daily_stat_rows(connection)

    later_rows = [row for row in result.rows if row.region_id == "country-b"]
    assert [row.day for row in later_rows] == [20260714, 20260715, 20260716, 20260717]
    assert [row.footprint_count for row in later_rows] == [0, 0, 0, 1]
    assert [row.stay_duration_seconds for row in later_rows] == [30, 86400, 86400, 30]
    assert sum(row.stay_duration_seconds for row in later_rows) == end - start
    assert math.fsum(row.travel_distance_meters for row in later_rows) == pytest.approx(
        distance,
    )


def test_split_interval_by_shanghai_day_preserves_a_large_finite_distance() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    start = int(datetime(2026, 7, 14, 15, 59, 30, tzinfo=timezone.utc).timestamp())
    end = int(datetime(2026, 7, 16, 16, 0, 30, tzinfo=timezone.utc).timestamp())
    distance = 1e308

    shares = precompute.split_interval_by_shanghai_day(start, end, distance)

    share_distances = [share.travel_distance_meters for share in shares]
    assert all(math.isfinite(share_distance) for share_distance in share_distances)
    assert all(share_distance >= 0 for share_distance in share_distances)
    assert math.fsum(share_distances) == pytest.approx(distance)


def test_daily_stats_wraps_distance_aggregation_overflow_with_key_context() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="country", level=1)
    start = int(datetime(2026, 7, 15, 0, 0, tzinfo=timezone.utc).timestamp())
    insert_raw_footprint(connection, timestamp_seconds=start, region_id="country")
    insert_raw_footprint(
        connection,
        timestamp_seconds=start + 1,
        region_id="country",
        distance=1e308,
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=start + 2,
        region_id="country",
        distance=1e308,
    )

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match=r"depth=1.*day=20260715.*region_id=country",
    ):
        precompute.build_admin_region_daily_stat_rows(connection)


@pytest.mark.parametrize(
    ("start_timestamp", "end_timestamp", "distance"),
    (
        (100, 100, 0.0),
        (101, 100, 0.0),
        (100, 101, -0.1),
        (100, 101, math.inf),
    ),
)
def test_split_interval_by_shanghai_day_rejects_invalid_interval_inputs(
    start_timestamp: int,
    end_timestamp: int,
    distance: float,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")

    with pytest.raises(precompute.AdminRegionPrecomputeSourceError):
        precompute.split_interval_by_shanghai_day(
            start_timestamp,
            end_timestamp,
            distance,
        )


@pytest.mark.parametrize("error_type", (OSError, OverflowError, ValueError))
def test_split_interval_wraps_current_timestamp_conversion_errors(
    monkeypatch: pytest.MonkeyPatch,
    error_type: type[Exception],
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")

    class InvalidTimestampDateTime:
        @staticmethod
        def fromtimestamp(*_args, **_kwargs):
            raise error_type("invalid current timestamp")

    monkeypatch.setattr(precompute, "datetime", InvalidTimestampDateTime)

    with pytest.raises(precompute.AdminRegionPrecomputeSourceError, match="timestamp"):
        precompute.split_interval_by_shanghai_day(100, 200, 0.0)


@pytest.mark.parametrize("error_type", (OSError, OverflowError, ValueError))
def test_split_interval_wraps_next_midnight_conversion_errors(
    monkeypatch: pytest.MonkeyPatch,
    error_type: type[Exception],
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")

    class InvalidMidnight:
        def astimezone(self, _time_zone):
            return self

        def timestamp(self):
            raise error_type("invalid next midnight")

    class InvalidMidnightDateTime:
        fromtimestamp = staticmethod(datetime.fromtimestamp)

        @staticmethod
        def combine(*_args, **_kwargs):
            return InvalidMidnight()

    monkeypatch.setattr(precompute, "datetime", InvalidMidnightDateTime)

    with pytest.raises(precompute.AdminRegionPrecomputeSourceError, match="midnight"):
        precompute.split_interval_by_shanghai_day(100, 200, 0.0)


def test_split_interval_rejects_a_non_advancing_midnight_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")

    class NonAdvancingMidnight:
        call_count = 0

        def astimezone(self, _time_zone):
            return self

        def timestamp(self):
            self.call_count += 1
            if self.call_count > 1:
                raise AssertionError("split retried a non-advancing boundary")
            return 100

    midnight = NonAdvancingMidnight()

    class NonAdvancingDateTime:
        fromtimestamp = staticmethod(datetime.fromtimestamp)

        @staticmethod
        def combine(*_args, **_kwargs):
            return midnight

    monkeypatch.setattr(precompute, "datetime", NonAdvancingDateTime)

    with pytest.raises(precompute.AdminRegionPrecomputeSourceError, match="advance"):
        precompute.split_interval_by_shanghai_day(100, 200, 0.0)


@pytest.mark.parametrize("distance", (-1.0, math.inf))
def test_daily_stats_rejects_invalid_distance_on_the_first_footprint(distance: float) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="country", level=1)
    insert_raw_footprint(
        connection,
        timestamp_seconds=100,
        region_id="country",
        distance=distance,
    )

    with pytest.raises(precompute.AdminRegionPrecomputeSourceError, match="distance"):
        precompute.build_admin_region_daily_stat_rows(connection)


def test_daily_stats_counts_unresolved_regions_without_fabricating_metrics() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    insert_region(connection, region_id="country", level=1)
    insert_raw_footprint(connection, timestamp_seconds=100, region_id="country")
    insert_raw_footprint(
        connection,
        timestamp_seconds=110,
        region_id="missing-region",
        distance=9.0,
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=120,
        region_id="country",
        distance=12.0,
    )

    result = precompute.build_admin_region_daily_stat_rows(connection)

    assert result.unresolved_footprint_count == 1
    assert all(row.region_id != "missing-region" for row in result.rows)
    assert [
        (
            row.region_id,
            row.footprint_count,
            row.stay_duration_seconds,
            row.travel_distance_meters,
        )
        for row in result.rows
    ] == [("country", 2, 10, 12.0)]


def test_build_admin_region_summary_precompute_atomically_populates_only_new_tables() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    protected_before = snapshot_protected_tiles(connection)

    result = precompute.build_admin_region_summary_precompute(connection, updated_at=123)

    assert result.thumbnail_base_count == 2
    assert result.thumbnail_region_path_count == 4
    assert result.daily_stat_count == 4
    base_rows = connection.execute(
        """
        SELECT scope, source_depth, source_z, source_x, source_y, view_box, path, updated_at
        FROM admin_region_thumbnail_bases
        ORDER BY scope
        """,
    ).fetchall()
    assert [tuple(row[:6]) for row in base_rows] == [
        ("china", 2, 1, 1, 0, "0 0 320 180"),
        ("world", 1, 0, 0, 0, "0 0 320 180"),
    ]
    assert all(str(row[6]) for row in base_rows)
    assert {int(row[7]) for row in base_rows} == {123}
    assert [
        tuple(row)
        for row in connection.execute(
            """
            SELECT depth, region_id
            FROM admin_region_thumbnail_region_paths
            ORDER BY depth, region_id
            """,
        )
    ] == [
        (1, "country-a"),
        (2, "province-a"),
        (3, "city-a"),
        (4, "district-a"),
    ]
    assert [
        tuple(row)
        for row in connection.execute(
            """
            SELECT depth, day, region_id, footprint_count,
                   stay_duration_seconds, travel_distance_meters
            FROM admin_region_daily_stats
            ORDER BY depth, day, region_id
            """,
        )
    ] == [
        (1, 20260715, "country-a", 1, 0, 0.0),
        (2, 20260715, "province-a", 1, 0, 0.0),
        (3, 20260715, "city-a", 1, 0, 0.0),
        (4, 20260715, "district-a", 1, 0, 0.0),
    ]
    assert read_ready_signature_keys(connection) == {
        THUMBNAIL_BASE_SIGNATURE_KEY,
        THUMBNAIL_PATH_SIGNATURE_KEY,
        DAILY_STATS_SIGNATURE_KEY,
    }
    assert snapshot_protected_tiles(connection) == protected_before


def test_build_admin_region_summary_precompute_migrates_legacy_daily_stats_table() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    connection.executescript(
        """
        DROP TABLE admin_region_daily_stats;
        CREATE TABLE admin_region_daily_stats (
          depth INTEGER NOT NULL,
          day INTEGER NOT NULL,
          region_id TEXT NOT NULL,
          footprint_count INTEGER NOT NULL,
          PRIMARY KEY (depth, day, region_id),
          CHECK (depth BETWEEN 1 AND 4),
          CHECK (footprint_count > 0)
        ) WITHOUT ROWID;
        INSERT INTO admin_region_daily_stats (
          depth, day, region_id, footprint_count
        ) VALUES (1, 20260714, 'legacy-country', 99);
        """,
    )
    connection.commit()

    precompute.build_admin_region_summary_precompute(connection, updated_at=123)

    assert table_columns(connection, "admin_region_daily_stats") == [
        "depth",
        "day",
        "region_id",
        "footprint_count",
        "stay_duration_seconds",
        "travel_distance_meters",
    ]
    assert [
        tuple(row)
        for row in connection.execute(
            """
            SELECT depth, day, region_id, footprint_count,
                   stay_duration_seconds, travel_distance_meters
            FROM admin_region_daily_stats
            ORDER BY depth, day, region_id
            """,
        )
    ] == [
        (1, 20260715, "country-a", 1, 0, 0.0),
        (2, 20260715, "province-a", 1, 0, 0.0),
        (3, 20260715, "city-a", 1, 0, 0.0),
        (4, 20260715, "district-a", 1, 0, 0.0),
    ]
    assert connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'admin_region_daily_stats_next'
        """,
    ).fetchone() is None


def test_build_admin_region_summary_precompute_fills_partial_tile_coverage_from_geometry() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    insert_region(connection, region_id="fallback-country", level=1)
    insert_region(
        connection,
        region_id="fallback-district",
        level=4,
        parent_id="city-a",
    )
    connection.execute(
        """
        UPDATE admin_regions
        SET geometry = ?, min_lng = 20, min_lat = 0, max_lng = 22, max_lat = 2
        WHERE id = 'fallback-country'
        """,
        ('{"type":"Polygon","coordinates":[[[20,0],[22,0],[22,2],[20,2],[20,0]]]}',),
    )
    connection.execute(
        """
        UPDATE admin_regions
        SET geometry = ?, min_lng = 112, min_lat = 25, max_lng = 113, max_lat = 26
        WHERE id = 'fallback-district'
        """,
        ('{"type":"Polygon","coordinates":[[[112,25],[113,25],[113,26],[112,26],[112,25]]]}',),
    )
    insert_raw_footprint(
        connection,
        timestamp_seconds=int(datetime(2026, 7, 14, 16, 2, tzinfo=timezone.utc).timestamp()),
        region_id="fallback-district",
    )
    connection.commit()

    result = precompute.build_admin_region_summary_precompute(connection, updated_at=123)

    assert result.thumbnail_region_path_count == 6
    fallback_paths = connection.execute(
        """
        SELECT depth, region_id, path
        FROM admin_region_thumbnail_region_paths
        WHERE region_id IN ('fallback-country', 'fallback-district')
        ORDER BY depth, region_id
        """,
    ).fetchall()
    assert [(int(row[0]), str(row[1])) for row in fallback_paths] == [
        (1, "fallback-country"),
        (4, "fallback-district"),
    ]
    assert all(str(row[2]).startswith("M") for row in fallback_paths)
    assert connection.execute(
        """
        SELECT footprint_count
        FROM admin_region_daily_stats
        WHERE depth = 4 AND region_id = 'fallback-district' AND day = 20260715
        """,
    ).fetchone()[0] == 1


def test_build_admin_region_summary_precompute_replaces_empty_tile_path_from_geometry() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    insert_region(connection, region_id="tiny-country", level=1)
    connection.execute(
        """
        UPDATE admin_regions
        SET geometry = ?, min_lng = 30, min_lat = 0, max_lng = 31, max_lat = 1
        WHERE id = 'tiny-country'
        """,
        ('{"type":"Polygon","coordinates":[[[30,0],[31,0],[31,1],[30,1],[30,0]]]}',),
    )
    tile = encode_geographic_admin_region_tile(
        depth=1,
        components={
            "country-a": (-10.0, 10.0, 10.0, 30.0),
            "tiny-country": (30.0, 0.0, 30.4, 0.4),
        },
        z=0,
        x=0,
        y=0,
    )
    connection.execute(
        """
        UPDATE admin_region_tiles
        SET tile = ?, feature_count = 2, updated_at = 999
        WHERE focus_region_id = 'world'
          AND depth = 1 AND z = 0 AND x = 0 AND y = 0
        """,
        (tile,),
    )
    connection.commit()
    tile_paths = precompute.build_precomputed_admin_region_thumbnail_paths(
        AdminRegionThumbnailTile(z=0, x=0, y=0, content=tile),
        depth=1,
    )
    assert next(
        path.path for path in tile_paths.region_paths if path.region_id == "tiny-country"
    ) == ""

    result = precompute.build_admin_region_summary_precompute(connection, updated_at=123)

    assert result.thumbnail_region_path_count == 5
    assert connection.execute(
        """
        SELECT path
        FROM admin_region_thumbnail_region_paths
        WHERE depth = 1 AND region_id = 'tiny-country'
        """,
    ).fetchone()[0].startswith("M")
    assert connection.execute(
        "SELECT path FROM admin_region_thumbnail_bases WHERE scope = 'world'",
    ).fetchone()[0] == tile_paths.base_path


def test_build_admin_region_summary_precompute_rolls_back_to_previous_complete_result() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    previous_rows = snapshot_summary_precompute(connection)
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        precompute.replace_admin_region_summary_precompute(
            connection,
            base_records=(),
            path_records=(),
            daily_stat_rows=(
                precompute.AdminRegionDailyStat(
                    depth=4,
                    day=20260716,
                    region_id="invalid-daily-stat",
                    footprint_count=0,
                    stay_duration_seconds=0,
                    travel_distance_meters=0,
                ),
            ),
            base_source_signature="replacement-base-signature",
            path_source_signature="replacement-path-signature",
            daily_source_signature="replacement-daily-signature",
        )

    assert snapshot_summary_precompute(connection) == previous_rows
    assert connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'admin_region_daily_stats_next'
        """,
    ).fetchone() is None


def test_replace_admin_region_summary_precompute_cleans_stale_next_after_rollback() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    previous_rows = snapshot_summary_precompute(connection)
    connection.executescript(
        """
        CREATE TABLE admin_region_daily_stats_next (
          marker TEXT NOT NULL
        );
        INSERT INTO admin_region_daily_stats_next (marker) VALUES ('stale');
        """,
    )
    connection.commit()

    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        precompute.replace_admin_region_summary_precompute(
            connection,
            base_records=(),
            path_records=(),
            daily_stat_rows=(
                precompute.AdminRegionDailyStat(
                    depth=4,
                    day=20260716,
                    region_id="invalid-daily-stat",
                    footprint_count=0,
                    stay_duration_seconds=0,
                    travel_distance_meters=0,
                ),
            ),
            base_source_signature="replacement-base-signature",
            path_source_signature="replacement-path-signature",
            daily_source_signature="replacement-daily-signature",
        )

    assert snapshot_summary_precompute(connection) == previous_rows
    assert connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'admin_region_daily_stats_next'
        """,
    ).fetchone() is None


def test_replace_admin_region_summary_precompute_preserves_original_failure(
    tmp_path: Path,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    database = tmp_path / "footprints.sqlite"
    setup_connection = create_precompute_source_database(database)
    precompute.build_admin_region_summary_precompute(setup_connection, updated_at=123)
    setup_connection.executescript(
        """
        CREATE TABLE admin_region_daily_stats_next (
          marker TEXT NOT NULL
        );
        INSERT INTO admin_region_daily_stats_next (marker) VALUES ('stale');
        """,
    )
    setup_connection.commit()
    setup_connection.close()

    class FailSecondNextDropConnection(sqlite3.Connection):
        next_drop_count = 0

        def execute(self, sql: str, parameters=(), /):
            if sql.strip().startswith("DROP TABLE IF EXISTS admin_region_daily_stats_next"):
                self.next_drop_count += 1
                if self.next_drop_count == 2:
                    raise sqlite3.OperationalError("forced cleanup failure")
            return super().execute(sql, parameters)

    connection = sqlite3.connect(database, factory=FailSecondNextDropConnection)
    connection.row_factory = sqlite3.Row

    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        precompute.replace_admin_region_summary_precompute(
            connection,
            base_records=(),
            path_records=(),
            daily_stat_rows=(
                precompute.AdminRegionDailyStat(
                    depth=4,
                    day=20260716,
                    region_id="invalid-daily-stat",
                    footprint_count=0,
                    stay_duration_seconds=0,
                    travel_distance_meters=0,
                ),
            ),
            base_source_signature="replacement-base-signature",
            path_source_signature="replacement-path-signature",
            daily_source_signature="replacement-daily-signature",
        )

    assert connection.next_drop_count == 1
    assert connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'admin_region_daily_stats_next'
        """,
    ).fetchone() is None


def test_replace_admin_region_summary_precompute_rolls_back_post_swap_failure() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    previous_rows = snapshot_summary_precompute(connection)
    connection.execute(
        f"""
        CREATE TRIGGER reject_daily_signature_update
        BEFORE UPDATE OF value ON footprint_meta
        WHEN OLD.key = '{DAILY_STATS_SIGNATURE_KEY}'
        BEGIN
          SELECT RAISE(ABORT, 'forced post-swap signature failure');
        END
        """,
    )
    connection.commit()

    with pytest.raises(
        sqlite3.IntegrityError,
        match="forced post-swap signature failure",
    ):
        precompute.replace_admin_region_summary_precompute(
            connection,
            base_records=(),
            path_records=(),
            daily_stat_rows=(
                precompute.AdminRegionDailyStat(
                    depth=4,
                    day=20260716,
                    region_id="valid-replacement",
                    footprint_count=1,
                    stay_duration_seconds=0,
                    travel_distance_meters=0,
                ),
            ),
            base_source_signature="replacement-base-signature",
            path_source_signature="replacement-path-signature",
            daily_source_signature="replacement-daily-signature",
        )

    assert snapshot_summary_precompute(connection) == previous_rows
    assert connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'admin_region_daily_stats_next'
        """,
    ).fetchone() is None


def test_build_admin_region_summary_precompute_rejects_empty_canonical_region_depth() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    connection.execute("UPDATE admin_regions SET level = 5 WHERE id = 'district-a'")
    connection.commit()

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match="no canonical regions at depth 4",
    ):
        precompute.build_admin_region_summary_precompute(connection, updated_at=456)


def test_build_admin_region_summary_precompute_rejects_incomplete_region_paths() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    previous_rows = snapshot_summary_precompute(connection)
    empty_tile = encode(
        [{"name": "admin_regions", "features": []}],
        default_options={"extents": 4096, "y_coord_down": True},
    )
    connection.execute(
        """
        UPDATE admin_region_tiles
        SET tile = ?, feature_count = 0, updated_at = 999
        WHERE focus_region_id = 'world'
          AND depth = 4 AND z = 1 AND x = 1 AND y = 0
        """,
        (empty_tile,),
    )
    connection.commit()

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match="depth 4.*district-a",
    ):
        precompute.build_admin_region_summary_precompute(connection, updated_at=456)

    assert snapshot_summary_precompute(connection) == previous_rows


def test_build_admin_region_summary_precompute_rejects_empty_daily_stats() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    previous_rows = snapshot_summary_precompute(connection)
    connection.execute("DELETE FROM footprints")
    connection.commit()

    with pytest.raises(
        precompute.AdminRegionPrecomputeSourceError,
        match="daily stats are empty",
    ):
        precompute.build_admin_region_summary_precompute(connection, updated_at=456)

    assert snapshot_summary_precompute(connection) == previous_rows


def test_read_thumbnail_bases_returns_persisted_world_and_china_without_geometry_work(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    database = tmp_path / "footprints.sqlite"
    connection = create_precompute_source_database(database)
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    connection.close()
    monkeypatch.setattr(
        precompute,
        "build_precomputed_admin_region_thumbnail_paths",
        lambda *_args, **_kwargs: pytest.fail("request path rebuilt thumbnail geometry"),
    )

    payload = precompute.read_admin_region_thumbnail_bases(database)

    assert payload["viewBox"] == "0 0 320 180"
    assert payload["signature"]
    assert set(payload["bases"]) == {"world", "china"}
    assert payload["bases"]["world"]["path"]
    assert payload["bases"]["china"]["path"]


def test_query_precomputed_summary_reads_daily_stats_and_concatenates_region_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    from enroute_api.admin_regions import summary as summary_module
    from enroute_api.admin_regions import thumbnail as thumbnail_module

    database = tmp_path / "footprints.sqlite"
    connection = create_precompute_source_database(database)
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    expected_path = str(
        connection.execute(
            """
            SELECT path
            FROM admin_region_thumbnail_region_paths
            WHERE depth = 4 AND region_id = 'district-a'
            """,
        ).fetchone()[0]
    )
    connection.close()
    monkeypatch.setattr(
        summary_module,
        "query_admin_region_statistics",
        lambda *_args, **_kwargs: pytest.fail("request read raw footprints recursively"),
    )
    monkeypatch.setattr(
        thumbnail_module,
        "read_admin_region_thumbnail_source",
        lambda *_args, **_kwargs: pytest.fail("request decoded admin-region MVT"),
    )

    payload = precompute.query_precomputed_admin_region_summary(
        database,
        depth=4,
        start_day=20260715,
        end_day=20260715,
    )

    assert payload == {
        "depth": 4,
        "visitedRegionIds": ["district-a"],
        "visitedCount": 1,
        "totalCount": 1,
        "visitedPath": expected_path,
        "rankings": [
            {
                "rank": 1,
                "regionId": "district-a",
                "name": "district-a",
                "footprintCount": 1,
                "bounds": {
                    "west": 0.0,
                    "south": 0.0,
                    "east": 1.0,
                    "north": 1.0,
                },
            },
        ],
    }
    empty_payload = precompute.query_precomputed_admin_region_summary(
        database,
        depth=4,
        start_day=20260716,
        end_day=20260716,
    )
    assert empty_payload["visitedRegionIds"] == []
    assert empty_payload["visitedPath"] == ""
    assert empty_payload["visitedCount"] == 0
    assert empty_payload["totalCount"] == 1


def test_precomputed_readers_reject_stale_or_missing_ready_signatures(tmp_path: Path) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    database = tmp_path / "footprints.sqlite"
    connection = create_precompute_source_database(database)
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    connection.execute(
        """
        UPDATE admin_region_tiles
        SET updated_at = updated_at + 1
        WHERE focus_region_id = 'world' AND depth = 2 AND z = 1 AND x = 1 AND y = 0
        """,
    )
    connection.commit()
    connection.close()

    with pytest.raises(
        precompute.AdminRegionPrecomputeUnavailable,
        match="thumbnail base signature is stale",
    ):
        precompute.read_admin_region_thumbnail_bases(database)

    connection = sqlite3.connect(database)
    connection.execute(
        """
        UPDATE admin_region_tiles
        SET updated_at = updated_at - 1
        WHERE focus_region_id = 'world' AND depth = 2 AND z = 1 AND x = 1 AND y = 0
        """,
    )
    connection.execute(
        "DELETE FROM footprint_meta WHERE key = ?",
        (DAILY_STATS_SIGNATURE_KEY,),
    )
    connection.commit()
    connection.close()
    with pytest.raises(
        precompute.AdminRegionPrecomputeUnavailable,
        match="daily stats signature is missing",
    ):
        precompute.query_precomputed_admin_region_summary(
            database,
            depth=4,
            start_day=None,
            end_day=None,
        )


def test_precomputed_summary_rejects_v3_daily_stats_signature(tmp_path: Path) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    database = tmp_path / "footprints.sqlite"
    connection = create_precompute_source_database(database)
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    signature = json.loads(
        connection.execute(
            "SELECT value FROM footprint_meta WHERE key = ?",
            (DAILY_STATS_SIGNATURE_KEY,),
        ).fetchone()[0],
    )
    signature["algorithmSignature"] = "admin-region-summary-v3"
    connection.execute(
        "UPDATE footprint_meta SET value = ? WHERE key = ?",
        (
            json.dumps(signature, ensure_ascii=True, separators=(",", ":"), sort_keys=True),
            DAILY_STATS_SIGNATURE_KEY,
        ),
    )
    connection.commit()
    connection.close()

    with pytest.raises(
        precompute.AdminRegionPrecomputeUnavailable,
        match="daily stats signature is stale",
    ):
        precompute.query_precomputed_admin_region_summary(
            database,
            depth=4,
            start_day=None,
            end_day=None,
        )


def test_admin_region_precompute_api_separates_bases_from_dynamic_summary(tmp_path: Path) -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    database = tmp_path / "footprints.sqlite"
    connection = create_precompute_source_database(database)
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    connection.close()
    settings = Settings(
        footprint_db_path=database,
        footprint_data_path=tmp_path / "missing.csv",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
        accounting_db_path=tmp_path / "accounting.sqlite",
    )
    client = TestClient(create_app(settings=settings))

    bases_response = client.get("/api/admin-regions/thumbnail-bases")
    summary_response = client.get(
        "/api/admin-regions/summary?depth=4&start=2026-07-15&end=2026-07-15",
    )

    assert bases_response.status_code == 200
    assert set(bases_response.json()["bases"]) == {"world", "china"}
    assert summary_response.status_code == 200
    assert summary_response.json()["visitedRegionIds"] == ["district-a"]
    assert summary_response.json()["visitedPath"]
    assert "thumbnail" not in summary_response.json()


def test_admin_region_precompute_api_returns_stable_503_without_fallback(tmp_path: Path) -> None:
    database = tmp_path / "footprints.sqlite"
    connection = create_precompute_source_database(database)
    connection.close()
    settings = Settings(
        footprint_db_path=database,
        footprint_data_path=tmp_path / "missing.csv",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
        accounting_db_path=tmp_path / "accounting.sqlite",
    )
    client = TestClient(create_app(settings=settings))

    bases_response = client.get("/api/admin-regions/thumbnail-bases")
    summary_response = client.get(
        "/api/admin-regions/summary?depth=4&start=2026-07-15&end=2026-07-15",
    )

    assert bases_response.status_code == 503
    assert bases_response.json()["detail"]["code"] == (
        "admin_region_thumbnail_precompute_unavailable"
    )
    assert summary_response.status_code == 503
    assert summary_response.json()["detail"]["code"] == (
        "admin_region_summary_precompute_unavailable"
    )


def primary_key_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return [str(row[1]) for row in sorted(rows, key=lambda row: int(row[5])) if int(row[5]) > 0]


def insert_admin_region_tile(
    connection: sqlite3.Connection,
    *,
    depth: int,
    z: int,
    x: int,
    y: int,
    marker: bytes,
) -> None:
    connection.execute(
        """
        INSERT INTO admin_region_tiles (
          z, x, y, focus_region_id, depth, algorithm_signature,
          tile, feature_count, updated_at
        ) VALUES (?, ?, ?, 'world', ?, ?, ?, 1, ?)
        """,
        (z, x, y, depth, f"tile-v{depth}", marker, depth),
    )


def create_connection_with_ready_signatures() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    connection.executemany(
        "INSERT INTO footprint_meta (key, value) VALUES (?, 'ready')",
        (
            (THUMBNAIL_BASE_SIGNATURE_KEY,),
            (THUMBNAIL_PATH_SIGNATURE_KEY,),
            (DAILY_STATS_SIGNATURE_KEY,),
        ),
    )
    return connection


def read_ready_signature_keys(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute(
            "SELECT key FROM footprint_meta WHERE key LIKE 'adminRegion%PrecomputeSignature'",
        )
    }


class StaticRegionMatcher:
    def __init__(self, region_id: str | None) -> None:
        self.region_id = region_id

    def find_finest_region_id(self, *, longitude: float, latitude: float) -> str | None:
        del longitude, latitude
        return self.region_id


def encode_geographic_admin_region_tile(
    *,
    depth: int,
    components: dict[str, tuple[float, float, float, float]],
    z: int = 1,
    x: int = 1,
    y: int = 0,
) -> bytes:
    world_extent = 4096 * 2**z

    def tile_position(longitude: float, latitude: float) -> list[int]:
        global_x = (longitude + 180.0) / 360.0 * world_extent
        global_y = (
            0.5
            - math.asinh(math.tan(math.radians(latitude))) / (2.0 * math.pi)
        ) * world_extent
        return [round(global_x - x * 4096), round(global_y - y * 4096)]

    features = []
    for region_id, (west, south, east, north) in components.items():
        ring = [
            tile_position(west, south),
            tile_position(east, south),
            tile_position(east, north),
            tile_position(west, north),
            tile_position(west, south),
        ]
        features.append(
            {
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"region_id": region_id, "level": depth, "kind": "fill"},
            },
        )
    return encode(
        [{"name": "admin_regions", "features": features}],
        default_options={"extents": 4096, "y_coord_down": True},
    )


def insert_region(
    connection: sqlite3.Connection,
    *,
    region_id: str,
    level: int,
    parent_id: str | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO admin_regions (
          id, name, level, geometry, source_geometry, source_coordinate_system,
          min_lng, max_lng, min_lat, max_lat,
          first_seen_timestamp, footprint_count, stay_duration_seconds,
          travel_distance_meters
        ) VALUES (?, ?, ?, ?, ?, 'wgs84', 0, 1, 0, 1, NULL, 0, 0, 0)
        """,
        (
            region_id,
            region_id,
            level,
            '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
            '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
        ),
    )
    if parent_id is not None:
        connection.execute(
            "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
            (parent_id, region_id),
        )


def insert_raw_footprint(
    connection: sqlite3.Connection,
    *,
    timestamp_seconds: int,
    region_id: str | None,
    distance: float = 0.0,
) -> None:
    connection.execute(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed,
          distance, heading, altitude, region_id
        ) VALUES (?, 121.47, 31.23, 5, 0, ?, 0, 3, ?)
        """,
        (timestamp_seconds, distance, region_id),
    )


def create_precompute_source_database(
    database: str | Path = ":memory:",
) -> sqlite3.Connection:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    for region_id, level, parent_id in (
        ("country-a", 1, None),
        ("province-a", 2, "country-a"),
        ("city-a", 3, "province-a"),
        ("district-a", 4, "city-a"),
    ):
        insert_region(
            connection,
            region_id=region_id,
            level=level,
            parent_id=parent_id,
        )
    insert_raw_footprint(
        connection,
        timestamp_seconds=int(datetime(2026, 7, 14, 16, 1, tzinfo=timezone.utc).timestamp()),
        region_id="district-a",
    )
    for depth, region_id, z, x, y, bounds in (
        (1, "country-a", 0, 0, 0, (-10.0, 10.0, 10.0, 30.0)),
        (2, "province-a", 1, 1, 0, (105.0, 20.0, 115.0, 35.0)),
        (3, "city-a", 1, 1, 0, (108.0, 22.0, 113.0, 30.0)),
        (4, "district-a", 1, 1, 0, (109.0, 23.0, 111.0, 27.0)),
    ):
        tile = encode_geographic_admin_region_tile(
            depth=depth,
            components={region_id: bounds},
            z=z,
            x=x,
            y=y,
        )
        insert_admin_region_tile(
            connection,
            depth=depth,
            z=z,
            x=x,
            y=y,
            marker=tile,
        )
    connection.execute(
        """
        INSERT INTO visual_tiles (
          z, x, y, t_type, t, status, cells, raw_count,
          representative_count, updated_at
        ) VALUES (1, 1, 0, 0, 0, 1, X'0102', 1, 1, 1)
        """,
    )
    connection.executemany(
        "INSERT INTO footprint_meta (key, value) VALUES (?, ?)",
        (
            ("sourceSignature", "footprints-v1"),
            ("adminRegionSourceSignature", "regions-v1"),
            ("rowCount", "1"),
        ),
    )
    connection.commit()
    return connection


def snapshot_protected_tiles(connection: sqlite3.Connection) -> dict[str, list[tuple[object, ...]]]:
    return {
        "visual_tiles": [
            tuple(row)
            for row in connection.execute(
                "SELECT * FROM visual_tiles ORDER BY z, x, y, t_type, t",
            )
        ],
        "admin_region_tiles": [
            tuple(row)
            for row in connection.execute(
                """
                SELECT * FROM admin_region_tiles
                ORDER BY z, x, y, focus_region_id, depth
                """,
            )
        ],
    }


def snapshot_summary_precompute(connection: sqlite3.Connection) -> dict[str, list[tuple[object, ...]]]:
    return {
        "bases": [
            tuple(row)
            for row in connection.execute(
                "SELECT * FROM admin_region_thumbnail_bases ORDER BY scope",
            )
        ],
        "paths": [
            tuple(row)
            for row in connection.execute(
                """
                SELECT * FROM admin_region_thumbnail_region_paths
                ORDER BY depth, region_id
                """,
            )
        ],
        "stats": [
            tuple(row)
            for row in connection.execute(
                "SELECT * FROM admin_region_daily_stats ORDER BY depth, day, region_id",
            )
        ],
        "signatures": [
            tuple(row)
            for row in connection.execute(
                """
                SELECT key, value
                FROM footprint_meta
                WHERE key LIKE 'adminRegion%PrecomputeSignature'
                ORDER BY key
                """,
            )
        ],
    }


def table_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [str(row[1]) for row in connection.execute(f"PRAGMA table_info({table_name})")]
