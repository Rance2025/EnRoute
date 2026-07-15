from __future__ import annotations

import sqlite3


ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE = "admin-region-summary-v3"
THUMBNAIL_BASE_SIGNATURE_KEY = "adminRegionThumbnailBasePrecomputeSignature"
THUMBNAIL_PATH_SIGNATURE_KEY = "adminRegionThumbnailPathPrecomputeSignature"
DAILY_STATS_SIGNATURE_KEY = "adminRegionDailyStatsPrecomputeSignature"
THUMBNAIL_BASE_TILE_KEYS = (
    (1, 0, 0, 0),
    (2, 1, 1, 0),
)
THUMBNAIL_PATH_TILE_KEYS = (
    (1, 0, 0, 0),
    (2, 1, 1, 0),
    (3, 1, 1, 0),
    (4, 1, 1, 0),
)


def invalidate_admin_region_daily_stats(connection: sqlite3.Connection) -> None:
    delete_meta_keys_if_available(connection, (DAILY_STATS_SIGNATURE_KEY,))


def invalidate_admin_region_thumbnail_bases(connection: sqlite3.Connection) -> None:
    delete_meta_keys_if_available(connection, (THUMBNAIL_BASE_SIGNATURE_KEY,))


def invalidate_admin_region_thumbnail_paths(connection: sqlite3.Connection) -> None:
    delete_meta_keys_if_available(connection, (THUMBNAIL_PATH_SIGNATURE_KEY,))


def invalidate_all_admin_region_summary_precompute(connection: sqlite3.Connection) -> None:
    delete_meta_keys_if_available(
        connection,
        (
            THUMBNAIL_BASE_SIGNATURE_KEY,
            THUMBNAIL_PATH_SIGNATURE_KEY,
            DAILY_STATS_SIGNATURE_KEY,
        ),
    )


def invalidate_admin_region_thumbnail_tile(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    z: int,
    x: int,
    y: int,
) -> None:
    if focus_region_id != "world":
        return
    tile_key = (depth, z, x, y)
    keys = []
    if tile_key in THUMBNAIL_BASE_TILE_KEYS:
        keys.append(THUMBNAIL_BASE_SIGNATURE_KEY)
    if tile_key in THUMBNAIL_PATH_TILE_KEYS:
        keys.append(THUMBNAIL_PATH_SIGNATURE_KEY)
    delete_meta_keys_if_available(connection, tuple(keys))


def delete_meta_keys_if_available(
    connection: sqlite3.Connection,
    keys: tuple[str, ...],
) -> None:
    if not keys:
        return
    placeholders = ",".join("?" for _key in keys)
    try:
        connection.execute(
            f"DELETE FROM footprint_meta WHERE key IN ({placeholders})",
            keys,
        )
    except sqlite3.OperationalError as error:
        if "no such table: footprint_meta" not in str(error):
            raise
