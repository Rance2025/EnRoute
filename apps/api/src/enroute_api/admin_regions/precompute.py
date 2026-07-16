from __future__ import annotations

import json
import math
import sqlite3
import time
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

from enroute_api.footprints.visual_tiles import encode_day, shanghai_date_from_timestamp

from .thumbnail import (
    CHINA_BOUNDS,
    COUNTRY_SCOPE_FILTER,
    LONGITUDE_SCALE,
    MVT_EXTENT,
    TILE_SIMPLIFY_UNITS,
    TILE_UNION_GRID_UNITS,
    VIEWBOX_HEIGHT,
    VIEWBOX_PADDING,
    VIEWBOX_WIDTH,
    WORLD_BOUNDS,
    AdminRegionThumbnailPath,
    AdminRegionThumbnailPaths,
    AdminRegionThumbnailTile,
    bounded_geometry_path,
    decode_fill_geometries,
    normalize_bounds,
    remove_polygon_holes,
    repair_polygonal_geometry,
    safe_union,
)

from .precompute_meta import (
    ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE,
    DAILY_STATS_SIGNATURE_KEY,
    THUMBNAIL_BASE_TILE_KEYS,
    THUMBNAIL_BASE_SIGNATURE_KEY,
    THUMBNAIL_PATH_TILE_KEYS,
    THUMBNAIL_PATH_SIGNATURE_KEY,
)


class AdminRegionPrecomputeSourceError(RuntimeError):
    pass


class AdminRegionPrecomputeUnavailable(RuntimeError):
    pass


CHINA_THUMBNAIL_SOUTH_BOUND = 17.5
ADMIN_REGION_GEOMETRY_QUERY_BATCH_SIZE = 400
_ADMIN_REGION_DAILY_STATS_TABLE = "admin_region_daily_stats"
_ADMIN_REGION_DAILY_STATS_NEXT_TABLE = "admin_region_daily_stats_next"


@dataclass(frozen=True, order=True)
class AdminRegionDailyStat:
    depth: int
    day: int
    region_id: str
    footprint_count: int
    stay_duration_seconds: int
    travel_distance_meters: float


@dataclass(frozen=True)
class AdminRegionThumbnailBaseRecord:
    scope: str
    view_box: str
    path: str
    source_depth: int
    source_z: int
    source_x: int
    source_y: int
    source_signature: str
    algorithm_signature: str
    updated_at: int


@dataclass(frozen=True)
class AdminRegionThumbnailRegionPathRecord:
    depth: int
    region_id: str
    path: str
    source_signature: str
    algorithm_signature: str


@dataclass(frozen=True)
class AdminRegionSummaryPrecomputeResult:
    thumbnail_base_count: int
    thumbnail_region_path_count: int
    daily_stat_count: int


