from __future__ import annotations

import json
import math
import sqlite3
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from threading import Lock
from typing import Iterable

from mapbox_vector_tile import decode
from shapely import force_2d, make_valid, union_all
from shapely.errors import GEOSException
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

VIEWBOX_WIDTH = 320.0
VIEWBOX_HEIGHT = 180.0
VIEWBOX_PADDING = 6.0
VIEWBOX = "0 0 320 180"
WORLD_BOUNDS = (-180.0, -58.0, 180.0, 85.0)
CHINA_BOUNDS = (73.0, 4.0, 136.0, 55.0)
STANDARD_PARALLEL_DEGREES = 35.0
LONGITUDE_SCALE = math.cos(math.radians(STANDARD_PARALLEL_DEGREES))
MVT_EXTENT = 4096.0
TILE_SIMPLIFY_UNITS = 8.0
TILE_UNION_GRID_UNITS = 4.0
RAW_FALLBACK_MAX_GEOMETRY_BYTES = 2_000_000
MAX_THUMBNAIL_PATH_LENGTH = 200_000
THUMBNAIL_CACHE_MAXSIZE = 16
WORLD_THUMBNAIL_TILE = (0, 0, 0)
CHINA_THUMBNAIL_TILE = (1, 1, 0)

COUNTRY_SCOPE_FILTER = """
  AND LOWER(TRIM(name)) NOT IN ('antarctica', '南极洲')
  AND LOWER(TRIM(id)) NOT IN (
    'aq', 'ata', '010', 'country:aq', 'country:ata', 'country:010'
  )
  AND LOWER(TRIM(id)) NOT LIKE '%:aq'
  AND LOWER(TRIM(id)) NOT LIKE '%:ata'
"""


@dataclass(frozen=True)
class AdminRegionThumbnailPath:
    region_id: str
    path: str
    coarse_path: str
    bounds: tuple[float, float, float, float]
    geometry: BaseGeometry | None = field(default=None, compare=False, repr=False)


@dataclass(frozen=True)
class AdminRegionThumbnailPaths:
    base_path: str
    region_paths: tuple[AdminRegionThumbnailPath, ...]


@dataclass(frozen=True)
class AdminRegionThumbnailTile:
    z: int
    x: int
    y: int
    content: bytes


@dataclass(frozen=True)
class AdminRegionThumbnailSource:
    cache_key: tuple[object, ...]
    depth: int
    mode: str
    tile: AdminRegionThumbnailTile | None = None
    china_base_tile: AdminRegionThumbnailTile | None = None
    geometry_rows: tuple[tuple[str, str], ...] = ()
    bounds_rows: tuple[tuple[str, float, float, float, float], ...] = ()
    cached_paths: AdminRegionThumbnailPaths | None = None


_thumbnail_cache: OrderedDict[tuple[object, ...], AdminRegionThumbnailPaths] = OrderedDict()
_thumbnail_cache_lock = Lock()


def preferred_thumbnail_tile_key(depth: int) -> tuple[int, int, int]:
    return WORLD_THUMBNAIL_TILE if depth == 1 else CHINA_THUMBNAIL_TILE


def requested_thumbnail_tile_keys(depth: int) -> tuple[tuple[int, int, int, int], ...]:
    keys = {(depth, *preferred_thumbnail_tile_key(depth))}
    if depth > 1:
        keys.update(
            {
                (2, *CHINA_THUMBNAIL_TILE),
                (2, *WORLD_THUMBNAIL_TILE),
            },
        )
    return tuple(sorted(keys))


def exact_thumbnail_tile_predicate(
    keys: Iterable[tuple[int, int, int, int]],
) -> tuple[str, tuple[int, ...]]:
    normalized_keys = tuple(sorted({tuple(int(value) for value in key) for key in keys}))
    if not normalized_keys:
        return "0", ()
    predicate = " OR ".join(
        "(depth = ? AND z = ? AND x = ? AND y = ?)" for _key in normalized_keys
    )
    parameters = tuple(value for key in normalized_keys for value in key)
    return predicate, parameters


