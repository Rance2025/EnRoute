from __future__ import annotations

import json
import sqlite3
from functools import lru_cache
from typing import Iterable

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, shape
from shapely.ops import transform

VIEWBOX_WIDTH = 320.0
VIEWBOX_HEIGHT = 150.0
VIEWBOX = "0 0 320 150"
WORLD_BOUNDS = (-180.0, -58.0, 180.0, 85.0)
CHINA_BOUNDS = (73.0, 17.0, 136.0, 55.0)


def create_admin_region_thumbnail(
    connection: sqlite3.Connection,
    *,
    depth: int,
    visited_region_ids: set[str],
) -> dict[str, str]:
    if depth not in {1, 2, 3, 4}:
        raise ValueError("depth must be one of 1, 2, 3, or 4")

    rows = connection.execute(
        """
        SELECT id, geometry
        FROM admin_regions
        WHERE level = :depth
          AND (
            :depth != 1
            OR (
              LOWER(TRIM(name)) NOT IN ('antarctica', '南极洲')
              AND LOWER(TRIM(id)) NOT IN (
                'aq', 'ata', '010', 'country:aq', 'country:ata', 'country:010'
              )
              AND LOWER(TRIM(id)) NOT LIKE '%:aq'
              AND LOWER(TRIM(id)) NOT LIKE '%:ata'
            )
          )
        ORDER BY id
        """,
        {"depth": depth},
    ).fetchall()
    paths = [
        (str(row["id"]), project_geometry_path(str(row["geometry"]), depth))
        for row in rows
    ]
    return {
        "viewBox": VIEWBOX,
        "basePath": "".join(path for _, path in paths),
        "visitedPath": "".join(
            path for region_id, path in paths if region_id in visited_region_ids
        ),
    }


@lru_cache(maxsize=8192)
def project_geometry_path(geometry_json: str, depth: int) -> str:
    west, south, east, north = WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS
    geometry = shape(json.loads(geometry_json))

    def project(x, y, z=None):
        projected_x = (x - west) / (east - west) * VIEWBOX_WIDTH
        projected_y = (north - y) / (north - south) * VIEWBOX_HEIGHT
        if z is None:
            return projected_x, projected_y
        return projected_x, projected_y, z

    projected = transform(project, geometry).simplify(0.6, preserve_topology=True)
    return geometry_to_svg_path(projected)


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


def ring_to_svg_path(coordinates: Iterable[tuple[float, float]]) -> str:
    points = list(coordinates)
    if not points:
        return ""
    head = f"M{points[0][0]:.1f} {points[0][1]:.1f}"
    tail = "".join(f"L{x:.1f} {y:.1f}" for x, y in points[1:])
    return f"{head}{tail}Z"