def initialize_admin_region_summary_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS admin_region_thumbnail_bases (
          scope TEXT PRIMARY KEY,
          view_box TEXT NOT NULL,
          path TEXT NOT NULL,
          source_depth INTEGER NOT NULL,
          source_z INTEGER NOT NULL,
          source_x INTEGER NOT NULL,
          source_y INTEGER NOT NULL,
          source_signature TEXT NOT NULL,
          algorithm_signature TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          CHECK (scope IN ('world', 'china'))
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS admin_region_thumbnail_region_paths (
          depth INTEGER NOT NULL,
          region_id TEXT NOT NULL,
          path TEXT NOT NULL,
          source_signature TEXT NOT NULL,
          algorithm_signature TEXT NOT NULL,
          PRIMARY KEY (depth, region_id),
          CHECK (depth BETWEEN 1 AND 4)
        ) WITHOUT ROWID;

        """,
    )
    _create_admin_region_daily_stats_table(connection, replacement=False)


def _create_admin_region_daily_stats_table(
    connection: sqlite3.Connection,
    *,
    replacement: bool,
) -> None:
    table_name = (
        _ADMIN_REGION_DAILY_STATS_NEXT_TABLE
        if replacement
        else _ADMIN_REGION_DAILY_STATS_TABLE
    )
    if_not_exists = "" if replacement else "IF NOT EXISTS "
    connection.execute(
        f"""
        CREATE TABLE {if_not_exists}{table_name} (
          depth INTEGER NOT NULL,
          day INTEGER NOT NULL,
          region_id TEXT NOT NULL,
          footprint_count INTEGER NOT NULL,
          stay_duration_seconds INTEGER NOT NULL,
          travel_distance_meters REAL NOT NULL,
          PRIMARY KEY (depth, day, region_id),
          CHECK (depth BETWEEN 1 AND 4),
          CHECK (typeof(footprint_count) = 'integer'),
          CHECK (typeof(stay_duration_seconds) = 'integer'),
          CHECK (typeof(travel_distance_meters) IN ('integer', 'real')),
          CHECK (footprint_count >= 0),
          CHECK (stay_duration_seconds >= 0),
          CHECK (travel_distance_meters >= 0),
          CHECK (
            footprint_count > 0
            OR stay_duration_seconds > 0
            OR travel_distance_meters > 0
          )
        ) WITHOUT ROWID
        """,
    )


def create_admin_region_thumbnail_base_source_signature(
    connection: sqlite3.Connection,
) -> str:
    return create_admin_region_thumbnail_source_signature(
        connection,
        required_tile_keys=THUMBNAIL_BASE_TILE_KEYS,
    )


def create_admin_region_thumbnail_path_source_signature(
    connection: sqlite3.Connection,
) -> str:
    signature = json.loads(
        create_admin_region_thumbnail_source_signature(
            connection,
            required_tile_keys=THUMBNAIL_PATH_TILE_KEYS,
        ),
    )
    source_signature_row = connection.execute(
        "SELECT value FROM footprint_meta WHERE key = 'adminRegionSourceSignature'",
    ).fetchone()
    level_counts = {
        str(int(row[0])): int(row[1])
        for row in connection.execute(
            """
            SELECT level, COUNT(*)
            FROM admin_regions
            WHERE level BETWEEN 1 AND 4
            GROUP BY level
            ORDER BY level
            """,
        )
    }
    signature["adminRegions"] = {
        "sourceSignature": str(source_signature_row[0]) if source_signature_row else None,
        "levelCounts": {
            str(depth): level_counts.get(str(depth), 0)
            for depth in (1, 2, 3, 4)
        },
    }
    return json.dumps(
        signature,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def create_admin_region_thumbnail_source_signature(
    connection: sqlite3.Connection,
    *,
    required_tile_keys: tuple[tuple[int, int, int, int], ...],
) -> str:
    metadata_by_key = {}
    for depth, z, x, y in required_tile_keys:
        row = connection.execute(
            """
            SELECT algorithm_signature, updated_at, LENGTH(tile) AS byte_length
            FROM admin_region_tiles
            WHERE focus_region_id = 'world'
              AND depth = ?
              AND z = ?
              AND x = ?
              AND y = ?
            """,
            (depth, z, x, y),
        ).fetchone()
        if row is None:
            continue
        metadata_by_key[(depth, z, x, y)] = {
            "depth": depth,
            "z": z,
            "x": x,
            "y": y,
            "algorithmSignature": str(row[0]),
            "updatedAt": int(row[1]),
            "byteLength": int(row[2]),
        }
    missing_keys = [key for key in required_tile_keys if key not in metadata_by_key]
    if missing_keys:
        missing = ", ".join("/".join(str(value) for value in key) for key in missing_keys)
        raise AdminRegionPrecomputeSourceError(
            f"required admin-region thumbnail tile is missing: {missing}",
        )
    return json.dumps(
        {
            "algorithmSignature": ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE,
            "tiles": [metadata_by_key[key] for key in required_tile_keys],
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def build_precomputed_admin_region_thumbnail_paths(
    tile: AdminRegionThumbnailTile,
    *,
    depth: int,
) -> AdminRegionThumbnailPaths:
    if depth not in {1, 2, 3, 4}:
        raise ValueError("depth must be one of 1, 2, 3, or 4")
    grouped_geometries = decode_fill_geometries(tile.content)
    projected_by_region: dict[str, BaseGeometry] = {}
    region_paths = []
    for region_id in sorted(grouped_geometries):
        geometry = prepare_precomputed_region_geometry(
            grouped_geometries[region_id],
            tile=tile,
            depth=depth,
        )
        if geometry.is_empty:
            region_paths.append(
                AdminRegionThumbnailPath(
                    region_id=region_id,
                    path="",
                    coarse_path="",
                    bounds=(0.0, 0.0, 0.0, 0.0),
                    geometry=GeometryCollection(),
                ),
            )
            continue
        projected = project_precomputed_geographic_geometry(geometry, depth=depth)
        if projected.is_empty:
            region_paths.append(
                AdminRegionThumbnailPath(
                    region_id=region_id,
                    path="",
                    coarse_path="",
                    bounds=(0.0, 0.0, 0.0, 0.0),
                    geometry=GeometryCollection(),
                ),
            )
            continue
        path = bounded_geometry_path(projected.simplify(0.6, preserve_topology=True))
        if not path:
            continue
        projected_by_region[region_id] = projected
        region_paths.append(
            AdminRegionThumbnailPath(
                region_id=region_id,
                path=path,
                coarse_path=path,
                bounds=normalize_bounds(projected.bounds),
                geometry=projected,
            ),
        )

    base_geometry = safe_union(
        projected_by_region.values(),
        grid_size=0.1,
    ) if projected_by_region else GeometryCollection()
    if depth > 1 and not base_geometry.is_empty:
        base_geometry = remove_polygon_holes(base_geometry)
    base_path = (
        bounded_geometry_path(base_geometry.simplify(0.6, preserve_topology=True))
        if not base_geometry.is_empty
        else ""
    )
    return AdminRegionThumbnailPaths(
        base_path=base_path,
        region_paths=tuple(region_paths),
    )


def prepare_precomputed_region_geometry(
    geometries: list[BaseGeometry],
    *,
    tile: AdminRegionThumbnailTile,
    depth: int,
) -> BaseGeometry:
    prepared = geometries
    if depth == 1:
        prepared = [
            repair_polygonal_geometry(
                geometry.simplify(TILE_SIMPLIFY_UNITS, preserve_topology=False),
            )
            for geometry in geometries
        ]
    local_geometry = safe_union(
        prepared,
        grid_size=TILE_UNION_GRID_UNITS if depth == 1 else 0.25,
    )
    geographic_geometry = tile_geometry_to_geographic(local_geometry, tile=tile)
    west, south, east, north = precomputed_geographic_bounds(depth)
    return repair_polygonal_geometry(
        geographic_geometry.intersection(box(west, south, east, north)),
    )


def tile_geometry_to_geographic(
    geometry: BaseGeometry,
    *,
    tile: AdminRegionThumbnailTile,
) -> BaseGeometry:
    tile_count = 2**tile.z
    world_extent = MVT_EXTENT * tile_count

    def unproject(x, y, z=None):
        del z
        global_x = tile.x * MVT_EXTENT + float(x)
        global_y = tile.y * MVT_EXTENT + float(y)
        longitude = global_x / world_extent * 360.0 - 180.0
        mercator_y = math.pi - 2.0 * math.pi * global_y / world_extent
        latitude = math.degrees(math.atan(math.sinh(mercator_y)))
        return longitude, latitude

    return transform(unproject, geometry)


def project_precomputed_geographic_geometry(
    geometry: BaseGeometry,
    *,
    depth: int,
) -> BaseGeometry:
    west, south, east, north = precomputed_geographic_bounds(depth)
    available_width = VIEWBOX_WIDTH - VIEWBOX_PADDING * 2
    available_height = VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2
    projected_width = (east - west) * LONGITUDE_SCALE
    projected_height = north - south
    scale = min(
        available_width / projected_width,
        available_height / projected_height,
    )
    content_width = projected_width * scale
    content_height = projected_height * scale
    offset_x = (VIEWBOX_WIDTH - content_width) / 2
    offset_y = (VIEWBOX_HEIGHT - content_height) / 2

    def project(x, y, z=None):
        del z
        return (
            offset_x + (float(x) - west) * LONGITUDE_SCALE * scale,
            offset_y + (north - float(y)) * scale,
        )

    return transform(project, geometry)


def precomputed_geographic_bounds(depth: int) -> tuple[float, float, float, float]:
    if depth == 1:
        return WORLD_BOUNDS
    west, _south, east, north = CHINA_BOUNDS
    return west, CHINA_THUMBNAIL_SOUTH_BOUND, east, north


def build_admin_region_daily_stat_rows(
    connection: sqlite3.Connection,
) -> tuple[AdminRegionDailyStat, ...]:
    level_by_region = {
        str(row[0]): int(row[1])
        for row in connection.execute("SELECT id, level FROM admin_regions")
    }
    parent_by_child = {
        str(row[1]): str(row[0])
        for row in connection.execute("SELECT parent_id, child_id FROM admin_region_tree")
    }
    chain_cache: dict[str, tuple[tuple[int, str], ...]] = {}

    def resolve_depth_regions(region_id: str) -> tuple[tuple[int, str], ...]:
        cached = chain_cache.get(region_id)
        if cached is not None:
            return cached
        resolved: dict[int, str] = {}
        visited = set()
        current_id: str | None = region_id
        while current_id is not None and current_id not in visited:
            visited.add(current_id)
            level = level_by_region.get(current_id)
            if level in {1, 2, 3, 4} and level not in resolved:
                resolved[level] = current_id
            current_id = parent_by_child.get(current_id)
        result = tuple(sorted(resolved.items()))
        chain_cache[region_id] = result
        return result

    counts: Counter[tuple[int, int, str]] = Counter()
    for row in connection.execute(
        """
        SELECT timestamp_seconds, region_id
        FROM footprints
        WHERE region_id IS NOT NULL
          AND TRIM(region_id) != ''
        ORDER BY timestamp_seconds
        """,
    ):
        day = encode_day(shanghai_date_from_timestamp(int(row[0])))
        for depth, ancestor_id in resolve_depth_regions(str(row[1])):
            counts[(depth, day, ancestor_id)] += 1

    return tuple(
        AdminRegionDailyStat(
            depth=depth,
            day=day,
            region_id=region_id,
            footprint_count=count,
            stay_duration_seconds=0,
            travel_distance_meters=0.0,
        )
        for (depth, day, region_id), count in sorted(counts.items())
    )


def build_admin_region_summary_precompute(
    connection: sqlite3.Connection,
    *,
    updated_at: int | None = None,
) -> AdminRegionSummaryPrecomputeResult:
    resolved_updated_at = int(time.time() * 1000) if updated_at is None else int(updated_at)
    base_source_signature = create_admin_region_thumbnail_base_source_signature(connection)
    path_source_signature = create_admin_region_thumbnail_path_source_signature(connection)
    daily_source_signature = create_admin_region_daily_stats_source_signature(connection)
    paths_by_depth = {
        depth: build_precomputed_admin_region_thumbnail_paths(
            read_required_admin_region_thumbnail_tile(
                connection,
                depth=depth,
                z=z,
                x=x,
                y=y,
            ),
            depth=depth,
        )
        for depth, z, x, y in THUMBNAIL_PATH_TILE_KEYS
    }
    paths_by_depth = complete_precomputed_admin_region_path_coverage(
        connection,
        paths_by_depth,
    )
    validate_precomputed_admin_region_path_coverage(connection, paths_by_depth)
    base_records = (
        create_thumbnail_base_record(
            scope="world",
            source_key=THUMBNAIL_BASE_TILE_KEYS[0],
            path=paths_by_depth[1].base_path,
            source_signature=base_source_signature,
            updated_at=resolved_updated_at,
        ),
        create_thumbnail_base_record(
            scope="china",
            source_key=THUMBNAIL_BASE_TILE_KEYS[1],
            path=paths_by_depth[2].base_path,
            source_signature=base_source_signature,
            updated_at=resolved_updated_at,
        ),
    )
    if any(not record.path for record in base_records):
        raise AdminRegionPrecomputeSourceError("admin-region thumbnail base path is empty")
    path_records = tuple(
        AdminRegionThumbnailRegionPathRecord(
            depth=depth,
            region_id=region_path.region_id,
            path=region_path.path,
            source_signature=path_source_signature,
            algorithm_signature=ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE,
        )
        for depth in sorted(paths_by_depth)
        for region_path in paths_by_depth[depth].region_paths
    )
    if not path_records:
        raise AdminRegionPrecomputeSourceError("admin-region thumbnail region paths are empty")
    daily_stat_rows = build_admin_region_daily_stat_rows(connection)
    if not daily_stat_rows:
        raise AdminRegionPrecomputeSourceError("admin-region daily stats are empty")
    replace_admin_region_summary_precompute(
        connection,
        base_records=base_records,
        path_records=path_records,
        daily_stat_rows=daily_stat_rows,
        base_source_signature=base_source_signature,
        path_source_signature=path_source_signature,
        daily_source_signature=daily_source_signature,
    )
    return AdminRegionSummaryPrecomputeResult(
        thumbnail_base_count=len(base_records),
        thumbnail_region_path_count=len(path_records),
        daily_stat_count=len(daily_stat_rows),
    )


def create_thumbnail_base_record(
    *,
    scope: str,
    source_key: tuple[int, int, int, int],
    path: str,
    source_signature: str,
    updated_at: int,
) -> AdminRegionThumbnailBaseRecord:
    depth, z, x, y = source_key
    return AdminRegionThumbnailBaseRecord(
        scope=scope,
        view_box="0 0 320 180",
        path=path,
        source_depth=depth,
        source_z=z,
        source_x=x,
        source_y=y,
        source_signature=source_signature,
        algorithm_signature=ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE,
        updated_at=updated_at,
    )


def validate_precomputed_admin_region_path_coverage(
    connection: sqlite3.Connection,
    paths_by_depth: dict[int, AdminRegionThumbnailPaths],
) -> None:
    for depth, paths in sorted(paths_by_depth.items()):
        country_filter = COUNTRY_SCOPE_FILTER if depth == 1 else ""
        expected_ids = {
            str(row[0])
            for row in connection.execute(
                f"""
                SELECT id
                FROM admin_regions
                WHERE level = ?
                {country_filter}
                """,
                (depth,),
            )
        }
        if not expected_ids:
            raise AdminRegionPrecomputeSourceError(
                f"admin-region thumbnail paths have no canonical regions at depth {depth}",
            )
        actual_ids = {path.region_id for path in paths.region_paths}
        missing_ids = sorted(expected_ids - actual_ids)
        if missing_ids:
            raise AdminRegionPrecomputeSourceError(
                f"admin-region thumbnail paths are incomplete at depth {depth}: "
                f"{', '.join(missing_ids)}",
            )


def complete_precomputed_admin_region_path_coverage(
    connection: sqlite3.Connection,
    paths_by_depth: dict[int, AdminRegionThumbnailPaths],
) -> dict[int, AdminRegionThumbnailPaths]:
    completed = {}
    for depth, paths in sorted(paths_by_depth.items()):
        country_filter = COUNTRY_SCOPE_FILTER if depth == 1 else ""
        expected_ids = {
            str(row[0])
            for row in connection.execute(
                f"""
                SELECT id
                FROM admin_regions
                WHERE level = ?
                {country_filter}
                ORDER BY id
                """,
                (depth,),
            )
        }
        actual_by_id = {path.region_id: path for path in paths.region_paths}
        actual_ids = set(actual_by_id)
        fallback_ids = sorted(
            (expected_ids - actual_ids)
            | {
                region_id
                for region_id, path in actual_by_id.items()
                if region_id in expected_ids and not path.path
            },
        )

        if not fallback_ids or not (actual_ids & expected_ids):
            completed[depth] = paths
            continue

        completed_by_id = dict(actual_by_id)
        for offset in range(0, len(fallback_ids), ADMIN_REGION_GEOMETRY_QUERY_BATCH_SIZE):
            batch_ids = fallback_ids[
                offset:offset + ADMIN_REGION_GEOMETRY_QUERY_BATCH_SIZE
            ]
            batch_id_set = set(batch_ids)
            returned_ids = set()
            placeholders = ",".join("?" for _region_id in batch_ids)
            for row in connection.execute(
                f"""
                SELECT id, geometry
                FROM admin_regions
                WHERE level = ?
                {country_filter}
                  AND id IN ({placeholders})
                ORDER BY id
                """,
                (depth, *batch_ids),
            ):
                region_id = str(row[0])
                returned_ids.add(region_id)
                completed_by_id[region_id] = build_admin_region_geometry_fallback_path(
                    region_id=region_id,
                    geometry_json=row[1],
                    depth=depth,
                )
            missing_ids = sorted(batch_id_set - returned_ids)
            if missing_ids:
                raise AdminRegionPrecomputeSourceError(
                    "admin-region fallback geometry query is incomplete at depth "
                    f"{depth}: {', '.join(missing_ids)}",
                )
        completed[depth] = AdminRegionThumbnailPaths(
            base_path=paths.base_path,
            region_paths=tuple(completed_by_id[region_id] for region_id in sorted(completed_by_id)),
        )
    return completed


def build_admin_region_geometry_fallback_path(
    *,
    region_id: str,
    geometry_json: object,
    depth: int,
) -> AdminRegionThumbnailPath:
    try:
        geographic_geometry = repair_polygonal_geometry(shape(json.loads(str(geometry_json))))
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise AdminRegionPrecomputeSourceError(
            f"admin-region fallback geometry is invalid: {region_id}",
        ) from error
    if geographic_geometry.is_empty or not isinstance(
        geographic_geometry,
        (Polygon, MultiPolygon),
    ):
        raise AdminRegionPrecomputeSourceError(
            f"admin-region fallback geometry is empty or non-polygon: {region_id}",
        )

    west, south, east, north = precomputed_geographic_bounds(depth)
    clipped_geometry = repair_polygonal_geometry(
        geographic_geometry.intersection(box(west, south, east, north)),
    )
    if clipped_geometry.is_empty:
        if depth > 1 and geographic_geometry.bounds[3] <= south:
            return AdminRegionThumbnailPath(
                region_id=region_id,
                path="",
                coarse_path="",
                bounds=(0.0, 0.0, 0.0, 0.0),
                geometry=GeometryCollection(),
            )
        raise AdminRegionPrecomputeSourceError(
            f"admin-region fallback geometry is outside thumbnail bounds: {region_id}",
        )

    projected = project_precomputed_geographic_geometry(clipped_geometry, depth=depth)
    if projected.is_empty:
        raise AdminRegionPrecomputeSourceError(
            f"admin-region fallback projected geometry is empty: {region_id}",
        )
    path = bounded_geometry_path(projected.simplify(0.6, preserve_topology=True))
    if not path and not projected.is_empty:
        path = bounded_geometry_path(projected)
    if not path:
        raise AdminRegionPrecomputeSourceError(
            f"admin-region fallback path is empty: {region_id}",
        )
    return AdminRegionThumbnailPath(
        region_id=region_id,
        path=path,
        coarse_path=path,
        bounds=normalize_bounds(projected.bounds),
        geometry=GeometryCollection(),
    )


def read_required_admin_region_thumbnail_tile(
    connection: sqlite3.Connection,
    *,
    depth: int,
    z: int,
    x: int,
    y: int,
) -> AdminRegionThumbnailTile:
    row = connection.execute(
        """
        SELECT tile
        FROM admin_region_tiles
        WHERE focus_region_id = 'world'
          AND depth = ?
          AND z = ?
          AND x = ?
          AND y = ?
        """,
        (depth, z, x, y),
    ).fetchone()
    if row is None:
        raise AdminRegionPrecomputeSourceError(
            f"required admin-region thumbnail tile is missing: {depth}/{z}/{x}/{y}",
        )
    return AdminRegionThumbnailTile(
        z=z,
        x=x,
        y=y,
        content=bytes(row[0]),
    )


def create_admin_region_daily_stats_source_signature(
    connection: sqlite3.Connection,
) -> str:
    source_keys = ("sourceSignature", "adminRegionSourceSignature", "rowCount")
    placeholders = ",".join("?" for _key in source_keys)
    values = {
        str(row[0]): str(row[1])
        for row in connection.execute(
            f"SELECT key, value FROM footprint_meta WHERE key IN ({placeholders})",
            source_keys,
        )
    }
    return json.dumps(
        {
            "algorithmSignature": ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE,
            "adminRegionSourceSignature": values.get("adminRegionSourceSignature"),
            "footprintSourceSignature": values.get("sourceSignature"),
            "rowCount": values.get("rowCount"),
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def replace_admin_region_summary_precompute(
    connection: sqlite3.Connection,
    *,
    base_records: tuple[AdminRegionThumbnailBaseRecord, ...],
    path_records: tuple[AdminRegionThumbnailRegionPathRecord, ...],
    daily_stat_rows: tuple[AdminRegionDailyStat, ...],
    base_source_signature: str,
    path_source_signature: str,
    daily_source_signature: str,
) -> None:
    connection.execute(
        f"DROP TABLE IF EXISTS {_ADMIN_REGION_DAILY_STATS_NEXT_TABLE}",
    )
    connection.commit()
    with connection:
        if not connection.in_transaction:
            connection.execute("BEGIN")
        _create_admin_region_daily_stats_table(connection, replacement=True)
        connection.executemany(
            f"""
            INSERT INTO {_ADMIN_REGION_DAILY_STATS_NEXT_TABLE} (
              depth, day, region_id, footprint_count,
              stay_duration_seconds, travel_distance_meters
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                (
                    row.depth,
                    row.day,
                    row.region_id,
                    row.footprint_count,
                    row.stay_duration_seconds,
                    row.travel_distance_meters,
                )
                for row in daily_stat_rows
            ),
        )
        connection.execute(f"DROP TABLE {_ADMIN_REGION_DAILY_STATS_TABLE}")
        connection.execute(
            f"""
            ALTER TABLE {_ADMIN_REGION_DAILY_STATS_NEXT_TABLE}
            RENAME TO {_ADMIN_REGION_DAILY_STATS_TABLE}
            """,
        )
        connection.execute("DELETE FROM admin_region_thumbnail_bases")
        connection.execute("DELETE FROM admin_region_thumbnail_region_paths")
        connection.executemany(
            """
            INSERT INTO admin_region_thumbnail_bases (
              scope, view_box, path, source_depth, source_z, source_x, source_y,
              source_signature, algorithm_signature, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                (
                    record.scope,
                    record.view_box,
                    record.path,
                    record.source_depth,
                    record.source_z,
                    record.source_x,
                    record.source_y,
                    record.source_signature,
                    record.algorithm_signature,
                    record.updated_at,
                )
                for record in base_records
            ),
        )
        connection.executemany(
            """
            INSERT INTO admin_region_thumbnail_region_paths (
              depth, region_id, path, source_signature, algorithm_signature
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                (
                    record.depth,
                    record.region_id,
                    record.path,
                    record.source_signature,
                    record.algorithm_signature,
                )
                for record in path_records
            ),
        )
        set_precompute_signature(
            connection,
            key=THUMBNAIL_BASE_SIGNATURE_KEY,
            value=base_source_signature,
        )
        set_precompute_signature(
            connection,
            key=THUMBNAIL_PATH_SIGNATURE_KEY,
            value=path_source_signature,
        )
        set_precompute_signature(
            connection,
            key=DAILY_STATS_SIGNATURE_KEY,
            value=daily_source_signature,
        )


