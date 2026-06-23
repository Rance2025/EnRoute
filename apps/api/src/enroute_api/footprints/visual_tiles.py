from __future__ import annotations

import math
import sqlite3
from datetime import date, timedelta

from .visual_tile_codec import VisualCellRecord, encode_visual_cells

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
) -> None:
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
            longitude=float(row["longitude"]),
            latitude=float(row["latitude"]),
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
            footprint_id=int(row["timestamp_seconds"]),
            geom_x=geom_x,
            geom_y=geom_y,
        )

    if not records_by_cell:
        delete_visual_tile(connection, z=z, x=x, y=y, t_type=t_type, t=t)
        return

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


def last_day_of_month(value: date) -> date:
    if value.month == 12:
        return date(value.year, 12, 31)
    return date(value.year, value.month + 1, 1) - timedelta(days=1)


def encode_day(value: date) -> int:
    return value.year * 10000 + value.month * 100 + value.day


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


def tile_x_to_longitude(x: int, z: int) -> float:
    return x / 2**z * 360.0 - 180.0


def tile_y_to_latitude(y: int, z: int) -> float:
    n = math.pi - 2.0 * math.pi * y / 2**z
    return math.degrees(math.atan(math.sinh(n)))
