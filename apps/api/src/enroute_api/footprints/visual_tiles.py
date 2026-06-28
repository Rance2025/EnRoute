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
VISUAL_CELL_SIZE = 4
CELLS_PER_ROW = MVT_EXTENT // VISUAL_CELL_SIZE
VISUAL_TILE_ALGORITHM_SIGNATURE_KEY = "visualTileAlgorithmSignature"
VISUAL_TILE_ALGORITHM_SIGNATURE = f"mvt_extent={MVT_EXTENT};cell_size={VISUAL_CELL_SIZE}"
MAX_MERCATOR_LATITUDE = 85.05112878
MAX_VISUAL_TILE_ZOOM = 16
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


@dataclass(frozen=True)
class VisualTileReadResult:
    records: list[VisualCellRecord]
    dirty_buckets: list[tuple[int, int]]


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
    max_tile = 2**z - 1
    records_by_cell: dict[int, VisualCellRecord] = {}
    raw_count = 0
    cursor = connection.execute(
        """
        SELECT f.timestamp_seconds, f.longitude, f.latitude
        FROM footprint_spatial s
        JOIN footprints f ON f.timestamp_seconds = s.footprint_rowid
        WHERE (:is_last_x OR s.min_lng < :east)
          AND s.max_lng >= :west
          AND s.min_lat <= :north
          AND (:is_last_y OR s.max_lat > :south)
          AND f.timestamp_seconds >= :start
          AND f.timestamp_seconds < :end
        ORDER BY f.timestamp_seconds ASC
        """,
        {
            "west": west,
            "south": south,
            "east": east,
            "north": north,
            "is_last_x": int(x == max_tile),
            "is_last_y": int(y == max_tile),
            "start": start_timestamp_seconds,
            "end": end_timestamp_seconds,
        },
    )

    for row in cursor:
        raw_count += 1
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
        INSERT INTO visual_tiles (
          z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(z, x, y, t_type, t) DO UPDATE SET
          status = excluded.status,
          cells = excluded.cells,
          raw_count = excluded.raw_count,
          representative_count = excluded.representative_count,
          updated_at = excluded.updated_at
        """,
        (z, x, y, t_type, t, STATUS_READY, encode_visual_cells(records), raw_count, len(records), updated_at),
    )
    return True


def build_visual_tiles(
    connection: sqlite3.Connection,
    *,
    min_zoom: int = 0,
    max_zoom: int = MAX_VISUAL_TILE_ZOOM,
    bucket: str = "all,day,month,year",
    updated_at: int | None = None,
    commit_interval: int = 1000,
) -> VisualTileBuildResult:
    normalized_buckets = normalize_precompute_buckets(bucket)
    validate_zoom_range(min_zoom=min_zoom, max_zoom=max_zoom)
    resolved_updated_at = int(time.time() * 1000) if updated_at is None else updated_at
    bucket_count = 0
    candidate_count = 0
    built_count = 0
    timestamp_bounds = get_footprint_timestamp_bounds(connection)
    if timestamp_bounds is None:
        return VisualTileBuildResult(
            bucket=",".join(normalized_buckets),
            min_zoom=min_zoom,
            max_zoom=max_zoom,
            candidate_count=0,
            built_count=0,
        )

    for normalized_bucket in normalized_buckets:
        for z in range(min_zoom, max_zoom + 1):
            result_count = build_visual_tiles_for_zoom_and_bucket(
                connection,
                z=z,
                bucket=normalized_bucket,
                timestamp_bounds=timestamp_bounds,
                updated_at=resolved_updated_at,
                commit_interval=commit_interval,
            )
            bucket_count += result_count
            candidate_count += result_count
            built_count += result_count
    set_visual_tile_algorithm_signature(connection)
    connection.commit()
    return VisualTileBuildResult(
        bucket=",".join(normalized_buckets),
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=candidate_count,
        built_count=built_count,
    )


def build_visual_tiles_for_zoom_and_bucket(
    connection: sqlite3.Connection,
    *,
    z: int,
    bucket: str,
    timestamp_bounds: tuple[int, int],
    updated_at: int,
    commit_interval: int,
) -> int:
    all_start, all_end = timestamp_bounds
    t_type = precompute_bucket_type(bucket)
    raw_count_by_tile: dict[tuple[int, int, int, int], int] = {}
    records_by_tile: dict[tuple[int, int, int, int], dict[int, VisualCellRecord]] = {}
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
        resolved_t_type, t, _, _ = resolve_precompute_time_bucket(
            timestamp_seconds,
            bucket=bucket,
            all_start_timestamp_seconds=all_start,
            all_end_timestamp_seconds=all_end,
        )
        x, y = coordinate_to_tile(longitude=longitude, latitude=latitude, z=z)
        geom_x, geom_y = project_to_tile_geometry(
            longitude=longitude,
            latitude=latitude,
            z=z,
            x=x,
            y=y,
        )
        cell_x = min(geom_x // VISUAL_CELL_SIZE, CELLS_PER_ROW - 1)
        cell_y = min(geom_y // VISUAL_CELL_SIZE, CELLS_PER_ROW - 1)
        cell_id = cell_y * CELLS_PER_ROW + cell_x
        tile_key = (x, y, resolved_t_type, t)
        raw_count_by_tile[tile_key] = raw_count_by_tile.get(tile_key, 0) + 1
        records_by_cell = records_by_tile.setdefault(tile_key, {})
        if cell_id in records_by_cell:
            continue
        records_by_cell[cell_id] = VisualCellRecord(
            cell_id=cell_id,
            footprint_id=timestamp_seconds,
            geom_x=geom_x,
            geom_y=geom_y,
        )

    connection.execute("DELETE FROM visual_tiles WHERE z = ? AND t_type = ?", (z, t_type))
    built_count = 0
    for (x, y, resolved_t_type, t), records_by_cell in sorted(records_by_tile.items()):
        connection.execute(
            """
            INSERT INTO visual_tiles (
              z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                z,
                x,
                y,
                resolved_t_type,
                t,
                STATUS_READY,
                encode_visual_cells(records_by_cell.values()),
                raw_count_by_tile[(x, y, resolved_t_type, t)],
                len(records_by_cell),
                updated_at,
            ),
        )
        built_count += 1
        if commit_interval > 0 and built_count % commit_interval == 0:
            connection.commit()

    return built_count


