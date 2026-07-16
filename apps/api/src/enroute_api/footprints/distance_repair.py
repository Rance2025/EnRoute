from __future__ import annotations

import hashlib
import math
import sqlite3
from dataclasses import dataclass

from enroute_api.admin_regions.precompute import (
    build_admin_region_daily_stat_rows,
    replace_admin_region_daily_stats,
)

from .distance import (
    FootprintDistancePoint,
    normalize_daily_first_distance,
    shanghai_date,
)
from .store import rebuild_admin_region_stats_from_footprints


class DailyFirstDistanceRepairError(RuntimeError):
    pass


@dataclass(frozen=True)
class DailyFirstDistanceRepairResult:
    scanned_count: int
    candidate_count: int
    updated_count: int
    added_distance_meters: float


@dataclass(frozen=True)
class ProtectedTableSnapshot:
    footprint_count: int
    spatial_count: int
    visual_tile_count: int
    visual_tile_sha256: str


def repair_daily_first_distances(
    connection: sqlite3.Connection,
) -> DailyFirstDistanceRepairResult:
    before = snapshot_protected_tables(connection)
    rows = connection.execute(
        """
        SELECT timestamp_seconds, longitude, latitude, distance
        FROM footprints
        ORDER BY timestamp_seconds
        """,
    ).fetchall()
    previous: FootprintDistancePoint | None = None
    updates: list[tuple[float, int]] = []
    candidate_count = 0
    for row in rows:
        current = FootprintDistancePoint(
            timestamp_seconds=int(row[0]),
            longitude=float(row[1]),
            latitude=float(row[2]),
            distance=float(row[3]),
        )
        normalized_distance = normalize_daily_first_distance(
            previous=previous,
            current=current,
        )
        if (
            previous is not None
            and current.distance == 0
            and shanghai_date(previous.timestamp_seconds)
            != shanghai_date(current.timestamp_seconds)
        ):
            candidate_count += 1
        if normalized_distance != current.distance:
            updates.append((normalized_distance, current.timestamp_seconds))
        previous = current

    if updates:
        cursor = connection.executemany(
            """
            UPDATE footprints
            SET distance = ?
            WHERE timestamp_seconds = ? AND distance = 0
            """,
            updates,
        )
        if cursor.rowcount != len(updates):
            raise DailyFirstDistanceRepairError(
                "not all daily-first footprint distances were updated",
            )
        rebuild_admin_region_stats_from_footprints(connection)
        daily_build = build_admin_region_daily_stat_rows(connection)
        replace_admin_region_daily_stats(connection, daily_build)

    after = snapshot_protected_tables(connection)
    if before != after:
        raise DailyFirstDistanceRepairError("protected footprint tables changed")

    return DailyFirstDistanceRepairResult(
        scanned_count=len(rows),
        candidate_count=candidate_count,
        updated_count=len(updates),
        added_distance_meters=math.fsum(distance for distance, _timestamp in updates),
    )


def snapshot_protected_tables(
    connection: sqlite3.Connection,
) -> ProtectedTableSnapshot:
    digest = hashlib.sha256()
    visual_tile_count = 0
    for row in connection.execute(
        """
        SELECT
          z, x, y, t_type, t, status, cells,
          raw_count, representative_count, updated_at
        FROM visual_tiles
        ORDER BY z, x, y, t_type, t
        """,
    ):
        visual_tile_count += 1
        for value in row:
            if value is None:
                encoded = b"N"
            elif isinstance(value, bytes):
                encoded = b"B" + value
            else:
                encoded = b"T" + str(value).encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
    return ProtectedTableSnapshot(
        footprint_count=int(
            connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0],
        ),
        spatial_count=int(
            connection.execute("SELECT COUNT(*) FROM footprint_spatial").fetchone()[0],
        ),
        visual_tile_count=visual_tile_count,
        visual_tile_sha256=digest.hexdigest(),
    )