def create_admin_region_thumbnail(
    connection: sqlite3.Connection,
    *,
    depth: int,
    visited_region_ids: set[str],
) -> dict[str, str]:
    source = read_admin_region_thumbnail_source(connection, depth=depth)
    paths = source.cached_paths or get_or_build_thumbnail_paths(source)
    cached_region_ids = {region_path.region_id for region_path in paths.region_paths}
    missing_visited_ids = {str(region_id) for region_id in visited_region_ids} - cached_region_ids
    return create_admin_region_thumbnail_response(
        paths,
        depth=depth,
        visited_region_ids=visited_region_ids,
        visited_region_bounds=query_region_bounds_by_ids(
            connection,
            depth=depth,
            region_ids=missing_visited_ids,
        ),
    )


def read_admin_region_thumbnail_source(
    connection: sqlite3.Connection,
    *,
    depth: int,
) -> AdminRegionThumbnailSource:
    validate_thumbnail_depth(depth)
    connection_scope = connection
    requested_tile_keys = requested_thumbnail_tile_keys(depth)
    tile_predicate, tile_parameters = exact_thumbnail_tile_predicate(requested_tile_keys)
    tile_rows = connection.execute(
        f"""
        SELECT depth, z, x, y, algorithm_signature, updated_at, feature_count,
               LENGTH(tile) AS tile_length
        FROM admin_region_tiles
        WHERE focus_region_id = 'world'
          AND ({tile_predicate})
        ORDER BY depth, z, x, y
        """,
        tile_parameters,
    ).fetchall()
    metadata_by_key = {
        (
            int(row_value(row, "depth", 0)),
            int(row_value(row, "z", 1)),
            int(row_value(row, "x", 2)),
            int(row_value(row, "y", 3)),
        ): (
            str(row_value(row, "algorithm_signature", 4)),
            int(row_value(row, "updated_at", 5)),
            int(row_value(row, "feature_count", 6)),
            int(row_value(row, "tile_length", 7)),
        )
        for row in tile_rows
    }
    metadata_key: tuple[object, ...] = tuple(
        (requested_tile_key, metadata_by_key.get(requested_tile_key))
        for requested_tile_key in requested_tile_keys
    )
    current_tile_key = (depth, *preferred_thumbnail_tile_key(depth))
    china_base_tile_key = next(
        (
            candidate
            for candidate in (
                (2, *CHINA_THUMBNAIL_TILE),
                (2, *WORLD_THUMBNAIL_TILE),
            )
            if depth > 1 and candidate in metadata_by_key
        ),
        None,
    )
    if current_tile_key in metadata_by_key:
        cache_key = (
            "tile",
            connection_scope,
            depth,
            metadata_key,
        )
        cached_paths = get_cached_thumbnail_paths(cache_key)
        if cached_paths is not None:
            return AdminRegionThumbnailSource(
                cache_key=cache_key,
                depth=depth,
                mode="cached",
                cached_paths=cached_paths,
            )
        content_tile_keys = {current_tile_key}
        if china_base_tile_key is not None:
            content_tile_keys.add(china_base_tile_key)
        tiles_by_key = read_admin_region_thumbnail_tiles(
            connection,
            keys=content_tile_keys,
        )
        tile = tiles_by_key.get(current_tile_key)
        if tile is not None:
            return AdminRegionThumbnailSource(
                cache_key=cache_key,
                depth=depth,
                mode="tile",
                tile=tile,
                china_base_tile=(
                    tiles_by_key.get(china_base_tile_key)
                    if china_base_tile_key is not None
                    else None
                ),
            )

    return read_raw_admin_region_thumbnail_source(
        connection,
        connection_scope=connection_scope,
        depth=depth,
        tile_metadata_key=metadata_key,
        china_base_tile_key=china_base_tile_key,
    )


