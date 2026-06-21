from __future__ import annotations

import json
import math
import sqlite3
from pathlib import Path
from typing import Any, Iterable, TypedDict

from enroute_api.admin_regions.store import (
    find_finest_region_id,
    get_region_chain,
    get_region_levels,
    initialize_admin_region_schema,
    load_admin_regions,
)

from .csv_loader import iter_footprint_points

TILE_SIZE = 256
MAX_MERCATOR_LATITUDE = 85.05112878
OPEN_ENDED_TIMESTAMP_SECONDS = 8_640_000_000_000
ADMIN_REGION_LOADER_VERSION = "admin-regions-v2"


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
        self.connection = sqlite3.connect(self.db_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        initialize_schema(self.connection)

    def ensure_ready(self) -> None:
        self.import_footprints()

    def import_footprints(self) -> FootprintImportResult:
        return ensure_imported(
            self.connection,
            data_path=self.data_path,
            coordinate_system=self.coordinate_system,
            admin_region_data_path=self.admin_region_data_path,
        )

    def get_snapshot(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        self.ensure_ready()
        return query_snapshot(self.connection, normalize_snapshot_input(input_payload))

    def get_all_points(self) -> dict[str, list[dict[str, Any]]]:
        self.ensure_ready()
        return query_all_points(self.connection)

    def close(self) -> None:
        self.connection.close()


def initialize_schema(connection: sqlite3.Connection) -> None:
    initialize_admin_region_schema(connection)
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
        """,
    )
    connection.commit()


def migrate_legacy_footprints_schema(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'footprints'",
    ).fetchone()
    if row is None:
        return

    columns = [column[1] for column in connection.execute("PRAGMA table_info(footprints)")]
    if columns == [
        "timestamp_seconds",
        "longitude",
        "latitude",
        "accuracy",
        "speed",
        "distance",
        "heading",
        "altitude",
        "region_id",
    ]:
        return

    connection.executescript(
        """
        DROP TABLE IF EXISTS footprint_spatial;
        DROP TABLE IF EXISTS footprints;
        DELETE FROM footprint_meta;
        UPDATE admin_regions
        SET first_seen_timestamp = NULL,
            footprint_count = 0,
            stay_duration_seconds = 0,
            travel_distance_meters = 0;
        """,
    )


def ensure_imported(
    connection: sqlite3.Connection,
    *,
    data_path: Path,
    coordinate_system: str,
    admin_region_data_path: Path | None = None,
) -> FootprintImportResult:
    return import_footprints(
        connection,
        data_path=data_path,
        coordinate_system=coordinate_system,
        admin_region_data_path=admin_region_data_path,
    )


def import_footprints(
    connection: sqlite3.Connection,
    *,
    data_path: Path,
    coordinate_system: str,
    admin_region_data_path: Path | None = None,
) -> FootprintImportResult:
    region_signature = load_admin_region_data_if_available(connection, admin_region_data_path)
    source_signature = create_import_signature(data_path, coordinate_system, region_signature)
    compatibility_signature = create_import_compatibility_signature(coordinate_system, region_signature)
    stored_signature = get_meta_value(connection, "sourceSignature")
    stored_compatibility_signature = get_meta_value(connection, "importCompatibilitySignature")
    stored_count = get_footprint_row_count(connection)
    stored_spatial_count = get_spatial_row_count(connection)

    if stored_signature == source_signature and stored_count > 0 and stored_spatial_count == stored_count:
        return get_import_result(connection, new_count=0)
    if not data_path.exists() and stored_count > 0 and stored_spatial_count == stored_count:
        return get_import_result(connection, new_count=0)

    if stored_compatibility_signature is None and stored_count > 0:
        stored_compatibility_signature = compatibility_signature

    if stored_compatibility_signature != compatibility_signature:
        clear_imported_footprints(connection)
        stored_count = 0

    with connection:
        new_count = 0
        for point in iter_footprint_points(data_path=data_path, coordinate_system=coordinate_system):
            if insert_footprint_if_new(connection, point):
                new_count += 1

        set_meta_value(connection, "sourceSignature", source_signature)
        set_meta_value(connection, "importCompatibilitySignature", compatibility_signature)
        set_meta_value(connection, "rowCount", str(stored_count + new_count))

    return get_import_result(connection, new_count=new_count)


def insert_footprint_if_new(connection: sqlite3.Connection, point: dict[str, Any]) -> bool:
    region_id = find_finest_region_id(
        connection,
        longitude=float(point["longitude"]),
        latitude=float(point["latitude"]),
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
    return signature


def clear_imported_footprints(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DELETE FROM footprint_spatial;
        DELETE FROM footprints;
        DELETE FROM footprint_meta WHERE key IN ('sourceSignature', 'rowCount');
        UPDATE admin_regions
        SET first_seen_timestamp = NULL,
            footprint_count = 0,
            stay_duration_seconds = 0,
            travel_distance_meters = 0;
        """,
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


def query_metrics(connection: sqlite3.Connection, input_payload: dict[str, Any]) -> dict[str, float]:
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
        / max(input_payload["timeRange"]["dayCount"], 1),
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


def create_import_compatibility_signature(coordinate_system: str, admin_region_signature: str) -> str:
    return json.dumps(
        {
            "coordinateSystem": coordinate_system,
            "adminRegions": json.loads(admin_region_signature),
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
