from __future__ import annotations

import json
import math
import sqlite3
import time
from datetime import date, timedelta
from pathlib import Path
from threading import RLock, Thread
from typing import Any, Iterable, TypedDict

from enroute_api.admin_regions.store import (
    format_admin_region,
    RegionMatcher,
    create_region_matcher,
    get_region_chain,
    get_region_levels,
    initialize_admin_region_schema,
    load_admin_regions,
    query_admin_regions,
)
from enroute_api.admin_regions.tiles import initialize_admin_region_tile_schema, read_admin_region_tile

from .csv_loader import iter_footprint_points
from .visual_tiles import (
    MAX_VISUAL_TILE_ZOOM,
    TIME_BUCKET_ALL,
    TIME_BUCKET_DAY,
    TIME_BUCKET_MONTH,
    TIME_BUCKET_YEAR,
    VISUAL_TILE_ALGORITHM_SIGNATURE,
    VISUAL_TILE_ALGORITHM_SIGNATURE_KEY,
    coordinate_to_tile,
    encode_day,
    mark_visual_tile_dirty,
    read_visual_tile_records,
    rebuild_dirty_visual_tiles,
    resolve_time_buckets,
    shanghai_date_from_timestamp,
    shanghai_date_start_timestamp_seconds,
    summarize_visual_tiles_for_viewport,
    summarize_visual_tile_keys,
)
from enroute_api.map_tiles.mvt import encode_footprint_mvt

