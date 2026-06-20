from __future__ import annotations

import json
import math
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from .csv_loader import iter_footprint_points, load_footprint_payload

TILE_SIZE = 256
MAX_MERCATOR_LATITUDE = 85.05112878
OPEN_ENDED_TIMESTAMP_SECONDS = 8_640_000_000_000


class FootprintStore:
    def __init__(
        self,
        *,
        db_path: str | Path,
        data_path: str | Path,
        coordinate_system: str,
    ) -> None:
        self.db_path = Path(db_path)
        self.data_path = Path(data_path)
        self.coordinate_system = coordinate_system
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        initialize_schema(self.connection)

    def get_snapshot(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        ensure_imported(
            self.connection,
            data_path=self.data_path,
            coordinate_system=self.coordinate_system,
        )
        return query_snapshot(self.connection, normalize_snapshot_input(input_payload))


def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS footprint_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS footprints (
          id TEXT PRIMARY KEY,
          timestamp_seconds INTEGER NOT NULL,
          longitude REAL NOT NULL,
          latitude REAL NOT NULL,
          accuracy REAL NOT NULL,
          speed REAL NOT NULL,
          distance REAL NOT NULL,
          heading REAL NOT NULL,
          altitude REAL NOT NULL,
          loc_type REAL NOT NULL,
          is_back_foreground REAL NOT NULL,
          step_type REAL NOT NULL
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


def ensure_imported(
    connection: sqlite3.Connection,
    *,
    data_path: Path,
    coordinate_system: str,
) -> None:
    source_signature = create_source_signature(data_path, coordinate_system)
    stored_signature = get_meta_value(connection, "sourceSignature")
    stored_count = int(get_meta_value(connection, "rowCount") or 0)
    stored_spatial_count = get_spatial_row_count(connection)

    if stored_signature == source_signature and stored_count > 0 and stored_spatial_count == stored_count:
        return

    with connection:
        connection.execute("DELETE FROM footprint_spatial")
        connection.execute("DELETE FROM footprints")

        imported_count = 0
        for point in iter_footprint_points(data_path=data_path, coordinate_system=coordinate_system):
            cursor = connection.execute(
                """
                INSERT INTO footprints (
                  id,
                  timestamp_seconds,
                  longitude,
                  latitude,
                  accuracy,
                  speed,
                  distance,
                  heading,
                  altitude,
                  loc_type,
                  is_back_foreground,
                  step_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    point["id"],
                    point["timestampSeconds"],
                    point["longitude"],
                    point["latitude"],
                    point["accuracy"],
                    point["speed"],
                    point["distance"],
                    point["heading"],
                    point["altitude"],
                    point["locType"],
                    point["isBackForeground"],
                    point["stepType"],
                ),
            )
            rowid = cursor.lastrowid
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
                    rowid,
                    point["longitude"],
                    point["longitude"],
                    point["latitude"],
                    point["latitude"],
                ),
            )
            imported_count += 1

        set_meta_value(connection, "sourceSignature", source_signature)
        set_meta_value(connection, "rowCount", str(imported_count))


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
          f.id,
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


def create_source_signature(data_path: Path, coordinate_system: str) -> str:
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


def get_spatial_row_count(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COUNT(*) AS count FROM footprint_spatial").fetchone()
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
