from __future__ import annotations

import json
import math
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Iterable

from mapbox_vector_tile import decode, encode
from shapely.geometry import box, mapping, shape
from shapely.geometry.base import BaseGeometry

from enroute_api.footprints.visual_tiles import MVT_EXTENT, tile_bounds

ADMIN_REGION_TILE_LAYER_NAME = "admin_regions"
ADMIN_REGION_WORLD_FOCUS_ID = "world"
ADMIN_REGION_FILL_FEATURE_KIND = "fill"
ADMIN_REGION_LINE_FEATURE_KIND = "line"
MAX_ADMIN_REGION_TILE_ZOOM = 16
DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM = 8
MAX_MERCATOR_LATITUDE = 85.05112878
ADMIN_REGION_TILE_ALGORITHM_SIGNATURE = "admin-region-mvt-v1-wgs84-global-l1-l3"


@dataclass(frozen=True)
class AdminRegionTileBuildResult:
    focus_region_id: str
    depth: int
    min_zoom: int
    max_zoom: int
    candidate_count: int
    built_count: int
    feature_count: int


@dataclass(frozen=True)
class PreparedAdminRegionTileRow:
    row: sqlite3.Row
    geometry: BaseGeometry
    boundary: BaseGeometry


def initialize_admin_region_tile_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS admin_region_tiles (
          z INTEGER NOT NULL,
          x INTEGER NOT NULL,
          y INTEGER NOT NULL,
          focus_region_id TEXT NOT NULL,
          depth INTEGER NOT NULL,
          algorithm_signature TEXT NOT NULL DEFAULT '',
          tile BLOB NOT NULL,
          feature_count INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (z, x, y, focus_region_id, depth)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_admin_region_tiles_focus
          ON admin_region_tiles(focus_region_id, depth, z);
        """,
    )
    migrate_admin_region_tile_algorithm_signature(connection)
    connection.commit()


def migrate_admin_region_tile_algorithm_signature(connection: sqlite3.Connection) -> None:
    columns = [column[1] for column in connection.execute("PRAGMA table_info(admin_region_tiles)")]
    if "algorithm_signature" not in columns:
        connection.execute(
            "ALTER TABLE admin_region_tiles ADD COLUMN algorithm_signature TEXT NOT NULL DEFAULT ''",
        )


def validate_admin_region_tile_depth(depth: int) -> None:
    if depth not in {1, 2, 3}:
        raise ValueError("depth must be one of 1, 2, or 3")


def validate_admin_region_tile_zoom_range(*, min_zoom: int, max_zoom: int) -> None:
    if min_zoom < 0:
        raise ValueError("min_zoom must be greater than or equal to 0")
    if max_zoom > MAX_ADMIN_REGION_TILE_ZOOM:
        raise ValueError(f"max_zoom must be less than or equal to {MAX_ADMIN_REGION_TILE_ZOOM}")
    if min_zoom > max_zoom:
        raise ValueError("min_zoom must be less than or equal to max_zoom")


def validate_admin_region_tile_coordinates(*, z: int, x: int, y: int) -> None:
    if z < 0 or z > MAX_ADMIN_REGION_TILE_ZOOM:
        raise ValueError(f"z must be between 0 and {MAX_ADMIN_REGION_TILE_ZOOM}")

    max_tile = 2**z - 1
    if x < 0 or y < 0 or x > max_tile or y > max_tile:
        raise ValueError(f"x and y must be between 0 and {max_tile} for z {z}")


def resolve_focused_region_rows(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
) -> list[sqlite3.Row]:
    validate_admin_region_tile_depth(depth)
    if focus_region_id == ADMIN_REGION_WORLD_FOCUS_ID:
        return list(query_world_focus_region_rows(connection, depth=depth))

    descendant_ids = get_descendant_region_ids(connection, focus_region_id=focus_region_id, depth=depth)
    return list(query_regions_by_ids(connection, descendant_ids))


def query_world_focus_region_rows(connection: sqlite3.Connection, *, depth: int) -> list[sqlite3.Row]:
    level_limit = min(max(depth, 1), 3)
    return list(
        connection.execute(
            """
            SELECT
              r.id,
              r.name,
              r.level,
              r.geometry,
              r.min_lng,
              r.max_lng,
              r.min_lat,
              r.max_lat,
              t.parent_id
            FROM admin_regions r
            LEFT JOIN admin_region_tree t ON t.child_id = r.id
            WHERE r.level <= ?
            ORDER BY r.id
            """,
            (level_limit,),
        ),
    )


def get_descendant_region_ids(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
) -> list[str]:
    current_parent_ids = [focus_region_id]
    descendant_ids: list[str] = []
    seen: set[str] = set()

    for _ in range(depth):
        if not current_parent_ids:
            break

        placeholders = ",".join("?" for _ in current_parent_ids)
        rows = connection.execute(
            f"""
            SELECT child_id
            FROM admin_region_tree
            WHERE parent_id IN ({placeholders})
            ORDER BY child_id
            """,
            current_parent_ids,
        ).fetchall()
        next_parent_ids = []
        for row in rows:
            child_id = str(row["child_id"] if isinstance(row, sqlite3.Row) else row[0])
            next_parent_ids.append(child_id)
            if child_id in seen:
                continue
            seen.add(child_id)
            descendant_ids.append(child_id)
        current_parent_ids = next_parent_ids

    return sorted(descendant_ids)


def query_regions_by_ids(
    connection: sqlite3.Connection,
    region_ids: Iterable[str],
) -> list[sqlite3.Row]:
    ids = list(region_ids)
    if not ids:
        return []

    placeholders = ",".join("?" for _ in ids)
    return list(
        connection.execute(
            f"""
            SELECT
              r.id,
              r.name,
              r.level,
              r.geometry,
              r.min_lng,
              r.max_lng,
              r.min_lat,
              r.max_lat,
              t.parent_id
            FROM admin_regions r
            LEFT JOIN admin_region_tree t ON t.child_id = r.id
            WHERE r.id IN ({placeholders})
            ORDER BY r.level, r.id
            """,
            ids,
        ),
    )


def build_admin_region_tile(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    focus_region_id: str,
    depth: int,
    updated_at: int,
) -> bool:
    rows = resolve_focused_region_rows(connection, focus_region_id=focus_region_id, depth=depth)
    return build_admin_region_tile_from_rows(
        connection,
        rows=rows,
        z=z,
        x=x,
        y=y,
        focus_region_id=focus_region_id,
        depth=depth,
        updated_at=updated_at,
    )


def build_admin_region_tile_from_rows(
    connection: sqlite3.Connection,
    *,
    rows: list[sqlite3.Row],
    z: int,
    x: int,
    y: int,
    focus_region_id: str,
    depth: int,
    updated_at: int,
) -> bool:
    return build_admin_region_tile_from_prepared_rows(
        connection,
        rows=prepare_admin_region_tile_rows(rows),
        z=z,
        x=x,
        y=y,
        focus_region_id=focus_region_id,
        depth=depth,
        updated_at=updated_at,
    )


def build_admin_region_tile_from_prepared_rows(
    connection: sqlite3.Connection,
    *,
    rows: list[PreparedAdminRegionTileRow],
    z: int,
    x: int,
    y: int,
    focus_region_id: str,
    depth: int,
    updated_at: int,
) -> bool:
    tile = encode_admin_region_mvt_from_prepared_rows(rows, z=z, x=x, y=y)
    if not tile:
        delete_admin_region_tile(
            connection,
            z=z,
            x=x,
            y=y,
            focus_region_id=focus_region_id,
            depth=depth,
        )
        return False

    feature_count = count_tile_features(tile)
    connection.execute(
        """
        INSERT INTO admin_region_tiles (
          z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(z, x, y, focus_region_id, depth) DO UPDATE SET
          algorithm_signature = excluded.algorithm_signature,
          tile = excluded.tile,
          feature_count = excluded.feature_count,
          updated_at = excluded.updated_at
        """,
        (
            z,
            x,
            y,
            focus_region_id,
            depth,
            ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
            tile,
            feature_count,
            updated_at,
        ),
    )
    return True


def build_admin_region_tiles(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    min_zoom: int = 0,
    max_zoom: int = DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM,
    updated_at: int | None = None,
    commit_interval: int = 1000,
) -> AdminRegionTileBuildResult:
    validate_admin_region_tile_depth(depth)
    validate_admin_region_tile_zoom_range(min_zoom=min_zoom, max_zoom=max_zoom)
    resolved_updated_at = int(time.time() * 1000) if updated_at is None else updated_at
    rows = resolve_focused_region_rows(connection, focus_region_id=focus_region_id, depth=depth)
    prepared_rows = prepare_admin_region_tile_rows(rows)
    tile_keys = enumerate_admin_region_tile_keys(prepared_rows, min_zoom=min_zoom, max_zoom=max_zoom)
    built_count = 0

    for z, x, y in tile_keys:
        if build_admin_region_tile_from_prepared_rows(
            connection,
            rows=prepared_rows,
            z=z,
            x=x,
            y=y,
            focus_region_id=focus_region_id,
            depth=depth,
            updated_at=resolved_updated_at,
        ):
            built_count += 1
        if commit_interval > 0 and built_count > 0 and built_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(tile_keys),
        built_count=built_count,
        feature_count=len(rows),
    )


def enumerate_admin_region_tile_keys(
    rows: list[PreparedAdminRegionTileRow],
    *,
    min_zoom: int,
    max_zoom: int,
) -> list[tuple[int, int, int]]:
    tile_keys: set[tuple[int, int, int]] = set()
    for row in rows:
        if row.geometry.is_empty:
            continue
        min_lng, min_lat, max_lng, max_lat = row.geometry.bounds
        for z in range(min_zoom, max_zoom + 1):
            west_x, north_y = coordinate_to_tile(
                longitude=float(min_lng),
                latitude=float(max_lat),
                z=z,
            )
            east_x, south_y = coordinate_to_tile(
                longitude=float(max_lng),
                latitude=float(min_lat),
                z=z,
            )
            for tile_x in range(min(west_x, east_x), max(west_x, east_x) + 1):
                for tile_y in range(min(north_y, south_y), max(north_y, south_y) + 1):
                    tile_keys.add((z, tile_x, tile_y))
    return sorted(tile_keys)


def read_admin_region_tile(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    focus_region_id: str,
    depth: int,
) -> bytes:
    validate_admin_region_tile_depth(depth)
    validate_admin_region_tile_coordinates(z=z, x=x, y=y)
    row = connection.execute(
        """
        SELECT tile
        FROM admin_region_tiles
        WHERE z = ?
          AND x = ?
          AND y = ?
          AND focus_region_id = ?
          AND depth = ?
          AND algorithm_signature = ?
        """,
        (z, x, y, focus_region_id, depth, ADMIN_REGION_TILE_ALGORITHM_SIGNATURE),
    ).fetchone()
    if row is None:
        return b""
    tile = row["tile"] if isinstance(row, sqlite3.Row) else row[0]
    return bytes(tile)


def delete_admin_region_tile(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    focus_region_id: str,
    depth: int,
) -> None:
    connection.execute(
        """
        DELETE FROM admin_region_tiles
        WHERE z = ? AND x = ? AND y = ? AND focus_region_id = ? AND depth = ?
        """,
        (z, x, y, focus_region_id, depth),
    )


def clear_admin_region_tiles(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM admin_region_tiles")


def prepare_admin_region_tile_rows(rows: list[sqlite3.Row]) -> list[PreparedAdminRegionTileRow]:
    prepared_rows = []
    for row in rows:
        geometry = shape(json.loads(str(row["geometry"])))
        prepared_rows.append(
            PreparedAdminRegionTileRow(
                row=row,
                geometry=geometry,
                boundary=geometry.boundary,
            ),
        )
    return prepared_rows


def encode_admin_region_mvt(rows: list[sqlite3.Row], *, z: int, x: int, y: int) -> bytes:
    return encode_admin_region_mvt_from_prepared_rows(
        prepare_admin_region_tile_rows(rows),
        z=z,
        x=x,
        y=y,
    )


def encode_admin_region_mvt_from_prepared_rows(
    rows: list[PreparedAdminRegionTileRow],
    *,
    z: int,
    x: int,
    y: int,
) -> bytes:
    fill_features = []
    line_features = []
    west, south, east, north = tile_bounds(z=z, x=x, y=y)
    tile_box = box(west, south, east, north)
    for prepared_row in rows:
        if not row_intersects_tile(prepared_row, west=west, south=south, east=east, north=north):
            continue
        properties = create_admin_region_tile_properties(prepared_row.row)
        clipped_geometry = prepared_row.geometry.intersection(tile_box)
        clipped_boundary = prepared_row.boundary.intersection(tile_box)
        projected_geometry = project_shapely_geometry_to_tile(clipped_geometry, z=z, x=x, y=y)
        projected_boundary = project_shapely_geometry_to_tile(clipped_boundary, z=z, x=x, y=y)
        if projected_geometry is not None:
            fill_features.append(
                {
                    "geometry": projected_geometry,
                    "properties": {
                        **properties,
                        "kind": ADMIN_REGION_FILL_FEATURE_KIND,
                    },
                },
            )
        if projected_boundary is not None:
            line_features.append(
                {
                    "geometry": projected_boundary,
                    "properties": {
                        **properties,
                        "kind": ADMIN_REGION_LINE_FEATURE_KIND,
                    },
                },
            )

    features = [*fill_features, *deduplicate_admin_region_line_features(line_features)]
    if not features:
        return b""

    return encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": features,
            },
        ],
        default_options={
            "extents": MVT_EXTENT,
            "y_coord_down": True,
        },
    )


def count_tile_features(tile: bytes) -> int:
    decoded = decode(tile)
    return len(decoded.get(ADMIN_REGION_TILE_LAYER_NAME, {}).get("features", []))


def create_admin_region_tile_properties(row: sqlite3.Row) -> dict[str, object]:
    return {
        "region_id": str(row["id"]),
        "parent_id": "" if row["parent_id"] is None else str(row["parent_id"]),
        "level": int(row["level"]),
        "name": str(row["name"]),
    }


def deduplicate_admin_region_line_features(
    features: list[dict[str, object]],
) -> list[dict[str, object]]:
    seen_segments: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    deduplicated_features = []
    for feature in features:
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            continue
        deduplicated_geometry = deduplicate_line_geometry_segments(geometry, seen_segments)
        if deduplicated_geometry is None:
            continue
        deduplicated_features.append(
            {
                **feature,
                "geometry": deduplicated_geometry,
            },
        )
    return deduplicated_features


def deduplicate_line_geometry_segments(
    geometry: dict[str, Any],
    seen_segments: set[tuple[tuple[int, int], tuple[int, int]]],
) -> dict[str, Any] | None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, (list, tuple)):
        lines = [coordinates]
    elif geometry_type == "MultiLineString" and isinstance(coordinates, (list, tuple)):
        lines = coordinates
    else:
        return None

    deduplicated_lines = []
    for line in lines:
        if not isinstance(line, (list, tuple)):
            continue
        for segment_line in split_line_into_unique_segment_runs(line, seen_segments):
            if len(segment_line) >= 2:
                deduplicated_lines.append(segment_line)

    if not deduplicated_lines:
        return None
    if len(deduplicated_lines) == 1:
        return {"type": "LineString", "coordinates": deduplicated_lines[0]}
    return {"type": "MultiLineString", "coordinates": deduplicated_lines}


def split_line_into_unique_segment_runs(
    line: list[Any] | tuple[Any, ...],
    seen_segments: set[tuple[tuple[int, int], tuple[int, int]]],
) -> list[list[list[int]]]:
    points = [
        [int(point[0]), int(point[1])]
        for point in line
        if isinstance(point, (list, tuple)) and len(point) >= 2
    ]
    runs = []
    current_run: list[list[int]] = []

    for start, end in zip(points, points[1:]):
        segment = canonical_tile_segment(start, end)
        if segment is None:
            continue
        if segment in seen_segments:
            if len(current_run) >= 2:
                runs.append(current_run)
            current_run = []
            continue
        seen_segments.add(segment)
        if not current_run:
            current_run = [start, end]
        elif current_run[-1] == start:
            current_run.append(end)
        else:
            if len(current_run) >= 2:
                runs.append(current_run)
            current_run = [start, end]

    if len(current_run) >= 2:
        runs.append(current_run)
    return runs


def canonical_tile_segment(
    start: list[int],
    end: list[int],
) -> tuple[tuple[int, int], tuple[int, int]] | None:
    first = (start[0], start[1])
    second = (end[0], end[1])
    if first == second:
        return None
    return (first, second) if first <= second else (second, first)


def row_intersects_tile(
    row: PreparedAdminRegionTileRow,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
) -> bool:
    if row.geometry.is_empty:
        return False
    min_lng, min_lat, max_lng, max_lat = row.geometry.bounds
    return (
        float(min_lng) <= east
        and float(max_lng) >= west
        and float(min_lat) <= north
        and float(max_lat) >= south
    )


def project_shapely_geometry_to_tile(
    geometry: BaseGeometry,
    *,
    z: int,
    x: int,
    y: int,
) -> dict[str, Any] | None:
    if geometry.is_empty:
        return None
    return project_geojson_geometry_to_tile(mapping(geometry), z=z, x=x, y=y)


def project_geojson_geometry_to_tile(
    geometry: dict[str, Any],
    *,
    z: int,
    x: int,
    y: int,
) -> dict[str, Any] | None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, (list, tuple)):
        polygon = project_polygon_to_tile(coordinates, z=z, x=x, y=y)
        if polygon is None:
            return None
        return {"type": "Polygon", "coordinates": polygon}
    if geometry_type == "MultiPolygon" and isinstance(coordinates, (list, tuple)):
        polygons = [
            polygon
            for polygon in (
                project_polygon_to_tile(current_polygon, z=z, x=x, y=y)
                for current_polygon in coordinates
            )
            if polygon is not None
        ]
        if not polygons:
            return None
        return {"type": "MultiPolygon", "coordinates": polygons}
    if geometry_type == "LineString" and isinstance(coordinates, (list, tuple)):
        line = project_line_to_tile(coordinates, z=z, x=x, y=y)
        if line is None:
            return None
        return {"type": "LineString", "coordinates": line}
    if geometry_type == "MultiLineString" and isinstance(coordinates, (list, tuple)):
        lines = [
            line
            for line in (
                project_line_to_tile(current_line, z=z, x=x, y=y)
                for current_line in coordinates
            )
            if line is not None
        ]
        if not lines:
            return None
        return {"type": "MultiLineString", "coordinates": lines}
    if geometry_type == "GeometryCollection":
        projected = project_geometry_collection_to_tile(geometry, z=z, x=x, y=y)
        if projected is None:
            return None
        return normalize_projected_geometry_collection(projected)
    return None


def project_geometry_collection_to_tile(
    geometry: dict[str, Any],
    *,
    z: int,
    x: int,
    y: int,
) -> dict[str, Any] | None:
    geometries = geometry.get("geometries")
    if not isinstance(geometries, list):
        return None

    polygons = []
    lines = []
    for current_geometry in geometries:
        if not isinstance(current_geometry, dict):
            continue
        projected = project_geojson_geometry_to_tile(current_geometry, z=z, x=x, y=y)
        if projected is None:
            continue
        if projected["type"] == "Polygon":
            polygons.append(projected["coordinates"])
        elif projected["type"] == "MultiPolygon":
            polygons.extend(projected["coordinates"])
        elif projected["type"] == "LineString":
            lines.append(projected["coordinates"])
        elif projected["type"] == "MultiLineString":
            lines.extend(projected["coordinates"])

    if polygons and not lines:
        return {"type": "MultiPolygon", "coordinates": polygons}
    if lines and not polygons:
        return {"type": "MultiLineString", "coordinates": lines}
    if polygons or lines:
        geometries = []
        if polygons:
            geometries.append({"type": "MultiPolygon", "coordinates": polygons})
        if lines:
            geometries.append({"type": "MultiLineString", "coordinates": lines})
        return {"type": "GeometryCollection", "geometries": geometries}
    return None


def normalize_projected_geometry_collection(geometry: dict[str, Any]) -> dict[str, Any] | None:
    geometries = geometry.get("geometries")
    if geometry.get("type") != "GeometryCollection" or not isinstance(geometries, list):
        return geometry

    polygons = []
    lines = []
    for current_geometry in geometries:
        if not isinstance(current_geometry, dict):
            continue
        geometry_type = current_geometry.get("type")
        coordinates = current_geometry.get("coordinates")
        if geometry_type == "Polygon" and isinstance(coordinates, (list, tuple)):
            polygons.append(coordinates)
        elif geometry_type == "MultiPolygon" and isinstance(coordinates, (list, tuple)):
            polygons.extend(coordinates)
        elif geometry_type == "LineString" and isinstance(coordinates, (list, tuple)):
            lines.append(coordinates)
        elif geometry_type == "MultiLineString" and isinstance(coordinates, (list, tuple)):
            lines.extend(coordinates)

    if polygons:
        return {"type": "MultiPolygon", "coordinates": polygons}
    if lines:
        return {"type": "MultiLineString", "coordinates": lines}
    return None


def project_polygon_to_tile(
    polygon: list[Any] | tuple[Any, ...],
    *,
    z: int,
    x: int,
    y: int,
) -> list[list[list[int]]] | None:
    rings = [
        projected_ring
        for projected_ring in (
            project_ring_to_tile(ring, z=z, x=x, y=y)
            for ring in polygon
            if isinstance(ring, (list, tuple))
        )
        if projected_ring is not None
    ]
    if not rings:
        return None
    return rings


def project_ring_to_tile(
    ring: list[Any] | tuple[Any, ...],
    *,
    z: int,
    x: int,
    y: int,
) -> list[list[int]] | None:
    projected = []
    for position in ring:
        if not isinstance(position, (list, tuple)) or len(position) < 2:
            continue
        geom_x, geom_y = project_to_tile_geometry(
            longitude=float(position[0]),
            latitude=float(position[1]),
            z=z,
            x=x,
            y=y,
        )
        point = [geom_x, geom_y]
        if not projected or projected[-1] != point:
            projected.append(point)

    if len(projected) < 3:
        return None
    if projected[0] != projected[-1]:
        projected.append(projected[0])
    if len(projected) < 4:
        return None
    return projected


def project_line_to_tile(
    line: list[Any] | tuple[Any, ...],
    *,
    z: int,
    x: int,
    y: int,
) -> list[list[int]] | None:
    projected = []
    for position in line:
        if not isinstance(position, (list, tuple)) or len(position) < 2:
            continue
        geom_x, geom_y = project_to_tile_geometry(
            longitude=float(position[0]),
            latitude=float(position[1]),
            z=z,
            x=x,
            y=y,
        )
        point = [geom_x, geom_y]
        if not projected or projected[-1] != point:
            projected.append(point)

    if len(projected) < 2:
        return None
    return projected


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