TILE_SIZE = 256
MAX_MERCATOR_LATITUDE = 85.05112878
OPEN_ENDED_TIMESTAMP_SECONDS = 8_640_000_000_000
ADMIN_REGION_LOADER_VERSION = "admin-regions-v2"
ADMIN_REGION_STATS_SIGNATURE_KEY = "adminRegionStatsSignature"
FOOTPRINT_COLUMNS = [
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
FOOTPRINT_COLUMNS_WITH_COUNTRY_ID = [*FOOTPRINT_COLUMNS, "country_id"]


class FootprintImportResult(TypedDict):
    new_count: int
    total_count: int
    matched_count: int
    region_count: int
    unlocked_region_count: int


class FootprintStore:
    def __init__(
        self,
        *,
        db_path: str | Path,
        data_path: str | Path,
        coordinate_system: str,
        admin_region_data_path: str | Path | None = None,
    ) -> None:
        self.db_path = Path(db_path)
        self.data_path = Path(data_path)
        self.coordinate_system = coordinate_system
        self.admin_region_data_path = (
            None if admin_region_data_path is None else Path(admin_region_data_path)
        )
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection_lock = RLock()
        self._visual_tile_rebuild_lock = RLock()
        self._queued_visual_tile_rebuilds: set[tuple[int, int, int, tuple[tuple[int, int], ...]]] = set()
        self.connection = sqlite3.connect(self.db_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        initialize_schema(self.connection)

    def ensure_ready(self) -> None:
        with self._connection_lock:
            ensure_imported(
                self.connection,
                data_path=self.data_path,
                coordinate_system=self.coordinate_system,
                admin_region_data_path=self.admin_region_data_path,
                load_admin_region_data=False,
                refresh_footprints=False,
                refresh_admin_region_stats=False,
            )

    def import_footprints(self) -> FootprintImportResult:
        with self._connection_lock:
            return ensure_imported(
                self.connection,
                data_path=self.data_path,
                coordinate_system=self.coordinate_system,
                admin_region_data_path=self.admin_region_data_path,
            )

    def get_snapshot(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        with self._connection_lock:
            self.ensure_ready()
            return query_snapshot(self.connection, normalize_snapshot_input(input_payload))

    def get_footprint_metrics(
        self,
        *,
        range_value: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        with self._connection_lock:
            self.ensure_ready()
            input_payload = normalize_metrics_input(
                self.connection,
                range_value=range_value,
                start_date=start_date,
                end_date=end_date,
            )
            return {
                **query_metrics(self.connection, input_payload),
                "selectedBounds": query_selected_bounds(self.connection, input_payload),
            }

    def get_all_points(self) -> dict[str, list[dict[str, Any]]]:
        with self._connection_lock:
            self.ensure_ready()
            return query_all_points(self.connection)

    def get_admin_regions(
        self,
        *,
        level: int,
        west: float | None = None,
        south: float | None = None,
        east: float | None = None,
        north: float | None = None,
        zoom: float | None = None,
    ) -> dict[str, object]:
        with self._connection_lock:
            self.ensure_ready()
            return {
                "regions": [
                    format_admin_region(row)
                    for row in query_admin_regions(
                        self.connection,
                        level=level,
                        west=west,
                        south=south,
                        east=east,
                        north=north,
                        zoom=zoom,
                    )
                ],
            }

    def get_footprint_mvt(
        self,
        *,
        z: int,
        x: int,
        y: int,
        range_value: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> bytes:
        with self._connection_lock:
            self.ensure_ready()
            buckets = resolve_time_buckets(
                range_value=range_value,
                start_date=start_date,
                end_date=end_date,
            )
            read_result = read_visual_tile_records(
                self.connection,
                z=z,
                x=x,
                y=y,
                buckets=buckets,
            )
            if read_result.dirty_buckets:
                self.queue_visual_tile_rebuild(
                    z=z,
                    x=x,
                    y=y,
                    buckets=read_result.dirty_buckets,
                )
            return encode_footprint_mvt(read_result.records)

    def get_admin_region_mvt(
        self,
        *,
        z: int,
        x: int,
        y: int,
        focus_region_id: str,
        depth: int,
    ) -> bytes:
        with sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=5) as connection:
            connection.row_factory = sqlite3.Row
            return read_admin_region_tile(
                connection,
                z=z,
                x=x,
                y=y,
                focus_region_id=focus_region_id,
                depth=depth,
            )

    def get_footprint_tile_debug_metrics(
        self,
        *,
        z: int,
        west: float | None = None,
        south: float | None = None,
        east: float | None = None,
        north: float | None = None,
        tile_keys: list[tuple[int, int]] | None = None,
        range_value: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, int | float]:
        with self._connection_lock:
            self.ensure_ready()
            buckets = resolve_time_buckets(
                range_value=range_value,
                start_date=start_date,
                end_date=end_date,
            )
            if tile_keys is not None:
                return summarize_visual_tile_keys(
                    self.connection,
                    z=z,
                    tile_keys=tile_keys,
                    buckets=buckets,
                )
            if west is None or south is None or east is None or north is None:
                raise ValueError("viewport bounds are required when tile keys are not provided")

            return summarize_visual_tiles_for_viewport(
                self.connection,
                z=z,
                west=west,
                south=south,
                east=east,
                north=north,
                buckets=buckets,
            )

    def queue_visual_tile_rebuild(
        self,
        *,
        z: int,
        x: int,
        y: int,
        buckets: list[tuple[int, int]],
    ) -> None:
        rebuild_key = (z, x, y, tuple(sorted(set(buckets))))
        with self._visual_tile_rebuild_lock:
            if rebuild_key in self._queued_visual_tile_rebuilds:
                return
            self._queued_visual_tile_rebuilds.add(rebuild_key)

        thread = Thread(
            target=self._rebuild_visual_tile_worker,
            args=(rebuild_key,),
            daemon=True,
        )
        thread.start()

    def _rebuild_visual_tile_worker(
        self,
        rebuild_key: tuple[int, int, int, tuple[tuple[int, int], ...]],
    ) -> None:
        z, x, y, buckets = rebuild_key
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        try:
            initialize_schema(connection)
            rebuild_dirty_visual_tiles(
                connection,
                z=z,
                x=x,
                y=y,
                buckets=list(buckets),
            )
        finally:
            connection.close()
            with self._visual_tile_rebuild_lock:
                self._queued_visual_tile_rebuilds.discard(rebuild_key)

    def close(self) -> None:
        with self._connection_lock:
            self.connection.close()


def initialize_schema(connection: sqlite3.Connection) -> None:
    initialize_admin_region_schema(connection)
    initialize_admin_region_tile_schema(connection)
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS footprint_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """,
    )
    migrate_legacy_footprints_schema(connection)
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS footprints (
          timestamp_seconds INTEGER PRIMARY KEY,
          longitude REAL NOT NULL,
          latitude REAL NOT NULL,
          accuracy REAL NOT NULL,
          speed REAL NOT NULL,
          distance REAL NOT NULL,
          heading REAL NOT NULL,
          altitude REAL NOT NULL,
          region_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_footprints_time ON footprints(timestamp_seconds);
        CREATE INDEX IF NOT EXISTS idx_footprints_lng_lat_time
          ON footprints(longitude, latitude, timestamp_seconds);
        CREATE VIRTUAL TABLE IF NOT EXISTS footprint_spatial USING rtree(
          footprint_rowid,
          min_lng,
          max_lng,
          min_lat,
          max_lat
        );
        CREATE TABLE IF NOT EXISTS visual_tiles (
          z INTEGER NOT NULL,
          x INTEGER NOT NULL,
          y INTEGER NOT NULL,
          t_type INTEGER NOT NULL,
          t INTEGER NOT NULL,
          status INTEGER NOT NULL,
          cells BLOB,
          raw_count INTEGER NOT NULL DEFAULT 0,
          representative_count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (z, x, y, t_type, t)
        ) WITHOUT ROWID;
        """,
    )
    migrate_visual_tiles_count_columns(connection)
    connection.commit()


def migrate_visual_tiles_count_columns(connection: sqlite3.Connection) -> None:
    columns = [column[1] for column in connection.execute("PRAGMA table_info(visual_tiles)")]
    if "raw_count" not in columns:
        connection.execute("ALTER TABLE visual_tiles ADD COLUMN raw_count INTEGER NOT NULL DEFAULT 0")
    if "representative_count" not in columns:
        connection.execute(
            "ALTER TABLE visual_tiles ADD COLUMN representative_count INTEGER NOT NULL DEFAULT 0",
        )


def migrate_legacy_footprints_schema(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'footprints'",
    ).fetchone()
    if row is None:
        return

    columns = [column[1] for column in connection.execute("PRAGMA table_info(footprints)")]
    if columns == FOOTPRINT_COLUMNS:
        return
    if columns == FOOTPRINT_COLUMNS_WITH_COUNTRY_ID:
        migrate_footprints_without_country_id(connection)
        return

    raise RuntimeError(
        "legacy footprints schema detected; run the explicit footprint rebuild script instead",
    )


def migrate_footprints_without_country_id(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        ALTER TABLE footprints RENAME TO footprints_with_country_id;
        CREATE TABLE footprints (
          timestamp_seconds INTEGER PRIMARY KEY,
          longitude REAL NOT NULL,
          latitude REAL NOT NULL,
          accuracy REAL NOT NULL,
          speed REAL NOT NULL,
          distance REAL NOT NULL,
          heading REAL NOT NULL,
          altitude REAL NOT NULL,
          region_id TEXT
        );
        INSERT INTO footprints (
          timestamp_seconds,
          longitude,
          latitude,
          accuracy,
          speed,
          distance,
          heading,
          altitude,
          region_id
        )
        SELECT
          timestamp_seconds,
          longitude,
          latitude,
          accuracy,
          speed,
          distance,
          heading,
          altitude,
          region_id
        FROM footprints_with_country_id;
        DROP TABLE footprints_with_country_id;
        """,
    )


def ensure_imported(
    connection: sqlite3.Connection,
    *,
    data_path: Path,
    coordinate_system: str,
    admin_region_data_path: Path | None = None,
    load_admin_region_data: bool = True,
    refresh_footprints: bool = True,
    refresh_admin_region_stats: bool = True,
) -> FootprintImportResult:
    return import_footprints(
        connection,
        data_path=data_path,
        coordinate_system=coordinate_system,
        admin_region_data_path=admin_region_data_path,
        load_admin_region_data=load_admin_region_data,
        refresh_footprints=refresh_footprints,
        refresh_admin_region_stats=refresh_admin_region_stats,
    )


def import_footprints(
    connection: sqlite3.Connection,
    *,
    data_path: Path,
    coordinate_system: str,
    admin_region_data_path: Path | None = None,
    load_admin_region_data: bool = True,
    refresh_footprints: bool = True,
    refresh_admin_region_stats: bool = True,
) -> FootprintImportResult:
    region_signature = resolve_admin_region_signature(
        connection,
        admin_region_data_path,
        load_admin_region_data=load_admin_region_data,
    )
    source_signature = create_import_signature(data_path, coordinate_system, region_signature)
    compatibility_signature = create_import_compatibility_signature(
        coordinate_system,
        region_signature,
    )
    stored_signature = get_meta_value(connection, "sourceSignature")
    stored_compatibility_signature = get_meta_value(connection, "importCompatibilitySignature")
    stored_stats_signature = get_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY)
    stored_count = get_footprint_row_count(connection)
    stored_spatial_count = get_spatial_row_count(connection)

    if not refresh_footprints and stored_count > 0 and stored_spatial_count == stored_count:
        ensure_visual_tiles_algorithm_current(connection)
        return get_import_result(connection, new_count=0)

    if stored_signature == source_signature and stored_count > 0 and stored_spatial_count == stored_count:
        ensure_visual_tiles_algorithm_current(connection)
        if refresh_admin_region_stats:
            ensure_admin_region_stats_current(
                connection,
                stored_stats_signature=stored_stats_signature,
                expected_stats_signature=compatibility_signature,
            )
        return get_import_result(connection, new_count=0)
    if (
        not data_path.exists()
        and stored_count > 0
        and stored_spatial_count == stored_count
        and stored_signature is not None
        and stored_compatibility_signature == compatibility_signature
    ):
        ensure_visual_tiles_algorithm_current(connection)
        if refresh_admin_region_stats:
            ensure_admin_region_stats_current(
                connection,
                stored_stats_signature=stored_stats_signature,
                expected_stats_signature=compatibility_signature,
            )
        return get_import_result(connection, new_count=0)

    if not data_path.exists():
        raise FileNotFoundError(data_path)

    with connection:
        if stored_count > 0 and refresh_admin_region_stats:
            rebuild_admin_region_stats_if_stale(
                connection,
                stored_stats_signature=stored_stats_signature,
                expected_stats_signature=compatibility_signature,
            )
        region_matcher = create_region_matcher(connection)
        new_count = 0
        for point in iter_footprint_points(data_path=data_path, coordinate_system=coordinate_system):
            if insert_footprint_if_new(connection, point, region_matcher=region_matcher):
                new_count += 1
                mark_affected_visual_tiles_dirty(connection, point)

        set_meta_value(connection, "sourceSignature", source_signature)
        set_meta_value(connection, "importCompatibilitySignature", compatibility_signature)
        set_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY, compatibility_signature)
        set_meta_value(connection, VISUAL_TILE_ALGORITHM_SIGNATURE_KEY, VISUAL_TILE_ALGORITHM_SIGNATURE)
        set_meta_value(connection, "rowCount", str(stored_count + new_count))

    return get_import_result(connection, new_count=new_count)


def insert_footprint_if_new(
    connection: sqlite3.Connection,
    point: dict[str, Any],
    *,
    region_matcher: RegionMatcher | None = None,
) -> bool:
    region_id = classify_footprint_admin_region(
        connection,
        point,
        region_matcher=region_matcher,
    )
    cursor = connection.execute(
        """
        INSERT OR IGNORE INTO footprints (
          timestamp_seconds,
          longitude,
          latitude,
          accuracy,
          speed,
          distance,
          heading,
          altitude,
          region_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(point["timestampSeconds"]),
            float(point["longitude"]),
            float(point["latitude"]),
            float(point["accuracy"]),
            float(point["speed"]),
            float(point["distance"]),
            float(point["heading"]),
            float(point["altitude"]),
            region_id,
        ),
    )
    if cursor.rowcount == 0:
        validate_existing_footprint_matches(connection, point, region_id)
        return False

    connection.execute(
        """
        INSERT INTO footprint_spatial (
          footprint_rowid,
          min_lng,
          max_lng,
          min_lat,
          max_lat
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (
            int(point["timestampSeconds"]),
            float(point["longitude"]),
            float(point["longitude"]),
            float(point["latitude"]),
            float(point["latitude"]),
        ),
    )
    update_region_unlock_stats(connection, point, region_id)
    return True


def classify_footprint_admin_region(
    connection: sqlite3.Connection,
    point: dict[str, Any],
    *,
    region_matcher: RegionMatcher | None = None,
) -> str | None:
    matcher = region_matcher or create_region_matcher(connection)
    return matcher.find_finest_region_id(
        longitude=float(point["longitude"]),
        latitude=float(point["latitude"]),
    )


def mark_affected_visual_tiles_dirty(connection: sqlite3.Connection, point: dict[str, Any]) -> None:
    timestamp_seconds = int(point["timestampSeconds"])
    local_date = shanghai_date_from_timestamp(timestamp_seconds)
    buckets = [
        (TIME_BUCKET_ALL, 0),
        (TIME_BUCKET_YEAR, local_date.year),
        (TIME_BUCKET_MONTH, local_date.year * 100 + local_date.month),
        (TIME_BUCKET_DAY, encode_day(local_date)),
    ]
    updated_at = int(time.time() * 1000)
    longitude = float(point["longitude"])
    latitude = float(point["latitude"])

    for z in range(MAX_VISUAL_TILE_ZOOM + 1):
        x, y = coordinate_to_tile(longitude=longitude, latitude=latitude, z=z)
        for t_type, t in buckets:
            mark_visual_tile_dirty(
                connection,
                z=z,
                x=x,
                y=y,
                t_type=t_type,
                t=t,
                updated_at=updated_at,
            )


def validate_existing_footprint_matches(
    connection: sqlite3.Connection,
    point: dict[str, Any],
    region_id: str | None,
) -> None:
    row = connection.execute(
        """
        SELECT
          longitude,
          latitude,
          accuracy,
          speed,
          distance,
          heading,
          altitude,
          region_id
        FROM footprints
        WHERE timestamp_seconds = ?
        """,
        (int(point["timestampSeconds"]),),
    ).fetchone()
    if row is None:
        return

    expected = {
        "longitude": float(point["longitude"]),
        "latitude": float(point["latitude"]),
        "accuracy": float(point["accuracy"]),
        "speed": float(point["speed"]),
        "distance": float(point["distance"]),
        "heading": float(point["heading"]),
        "altitude": float(point["altitude"]),
        "region_id": region_id,
    }
    actual = {
        "longitude": float(row["longitude"]),
        "latitude": float(row["latitude"]),
        "accuracy": float(row["accuracy"]),
        "speed": float(row["speed"]),
        "distance": float(row["distance"]),
        "heading": float(row["heading"]),
        "altitude": float(row["altitude"]),
        "region_id": row["region_id"],
    }
    if actual != expected:
        raise ValueError(
            f"Conflicting footprint row for timestamp {int(point['timestampSeconds'])}",
        )


def load_admin_region_data_if_available(
    connection: sqlite3.Connection,
    admin_region_data_path: Path | None,
) -> str:
    if admin_region_data_path is None or not admin_region_data_path.exists():
        return create_source_signature(admin_region_data_path, ADMIN_REGION_LOADER_VERSION)

    signature = create_source_signature(admin_region_data_path, ADMIN_REGION_LOADER_VERSION)
    if get_meta_value(connection, "adminRegionSourceSignature") == signature:
        return signature

    feature_collection = json.loads(admin_region_data_path.read_text(encoding="utf-8-sig"))
    load_admin_regions(connection, feature_collection)
    set_meta_value(connection, "adminRegionSourceSignature", signature)
    delete_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY)
    return signature


def resolve_admin_region_signature(
    connection: sqlite3.Connection,
    admin_region_data_path: Path | None,
    *,
    load_admin_region_data: bool,
) -> str:
    if load_admin_region_data:
        return load_admin_region_data_if_available(connection, admin_region_data_path)

    stored_signature = get_meta_value(connection, "adminRegionSourceSignature")
    if stored_signature is not None:
        return stored_signature

    return create_source_signature(admin_region_data_path, ADMIN_REGION_LOADER_VERSION)


def ensure_visual_tiles_algorithm_current(connection: sqlite3.Connection) -> None:
    if get_meta_value(connection, VISUAL_TILE_ALGORITHM_SIGNATURE_KEY) == VISUAL_TILE_ALGORITHM_SIGNATURE:
        return

    with connection:
        set_meta_value(connection, VISUAL_TILE_ALGORITHM_SIGNATURE_KEY, VISUAL_TILE_ALGORITHM_SIGNATURE)


def ensure_admin_region_stats_current(
    connection: sqlite3.Connection,
    *,
    stored_stats_signature: str | None,
    expected_stats_signature: str,
) -> None:
    with connection:
        rebuild_admin_region_stats_if_stale(
            connection,
            stored_stats_signature=stored_stats_signature,
            expected_stats_signature=expected_stats_signature,
        )


def rebuild_admin_region_stats_if_stale(
    connection: sqlite3.Connection,
    *,
    stored_stats_signature: str | None,
    expected_stats_signature: str,
) -> None:
    if stored_stats_signature == expected_stats_signature:
        return

    rebuild_admin_region_stats_from_footprints(connection)
    set_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY, expected_stats_signature)


def rebuild_admin_region_stats_from_footprints(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        UPDATE admin_regions
        SET first_seen_timestamp = NULL,
            footprint_count = 0,
            stay_duration_seconds = 0,
            travel_distance_meters = 0
        """,
    )
    rows = connection.execute(
        """
        SELECT timestamp_seconds, distance, region_id
        FROM footprints
        WHERE region_id IS NOT NULL
        ORDER BY timestamp_seconds
        """,
    ).fetchall()
    for row in rows:
        update_region_unlock_stats(
            connection,
            {
                "timestampSeconds": int(row["timestamp_seconds"]),
                "distance": float(row["distance"]),
            },
            None if row["region_id"] is None else str(row["region_id"]),
        )


def get_import_result(connection: sqlite3.Connection, *, new_count: int) -> FootprintImportResult:
    total_count = get_footprint_row_count(connection)
    matched_count = get_matched_footprint_row_count(connection)
    region_count = get_admin_region_row_count(connection)
    unlocked_region_count = get_unlocked_admin_region_row_count(connection)
    return {
        "new_count": new_count,
        "total_count": total_count,
        "matched_count": matched_count,
        "region_count": region_count,
        "unlocked_region_count": unlocked_region_count,
    }


def update_region_unlock_stats(
    connection: sqlite3.Connection,
    point: dict[str, Any],
    region_id: str | None,
) -> None:
    current_chain = get_region_chain(connection, region_id)
    timestamp_seconds = int(point["timestampSeconds"])
    for chain_region_id in current_chain:
        connection.execute(
            """
            UPDATE admin_regions
            SET footprint_count = footprint_count + 1,
                first_seen_timestamp = CASE
                  WHEN first_seen_timestamp IS NULL OR first_seen_timestamp > ?
                  THEN ?
                  ELSE first_seen_timestamp
                END
            WHERE id = ?
            """,
            (timestamp_seconds, timestamp_seconds, chain_region_id),
        )

    previous = connection.execute(
        """
        SELECT timestamp_seconds, region_id
        FROM footprints
        WHERE timestamp_seconds < ?
        ORDER BY timestamp_seconds DESC
        LIMIT 1
        """,
        (timestamp_seconds,),
    ).fetchone()
    if previous is None:
        return

    current_by_level = get_region_levels(connection, current_chain)
    previous_by_level = get_region_levels(
        connection,
        get_region_chain(connection, previous["region_id"]),
    )
    delta_seconds = timestamp_seconds - int(previous["timestamp_seconds"])
    distance = float(point["distance"])

    for level, current_region_id in current_by_level.items():
        if previous_by_level.get(level) != current_region_id:
            continue
        connection.execute(
            """
            UPDATE admin_regions
            SET stay_duration_seconds = stay_duration_seconds + ?,
                travel_distance_meters = travel_distance_meters + ?
            WHERE id = ?
            """,
            (delta_seconds, distance, current_region_id),
        )


def query_snapshot(connection: sqlite3.Connection, input_payload: dict[str, Any]) -> dict[str, Any]:
    metrics = query_metrics(connection, input_payload)
    selected_bounds = query_selected_bounds(connection, input_payload)
    points, raw_count = aggregate_rows(query_viewport_rows(connection, input_payload), input_payload)

    return {
        "points": points,
        "metrics": metrics,
        "selectedBounds": selected_bounds,
        "debug": {
            "rawCount": raw_count,
            "renderedCount": len(points),
            "renderRatio": 0 if raw_count == 0 else len(points) / raw_count,
        },
    }


def query_metrics(connection: sqlite3.Connection, input_payload: dict[str, Any]) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT
          COUNT(*) AS selectedCount,
          COALESCE(SUM(CASE WHEN distance > 0 THEN distance ELSE 0 END), 0) AS totalDistanceMeters
        FROM footprints
        WHERE timestamp_seconds >= ?
          AND timestamp_seconds <= ?
        """,
        (
            input_payload["timeRange"]["startTimestampSeconds"],
            input_payload["timeRange"]["endTimestampSeconds"],
        ),
    ).fetchone()
    total_distance_meters = float(row["totalDistanceMeters"])

    return {
        "selectedCount": int(row["selectedCount"]),
        "totalDistanceMeters": total_distance_meters,
        "averageDistanceMetersPerDay": total_distance_meters
        / get_elapsed_day_count_for_average(input_payload["timeRange"]),
        "distanceSeries": query_distance_series(connection, input_payload),
    }


def get_elapsed_day_count_for_average(
    time_range: dict[str, int],
    *,
    now_timestamp_seconds: int | None = None,
) -> int:
    now_seconds = int(time.time() if now_timestamp_seconds is None else now_timestamp_seconds)
    start_seconds = int(time_range["startTimestampSeconds"])
    end_seconds = int(time_range["endTimestampSeconds"])
    start_date = shanghai_date_from_timestamp(start_seconds)
    effective_end_date = shanghai_date_from_timestamp(min(end_seconds, now_seconds))

    if effective_end_date < start_date:
        return 1

    return max((effective_end_date - start_date).days + 1, 1)


def query_distance_series(
    connection: sqlite3.Connection,
    input_payload: dict[str, Any],
) -> dict[str, object]:
    time_range = input_payload["timeRange"]
    day_count = max(int(time_range["dayCount"]), 1)

    if day_count == 1:
        return query_hourly_distance_series(connection, time_range)

    return query_daily_distance_series(connection, time_range)


def query_hourly_distance_series(
    connection: sqlite3.Connection,
    time_range: dict[str, int],
) -> dict[str, object]:
    start_date = shanghai_date_from_timestamp(int(time_range["startTimestampSeconds"]))
    day_start_timestamp = shanghai_date_start_timestamp_seconds(
        start_date.year,
        start_date.month,
        start_date.day,
    )
    distance_by_hour = {
        int(row["bucketHour"]): float(row["distanceMeters"])
        for row in connection.execute(
            """
            SELECT
              CAST((timestamp_seconds - ?) / 3600 AS INTEGER) AS bucketHour,
              COALESCE(SUM(CASE WHEN distance > 0 THEN distance ELSE 0 END), 0) AS distanceMeters
            FROM footprints
            WHERE timestamp_seconds >= ?
              AND timestamp_seconds <= ?
            GROUP BY bucketHour
            """,
            (
                day_start_timestamp,
                time_range["startTimestampSeconds"],
                time_range["endTimestampSeconds"],
            ),
        )
    }

    return {
        "granularity": "hour",
        "unit": "hour",
        "buckets": [
            {
                "key": f"{start_date.isoformat()}T{hour:02d}",
                "label": f"{hour:02d}:00",
                "distanceMeters": distance_by_hour.get(hour, 0),
            }
            for hour in range(24)
        ],
    }


def query_daily_distance_series(
    connection: sqlite3.Connection,
    time_range: dict[str, int],
) -> dict[str, object]:
    start_date = shanghai_date_from_timestamp(int(time_range["startTimestampSeconds"]))
    end_date = shanghai_date_from_timestamp(int(time_range["endTimestampSeconds"]))
    distance_by_day = {
        row["bucketDate"]: float(row["distanceMeters"])
        for row in connection.execute(
            """
            SELECT
              date(timestamp_seconds + 28800, 'unixepoch') AS bucketDate,
              COALESCE(SUM(CASE WHEN distance > 0 THEN distance ELSE 0 END), 0) AS distanceMeters
            FROM footprints
            WHERE timestamp_seconds >= ?
              AND timestamp_seconds <= ?
            GROUP BY bucketDate
            """,
            (
                time_range["startTimestampSeconds"],
                time_range["endTimestampSeconds"],
            ),
        )
    }

    buckets = []
    current_date = start_date
    while current_date <= end_date:
        key = current_date.isoformat()
        buckets.append(
            {
                "key": key,
                "label": f"{current_date.month}月{current_date.day}日",
                "distanceMeters": distance_by_day.get(key, 0),
            },
        )
        current_date += timedelta(days=1)

    return {
        "granularity": "day",
        "unit": "day",
        "buckets": buckets,
    }


def normalize_metrics_input(
    connection: sqlite3.Connection,
    *,
    range_value: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    if (range_value or "").strip().lower() == "all" or not (start_date and end_date):
        return normalize_all_metrics_input(connection)

    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)

    return {
        "timeRange": {
            "startTimestampSeconds": shanghai_date_start_timestamp_seconds(
                start.year,
                start.month,
                start.day,
            ),
            "endTimestampSeconds": shanghai_date_start_timestamp_seconds(
                end.year,
                end.month,
                end.day,
            )
            + 86_399,
            "dayCount": max((end - start).days + 1, 1),
        },
    }


def normalize_all_metrics_input(connection: sqlite3.Connection) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT
          MIN(timestamp_seconds) AS startTimestampSeconds,
          MAX(timestamp_seconds) AS endTimestampSeconds
        FROM footprints
        """,
    ).fetchone()
    if row["startTimestampSeconds"] is None or row["endTimestampSeconds"] is None:
        return {
            "timeRange": {
                "startTimestampSeconds": 0,
                "endTimestampSeconds": OPEN_ENDED_TIMESTAMP_SECONDS,
                "dayCount": 1,
            },
        }

    start_timestamp_seconds = int(row["startTimestampSeconds"])
    end_timestamp_seconds = int(row["endTimestampSeconds"])
    start = shanghai_date_from_timestamp(start_timestamp_seconds)
    end = shanghai_date_from_timestamp(end_timestamp_seconds)

    return {
        "timeRange": {
            "startTimestampSeconds": start_timestamp_seconds,
            "endTimestampSeconds": end_timestamp_seconds,
            "dayCount": max((end - start).days + 1, 1),
        },
    }


def query_all_points(connection: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    rows = connection.execute(
        """
        SELECT
          timestamp_seconds AS timestampSeconds,
          longitude,
          latitude,
          accuracy,
          speed,
          distance,
          heading,
          altitude,
          region_id AS regionId
        FROM footprints
        ORDER BY timestamp_seconds
        """,
    )
    return {"points": [format_raw_point(row) for row in rows]}


def format_raw_point(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "timestampSeconds": int(row["timestampSeconds"]),
        "longitude": float(row["longitude"]),
        "latitude": float(row["latitude"]),
        "accuracy": float(row["accuracy"]),
        "speed": float(row["speed"]),
        "distance": float(row["distance"]),
        "heading": float(row["heading"]),
        "altitude": float(row["altitude"]),
        "regionId": None if row["regionId"] is None else str(row["regionId"]),
    }


def query_selected_bounds(
    connection: sqlite3.Connection,
    input_payload: dict[str, Any],
) -> dict[str, list[float]] | None:
    row = connection.execute(
        """
        SELECT
          MIN(longitude) AS west,
          MIN(latitude) AS south,
          MAX(longitude) AS east,
          MAX(latitude) AS north
        FROM footprints
        WHERE timestamp_seconds >= ?
          AND timestamp_seconds <= ?
        """,
        (
            input_payload["timeRange"]["startTimestampSeconds"],
            input_payload["timeRange"]["endTimestampSeconds"],
        ),
    ).fetchone()

    if row["west"] is None or row["south"] is None or row["east"] is None or row["north"] is None:
        return None

    return {
        "southWest": [float(row["west"]), float(row["south"])],
        "northEast": [float(row["east"]), float(row["north"])],
    }


def query_viewport_rows(connection: sqlite3.Connection, input_payload: dict[str, Any]) -> Iterable[sqlite3.Row]:
    viewport_bounds = input_payload["viewportBounds"]
    if viewport_bounds["west"] <= viewport_bounds["east"]:
        longitude_clause = "s.min_lng <= :east AND s.max_lng >= :west"
    else:
        longitude_clause = "(s.min_lng <= :east OR s.max_lng >= :west)"

    cursor = connection.execute(
        f"""
        SELECT
          f.timestamp_seconds AS timestampSeconds,
          f.longitude,
          f.latitude,
          f.accuracy,
          f.distance
        FROM footprint_spatial s
        JOIN footprints f ON f.rowid = s.footprint_rowid
        WHERE f.timestamp_seconds >= :startTimestampSeconds
          AND f.timestamp_seconds <= :endTimestampSeconds
          AND s.min_lat <= :north
          AND s.max_lat >= :south
          AND {longitude_clause}
        """,
        {
            "startTimestampSeconds": input_payload["timeRange"]["startTimestampSeconds"],
            "endTimestampSeconds": input_payload["timeRange"]["endTimestampSeconds"],
            "west": viewport_bounds["west"],
            "east": viewport_bounds["east"],
            "south": viewport_bounds["south"],
            "north": viewport_bounds["north"],
        },
    )
    return cursor


def aggregate_rows(
    rows: Iterable[sqlite3.Row],
    input_payload: dict[str, Any],
) -> tuple[list[dict[str, Any]], int]:
    buckets: dict[str, dict[str, float]] = {}
    world_width_px = TILE_SIZE * 2**input_payload["zoom"]
    raw_count = 0

    for row in rows:
        raw_count += 1
        projected = project_lng_lat((float(row["longitude"]), float(row["latitude"])), input_payload["zoom"])
        relative_x = normalize_viewport_relative_world_x(
            projected["x"],
            input_payload["viewportNorthWestWorldPixel"]["x"],
            world_width_px,
        )
        bucket_x = math.floor(relative_x / input_payload["cellSizePx"])
        bucket_y = math.floor(
            (projected["y"] - input_payload["viewportNorthWestWorldPixel"]["y"])
            / input_payload["cellSizePx"],
        )
        bucket_key = f"{bucket_x}:{bucket_y}"
        bucket = buckets.get(bucket_key)

        if bucket is None:
            buckets[bucket_key] = {
                "count": 1,
                "sumRelativeX": relative_x,
                "sumY": projected["y"],
                "minAccuracy": float(row["accuracy"]),
                "startTimestampSeconds": float(row["timestampSeconds"]),
                "endTimestampSeconds": float(row["timestampSeconds"]),
            }
            continue

        bucket["count"] += 1
        bucket["sumRelativeX"] += relative_x
        bucket["sumY"] += projected["y"]
        bucket["minAccuracy"] = min(bucket["minAccuracy"], float(row["accuracy"]))
        bucket["startTimestampSeconds"] = min(
            bucket["startTimestampSeconds"],
            float(row["timestampSeconds"]),
        )
        bucket["endTimestampSeconds"] = max(
            bucket["endTimestampSeconds"],
            float(row["timestampSeconds"]),
        )

    return (
        [format_bucket(bucket_id, bucket, input_payload, world_width_px) for bucket_id, bucket in buckets.items()],
        raw_count,
    )


def format_bucket(
    bucket_id: str,
    bucket: dict[str, float],
    input_payload: dict[str, Any],
    world_width_px: float,
) -> dict[str, Any]:
    average_x = normalize_world_x(
        input_payload["viewportNorthWestWorldPixel"]["x"] + bucket["sumRelativeX"] / bucket["count"],
        world_width_px,
    )
    longitude, latitude = unproject_world_point(
        {
            "x": average_x,
            "y": bucket["sumY"] / bucket["count"],
        },
        input_payload["zoom"],
    )
    return {
        "id": bucket_id,
        "longitude": longitude,
        "latitude": latitude,
        "count": int(bucket["count"]),
        "minAccuracy": bucket["minAccuracy"],
        "startTimestampSeconds": int(bucket["startTimestampSeconds"]),
        "endTimestampSeconds": int(bucket["endTimestampSeconds"]),
    }


def normalize_snapshot_input(input_payload: dict[str, Any]) -> dict[str, Any]:
    cell_size_px = to_float(input_payload.get("cellSizePx"))
    end_timestamp_seconds = to_float(input_payload.get("timeRange", {}).get("endTimestampSeconds"))

    return {
        "timeRange": {
            "startTimestampSeconds": to_float(input_payload.get("timeRange", {}).get("startTimestampSeconds")),
            "endTimestampSeconds": end_timestamp_seconds
            if math.isfinite(end_timestamp_seconds)
            else OPEN_ENDED_TIMESTAMP_SECONDS,
            "dayCount": to_float(input_payload.get("timeRange", {}).get("dayCount")),
        },
        "zoom": to_float(input_payload.get("zoom")),
        "cellSizePx": cell_size_px if math.isfinite(cell_size_px) and cell_size_px > 0 else 0.5,
        "viewportBounds": {
            "west": to_float(input_payload.get("viewportBounds", {}).get("west")),
            "south": to_float(input_payload.get("viewportBounds", {}).get("south")),
            "east": to_float(input_payload.get("viewportBounds", {}).get("east")),
            "north": to_float(input_payload.get("viewportBounds", {}).get("north")),
        },
        "viewportNorthWestWorldPixel": {
            "x": to_float(input_payload.get("viewportNorthWestWorldPixel", {}).get("x")),
            "y": to_float(input_payload.get("viewportNorthWestWorldPixel", {}).get("y")),
        },
    }


def create_import_signature(
    data_path: Path,
    coordinate_system: str,
    admin_region_signature: str,
) -> str:
    return json.dumps(
        {
            "footprints": json.loads(create_source_signature(data_path, coordinate_system)),
            "adminRegions": json.loads(admin_region_signature),
        },
        separators=(",", ":"),
    )


def create_import_compatibility_signature(
    coordinate_system: str,
    admin_region_signature: str | None = None,
) -> str:
    return json.dumps(
        {
            "coordinateSystem": coordinate_system,
            "adminRegions": None if admin_region_signature is None else json.loads(admin_region_signature),
        },
        separators=(",", ":"),
    )


def create_source_signature(data_path: Path | None, coordinate_system: str) -> str:
    if data_path is None:
        return json.dumps(
            {
                "dataPath": None,
                "coordinateSystem": coordinate_system,
                "mtimeMs": 0,
                "size": 0,
            },
            separators=(",", ":"),
        )

    try:
        stat = data_path.resolve().stat()
        size = stat.st_size
        mtime_ms = stat.st_mtime * 1000
    except OSError:
        size = 0
        mtime_ms = 0

    return json.dumps(
        {
            "dataPath": str(data_path.resolve()),
            "coordinateSystem": coordinate_system,
            "mtimeMs": mtime_ms,
            "size": size,
        },
        separators=(",", ":"),
    )


def get_meta_value(connection: sqlite3.Connection, key: str) -> str | None:
    row = connection.execute("SELECT value FROM footprint_meta WHERE key = ?", (key,)).fetchone()
    return None if row is None else str(row["value"])


def get_footprint_row_count(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COUNT(*) AS count FROM footprints").fetchone()
    return int(row["count"])


def get_matched_footprint_row_count(connection: sqlite3.Connection) -> int:
    row = connection.execute(
        "SELECT COUNT(*) AS count FROM footprints WHERE region_id IS NOT NULL",
    ).fetchone()
    return int(row["count"])


def get_spatial_row_count(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COUNT(*) AS count FROM footprint_spatial").fetchone()
    return int(row["count"])


def get_admin_region_row_count(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COUNT(*) AS count FROM admin_regions").fetchone()
    return int(row["count"])


def get_unlocked_admin_region_row_count(connection: sqlite3.Connection) -> int:
    row = connection.execute(
        "SELECT COUNT(*) AS count FROM admin_regions WHERE footprint_count > 0",
    ).fetchone()
    return int(row["count"])


def set_meta_value(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO footprint_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def delete_meta_value(connection: sqlite3.Connection, key: str) -> None:
    connection.execute("DELETE FROM footprint_meta WHERE key = ?", (key,))


def project_lng_lat(lng_lat: tuple[float, float], zoom: float) -> dict[str, float]:
    longitude, latitude = lng_lat
    scale = TILE_SIZE * 2**zoom
    clamped_latitude = min(max(latitude, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE)
    sin_latitude = math.sin(clamped_latitude * math.pi / 180)

    return {
        "x": ((longitude + 180) / 360) * scale,
        "y": (0.5 - math.log((1 + sin_latitude) / (1 - sin_latitude)) / (4 * math.pi)) * scale,
    }


def unproject_world_point(point: dict[str, float], zoom: float) -> tuple[float, float]:
    scale = TILE_SIZE * 2**zoom
    longitude = point["x"] / scale * 360 - 180
    latitude_radians = math.atan(math.sinh(math.pi * (1 - 2 * point["y"] / scale)))
    return longitude, latitude_radians * 180 / math.pi


def normalize_viewport_relative_world_x(projected_x: float, origin_x: float, world_width_px: float) -> float:
    relative_x = projected_x - origin_x
    return relative_x + world_width_px if relative_x < 0 else relative_x


def normalize_world_x(x: float, world_width_px: float) -> float:
    normalized_x = x % world_width_px
    return normalized_x + world_width_px if normalized_x < 0 else normalized_x


def to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan
