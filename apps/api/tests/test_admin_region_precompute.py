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
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            """
            INSERT INTO admin_region_daily_stats (
              depth, day, region_id, footprint_count
            ) VALUES (1, 20260715, 'CN', 0)
            """,
        )


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

    rows = precompute.build_admin_region_daily_stat_rows(connection)

    assert [
        (row.depth, row.day, row.region_id, row.footprint_count)
        for row in rows
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
            SELECT depth, day, region_id, footprint_count
            FROM admin_region_daily_stats
            ORDER BY depth, day, region_id
            """,
        )
    ] == [
        (1, 20260715, "country-a", 1),
        (2, 20260715, "province-a", 1),
        (3, 20260715, "city-a", 1),
        (4, 20260715, "district-a", 1),
    ]
    assert read_ready_signature_keys(connection) == {
        THUMBNAIL_BASE_SIGNATURE_KEY,
        THUMBNAIL_PATH_SIGNATURE_KEY,
        DAILY_STATS_SIGNATURE_KEY,
    }
    assert snapshot_protected_tiles(connection) == protected_before


def test_build_admin_region_summary_precompute_rolls_back_to_previous_complete_result() -> None:
    precompute = importlib.import_module("enroute_api.admin_regions.precompute")
    connection = create_precompute_source_database()
    precompute.build_admin_region_summary_precompute(connection, updated_at=123)
    previous_rows = snapshot_summary_precompute(connection)
    connection.execute(
        """
        CREATE TRIGGER reject_new_daily_stats
        BEFORE INSERT ON admin_region_daily_stats
        BEGIN
          SELECT RAISE(ABORT, 'forced summary precompute failure');
        END
        """,
    )

    with pytest.raises(sqlite3.IntegrityError, match="forced summary precompute failure"):
        precompute.build_admin_region_summary_precompute(connection, updated_at=456)

    assert snapshot_summary_precompute(connection) == previous_rows


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
) -> None:
    connection.execute(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed,
          distance, heading, altitude, region_id
        ) VALUES (?, 121.47, 31.23, 5, 0, 0, 0, 3, ?)
        """,
        (timestamp_seconds, region_id),
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