def backfill_visual_tile_counts(connection: sqlite3.Connection, *, commit_interval: int = 1000) -> int:
    updated_count = 0
    timestamp_bounds = get_footprint_timestamp_bounds(connection)
    if timestamp_bounds is None:
        return 0

    count_groups = connection.execute(
        """
        SELECT DISTINCT z, t_type
        FROM visual_tiles
        WHERE cells IS NOT NULL
        ORDER BY z, t_type
        """,
    ).fetchall()
    raw_counts: dict[tuple[int, int, int, int, int], int] = {}
    for row in count_groups:
        raw_counts.update(
            count_raw_footprints_for_visual_tile_group(
                connection,
                z=int(get_row_value(row, "z", 0)),
                t_type=int(get_row_value(row, "t_type", 1)),
                timestamp_bounds=timestamp_bounds,
            ),
        )

    rows = connection.execute(
        """
        SELECT z, x, y, t_type, t, cells
        FROM visual_tiles
        WHERE cells IS NOT NULL
        ORDER BY z, x, y, t_type, t
        """,
    ).fetchall()

    for row in rows:
        z = int(get_row_value(row, "z", 0))
        x = int(get_row_value(row, "x", 1))
        y = int(get_row_value(row, "y", 2))
        t_type = int(get_row_value(row, "t_type", 3))
        t = int(get_row_value(row, "t", 4))
        cells = get_row_value(row, "cells", 5)
        raw_count = raw_counts.get((z, x, y, t_type, t), 0)
        representative_count = len(decode_visual_cells(cells))
        connection.execute(
            """
            UPDATE visual_tiles
            SET raw_count = ?, representative_count = ?
            WHERE z = ? AND x = ? AND y = ? AND t_type = ? AND t = ?
            """,
            (raw_count, representative_count, z, x, y, t_type, t),
        )
        updated_count += 1
        if commit_interval > 0 and updated_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return updated_count


def count_raw_footprints_for_visual_tile_group(
    connection: sqlite3.Connection,
    *,
    z: int,
    t_type: int,
    timestamp_bounds: tuple[int, int],
) -> dict[tuple[int, int, int, int, int], int]:
    all_start, all_end = timestamp_bounds
    raw_counts: dict[tuple[int, int, int, int, int], int] = {}
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
        bucket = precompute_bucket_name(t_type)
        if bucket is None:
            continue
        resolved_t_type, t, _, _ = resolve_precompute_time_bucket(
            timestamp_seconds,
            bucket=bucket,
            all_start_timestamp_seconds=all_start,
            all_end_timestamp_seconds=all_end,
        )
        x, y = coordinate_to_tile(longitude=longitude, latitude=latitude, z=z)
        tile_key = (z, x, y, resolved_t_type, t)
        raw_counts[tile_key] = raw_counts.get(tile_key, 0) + 1

    return raw_counts


def count_raw_footprints_for_visual_tile(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    t_type: int,
    t: int,
) -> int:
    time_bounds = resolve_precomputed_bucket_bounds(connection, t_type=t_type, t=t)
    if time_bounds is None:
        return 0

    start_timestamp_seconds, end_timestamp_seconds = time_bounds
    west, south, east, north = tile_bounds(z=z, x=x, y=y)
    max_tile = 2**z - 1
    row = connection.execute(
        """
        SELECT COUNT(*) AS count
        FROM footprint_spatial s
        JOIN footprints f ON f.timestamp_seconds = s.footprint_rowid
        WHERE (:is_last_x OR s.min_lng < :east)
          AND s.max_lng >= :west
          AND s.min_lat <= :north
          AND (:is_last_y OR s.max_lat > :south)
          AND f.timestamp_seconds >= :start
          AND f.timestamp_seconds < :end
        """,
        {
            "west": west,
            "south": south,
            "east": east,
            "north": north,
            "is_last_x": int(x == max_tile),
            "is_last_y": int(y == max_tile),
            "start": start_timestamp_seconds,
            "end": end_timestamp_seconds,
        },
    ).fetchone()
    return int(get_row_value(row, "count", 0))


def precompute_bucket_name(t_type: int) -> str | None:
    if t_type == TIME_BUCKET_ALL:
        return "all"
    if t_type == TIME_BUCKET_DAY:
        return "day"
    if t_type == TIME_BUCKET_MONTH:
        return "month"
    if t_type == TIME_BUCKET_YEAR:
        return "year"
    return None


def resolve_precomputed_bucket_bounds(
    connection: sqlite3.Connection,
    *,
    t_type: int,
    t: int,
) -> tuple[int, int] | None:
    if t_type == TIME_BUCKET_ALL:
        return get_footprint_timestamp_bounds(connection)
    if t_type == TIME_BUCKET_DAY:
        year = t // 10_000
        month = (t // 100) % 100
        day = t % 100
        start = shanghai_date_start_timestamp_seconds(year, month, day)
        return start, start + 86_400
    if t_type == TIME_BUCKET_MONTH:
        year = t // 100
        month = t % 100
        start = shanghai_date_start_timestamp_seconds(year, month, 1)
        if month == 12:
            end = shanghai_date_start_timestamp_seconds(year + 1, 1, 1)
        else:
            end = shanghai_date_start_timestamp_seconds(year, month + 1, 1)
        return start, end
    if t_type == TIME_BUCKET_YEAR:
        start = shanghai_date_start_timestamp_seconds(t, 1, 1)
        end = shanghai_date_start_timestamp_seconds(t + 1, 1, 1)
        return start, end
    return None


def set_visual_tile_algorithm_signature(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT INTO footprint_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (VISUAL_TILE_ALGORITHM_SIGNATURE_KEY, VISUAL_TILE_ALGORITHM_SIGNATURE),
    )


def enumerate_visual_tile_build_candidates(
    connection: sqlite3.Connection,
    *,
    z: int,
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


def precompute_bucket_type(bucket: str) -> int:
    if bucket == "all":
        return TIME_BUCKET_ALL
    if bucket == "day":
        return TIME_BUCKET_DAY
    if bucket == "month":
        return TIME_BUCKET_MONTH
    return TIME_BUCKET_YEAR


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


def normalize_precompute_buckets(bucket: str) -> list[str]:
    normalized_buckets: list[str] = []
    for raw_bucket in bucket.split(","):
        normalized_bucket = normalize_precompute_bucket(raw_bucket)
        if normalized_bucket not in normalized_buckets:
            normalized_buckets.append(normalized_bucket)
    return normalized_buckets


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
) -> VisualTileReadResult:
    records_by_cell: dict[int, VisualCellRecord] = {}
    dirty_buckets: list[tuple[int, int]] = []
    for t_type, t in buckets:
        row = connection.execute(
            """
            SELECT status, cells
            FROM visual_tiles
            WHERE z = ? AND x = ? AND y = ? AND t_type = ? AND t = ?
              AND status IN (?, ?)
              AND cells IS NOT NULL
            """,
            (z, x, y, t_type, t, STATUS_READY, STATUS_DIRTY),
        ).fetchone()
        if row is None:
            continue

        status = int(get_row_value(row, "status", 0))
        cells = get_row_value(row, "cells", 1)
        for record in decode_visual_cells(cells):
            records_by_cell.setdefault(record.cell_id, record)
        if status == STATUS_DIRTY:
            dirty_buckets.append((t_type, t))

    return VisualTileReadResult(
        records=list(records_by_cell.values()),
        dirty_buckets=dirty_buckets,
    )


def summarize_visual_tiles_for_viewport(
    connection: sqlite3.Connection,
    *,
    z: int,
    west: float,
    south: float,
    east: float,
    north: float,
    buckets: list[tuple[int, int]],
) -> dict[str, int | float]:
    tile_keys = enumerate_visual_tile_keys_for_viewport(
        z=z,
        west=west,
        south=south,
        east=east,
        north=north,
    )
    return summarize_visual_tile_keys(
        connection,
        z=z,
        tile_keys=tile_keys,
        buckets=buckets,
    )


def summarize_visual_tile_keys(
    connection: sqlite3.Connection,
    *,
    z: int,
    tile_keys: list[tuple[int, int]],
    buckets: list[tuple[int, int]],
) -> dict[str, int | float]:
    raw_count = 0
    ready_tile_count = 0
    dirty_tile_count = 0
    populated_tiles: set[tuple[int, int]] = set()
    representative_cells_by_tile: dict[tuple[int, int], set[int]] = {}

    for x, y in tile_keys:
        for t_type, t in buckets:
            row = connection.execute(
                """
                SELECT status, cells, raw_count, representative_count
                FROM visual_tiles
                WHERE z = ? AND x = ? AND y = ? AND t_type = ? AND t = ?
                  AND status IN (?, ?)
                  AND cells IS NOT NULL
                """,
                (z, x, y, t_type, t, STATUS_READY, STATUS_DIRTY),
            ).fetchone()
            if row is None:
                continue

            populated_tiles.add((x, y))
            status = int(get_row_value(row, "status", 0))
            if status == STATUS_READY:
                ready_tile_count += 1
            elif status == STATUS_DIRTY:
                dirty_tile_count += 1

            raw_count += int(get_row_value(row, "raw_count", 2) or 0)
            cells = get_row_value(row, "cells", 1)
            representative_cells = representative_cells_by_tile.setdefault((x, y), set())
            for record in decode_visual_cells(cells):
                representative_cells.add(record.cell_id)

    representative_count = sum(len(cells) for cells in representative_cells_by_tile.values())
    return {
        "tileZoom": z,
        "requestedTileCount": len(tile_keys),
        "populatedTileCount": len(populated_tiles),
        "readyTileCount": ready_tile_count,
        "dirtyTileCount": dirty_tile_count,
        "rawCount": raw_count,
        "representativeCount": representative_count,
        "renderRatio": 0 if raw_count == 0 else representative_count / raw_count,
    }


def enumerate_visual_tile_keys_for_viewport(
    *,
    z: int,
    west: float,
    south: float,
    east: float,
    north: float,
) -> list[tuple[int, int]]:
    if z < 0:
        return []

    scale = 2**z
    if z <= 1:
        return [(x, y) for y in range(scale) for x in range(scale)]

    north_tile = coordinate_to_tile(longitude=0, latitude=max(north, south), z=z)[1]
    south_tile = coordinate_to_tile(longitude=0, latitude=min(north, south), z=z)[1]
    y_values = range(min(north_tile, south_tile), max(north_tile, south_tile) + 1)

    x_values: set[int] = set()
    if viewport_covers_full_world(west=west, east=east):
        x_values.update(range(scale))
    else:
        for segment_west, segment_east in split_longitude_viewport(west=west, east=east):
            west_tile = coordinate_to_tile(longitude=segment_west, latitude=0, z=z)[0]
            east_tile = coordinate_to_tile(longitude=segment_east, latitude=0, z=z)[0]
            x_values.update(range(min(west_tile, east_tile), max(west_tile, east_tile) + 1))

    return sorted((x, y) for y in y_values for x in x_values)


def viewport_covers_full_world(*, west: float, east: float) -> bool:
    return abs(east - west) >= 360


def split_longitude_viewport(*, west: float, east: float) -> list[tuple[float, float]]:
    normalized_west = normalize_longitude(west)
    normalized_east = normalize_longitude(east)
    if normalized_east < normalized_west:
        return [(normalized_west, 180), (-180, normalized_east)]
    return [(normalized_west, normalized_east)]


def normalize_longitude(value: float) -> float:
    normalized = ((value + 180) % 360) - 180
    if normalized == -180 and value > 0:
        return 180
    return normalized


def rebuild_dirty_visual_tiles(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    buckets: list[tuple[int, int]],
) -> None:
    if not buckets:
        return

    updated_at = int(time.time() * 1000)
    for t_type, t in buckets:
        time_range = resolve_bucket_timestamp_range(connection, t_type=t_type, t=t)
        if time_range is None:
            delete_visual_tile(connection, z=z, x=x, y=y, t_type=t_type, t=t)
            continue

        start_timestamp_seconds, end_timestamp_seconds = time_range
        build_visual_tile(
            connection,
            z=z,
            x=x,
            y=y,
            t_type=t_type,
            t=t,
            start_timestamp_seconds=start_timestamp_seconds,
            end_timestamp_seconds=end_timestamp_seconds,
            updated_at=updated_at,
        )
    connection.commit()


def resolve_bucket_timestamp_range(
    connection: sqlite3.Connection,
    *,
    t_type: int,
    t: int,
) -> tuple[int, int] | None:
    if t_type == TIME_BUCKET_ALL and t == 0:
        return get_footprint_timestamp_bounds(connection)

    if t_type == TIME_BUCKET_YEAR:
        return (
            shanghai_date_start_timestamp_seconds(t, 1, 1),
            shanghai_date_start_timestamp_seconds(t + 1, 1, 1),
        )

    if t_type == TIME_BUCKET_MONTH:
        year = t // 100
        month = t % 100
        if month < 1 or month > 12:
            return None
        if month == 12:
            return (
                shanghai_date_start_timestamp_seconds(year, 12, 1),
                shanghai_date_start_timestamp_seconds(year + 1, 1, 1),
            )
        return (
            shanghai_date_start_timestamp_seconds(year, month, 1),
            shanghai_date_start_timestamp_seconds(year, month + 1, 1),
        )

    if t_type == TIME_BUCKET_DAY:
        year = t // 10000
        month = (t // 100) % 100
        day = t % 100
        try:
            return (
                shanghai_date_start_timestamp_seconds(year, month, day),
                shanghai_date_start_timestamp_seconds(year, month, day) + 86_400,
            )
        except ValueError:
            return None

    return None


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