def set_precompute_signature(
    connection: sqlite3.Connection,
    *,
    key: str,
    value: str,
) -> None:
    connection.execute(
        """
        INSERT INTO footprint_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def read_admin_region_thumbnail_bases(db_path: str | Path) -> dict[str, object]:
    try:
        with open_admin_region_readonly_connection(db_path) as connection:
            expected_signature = create_admin_region_thumbnail_base_source_signature(connection)
            require_precompute_signature(
                connection,
                key=THUMBNAIL_BASE_SIGNATURE_KEY,
                expected=expected_signature,
                label="thumbnail base",
            )
            rows = connection.execute(
                """
                SELECT
                  scope,
                  view_box,
                  path,
                  source_signature,
                  algorithm_signature
                FROM admin_region_thumbnail_bases
                ORDER BY scope
                """,
            ).fetchall()
            rows_by_scope = {str(row[0]): row for row in rows}
            if set(rows_by_scope) != {"world", "china"}:
                raise AdminRegionPrecomputeUnavailable("thumbnail bases are incomplete")
            view_boxes = {str(row[1]) for row in rows}
            if view_boxes != {"0 0 320 180"}:
                raise AdminRegionPrecomputeUnavailable("thumbnail base viewBox is invalid")
            for row in rows:
                if str(row[3]) != expected_signature:
                    raise AdminRegionPrecomputeUnavailable("thumbnail base row signature is stale")
                if str(row[4]) != ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE:
                    raise AdminRegionPrecomputeUnavailable("thumbnail base algorithm is stale")
                if not str(row[2]):
                    raise AdminRegionPrecomputeUnavailable("thumbnail base path is empty")
            return {
                "viewBox": "0 0 320 180",
                "signature": expected_signature,
                "bases": {
                    scope: {"path": str(rows_by_scope[scope][2])}
                    for scope in ("world", "china")
                },
            }
    except AdminRegionPrecomputeUnavailable:
        raise
    except (AdminRegionPrecomputeSourceError, sqlite3.Error) as error:
        raise AdminRegionPrecomputeUnavailable(
            f"thumbnail base precompute is unavailable: {error}",
        ) from error


def query_precomputed_admin_region_summary(
    db_path: str | Path,
    *,
    depth: int,
    start_day: int | None,
    end_day: int | None,
) -> dict[str, object]:
    if depth not in {1, 2, 3, 4}:
        raise ValueError("depth must be one of 1, 2, 3, or 4")
    if (start_day is None) != (end_day is None):
        raise ValueError("start_day and end_day must both be set or both be omitted")
    try:
        with open_admin_region_readonly_connection(db_path) as connection:
            path_signature = create_admin_region_thumbnail_path_source_signature(connection)
            daily_signature = create_admin_region_daily_stats_source_signature(connection)
            require_precompute_signature(
                connection,
                key=THUMBNAIL_PATH_SIGNATURE_KEY,
                expected=path_signature,
                label="thumbnail path",
            )
            require_precompute_signature(
                connection,
                key=DAILY_STATS_SIGNATURE_KEY,
                expected=daily_signature,
                label="daily stats",
            )
            eligible_rows = query_eligible_admin_region_metadata(connection, depth=depth)
            metadata_by_id = {str(row[0]): row for row in eligible_rows}
            counts_by_id = query_admin_region_daily_counts(
                connection,
                depth=depth,
                start_day=start_day,
                end_day=end_day,
            )
            visited_ids = sorted(set(metadata_by_id) & set(counts_by_id))
            path_by_id = query_precomputed_region_paths(
                connection,
                depth=depth,
                region_ids=visited_ids,
                expected_signature=path_signature,
            )
            ranking_ids = sorted(
                visited_ids,
                key=lambda region_id: (
                    -counts_by_id[region_id],
                    str(metadata_by_id[region_id][1]),
                    region_id,
                ),
            )
            return {
                "depth": depth,
                "visitedRegionIds": visited_ids,
                "visitedCount": len(visited_ids),
                "totalCount": len(metadata_by_id),
                "visitedPath": "".join(path_by_id[region_id] for region_id in visited_ids),
                "rankings": [
                    format_precomputed_admin_region_ranking(
                        metadata_by_id[region_id],
                        rank=rank,
                        footprint_count=counts_by_id[region_id],
                    )
                    for rank, region_id in enumerate(ranking_ids, start=1)
                ],
            }
    except AdminRegionPrecomputeUnavailable:
        raise
    except (AdminRegionPrecomputeSourceError, sqlite3.Error) as error:
        raise AdminRegionPrecomputeUnavailable(
            f"admin-region summary precompute is unavailable: {error}",
        ) from error


def normalize_admin_region_summary_day_range(
    *,
    range_value: str | None,
    start_date: str | None,
    end_date: str | None,
) -> tuple[int | None, int | None]:
    if (range_value or "").strip().lower() == "all" or not (start_date and end_date):
        return None, None
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    return encode_day(start), encode_day(end)


def open_admin_region_readonly_connection(db_path: str | Path) -> sqlite3.Connection:
    resolved_path = Path(db_path).resolve()
    connection = sqlite3.connect(f"{resolved_path.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def require_precompute_signature(
    connection: sqlite3.Connection,
    *,
    key: str,
    expected: str,
    label: str,
) -> None:
    row = connection.execute(
        "SELECT value FROM footprint_meta WHERE key = ?",
        (key,),
    ).fetchone()
    if row is None:
        raise AdminRegionPrecomputeUnavailable(f"{label} signature is missing")
    if str(row[0]) != expected:
        raise AdminRegionPrecomputeUnavailable(f"{label} signature is stale")


def query_eligible_admin_region_metadata(
    connection: sqlite3.Connection,
    *,
    depth: int,
) -> list[sqlite3.Row]:
    country_filter = COUNTRY_SCOPE_FILTER if depth == 1 else ""
    return list(
        connection.execute(
            f"""
            SELECT id, name, min_lng, min_lat, max_lng, max_lat
            FROM admin_regions
            WHERE level = ?
            {country_filter}
            ORDER BY id
            """,
            (depth,),
        ),
    )


def query_admin_region_daily_counts(
    connection: sqlite3.Connection,
    *,
    depth: int,
    start_day: int | None,
    end_day: int | None,
) -> dict[str, int]:
    date_filter = ""
    parameters: list[int] = [depth]
    if start_day is not None and end_day is not None:
        date_filter = "AND day BETWEEN ? AND ?"
        parameters.extend((start_day, end_day))
    return {
        str(row[0]): int(row[1])
        for row in connection.execute(
            f"""
            SELECT region_id, SUM(footprint_count) AS footprint_count
            FROM admin_region_daily_stats
            WHERE depth = ?
              {date_filter}
            GROUP BY region_id
            HAVING SUM(footprint_count) > 0
            """,
            parameters,
        )
    }


def query_precomputed_region_paths(
    connection: sqlite3.Connection,
    *,
    depth: int,
    region_ids: list[str],
    expected_signature: str,
) -> dict[str, str]:
    if not region_ids:
        return {}
    rows = []
    for offset in range(0, len(region_ids), 500):
        chunk = region_ids[offset:offset + 500]
        placeholders = ",".join("?" for _region_id in chunk)
        rows.extend(
            connection.execute(
                f"""
                SELECT region_id, path, source_signature, algorithm_signature
                FROM admin_region_thumbnail_region_paths
                WHERE depth = ?
                  AND region_id IN ({placeholders})
                ORDER BY region_id
                """,
                (depth, *chunk),
            ),
        )
    path_by_id = {str(row[0]): str(row[1]) for row in rows}
    missing_ids = sorted(set(region_ids) - set(path_by_id))
    if missing_ids:
        raise AdminRegionPrecomputeUnavailable(
            f"thumbnail paths are incomplete: {', '.join(missing_ids)}",
        )
    for row in rows:
        if str(row[2]) != expected_signature:
            raise AdminRegionPrecomputeUnavailable("thumbnail path row signature is stale")
        if str(row[3]) != ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE:
            raise AdminRegionPrecomputeUnavailable("thumbnail path algorithm is stale")
    return path_by_id


def format_precomputed_admin_region_ranking(
    row: sqlite3.Row,
    *,
    rank: int,
    footprint_count: int,
) -> dict[str, object]:
    return {
        "rank": rank,
        "regionId": str(row[0]),
        "name": str(row[1]),
        "footprintCount": footprint_count,
        "bounds": {
            "west": float(row[2]),
            "south": float(row[3]),
            "east": float(row[4]),
            "north": float(row[5]),
        },
    }
