from __future__ import annotations

import json
import math
import sqlite3
import time
from collections import Counter
from dataclasses import dataclass

from shapely.geometry import GeometryCollection, box
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


CHINA_THUMBNAIL_SOUTH_BOUND = 17.5


@dataclass(frozen=True, order=True)
class AdminRegionDailyStat:
    depth: int
    day: int
    region_id: str
    footprint_count: int


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

        CREATE TABLE IF NOT EXISTS admin_region_daily_stats (
          depth INTEGER NOT NULL,
          day INTEGER NOT NULL,
          region_id TEXT NOT NULL,
          footprint_count INTEGER NOT NULL,
          PRIMARY KEY (depth, day, region_id),
          CHECK (depth BETWEEN 1 AND 4),
          CHECK (footprint_count > 0)
        ) WITHOUT ROWID;
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
    return create_admin_region_thumbnail_source_signature(
        connection,
        required_tile_keys=THUMBNAIL_PATH_TILE_KEYS,
    )


def create_admin_region_thumbnail_source_signature(
    connection: sqlite3.Connection,
    *,
    required_tile_keys: tuple[tuple[int, int, int, int], ...],
) -> str:
    predicate = " OR ".join(
        "(depth = ? AND z = ? AND x = ? AND y = ?)" for _key in required_tile_keys
    )
    parameters = tuple(value for key in required_tile_keys for value in key)
    rows = connection.execute(
        f"""
        SELECT
          depth,
          z,
          x,
          y,
          algorithm_signature,
          updated_at,
          LENGTH(tile) AS byte_length
        FROM admin_region_tiles
        WHERE focus_region_id = 'world'
          AND ({predicate})
        ORDER BY depth, z, x, y
        """,
        parameters,
    ).fetchall()
    metadata_by_key = {
        (int(row[0]), int(row[1]), int(row[2]), int(row[3])): {
            "depth": int(row[0]),
            "z": int(row[1]),
            "x": int(row[2]),
            "y": int(row[3]),
            "algorithmSignature": str(row[4]),
            "updatedAt": int(row[5]),
            "byteLength": int(row[6]),
        }
        for row in rows
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
        actual_ids = {path.region_id for path in paths.region_paths}
        missing_ids = sorted(expected_ids - actual_ids)
        if missing_ids:
            raise AdminRegionPrecomputeSourceError(
                f"admin-region thumbnail paths are incomplete at depth {depth}: "
                f"{', '.join(missing_ids)}",
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
    with connection:
        connection.execute("DELETE FROM admin_region_thumbnail_bases")
        connection.execute("DELETE FROM admin_region_thumbnail_region_paths")
        connection.execute("DELETE FROM admin_region_daily_stats")
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
        connection.executemany(
            """
            INSERT INTO admin_region_daily_stats (
              depth, day, region_id, footprint_count
            ) VALUES (?, ?, ?, ?)
            """,
            (
                (row.depth, row.day, row.region_id, row.footprint_count)
                for row in daily_stat_rows
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