def read_admin_region_thumbnail_tiles(
    connection: sqlite3.Connection,
    *,
    keys: Iterable[tuple[int, int, int, int]],
) -> dict[tuple[int, int, int, int], AdminRegionThumbnailTile]:
    requested_keys = tuple(sorted({tuple(int(value) for value in key) for key in keys}))
    if not requested_keys:
        return {}
    tile_predicate, tile_parameters = exact_thumbnail_tile_predicate(requested_keys)
    content_rows = connection.execute(
        f"""
        SELECT tile, depth, z, x, y
        FROM admin_region_tiles
        WHERE focus_region_id = 'world'
          AND ({tile_predicate})
        ORDER BY depth, z, x, y
        """,
        tile_parameters,
    ).fetchall()
    tiles_by_key: dict[tuple[int, int, int, int], AdminRegionThumbnailTile] = {}
    for row in content_rows:
        tile_value = row_value(row, "tile", 0)
        if tile_value is not None:
            depth = int(row_value(row, "depth", 1))
            z = int(row_value(row, "z", 2))
            x = int(row_value(row, "x", 3))
            y = int(row_value(row, "y", 4))
            tiles_by_key[(depth, z, x, y)] = AdminRegionThumbnailTile(
                z=z,
                x=x,
                y=y,
                content=bytes(tile_value),
            )
    return tiles_by_key


def read_raw_admin_region_thumbnail_source(
    connection: sqlite3.Connection,
    *,
    connection_scope: sqlite3.Connection,
    depth: int,
    tile_metadata_key: tuple[object, ...] = (),
    china_base_tile_key: tuple[int, int, int, int] | None = None,
) -> AdminRegionThumbnailSource:
    country_filter = COUNTRY_SCOPE_FILTER if depth == 1 else ""
    stats_row = connection.execute(
        f"""
        SELECT
          COUNT(*) AS region_count,
          COALESCE(SUM(LENGTH(geometry)), 0) AS geometry_bytes,
          COALESCE(MAX(rowid), 0) AS max_rowid
        FROM admin_regions
        WHERE level = ?
        {country_filter}
        """,
        (depth,),
    ).fetchone()
    data_version = int(connection.execute("PRAGMA data_version").fetchone()[0])
    region_count = int(row_value(stats_row, "region_count", 0))
    geometry_bytes = int(row_value(stats_row, "geometry_bytes", 1))
    max_rowid = int(row_value(stats_row, "max_rowid", 2))
    cache_key = (
        "raw",
        connection_scope,
        depth,
        tile_metadata_key,
        data_version,
        connection.total_changes,
        region_count,
        geometry_bytes,
        max_rowid,
    )
    cached_paths = get_cached_thumbnail_paths(cache_key)
    if cached_paths is not None:
        return AdminRegionThumbnailSource(
            cache_key=cache_key,
            depth=depth,
            mode="cached",
            cached_paths=cached_paths,
        )

    china_base_tile = None
    if china_base_tile_key is not None:
        tiles_by_key = read_admin_region_thumbnail_tiles(
            connection,
            keys=(china_base_tile_key,),
        )
        china_base_tile = tiles_by_key.get(china_base_tile_key)

    bounds_rows = query_region_bounds(connection, depth=depth)
    if geometry_bytes > RAW_FALLBACK_MAX_GEOMETRY_BYTES:
        return AdminRegionThumbnailSource(
            cache_key=cache_key,
            depth=depth,
            mode="bounds",
            china_base_tile=china_base_tile,
            bounds_rows=bounds_rows,
        )

    rows = connection.execute(
        f"""
        SELECT id, geometry
        FROM admin_regions
        WHERE level = ?
        {country_filter}
        ORDER BY id
        """,
        (depth,),
    ).fetchall()
    return AdminRegionThumbnailSource(
        cache_key=cache_key,
        depth=depth,
        mode="raw",
        china_base_tile=china_base_tile,
        geometry_rows=tuple(
            (str(row_value(row, "id", 0)), str(row_value(row, "geometry", 1)))
            for row in rows
        ),
        bounds_rows=bounds_rows,
    )


def create_admin_region_thumbnail_from_source(
    source: AdminRegionThumbnailSource,
    *,
    visited_region_ids: set[str],
    visited_region_bounds: dict[str, tuple[float, float, float, float]] | None = None,
) -> dict[str, str]:
    paths = source.cached_paths or get_or_build_thumbnail_paths(source)
    return create_admin_region_thumbnail_response(
        paths,
        depth=source.depth,
        visited_region_ids=visited_region_ids,
        visited_region_bounds=visited_region_bounds,
    )


