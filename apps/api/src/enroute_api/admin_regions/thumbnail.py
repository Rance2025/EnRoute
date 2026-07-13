from __future__ import annotations

import json
import math
import sqlite3
from collections import OrderedDict, defaultdict
from dataclasses import dataclass
from threading import Lock
from typing import Iterable

from mapbox_vector_tile import decode
from shapely import force_2d, union_all
from shapely.errors import GEOSException
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

VIEWBOX_WIDTH = 320.0
VIEWBOX_HEIGHT = 150.0
VIEWBOX = "0 0 320 150"
WORLD_BOUNDS = (-180.0, -58.0, 180.0, 85.0)
CHINA_BOUNDS = (73.0, 17.0, 136.0, 55.0)
MVT_EXTENT = 4096.0
TILE_SIMPLIFY_UNITS = 8.0
TILE_UNION_GRID_UNITS = 4.0
RAW_FALLBACK_MAX_GEOMETRY_BYTES = 2_000_000
MAX_THUMBNAIL_PATH_LENGTH = 200_000
THUMBNAIL_CACHE_MAXSIZE = 16

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


@dataclass(frozen=True)
class AdminRegionThumbnailPaths:
    base_path: str
    region_paths: tuple[AdminRegionThumbnailPath, ...]


@dataclass(frozen=True)
class AdminRegionThumbnailSource:
    cache_key: tuple[object, ...]
    depth: int
    mode: str
    tile: bytes = b""
    geometry_rows: tuple[tuple[str, str], ...] = ()
    bounds_rows: tuple[tuple[str, float, float, float, float], ...] = ()
    cached_paths: AdminRegionThumbnailPaths | None = None


_thumbnail_cache: OrderedDict[tuple[object, ...], AdminRegionThumbnailPaths] = OrderedDict()
_thumbnail_cache_lock = Lock()


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
    tile_row = connection.execute(
        """
        SELECT algorithm_signature, updated_at, feature_count, LENGTH(tile) AS tile_length
        FROM admin_region_tiles
        WHERE z = 0
          AND x = 0
          AND y = 0
          AND focus_region_id = 'world'
          AND depth = ?
        """,
        (depth,),
    ).fetchone()
    if tile_row is not None:
        cache_key = (
            "tile",
            connection_scope,
            depth,
            str(row_value(tile_row, "algorithm_signature", 0)),
            int(row_value(tile_row, "updated_at", 1)),
            int(row_value(tile_row, "feature_count", 2)),
            int(row_value(tile_row, "tile_length", 3)),
        )
        cached_paths = get_cached_thumbnail_paths(cache_key)
        if cached_paths is not None:
            return AdminRegionThumbnailSource(
                cache_key=cache_key,
                depth=depth,
                mode="cached",
                cached_paths=cached_paths,
            )
        content_row = connection.execute(
            """
            SELECT tile
            FROM admin_region_tiles
            WHERE z = 0
              AND x = 0
              AND y = 0
              AND focus_region_id = 'world'
              AND depth = ?
            """,
            (depth,),
        ).fetchone()
        tile = b"" if content_row is None else bytes(row_value(content_row, "tile", 0))
        if tile:
            return AdminRegionThumbnailSource(
                cache_key=cache_key,
                depth=depth,
                mode="tile",
                tile=tile,
            )

    return read_raw_admin_region_thumbnail_source(
        connection,
        connection_scope=connection_scope,
        depth=depth,
    )


