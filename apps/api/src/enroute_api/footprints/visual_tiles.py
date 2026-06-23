from __future__ import annotations

import math
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from .visual_tile_codec import VisualCellRecord, decode_visual_cells, encode_visual_cells

TIME_BUCKET_ALL = 0
TIME_BUCKET_YEAR = 1
TIME_BUCKET_MONTH = 2
TIME_BUCKET_DAY = 3

STATUS_READY = 1
STATUS_DIRTY = 2

MVT_EXTENT = 4096
VISUAL_CELL_SIZE = 16
CELLS_PER_ROW = MVT_EXTENT // VISUAL_CELL_SIZE
MAX_MERCATOR_LATITUDE = 85.05112878
MAX_VISUAL_TILE_ZOOM = 18
SHANGHAI_UTC_OFFSET_SECONDS = 8 * 60 * 60


@dataclass(frozen=True)
class VisualTileBuildResult:
    bucket: str
    min_zoom: int
    max_zoom: int
    candidate_count: int
    built_count: int


@dataclass(frozen=True, order=True)
class VisualTileBuildCandidate:
    z: int
    x: int
    y: int
    t_type: int
    t: int
    start_timestamp_seconds: int
    end_timestamp_seconds: int


def build_visual_tile(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    t_type: int,
    t: int,
    start_timestamp_seconds: int,
    end_timestamp_seconds: int,
    updated_at: int,
) -> bool:
    west, south, east, north = tile_bounds(z=z, x=x, y=y)
    records_by_cell: dict[int, VisualCellRecord] = {}
    cursor = connection.execute(
        """
        SELECT f.timestamp_seconds, f.longitude, f.latitude
        FROM footprint_spatial s
        JOIN footprints f ON f.timestamp_seconds = s.footprint_rowid
        WHERE s.min_lng <= :east
          AND s.max_lng >= :west
          AND s.min_lat <= :north
          AND s.max_lat >= :south
          AND f.timestamp_seconds >= :start
          AND f.timestamp_seconds < :end
        ORDER BY f.timestamp_seconds ASC
        """,
        {
            "west": west,
            "south": south,
            "east": east,
            "north": north,
            "start": start_timestamp_seconds,
            "end": end_timestamp_seconds,
        },
    )

    for row in cursor:
        geom_x, geom_y = project_to_tile_geometry(
            longitude=float(get_row_value(row, "longitude", 1)),
            latitude=float(get_row_value(row, "latitude", 2)),
            z=z,
            x=x,
            y=y,
        )
        cell_x = min(geom_x // VISUAL_CELL_SIZE, CELLS_PER_ROW - 1)
        cell_y = min(geom_y // VISUAL_CELL_SIZE, CELLS_PER_ROW - 1)
        cell_id = cell_y * CELLS_PER_ROW + cell_x
        if cell_id in records_by_cell:
            continue
        records_by_cell[cell_id] = VisualCellRecord(
            cell_id=cell_id,
            footprint_id=int(get_row_value(row, "timestamp_seconds", 0)),
            geom_x=geom_x,
            geom_y=geom_y,
        )

    if not records_by_cell:
        delete_visual_tile(connection, z=z, x=x, y=y, t_type=t_type, t=t)
        return False

    records = list(records_by_cell.values())
    connection.execute(
        """
        INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(z, x, y, t_type, t) DO UPDATE SET
          status = excluded.status,
          cells = excluded.cells,
          updated_at = excluded.updated_at
        """,
        (z, x, y, t_type, t, STATUS_READY, encode_visual_cells(records), updated_at),
    )
    return True


def build_visual_tiles(
    connection: sqlite3.Connection,
    *,
    min_zoom: int = 0,
    max_zoom: int = MAX_VISUAL_TILE_ZOOM,
    bucket: str = "all",
    updated_at: int | None = None,
    commit_interval: int = 1000,
) -> VisualTileBuildResult:
    normalized_bucket = normalize_precompute_bucket(bucket)
    validate_zoom_range(min_zoom=min_zoom, max_zoom=max_zoom)
    resolved_updated_at = int(time.time()) if updated_at is None else updated_at

    candidates = enumerate_visual_tile_build_candidates(
        connection,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        bucket=normalized_bucket,
    )
    built_count = 0
    for index, candidate in enumerate(candidates, start=1):
        if build_visual_tile(
            connection,
            z=candidate.z,
            x=candidate.x,
            y=candidate.y,
            t_type=candidate.t_type,
            t=candidate.t,
            start_timestamp_seconds=candidate.start_timestamp_seconds,
            end_timestamp_seconds=candidate.end_timestamp_seconds,
            updated_at=resolved_updated_at,
        ):
            built_count += 1
        if commit_interval > 0 and index % commit_interval == 0:
            connection.commit()
    connection.commit()
    return VisualTileBuildResult(
        bucket=normalized_bucket,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(candidates),
        built_count=built_count,
    )


def enumerate_visual_tile_build_candidates(
    connection: sqlite3.Connection,
    *,
    min_zoom: int,
    max_zoom: int,
    bucket: str,
) -> list[VisualTileBuildCandidate]:
    timestamp_bounds = get_footprint_timestamp_bounds(connection)
    if timestamp_bounds is None:
        return []

    all_start, all_end = timestamp_bounds
    candidates: set[VisualTileBuildCandidate] = set()
    cursor = connection.execute(
        """
        SELECT timestamp_seconds, longitude, latitude
        FROM footprints
        ORDER BY timestamp_seconds ASC
        """,
    )
    for row in cursor:
        timestamp_seconds = int(get_row_value(row, "timestamp_seconds", 0))
        longitude = float(get_row_value(row, "longitude", 1))
        latitude = float(get_row_value(row, "latitude", 2))
        t_type, t, start_timestamp_seconds, end_timestamp_seconds = resolve_precompute_time_bucket(
            timestamp_seconds,
            bucket=bucket,
            all_start_timestamp_seconds=all_start,
            all_end_timestamp_seconds=all_end,
        )
        for z in range(min_zoom, max_zoom + 1):
            x, y = coordinate_to_tile(longitude=longitude, latitude=latitude, z=z)
            candidates.add(
                VisualTileBuildCandidate(
                    z=z,
                    x=x,
                    y=y,
                    t_type=t_type,
                    t=t,
                    start_timestamp_seconds=start_timestamp_seconds,
                    end_timestamp_seconds=end_timestamp_seconds,
                ),
            )

    return sorted(candidates)


def get_footprint_timestamp_bounds(connection: sqlite3.Connection) -> tuple[int, int] | None:
    row = connection.execute(
        """
        SELECT MIN(timestamp_seconds) AS min_timestamp, MAX(timestamp_seconds) AS max_timestamp
        FROM footprints
        """,
    ).fetchone()
    if row is None:
        return None

    min_timestamp = get_row_value(row, "min_timestamp", 0)
    max_timestamp = get_row_value(row, "max_timestamp", 1)
    if min_timestamp is None or max_timestamp is None:
        return None
    return int(min_timestamp), int(max_timestamp) + 1


def resolve_precompute_time_bucket(
    timestamp_seconds: int,
    *,
    bucket: str,
    all_start_timestamp_seconds: int,
    all_end_timestamp_seconds: int,
) -> tuple[int, int, int, int]:
    if bucket == "all":
        return (
            TIME_BUCKET_ALL,
            0,
            all_start_timestamp_seconds,
            all_end_timestamp_seconds,
        )

    local_date = shanghai_date_from_timestamp(timestamp_seconds)
    if bucket == "day":
        start = shanghai_date_start_timestamp_seconds(local_date.year, local_date.month, local_date.day)
        return TIME_BUCKET_DAY, encode_day(local_date), start, start + 86_400

    if bucket == "month":
        start = shanghai_date_start_timestamp_seconds(local_date.year, local_date.month, 1)
        if local_date.month == 12:
            end = shanghai_date_start_timestamp_seconds(local_date.year + 1, 1, 1)
        else:
            end = shanghai_date_start_timestamp_seconds(local_date.year, local_date.month + 1, 1)
        return TIME_BUCKET_MONTH, local_date.year * 100 + local_date.month, start, end

    start = shanghai_date_start_timestamp_seconds(local_date.year, 1, 1)
    end = shanghai_date_start_timestamp_seconds(local_date.year + 1, 1, 1)
    return TIME_BUCKET_YEAR, local_date.year, start, end


def normalize_precompute_bucket(bucket: str) -> str:
    normalized = bucket.strip().lower()
    if normalized not in {"all", "day", "month", "year"}:
        raise ValueError("bucket must be one of all, day, month, or year")
    return normalized


def validate_zoom_range(*, min_zoom: int, max_zoom: int) -> None:
    if min_zoom < 0:
        raise ValueError("min_zoom must be greater than or equal to 0")
    if max_zoom > MAX_VISUAL_TILE_ZOOM:
        raise ValueError(f"max_zoom must be less than or equal to {MAX_VISUAL_TILE_ZOOM}")
    if min_zoom > max_zoom:
        raise ValueError("min_zoom must be less than or equal to max_zoom")


def coordinate_to_tile(*, longitude: float, latitude: float, z: int) -> tuple[int, int]:
    scale = 2**z
    clamped_longitude = min(max(longitude, -180.0), 180.0)
    clamped_latitude = min(max(latitude, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE)
    sin_latitude = math.sin(math.radians(clamped_latitude))
    tile_x = math.floor(((clamped_longitude + 180.0) / 360.0) * scale)
    tile_y = math.floor(
        (0.5 - math.log((1.0 + sin_latitude) / (1.0 - sin_latitude)) / (4.0 * math.pi))
        * scale,
    )
    max_tile = scale - 1
    return min(max(tile_x, 0), max_tile), min(max(tile_y, 0), max_tile)


def mark_visual_tile_dirty(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    t_type: int,
    t: int,
    updated_at: int,
) -> None:
    connection.execute(
        """
        UPDATE visual_tiles
        SET status = ?, updated_at = ?
        WHERE z = ? AND x = ? AND y = ? AND t_type = ? AND t = ?
        """,
        (STATUS_DIRTY, updated_at, z, x, y, t_type, t),
    )


def delete_visual_tile(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    t_type: int,
    t: int,
) -> None:
    connection.execute(
        """
        DELETE FROM visual_tiles
        WHERE z = ? AND x = ? AND y = ? AND t_type = ? AND t = ?
        """,
        (z, x, y, t_type, t),
    )


def split_time_range_into_buckets(start_date: str, end_date: str) -> list[tuple[int, int]]:
    current = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if current > end:
        return []

    buckets: list[tuple[int, int]] = []
    while current <= end:
        if current.month == 1 and current.day == 1:
            year_end = date(current.year, 12, 31)
            if year_end <= end:
                buckets.append((TIME_BUCKET_YEAR, current.year))
                current = year_end + timedelta(days=1)
                continue

        if current.day == 1:
            month_end = last_day_of_month(current)
            if month_end <= end:
                buckets.append((TIME_BUCKET_MONTH, current.year * 100 + current.month))
                current = month_end + timedelta(days=1)
                continue

        buckets.append((TIME_BUCKET_DAY, encode_day(current)))
        current += timedelta(days=1)

    return buckets


def resolve_time_buckets(
    *,
    range_value: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[tuple[int, int]]:
    if (range_value or "").strip().lower() == "all":
        return [(TIME_BUCKET_ALL, 0)]
    if start_date and end_date:
        return split_time_range_into_buckets(start_date, end_date)
    return [(TIME_BUCKET_ALL, 0)]


def read_visual_tile_records(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    buckets: list[tuple[int, int]],
) -> list[VisualCellRecord]:
    records_by_cell: dict[int, VisualCellRecord] = {}
    for t_type, t in buckets:
        row = connection.execute(
            """
            SELECT cells
            FROM visual_tiles
            WHERE z = ? AND x = ? AND y = ? AND t_type = ? AND t = ?
              AND status IN (?, ?)
              AND cells IS NOT NULL
            """,
            (z, x, y, t_type, t, STATUS_READY, STATUS_DIRTY),
        ).fetchone()
        if row is None:
            continue

        cells = row["cells"] if isinstance(row, sqlite3.Row) else row[0]
        for record in decode_visual_cells(cells):
            records_by_cell.setdefault(record.cell_id, record)
    return list(records_by_cell.values())


def last_day_of_month(value: date) -> date:
    if value.month == 12:
        return date(value.year, 12, 31)
    return date(value.year, value.month + 1, 1) - timedelta(days=1)


def encode_day(value: date) -> int:
    return value.year * 10000 + value.month * 100 + value.day


def shanghai_date_from_timestamp(timestamp_seconds: int) -> date:
    return datetime.fromtimestamp(
        timestamp_seconds + SHANGHAI_UTC_OFFSET_SECONDS,
        tz=timezone.utc,
    ).date()


def shanghai_date_start_timestamp_seconds(year: int, month: int, day: int) -> int:
    return (
        int(datetime(year, month, day, tzinfo=timezone.utc).timestamp())
        - SHANGHAI_UTC_OFFSET_SECONDS
    )


def tile_bounds(*, z: int, x: int, y: int) -> tuple[float, float, float, float]:
    west = tile_x_to_longitude(x, z)
    east = tile_x_to_longitude(x + 1, z)
    north = tile_y_to_latitude(y, z)
    south = tile_y_to_latitude(y + 1, z)
    return west, south, east, north


def project_to_tile_geometry(
    *,
    longitude: float,
    latitude: float,
    z: int,
    x: int,
    y: int,
) -> tuple[int, int]:
    scale = 2**z
    clamped_latitude = min(max(latitude, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE)
    sin_latitude = math.sin(math.radians(clamped_latitude))
    tile_x = ((longitude + 180.0) / 360.0) * scale
    tile_y = (0.5 - math.log((1.0 + sin_latitude) / (1.0 - sin_latitude)) / (4.0 * math.pi)) * scale
    geom_x = math.floor((tile_x - x) * MVT_EXTENT)
    geom_y = math.floor((tile_y - y) * MVT_EXTENT)
    return clamp_geometry_coordinate(geom_x), clamp_geometry_coordinate(geom_y)


def clamp_geometry_coordinate(value: int) -> int:
    return min(max(value, 0), MVT_EXTENT)


def get_row_value(row: sqlite3.Row | tuple[object, ...], key: str, index: int) -> object:
    if isinstance(row, sqlite3.Row):
        return row[key]
    return row[index]


def tile_x_to_longitude(x: int, z: int) -> float:
    return x / 2**z * 360.0 - 180.0


def tile_y_to_latitude(y: int, z: int) -> float:
    n = math.pi - 2.0 * math.pi * y / 2**z
    return math.degrees(math.atan(math.sinh(n)))