def create_admin_region_thumbnail_response(
    paths: AdminRegionThumbnailPaths,
    *,
    depth: int,
    visited_region_ids: set[str],
    visited_region_bounds: dict[str, tuple[float, float, float, float]] | None,
) -> dict[str, str]:
    visited_ids = {str(region_id) for region_id in visited_region_ids}
    paths_by_id = {region_path.region_id: region_path for region_path in paths.region_paths}
    resolved_bounds = visited_region_bounds or {}
    selected_paths = []
    for region_id in sorted(visited_ids):
        region_path = paths_by_id.get(region_id)
        if region_path is None and region_id in resolved_bounds:
            viewbox_bounds = project_geographic_bounds(
                *resolved_bounds[region_id],
                depth=depth,
            )
            coarse_path = bounds_to_svg_path(viewbox_bounds)
            if coarse_path:
                region_path = AdminRegionThumbnailPath(
                    region_id=region_id,
                    path=coarse_path,
                    coarse_path=coarse_path,
                    bounds=viewbox_bounds,
                    geometry=box(*viewbox_bounds),
                )
        if region_path is not None:
            selected_paths.append(region_path)
    return {
        "viewBox": VIEWBOX,
        "basePath": paths.base_path,
        "visitedPath": merge_visited_region_paths(selected_paths),
    }


def get_or_build_thumbnail_paths(
    source: AdminRegionThumbnailSource,
) -> AdminRegionThumbnailPaths:
    with _thumbnail_cache_lock:
        cached_paths = _thumbnail_cache.get(source.cache_key)
        if cached_paths is not None:
            _thumbnail_cache.move_to_end(source.cache_key)
            return cached_paths

        paths = build_thumbnail_paths(source)
        _thumbnail_cache[source.cache_key] = paths
        _thumbnail_cache.move_to_end(source.cache_key)
        while len(_thumbnail_cache) > THUMBNAIL_CACHE_MAXSIZE:
            _thumbnail_cache.popitem(last=False)
        return paths


def get_cached_thumbnail_paths(
    cache_key: tuple[object, ...],
) -> AdminRegionThumbnailPaths | None:
    with _thumbnail_cache_lock:
        paths = _thumbnail_cache.get(cache_key)
        if paths is not None:
            _thumbnail_cache.move_to_end(cache_key)
        return paths


def build_thumbnail_paths(source: AdminRegionThumbnailSource) -> AdminRegionThumbnailPaths:
    if source.mode == "tile":
        return build_tile_thumbnail_paths(source)
    if source.mode == "raw":
        return build_raw_thumbnail_paths(source)
    return build_bounds_thumbnail_paths(source)


def decode_fill_geometries(tile: bytes) -> dict[str, list[BaseGeometry]]:
    decoded = decode(tile, default_options={"y_coord_down": True})
    layer = decoded.get("admin_regions")
    features = layer.get("features", []) if isinstance(layer, dict) else []
    grouped_geometries: dict[str, list[BaseGeometry]] = defaultdict(list)
    for feature in features if isinstance(features, list) else []:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        geometry_mapping = feature.get("geometry")
        if (
            not isinstance(properties, dict)
            or properties.get("kind") != "fill"
            or not isinstance(geometry_mapping, dict)
        ):
            continue
        region_id = properties.get("region_id", properties.get("id"))
        if region_id in {None, ""}:
            continue
        geometry = repair_polygonal_geometry(shape(geometry_mapping))
        if not geometry.is_empty:
            grouped_geometries[str(region_id)].append(geometry)
    return dict(grouped_geometries)


def build_tile_base_path(
    grouped_geometries: dict[str, list[BaseGeometry]],
    *,
    depth: int,
    tile: AdminRegionThumbnailTile,
) -> str:
    base_geometries: list[BaseGeometry] = []
    for geometries in grouped_geometries.values():
        for geometry in geometries:
            repaired = repair_polygonal_geometry(geometry)
            if repaired.is_empty:
                continue
            if depth == 1:
                repaired = repaired.simplify(
                    TILE_SIMPLIFY_UNITS,
                    preserve_topology=False,
                )
            if not repaired.is_empty:
                base_geometries.append(repaired)
    if not base_geometries:
        return ""

    base_geometry = safe_union(
        base_geometries,
        grid_size=TILE_UNION_GRID_UNITS if depth == 1 else 0.0,
    )
    base_depth = 1 if depth == 1 else 2
    projected_base = clip_thumbnail_geometry(
        project_tile_geometry(
            base_geometry,
            depth=base_depth,
            tile=tile,
            simplify=False,
        ),
    )
    if depth > 1:
        projected_base = remove_polygon_holes(projected_base)
    return bounded_geometry_path(
        projected_base.simplify(0.6, preserve_topology=True),
    )