def read_raw_admin_region_thumbnail_source(
    connection: sqlite3.Connection,
    *,
    connection_scope: sqlite3.Connection,
    depth: int,
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

    bounds_rows = query_region_bounds(connection, depth=depth)
    if geometry_bytes > RAW_FALLBACK_MAX_GEOMETRY_BYTES:
        return AdminRegionThumbnailSource(
            cache_key=cache_key,
            depth=depth,
            mode="bounds",
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
                )
        if region_path is not None:
            selected_paths.append(region_path)
    return {
        "viewBox": VIEWBOX,
        "basePath": paths.base_path,
        "visitedPath": join_bounded_region_paths(selected_paths),
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


def build_tile_thumbnail_paths(
    source: AdminRegionThumbnailSource,
) -> AdminRegionThumbnailPaths:
    decoded = decode(source.tile, default_options={"y_coord_down": True})
    layer = decoded.get("admin_regions")
    features = layer.get("features", []) if isinstance(layer, dict) else []
    grouped_geometries: dict[str, list[BaseGeometry]] = defaultdict(list)
    base_geometries: list[BaseGeometry] = []
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
        geometry = force_2d(shape(geometry_mapping))
        if geometry.is_empty:
            continue
        grouped_geometries[str(region_id)].append(geometry)
        simplified = geometry.simplify(TILE_SIMPLIFY_UNITS, preserve_topology=False)
        if not simplified.is_empty:
            base_geometries.append(simplified)

    coarse_by_id = create_coarse_paths(source.bounds_rows, depth=source.depth)
    region_paths: list[AdminRegionThumbnailPath] = []
    for region_id in sorted({*grouped_geometries, *coarse_by_id}):
        coarse_path, coarse_bounds = coarse_by_id.get(region_id, ("", (0.0, 0.0, 0.0, 0.0)))
        geometries = grouped_geometries.get(region_id, [])
        detailed_path = ""
        projected_bounds = coarse_bounds
        if geometries:
            if not coarse_path:
                coarse_bounds = project_tile_bounds(
                    combine_bounds(geometry.bounds for geometry in geometries),
                    depth=source.depth,
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
                projected = project_tile_geometry(region_geometry, depth=source.depth)
                detailed_path = bounded_geometry_path(projected)
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
                ),
            )

    if base_geometries:
        base_geometry = safe_union(base_geometries, grid_size=TILE_UNION_GRID_UNITS)
        base_path = bounded_geometry_path(
            project_tile_geometry(base_geometry, depth=source.depth),
        )
    else:
        base_path = ""
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
        geometry_json = geometry_by_id.get(region_id)
        if geometry_json is not None:
            geometry = force_2d(shape(json.loads(geometry_json)))
            projected = project_geographic_geometry(geometry, depth=source.depth)
            detailed_path = bounded_geometry_path(projected)
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
                ),
            )
    return AdminRegionThumbnailPaths(
        base_path=join_bounded_region_paths(region_paths),
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
        )
        for region_id, (path, bounds) in sorted(coarse_by_id.items())
        if path
    )
    return AdminRegionThumbnailPaths(
        base_path=join_bounded_region_paths(region_paths),
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
    non_empty = [geometry for geometry in geometries if not geometry.is_empty]
    if not non_empty:
        return GeometryCollection()
    try:
        return union_all(non_empty, grid_size=grid_size)
    except GEOSException:
        repaired = [geometry if geometry.is_valid else geometry.buffer(0) for geometry in non_empty]
        return union_all(repaired, grid_size=grid_size)


def project_geographic_geometry(geometry: BaseGeometry, *, depth: int) -> BaseGeometry:
    west, south, east, north = WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS

    def project(x, y, z=None):
        del z
        projected_x = (x - west) / (east - west) * VIEWBOX_WIDTH
        projected_y = (north - y) / (north - south) * VIEWBOX_HEIGHT
        return projected_x, projected_y

    return transform(project, force_2d(geometry)).simplify(0.6, preserve_topology=True)


def project_tile_geometry(geometry: BaseGeometry, *, depth: int) -> BaseGeometry:
    def project(x, y, z=None):
        del z
        return project_tile_position(float(x), float(y), depth=depth)

    return transform(project, force_2d(geometry)).simplify(0.6, preserve_topology=True)


def project_tile_bounds(
    bounds: tuple[float, float, float, float],
    *,
    depth: int,
) -> tuple[float, float, float, float]:
    west, north, east, south = normalize_bounds(bounds)
    north_west = project_tile_position(west, north, depth=depth)
    south_east = project_tile_position(east, south, depth=depth)
    return normalize_bounds((*north_west, *south_east))


def project_tile_position(x: float, y: float, *, depth: int) -> tuple[float, float]:
    west, south, east, north = WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS
    longitude = x / MVT_EXTENT * 360.0 - 180.0
    mercator_y = math.pi - 2.0 * math.pi * y / MVT_EXTENT
    latitude = math.degrees(math.atan(math.sinh(mercator_y)))
    projected_x = (longitude - west) / (east - west) * VIEWBOX_WIDTH
    projected_y = (north - latitude) / (north - south) * VIEWBOX_HEIGHT
    return projected_x, projected_y


def project_geographic_bounds(
    west: float,
    south: float,
    east: float,
    north: float,
    *,
    depth: int,
) -> tuple[float, float, float, float]:
    frame_west, frame_south, frame_east, frame_north = (
        WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS
    )
    min_x = (west - frame_west) / (frame_east - frame_west) * VIEWBOX_WIDTH
    max_x = (east - frame_west) / (frame_east - frame_west) * VIEWBOX_WIDTH
    min_y = (frame_north - north) / (frame_north - frame_south) * VIEWBOX_HEIGHT
    max_y = (frame_north - south) / (frame_north - frame_south) * VIEWBOX_HEIGHT
    return normalize_bounds((min_x, min_y, max_x, max_y))


def bounded_geometry_path(geometry: BaseGeometry) -> str:
    path = geometry_to_svg_path(geometry)
    if len(path) <= MAX_THUMBNAIL_PATH_LENGTH:
        return path
    for tolerance in (1.2, 2.4, 4.8, 9.6):
        simplified = geometry.simplify(tolerance, preserve_topology=False)
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