def build_china_base_tile_path(
    tile: AdminRegionThumbnailTile | None,
    *,
    depth: int,
) -> str:
    if tile is None:
        return ""
    return build_tile_base_path(
        decode_fill_geometries(tile.content),
        depth=depth,
        tile=tile,
    )


def build_tile_thumbnail_paths(
    source: AdminRegionThumbnailSource,
) -> AdminRegionThumbnailPaths:
    tile = source.tile
    if tile is None:
        return AdminRegionThumbnailPaths(base_path="", region_paths=())
    grouped_geometries = decode_fill_geometries(tile.content)

    coarse_by_id = create_coarse_paths(source.bounds_rows, depth=source.depth)
    region_paths: list[AdminRegionThumbnailPath] = []
    for region_id in sorted({*grouped_geometries, *coarse_by_id}):
        coarse_path, coarse_bounds = coarse_by_id.get(region_id, ("", (0.0, 0.0, 0.0, 0.0)))
        geometries = grouped_geometries.get(region_id, [])
        detailed_path = ""
        projected_bounds = coarse_bounds
        projected_geometry: BaseGeometry | None = None
        if geometries:
            if not coarse_path:
                coarse_bounds = project_tile_bounds(
                    combine_bounds(geometry.bounds for geometry in geometries),
                    depth=source.depth,
                    tile=tile,
                )
                coarse_path = bounds_to_svg_path(coarse_bounds)
                projected_bounds = coarse_bounds
            if source.depth == 1:
                geometries = [
                    geometry.simplify(TILE_SIMPLIFY_UNITS, preserve_topology=False)
                    for geometry in geometries
                ]
            region_geometry = safe_union(
                geometries,
                grid_size=TILE_UNION_GRID_UNITS if source.depth == 1 else 0.25,
            )
            if not region_geometry.is_empty:
                projected = clip_thumbnail_geometry(
                    project_tile_geometry(
                        region_geometry,
                        depth=source.depth,
                        tile=tile,
                        simplify=False,
                    ),
                )
                if not projected.is_empty:
                    projected_geometry = projected
                    detailed_path = bounded_geometry_path(
                        projected.simplify(0.6, preserve_topology=True),
                    )
                    projected_bounds = normalize_bounds(projected.bounds)
                if not coarse_path:
                    coarse_path = bounds_to_svg_path(projected_bounds)
        if not detailed_path:
            detailed_path = coarse_path
        if detailed_path:
            region_paths.append(
                AdminRegionThumbnailPath(
                    region_id=region_id,
                    path=detailed_path,
                    coarse_path=coarse_path or detailed_path,
                    bounds=projected_bounds,
                    geometry=(
                        projected_geometry
                        if projected_geometry is not None
                        else box(*projected_bounds)
                    ),
                ),
            )

    base_tile = source.china_base_tile or tile
    base_groups = (
        grouped_geometries
        if base_tile == tile
        else decode_fill_geometries(base_tile.content)
    )
    base_path = build_tile_base_path(
        base_groups,
        depth=source.depth,
        tile=base_tile,
    )
    if not base_path:
        base_path = join_bounded_region_paths(region_paths)
    return AdminRegionThumbnailPaths(
        base_path=base_path,
        region_paths=tuple(region_paths),
    )


def build_raw_thumbnail_paths(
    source: AdminRegionThumbnailSource,
) -> AdminRegionThumbnailPaths:
    coarse_by_id = create_coarse_paths(source.bounds_rows, depth=source.depth)
    region_paths: list[AdminRegionThumbnailPath] = []
    geometry_by_id = dict(source.geometry_rows)
    for region_id in sorted({*geometry_by_id, *coarse_by_id}):
        coarse_path, coarse_bounds = coarse_by_id.get(region_id, ("", (0.0, 0.0, 0.0, 0.0)))
        detailed_path = ""
        projected_bounds = coarse_bounds
        projected_geometry: BaseGeometry | None = None
        geometry_json = geometry_by_id.get(region_id)
        if geometry_json is not None:
            geometry = repair_polygonal_geometry(shape(json.loads(geometry_json)))
            projected = clip_thumbnail_geometry(
                project_geographic_geometry(
                    geometry,
                    depth=source.depth,
                    simplify=False,
                ),
            )
            if not projected.is_empty:
                projected_geometry = projected
                detailed_path = bounded_geometry_path(
                    projected.simplify(0.6, preserve_topology=True),
                )
                projected_bounds = normalize_bounds(projected.bounds)
                if not coarse_path:
                    coarse_path = bounds_to_svg_path(projected_bounds)
        if not detailed_path:
            detailed_path = coarse_path
        if detailed_path:
            region_paths.append(
                AdminRegionThumbnailPath(
                    region_id=region_id,
                    path=detailed_path,
                    coarse_path=coarse_path or detailed_path,
                    bounds=projected_bounds,
                    geometry=(
                        projected_geometry
                        if projected_geometry is not None
                        else box(*projected_bounds)
                    ),
                ),
            )
    fallback_base_path = join_bounded_region_paths(region_paths)
    return AdminRegionThumbnailPaths(
        base_path=(
            build_china_base_tile_path(source.china_base_tile, depth=source.depth)
            or fallback_base_path
        ),
        region_paths=tuple(region_paths),
    )


def build_bounds_thumbnail_paths(
    source: AdminRegionThumbnailSource,
) -> AdminRegionThumbnailPaths:
    coarse_by_id = create_coarse_paths(source.bounds_rows, depth=source.depth)
    region_paths = tuple(
        AdminRegionThumbnailPath(
            region_id=region_id,
            path=path,
            coarse_path=path,
            bounds=bounds,
            geometry=box(*bounds),
        )
        for region_id, (path, bounds) in sorted(coarse_by_id.items())
        if path
    )
    fallback_base_path = join_bounded_region_paths(region_paths)
    return AdminRegionThumbnailPaths(
        base_path=(
            build_china_base_tile_path(source.china_base_tile, depth=source.depth)
            or fallback_base_path
        ),
        region_paths=region_paths,
    )


def query_region_bounds(
    connection: sqlite3.Connection,
    *,
    depth: int,
) -> tuple[tuple[str, float, float, float, float], ...]:
    country_filter = COUNTRY_SCOPE_FILTER if depth == 1 else ""
    rows = connection.execute(
        f"""
        SELECT id, min_lng, min_lat, max_lng, max_lat
        FROM admin_regions
        WHERE level = ?
        {country_filter}
        ORDER BY id
        """,
        (depth,),
    ).fetchall()
    return tuple(
        (
            str(row_value(row, "id", 0)),
            float(row_value(row, "min_lng", 1)),
            float(row_value(row, "min_lat", 2)),
            float(row_value(row, "max_lng", 3)),
            float(row_value(row, "max_lat", 4)),
        )
        for row in rows
    )


def query_region_bounds_by_ids(
    connection: sqlite3.Connection,
    *,
    depth: int,
    region_ids: set[str],
) -> dict[str, tuple[float, float, float, float]]:
    ids = sorted({str(region_id) for region_id in region_ids})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT id, min_lng, min_lat, max_lng, max_lat
        FROM admin_regions
        WHERE level = ?
          AND id IN ({placeholders})
        ORDER BY id
        """,
        (depth, *ids),
    ).fetchall()
    return {
        str(row_value(row, "id", 0)): (
            float(row_value(row, "min_lng", 1)),
            float(row_value(row, "min_lat", 2)),
            float(row_value(row, "max_lng", 3)),
            float(row_value(row, "max_lat", 4)),
        )
        for row in rows
    }


def create_coarse_paths(
    rows: tuple[tuple[str, float, float, float, float], ...],
    *,
    depth: int,
) -> dict[str, tuple[str, tuple[float, float, float, float]]]:
    coarse_paths = {}
    for region_id, west, south, east, north in rows:
        bounds = project_geographic_bounds(
            west,
            south,
            east,
            north,
            depth=depth,
        )
        coarse_paths[region_id] = bounds_to_svg_path(bounds), bounds
    return coarse_paths


def safe_union(
    geometries: Iterable[BaseGeometry],
    *,
    grid_size: float,
) -> BaseGeometry:
    non_empty = [
        repaired
        for geometry in geometries
        if not geometry.is_empty
        for repaired in (repair_polygonal_geometry(geometry),)
        if not repaired.is_empty
    ]
    if not non_empty:
        return GeometryCollection()
    try:
        unioned = union_all(non_empty, grid_size=grid_size)
    except GEOSException:
        unioned = union_all(
            [repair_polygonal_geometry(geometry.buffer(0)) for geometry in non_empty],
            grid_size=grid_size,
        )
    return repair_polygonal_geometry(unioned)


def repair_polygonal_geometry(geometry: BaseGeometry) -> BaseGeometry:
    resolved = force_2d(geometry)
    if not resolved.is_valid:
        resolved = make_valid(resolved)
    polygons = list(iter_polygons(resolved))
    if not polygons:
        return GeometryCollection()
    if len(polygons) == 1:
        return polygons[0]
    try:
        return union_all(polygons, grid_size=0.0)
    except GEOSException:
        return union_all([polygon.buffer(0) for polygon in polygons], grid_size=0.0)


def clip_thumbnail_geometry(geometry: BaseGeometry) -> BaseGeometry:
    frame = box(
        VIEWBOX_PADDING,
        VIEWBOX_PADDING,
        VIEWBOX_WIDTH - VIEWBOX_PADDING,
        VIEWBOX_HEIGHT - VIEWBOX_PADDING,
    )

    resolved = repair_polygonal_geometry(geometry)
    try:
        clipped = resolved.intersection(frame)
    except GEOSException:
        resolved = repair_polygonal_geometry(make_valid(resolved))
        clipped = resolved.intersection(frame)
    return repair_polygonal_geometry(clipped)


def remove_polygon_holes(geometry: BaseGeometry) -> BaseGeometry:
    shells = [Polygon(polygon.exterior) for polygon in iter_polygons(geometry)]
    return safe_union(shells, grid_size=0.1) if shells else GeometryCollection()


def project_geographic_position(
    longitude: float,
    latitude: float,
    *,
    depth: int,
) -> tuple[float, float]:
    west, south, east, north = WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS
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
    return (
        offset_x + (longitude - west) * LONGITUDE_SCALE * scale,
        offset_y + (north - latitude) * scale,
    )


def project_geographic_geometry(
    geometry: BaseGeometry,
    *,
    depth: int,
    simplify: bool = True,
) -> BaseGeometry:

    def project(x, y, z=None):
        del z
        return project_geographic_position(float(x), float(y), depth=depth)

    projected = transform(project, force_2d(geometry))
    return projected.simplify(0.6, preserve_topology=True) if simplify else projected


def project_tile_geometry(
    geometry: BaseGeometry,
    *,
    depth: int,
    tile: AdminRegionThumbnailTile,
    simplify: bool = True,
) -> BaseGeometry:
    def project(x, y, z=None):
        del z
        return project_tile_position(float(x), float(y), depth=depth, tile=tile)

    projected = transform(project, force_2d(geometry))
    return projected.simplify(0.6, preserve_topology=True) if simplify else projected


def project_tile_bounds(
    bounds: tuple[float, float, float, float],
    *,
    depth: int,
    tile: AdminRegionThumbnailTile,
) -> tuple[float, float, float, float]:
    west, north, east, south = normalize_bounds(bounds)
    north_west = project_tile_position(west, north, depth=depth, tile=tile)
    south_east = project_tile_position(east, south, depth=depth, tile=tile)
    return normalize_bounds((*north_west, *south_east))


def project_tile_position(
    x: float,
    y: float,
    *,
    depth: int,
    tile: AdminRegionThumbnailTile,
) -> tuple[float, float]:
    tile_count = 2**tile.z
    world_extent = MVT_EXTENT * tile_count
    global_x = tile.x * MVT_EXTENT + x
    global_y = tile.y * MVT_EXTENT + y
    longitude = global_x / world_extent * 360.0 - 180.0
    mercator_y = math.pi - 2.0 * math.pi * global_y / world_extent
    latitude = math.degrees(math.atan(math.sinh(mercator_y)))
    return project_geographic_position(longitude, latitude, depth=depth)


def project_geographic_bounds(
    west: float,
    south: float,
    east: float,
    north: float,
    *,
    depth: int,
) -> tuple[float, float, float, float]:
    north_west = project_geographic_position(west, north, depth=depth)
    south_east = project_geographic_position(east, south, depth=depth)
    return normalize_bounds((*north_west, *south_east))


def bounded_geometry_path(geometry: BaseGeometry) -> str:
    path = geometry_to_svg_path(geometry)
    if len(path) <= MAX_THUMBNAIL_PATH_LENGTH:
        return path
    for tolerance in (1.2, 2.4, 4.8, 9.6):
        simplified = geometry.simplify(tolerance, preserve_topology=True)
        path = geometry_to_svg_path(simplified)
        if len(path) <= MAX_THUMBNAIL_PATH_LENGTH:
            return path
    return bounds_to_svg_path(normalize_bounds(geometry.bounds))


def join_bounded_region_paths(paths: Iterable[AdminRegionThumbnailPath]) -> str:
    resolved_paths = list(paths)
    if not resolved_paths:
        return ""
    detailed = "".join(path.path for path in resolved_paths)
    if len(detailed) <= MAX_THUMBNAIL_PATH_LENGTH:
        return detailed
    coarse = "".join(path.coarse_path for path in resolved_paths)
    if len(coarse) <= MAX_THUMBNAIL_PATH_LENGTH:
        return coarse
    return bounds_to_svg_path(combine_bounds(path.bounds for path in resolved_paths))


def merge_visited_region_paths(paths: Iterable[AdminRegionThumbnailPath]) -> str:
    resolved_paths = list(paths)
    geometries: list[BaseGeometry] = []
    for path in resolved_paths:
        if path.geometry is not None and not path.geometry.is_empty:
            geometries.append(path.geometry)
    if geometries:
        merged = safe_union(geometries, grid_size=0.1).simplify(
            0.6,
            preserve_topology=True,
        )
        detailed = bounded_geometry_path(merged)
        if detailed:
            return detailed
    return join_bounded_region_paths(resolved_paths)


def geometry_to_svg_path(geometry: object) -> str:
    return "".join(polygon_to_svg_path(polygon) for polygon in iter_polygons(geometry))


def iter_polygons(geometry: object) -> Iterable[Polygon]:
    if isinstance(geometry, Polygon):
        yield geometry
    elif isinstance(geometry, (MultiPolygon, GeometryCollection)):
        for item in geometry.geoms:
            yield from iter_polygons(item)


def polygon_to_svg_path(polygon: Polygon) -> str:
    return ring_to_svg_path(polygon.exterior.coords) + "".join(
        ring_to_svg_path(interior.coords) for interior in polygon.interiors
    )


def ring_to_svg_path(coordinates: Iterable[tuple[float, ...]]) -> str:
    points = [(float(position[0]), float(position[1])) for position in coordinates]
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if not points:
        return ""
    head = f"M{points[0][0]:.1f} {points[0][1]:.1f}"
    tail = "".join(f"L{x:.1f} {y:.1f}" for x, y in points[1:])
    return f"{head}{tail}Z"


def bounds_to_svg_path(bounds: tuple[float, float, float, float]) -> str:
    west, north, east, south = normalize_bounds(bounds)
    if west == east or north == south:
        return ""
    return (
        f"M{west:.1f} {north:.1f}"
        f"L{east:.1f} {north:.1f}"
        f"L{east:.1f} {south:.1f}"
        f"L{west:.1f} {south:.1f}Z"
    )


def combine_bounds(
    bounds_values: Iterable[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    values = list(bounds_values)
    return (
        min(bounds[0] for bounds in values),
        min(bounds[1] for bounds in values),
        max(bounds[2] for bounds in values),
        max(bounds[3] for bounds in values),
    )


def normalize_bounds(
    bounds: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    west, north, east, south = (float(value) for value in bounds)
    return min(west, east), min(north, south), max(west, east), max(north, south)


def row_value(row: sqlite3.Row | tuple[object, ...], key: str, index: int) -> object:
    return row[key] if isinstance(row, sqlite3.Row) else row[index]


def validate_thumbnail_depth(depth: int) -> None:
    if depth not in {1, 2, 3, 4}:
        raise ValueError("depth must be one of 1, 2, 3, or 4")
