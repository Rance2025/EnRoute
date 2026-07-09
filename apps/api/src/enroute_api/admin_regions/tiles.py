from __future__ import annotations

import json
import math
import sqlite3
import time
from dataclasses import dataclass
from collections import defaultdict
from functools import lru_cache
from typing import Any, Iterable

from mapbox_vector_tile import decode, encode
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import clip_by_rect

from enroute_api.footprints.coordinates import transform_gcj02_to_wgs84_coordinate
from enroute_api.footprints.visual_tiles import MVT_EXTENT, tile_bounds
from enroute_api.admin_regions.scope import is_antarctica_admin_region_properties

ADMIN_REGION_TILE_LAYER_NAME = "admin_regions"
ADMIN_REGION_WORLD_FOCUS_ID = "world"
ADMIN_REGION_FILL_FEATURE_KIND = "fill"
ADMIN_REGION_LINE_FEATURE_KIND = "line"
MAX_ADMIN_REGION_TILE_ZOOM = 16
DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM = 9
MAX_MERCATOR_LATITUDE = 85.05112878
ADMIN_REGION_TILE_ALGORITHM_SIGNATURE = "admin-region-mvt-v15-cn-worldview-country-union-render-wgs84-index-preclip-fill-derived-boundary-line-dedupe-no-antarctica"
LEGACY_COUNTRY_ADMIN_REGION_TILE_ALGORITHM_SIGNATURES = (
    "admin-region-mvt-v14-render-wgs84-index-preclip-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v13-render-wgs84-preclip-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v12-render-wgs84-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v11-render-wgs84-fill-derived-boundary-line-dedupe",
    "admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe",
    "admin-region-mvt-v9-render-wgs84-fill-boundary-line-dedupe",
    "admin-region-mvt-v8-exact-level-fill-boundary-line-dedupe",
    "admin-region-mvt-v7-fill-boundary-line-dedupe",
    "admin-region-mvt-v6-country-fill-boundary-line-mask",
    "admin-region-mvt-v1-wgs84-global-l1-l3",
)
LEGACY_NON_COUNTRY_ADMIN_REGION_TILE_ALGORITHM_SIGNATURES = (
    "admin-region-mvt-v14-render-wgs84-index-preclip-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v13-render-wgs84-preclip-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v12-render-wgs84-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v11-render-wgs84-fill-derived-boundary-line-dedupe",
    "admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe",
    "admin-region-mvt-v9-render-wgs84-fill-boundary-line-dedupe",
    "admin-region-mvt-v8-exact-level-fill-boundary-line-dedupe",
    "admin-region-mvt-v7-fill-boundary-line-dedupe",
    "admin-region-mvt-v6-country-fill-boundary-line-mask",
    "admin-region-mvt-v5-cn-worldview-line-mask",
)
ADMIN_REGION_LINE_VISUAL_SNAP_UNITS = 8
ADMIN_REGION_LEGACY_REBUILD_TILE_BBOX_PADDING_DEGREES = 0.02
ADMIN_REGION_CACHED_LEGACY_NON_COUNTRY_MAX_ZOOM = 7
ADMIN_REGION_DIRECT_READ_LEGACY_NON_COUNTRY_MAX_ZOOM = 4
ADMIN_REGION_LINE_READY_ALGORITHM_SIGNATURES = (
    "admin-region-mvt-v14-render-wgs84-index-preclip-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v13-render-wgs84-preclip-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v12-render-wgs84-fill-derived-boundary-line-dedupe-no-antarctica",
    "admin-region-mvt-v11-render-wgs84-fill-derived-boundary-line-dedupe",
    "admin-region-mvt-v10-render-wgs84-fill-boundary-line-dedupe",
    "admin-region-mvt-v9-render-wgs84-fill-boundary-line-dedupe",
    "admin-region-mvt-v8-exact-level-fill-boundary-line-dedupe",
    "admin-region-mvt-v7-fill-boundary-line-dedupe",
    "admin-region-mvt-v1-wgs84-global-l1-l3",
)
ADMIN_REGION_DIRECT_READ_COUNTRY_ALGORITHM_SIGNATURES = (
    "admin-region-mvt-v1-wgs84-global-l1-l3",
)


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
    boundary: BaseGeometry | None = None
    line_mask_geometry: BaseGeometry | None = None


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
    if depth not in {1, 2, 3, 4}:
        raise ValueError("depth must be one of 1, 2, 3, or 4")


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
    level_limit = min(max(depth, 1), 4)
    if level_limit == 1:
        return list(
            connection.execute(
                """
                SELECT
                  r.id,
                  r.name,
                  r.level,
                  r.geometry,
                  r.line_geometry,
                  r.line_mask_geometry,
                  r.min_lng,
                  r.max_lng,
                  r.min_lat,
                  r.max_lat,
                  t.parent_id
                FROM admin_regions r
                LEFT JOIN admin_region_tree t ON t.child_id = r.id
                WHERE r.level = 1
                  AND lower(r.name) != 'antarctica'
                  AND lower(r.id) NOT IN ('aq', 'ata', '010', 'country:aq', 'country:ata')
                  AND lower(r.id) NOT LIKE '%:aq'
                  AND lower(r.id) NOT LIKE '%:ata'
                ORDER BY r.id
                """,
            ),
        )

    return list(
        connection.execute(
            """
            WITH RECURSIVE china_descendants(id) AS (
              SELECT id
              FROM admin_regions
              WHERE id IN ('cn', 'CN', 'chn', 'CHN', '156')
                 OR (
                   length(id) >= 6
                   AND substr(id, 1, 6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
                   AND substr(id, 1, 2) BETWEEN '11' AND '82'
                 )
              UNION
              SELECT tree.child_id
              FROM admin_region_tree tree
              JOIN china_descendants parent ON parent.id = tree.parent_id
            )
            SELECT
              r.id,
              r.name,
              r.level,
              r.geometry,
              r.line_geometry,
              r.line_mask_geometry,
              r.min_lng,
              r.max_lng,
              r.min_lat,
              r.max_lat,
              t.parent_id
            FROM admin_regions r
            LEFT JOIN admin_region_tree t ON t.child_id = r.id
            WHERE r.level = ?
              AND r.id IN (SELECT id FROM china_descendants)
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
              r.line_geometry,
              r.line_mask_geometry,
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
    rows_by_tile_key = index_admin_region_tile_rows(prepared_rows, min_zoom=min_zoom, max_zoom=max_zoom)
    tile_keys = sorted(rows_by_tile_key)
    built_count = 0

    for z, x, y in tile_keys:
        if build_admin_region_tile_from_prepared_rows(
            connection,
            rows=rows_by_tile_key[(z, x, y)],
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


def build_admin_region_tile_keys(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    tile_keys: Iterable[tuple[int, int, int]],
    updated_at: int | None = None,
    commit_interval: int = 1000,
) -> AdminRegionTileBuildResult:
    validate_admin_region_tile_depth(depth)
    resolved_tile_keys = sorted(set(tile_keys))
    for z, x, y in resolved_tile_keys:
        validate_admin_region_tile_coordinates(z=z, x=x, y=y)

    resolved_updated_at = int(time.time() * 1000) if updated_at is None else updated_at
    rows = resolve_focused_region_rows(connection, focus_region_id=focus_region_id, depth=depth)
    prepared_rows = prepare_admin_region_tile_rows(rows)
    built_count = 0

    for z, x, y in resolved_tile_keys:
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
    zooms = [z for z, _x, _y in resolved_tile_keys]
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min(zooms) if zooms else 0,
        max_zoom=max(zooms) if zooms else 0,
        candidate_count=len(resolved_tile_keys),
        built_count=built_count,
        feature_count=len(rows),
    )


def enumerate_admin_region_tile_keys(
    rows: list[PreparedAdminRegionTileRow],
    *,
    min_zoom: int,
    max_zoom: int,
) -> list[tuple[int, int, int]]:
    return sorted(index_admin_region_tile_rows(rows, min_zoom=min_zoom, max_zoom=max_zoom))


def index_admin_region_tile_rows(
    rows: list[PreparedAdminRegionTileRow],
    *,
    min_zoom: int,
    max_zoom: int,
) -> dict[tuple[int, int, int], list[PreparedAdminRegionTileRow]]:
    rows_by_tile_key: dict[tuple[int, int, int], list[PreparedAdminRegionTileRow]] = defaultdict(list)
    for row in rows:
        render_geometry = transform_admin_region_render_geometry(row.geometry, row.row)
        for geometry, render_key_geometry in zip(
            iter_tile_key_geometries(row.geometry),
            iter_tile_key_geometries(render_geometry),
            strict=False,
        ):
            render_min_lng, render_min_lat, render_max_lng, render_max_lat = render_key_geometry.bounds
            for z in range(min_zoom, max_zoom + 1):
                west_x, north_y = coordinate_to_tile(
                    longitude=float(render_min_lng),
                    latitude=float(render_max_lat),
                    z=z,
                )
                east_x, south_y = coordinate_to_tile(
                    longitude=float(render_max_lng),
                    latitude=float(render_min_lat),
                    z=z,
                )
                for tile_x in range(min(west_x, east_x), max(west_x, east_x) + 1):
                    for tile_y in range(min(north_y, south_y), max(north_y, south_y) + 1):
                        west, south, east, north = tile_bounds(z=z, x=tile_x, y=tile_y)
                        rows_by_tile_key[(z, tile_x, tile_y)].append(
                            PreparedAdminRegionTileRow(
                                row=row.row,
                                geometry=geometry,
                                boundary=None
                                if row.boundary is None
                                else clip_prepared_geometry_to_tile(
                                    row.boundary,
                                    west=west,
                                    south=south,
                                    east=east,
                                    north=north,
                                ),
                                line_mask_geometry=clip_prepared_geometry_to_tile(
                                    row.line_mask_geometry,
                                    west=west,
                                    south=south,
                                    east=east,
                                    north=north,
                                ),
                            ),
                        )
    return dict(rows_by_tile_key)


def clip_prepared_geometry_to_tile(
    geometry: BaseGeometry | None,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
) -> BaseGeometry | None:
    if geometry is None:
        return None
    clipped = clip_by_rect(geometry, west, south, east, north)
    return None if clipped.is_empty else clipped


def iter_tile_key_geometries(geometry: BaseGeometry) -> Iterable[BaseGeometry]:
    if geometry.is_empty:
        return
    if geometry.geom_type in {"MultiPolygon", "MultiLineString", "GeometryCollection"}:
        for child_geometry in geometry.geoms:
            yield from iter_tile_key_geometries(child_geometry)
        return
    yield geometry


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
        """,
        (z, x, y, focus_region_id, depth),
    ).fetchone()
    if row is None:
        return b""
    tile = row["tile"] if isinstance(row, sqlite3.Row) else row[0]
    return bytes(tile)


def resolve_readable_admin_region_tile_signatures(*, depth: int) -> tuple[str, ...]:
    if depth == 1:
        return (
            ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
            *LEGACY_COUNTRY_ADMIN_REGION_TILE_ALGORITHM_SIGNATURES,
        )
    return (
        ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
        *LEGACY_NON_COUNTRY_ADMIN_REGION_TILE_ALGORITHM_SIGNATURES,
    )


def should_derive_cached_admin_region_lines(algorithm_signature: str, *, depth: int, z: int) -> bool:
    if should_read_cached_admin_region_tile_directly(algorithm_signature, depth=depth, z=z):
        return False
    if (
        depth > 1
        and z <= ADMIN_REGION_CACHED_LEGACY_NON_COUNTRY_MAX_ZOOM
        and algorithm_signature in ADMIN_REGION_LINE_READY_ALGORITHM_SIGNATURES
    ):
        return False
    return algorithm_signature != ADMIN_REGION_TILE_ALGORITHM_SIGNATURE


def should_read_cached_admin_region_tile_directly(algorithm_signature: str, *, depth: int, z: int) -> bool:
    if depth <= 1:
        return algorithm_signature in ADMIN_REGION_DIRECT_READ_COUNTRY_ALGORITHM_SIGNATURES
    return (
        z <= ADMIN_REGION_DIRECT_READ_LEGACY_NON_COUNTRY_MAX_ZOOM
        and algorithm_signature in ADMIN_REGION_LINE_READY_ALGORITHM_SIGNATURES
    )


def should_rebuild_legacy_admin_region_tile_from_current_rows(
    algorithm_signature: str,
    *,
    depth: int,
    z: int,
) -> bool:
    if depth <= 1 or algorithm_signature == ADMIN_REGION_TILE_ALGORITHM_SIGNATURE:
        return False
    if z <= ADMIN_REGION_CACHED_LEGACY_NON_COUNTRY_MAX_ZOOM:
        return False
    return True


def should_rebuild_missing_admin_region_tile_from_current_rows(*, depth: int) -> bool:
    return depth > 1


def rebuild_admin_region_tile_from_current_rows(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    focus_region_id: str,
    depth: int,
) -> bytes:
    rows = resolve_focused_region_rows_for_tile(
        connection,
        z=z,
        x=x,
        y=y,
        focus_region_id=focus_region_id,
        depth=depth,
    )
    if not rows:
        return b""
    return encode_admin_region_mvt(rows, z=z, x=x, y=y)


def resolve_focused_region_rows_for_tile(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    focus_region_id: str,
    depth: int,
) -> list[sqlite3.Row]:
    rows = resolve_focused_region_rows(connection, focus_region_id=focus_region_id, depth=depth)
    if not rows:
        return []

    west, south, east, north = tile_bounds(z=z, x=x, y=y)
    padding = ADMIN_REGION_LEGACY_REBUILD_TILE_BBOX_PADDING_DEGREES
    return [
        row
        for row in rows
        if (
            float(row["min_lng"]) <= east + padding
            and float(row["max_lng"]) >= west - padding
            and float(row["min_lat"]) <= north + padding
            and float(row["max_lat"]) >= south - padding
        )
    ]


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
        line_mask_geometry = get_optional_row_value(row, "line_mask_geometry")
        line_mask = None
        if line_mask_geometry is not None:
            line_mask = shape(json.loads(str(line_mask_geometry)))
        prepared_rows.append(
            PreparedAdminRegionTileRow(
                row=row,
                geometry=geometry,
                boundary=None,
                line_mask_geometry=line_mask,
            ),
        )
    return prepared_rows


def get_optional_row_value(row: sqlite3.Row, key: str) -> object | None:
    if key not in row.keys():
        return None
    value = row[key]
    return None if value is None else value


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
    for prepared_row in rows:
        if not row_intersects_tile(prepared_row, west=west, south=south, east=east, north=north):
            continue
        properties = create_admin_region_tile_properties(prepared_row.row)
        render_source_geometry = transform_admin_region_render_geometry(
            prepared_row.geometry,
            prepared_row.row,
        )
        clipped_geometry = clip_by_rect(render_source_geometry, west, south, east, north)
        boundary = prepared_row.geometry.boundary if prepared_row.boundary is None else prepared_row.boundary
        if prepared_row.line_mask_geometry is not None and not boundary.is_empty:
            boundary = boundary.difference(prepared_row.line_mask_geometry)
        render_boundary = transform_admin_region_render_geometry(boundary, prepared_row.row)
        clipped_boundary = clip_by_rect(render_boundary, west, south, east, north)
        projected_geometry = project_shapely_geometry_to_tile(clipped_geometry, z=z, x=x, y=y)
        row_fill_features = (
            create_admin_region_fill_features(
                prepared_row.row,
                projected_geometry,
                properties=properties,
            )
            if projected_geometry is not None
            else []
        )
        if projected_geometry is not None:
            fill_features.extend(row_fill_features)
        projected_boundary = (
            project_shapely_geometry_to_tile(
                clipped_boundary,
                z=z,
                x=x,
                y=y,
            )
            if row_fill_features
            else None
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
        elif prepared_row.line_mask_geometry is None:
            line_features.extend(create_admin_region_line_features_from_fill_features(row_fill_features))

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


def transform_admin_region_render_geometry(geometry: BaseGeometry, row: sqlite3.Row) -> BaseGeometry:
    if geometry.is_empty or not should_transform_admin_region_render_coordinates(row):
        return geometry
    geojson_geometry = transform_geojson_geometry_coordinates(
        mapping(geometry),
        transform_gcj02_to_wgs84_position,
    )
    return shape(geojson_geometry)


def should_transform_admin_region_render_coordinates(row: sqlite3.Row) -> bool:
    region_id = str(row["id"])
    level = int(row["level"])
    return level > 1 and is_china_admin_region_id(region_id)


def is_china_admin_region_id(region_id: str) -> bool:
    adcode_prefix = region_id[:6]
    if len(adcode_prefix) != 6 or not adcode_prefix.isdigit():
        return False
    province_code = int(adcode_prefix[:2])
    return 11 <= province_code <= 82


def transform_geojson_geometry_coordinates(
    geometry: dict[str, Any],
    transformer,
) -> dict[str, Any]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Point" and isinstance(coordinates, (list, tuple)):
        return {"type": "Point", "coordinates": transformer(coordinates)}
    if geometry_type in {"LineString", "MultiPoint"} and isinstance(coordinates, (list, tuple)):
        return {
            "type": geometry_type,
            "coordinates": [transformer(position) for position in coordinates],
        }
    if geometry_type in {"Polygon", "MultiLineString"} and isinstance(coordinates, (list, tuple)):
        return {
            "type": geometry_type,
            "coordinates": [
                [transformer(position) for position in line]
                for line in coordinates
                if isinstance(line, (list, tuple))
            ],
        }
    if geometry_type == "MultiPolygon" and isinstance(coordinates, (list, tuple)):
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [
                    [transformer(position) for position in line]
                    for line in polygon
                    if isinstance(line, (list, tuple))
                ]
                for polygon in coordinates
                if isinstance(polygon, (list, tuple))
            ],
        }
    if geometry_type == "GeometryCollection":
        geometries = geometry.get("geometries")
        if not isinstance(geometries, list):
            return geometry
        return {
            "type": "GeometryCollection",
            "geometries": [
                transform_geojson_geometry_coordinates(current_geometry, transformer)
                for current_geometry in geometries
                if isinstance(current_geometry, dict)
            ],
        }
    return geometry


def transform_gcj02_to_wgs84_position(position: Any) -> list[float]:
    if not isinstance(position, (list, tuple)) or len(position) < 2:
        return [0.0, 0.0]
    longitude, latitude = transform_gcj02_to_wgs84_coordinate(
        longitude=float(position[0]),
        latitude=float(position[1]),
    )
    if len(position) > 2:
        return [longitude, latitude, *position[2:]]
    return [longitude, latitude]


def create_admin_region_fill_features(
    row: sqlite3.Row | dict[str, object],
    geometry: dict[str, Any],
    *,
    properties: dict[str, object] | None = None,
) -> list[dict[str, object]]:
    resolved_properties = create_admin_region_tile_properties(row) if properties is None else properties
    return [
        {
            "geometry": feature_geometry,
            "properties": {
                **resolved_properties,
                "kind": ADMIN_REGION_FILL_FEATURE_KIND,
            },
        }
        for feature_geometry in iter_admin_region_fill_geometries(geometry)
    ]


def iter_admin_region_fill_geometries(geometry: dict[str, Any]) -> Iterable[dict[str, Any]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, (list, tuple)):
        yield geometry
        return
    if geometry_type == "MultiPolygon" and isinstance(coordinates, (list, tuple)):
        for polygon in coordinates:
            yield {"type": "Polygon", "coordinates": polygon}
        return
    if geometry_type == "GeometryCollection":
        geometries = geometry.get("geometries")
        if not isinstance(geometries, list):
            return
        for child_geometry in geometries:
            if isinstance(child_geometry, dict):
                yield from iter_admin_region_fill_geometries(child_geometry)


def count_tile_features(tile: bytes) -> int:
    decoded = decode_admin_region_tile(tile)
    return len(decoded.get(ADMIN_REGION_TILE_LAYER_NAME, {}).get("features", []))


@lru_cache(maxsize=64)
def derive_admin_region_tile_lines_from_fill_features(tile: bytes, level_filter: int | None = None) -> bytes:
    if not tile:
        return tile

    decoded = decode_admin_region_tile(tile)
    layer = decoded.get(ADMIN_REGION_TILE_LAYER_NAME)
    if not isinstance(layer, dict):
        return tile
    features = layer.get("features")
    if not isinstance(features, list):
        return tile

    fill_features = [
        feature
        for feature in features
        if isinstance(feature, dict)
        and isinstance(feature.get("properties"), dict)
        and feature["properties"].get("kind") == ADMIN_REGION_FILL_FEATURE_KIND
        and not is_antarctica_admin_region_properties(feature["properties"])
        and (
            level_filter is None
            or normalize_admin_region_feature_level(feature["properties"].get("level")) == level_filter
        )
    ]
    if not fill_features:
        return b""

    derived_line_features = []
    for feature in fill_features:
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            continue
        line_geometry = create_line_geometry_from_tile_fill_geometry(geometry)
        if line_geometry is None:
            continue
        derived_line_features.append(
            {
                "geometry": line_geometry,
                "properties": {
                    **feature["properties"],
                    "kind": ADMIN_REGION_LINE_FEATURE_KIND,
                },
            },
        )

    features = [
        *fill_features,
        *deduplicate_admin_region_line_features(derived_line_features),
    ]
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


def decode_admin_region_tile(tile: bytes) -> dict[str, Any]:
    return decode(tile, default_options={"y_coord_down": True})


def normalize_admin_region_feature_level(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=64)
def filter_admin_region_tile_edge_line_segments(tile: bytes) -> bytes:
    if not tile:
        return tile

    decoded = decode_admin_region_tile(tile)
    layer = decoded.get(ADMIN_REGION_TILE_LAYER_NAME)
    if not isinstance(layer, dict):
        return tile
    features = layer.get("features")
    if not isinstance(features, list):
        return tile

    filtered_features = []
    changed = False
    for feature in features:
        if not isinstance(feature, dict):
            filtered_features.append(feature)
            continue
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if (
            not isinstance(properties, dict)
            or properties.get("kind") != ADMIN_REGION_LINE_FEATURE_KIND
            or not isinstance(geometry, dict)
        ):
            filtered_features.append(feature)
            continue
        filtered_geometry = filter_tile_edge_line_geometry_segments(geometry)
        if filtered_geometry != geometry:
            changed = True
        if filtered_geometry is None:
            changed = True
            continue
        filtered_features.append({**feature, "geometry": filtered_geometry})

    if not changed:
        return tile
    if not filtered_features:
        return b""

    return encode(
        [
            {
                "name": ADMIN_REGION_TILE_LAYER_NAME,
                "features": filtered_features,
            },
        ],
        default_options={
            "extents": MVT_EXTENT,
            "y_coord_down": True,
        },
    )


def filter_tile_edge_line_geometry_segments(geometry: dict[str, Any]) -> dict[str, Any] | None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, (list, tuple)):
        lines = filter_tile_edge_line_coordinates(coordinates)
    elif geometry_type == "MultiLineString" and isinstance(coordinates, (list, tuple)):
        lines = [
            filtered_line
            for line in coordinates
            if isinstance(line, (list, tuple))
            for filtered_line in filter_tile_edge_line_coordinates(line)
        ]
    else:
        return geometry

    if not lines:
        return None
    if len(lines) == 1:
        return {"type": "LineString", "coordinates": lines[0]}
    return {"type": "MultiLineString", "coordinates": lines}


def filter_tile_edge_line_coordinates(line: list[Any] | tuple[Any, ...]) -> list[list[list[int]]]:
    return normalize_tile_boundary_line_coordinates(line)


def create_line_geometry_from_tile_fill_geometry(geometry: dict[str, Any]) -> dict[str, Any] | None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, (list, tuple)):
        lines = [
            line
            for ring in coordinates
            if isinstance(ring, (list, tuple))
            for line in normalize_tile_boundary_line_coordinates(ring)
        ]
        if not lines:
            return None
        if len(lines) == 1:
            return {"type": "LineString", "coordinates": lines[0]}
        return {"type": "MultiLineString", "coordinates": lines}
    if geometry_type == "MultiPolygon" and isinstance(coordinates, (list, tuple)):
        lines = []
        for polygon in coordinates:
            if not isinstance(polygon, (list, tuple)):
                continue
            for ring in polygon:
                if not isinstance(ring, (list, tuple)):
                    continue
                lines.extend(normalize_tile_boundary_line_coordinates(ring))
        if not lines:
            return None
        if len(lines) == 1:
            return {"type": "LineString", "coordinates": lines[0]}
        return {"type": "MultiLineString", "coordinates": lines}
    return None


def create_admin_region_line_features_from_fill_features(
    fill_features: list[dict[str, object]],
) -> list[dict[str, object]]:
    line_features = []
    for feature in fill_features:
        geometry = feature.get("geometry")
        properties = feature.get("properties")
        if not isinstance(geometry, dict) or not isinstance(properties, dict):
            continue
        line_geometry = create_line_geometry_from_tile_fill_geometry(geometry)
        if line_geometry is None:
            continue
        line_features.append(
            {
                "geometry": line_geometry,
                "properties": {
                    **properties,
                    "kind": ADMIN_REGION_LINE_FEATURE_KIND,
                },
            },
        )
    return line_features


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
    seen_line_intervals: dict[tuple[int, int, int], list[tuple[int, int]]] = {}
    deduplicated_features = []
    for feature in features:
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            continue
        deduplicated_geometry = deduplicate_line_geometry_segments(geometry, seen_line_intervals)
        if deduplicated_geometry is None:
            continue
        deduplicated_features.append(
            {
                **feature,
                "geometry": deduplicated_geometry,
            },
        )
    return deduplicated_features


def snap_line_visual_geometry(geometry: dict[str, Any]) -> dict[str, Any] | None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, (list, tuple)):
        line = snap_line_visual_coordinates(coordinates)
        if line is None:
            return None
        return {"type": "LineString", "coordinates": line}
    if geometry_type == "MultiLineString" and isinstance(coordinates, (list, tuple)):
        lines = [
            line
            for line in (
                snap_line_visual_coordinates(current_line)
                for current_line in coordinates
                if isinstance(current_line, (list, tuple))
            )
            if line is not None
        ]
        if not lines:
            return None
        if len(lines) == 1:
            return {"type": "LineString", "coordinates": lines[0]}
        return {"type": "MultiLineString", "coordinates": lines}
    return geometry


def snap_line_visual_coordinates(line: list[Any] | tuple[Any, ...]) -> list[list[int]] | None:
    snapped = []
    for point in line:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        snapped_point = [
            snap_line_visual_coordinate(int(point[0])),
            snap_line_visual_coordinate(int(point[1])),
        ]
        if not snapped or snapped[-1] != snapped_point:
            snapped.append(snapped_point)
    return snapped if len(snapped) >= 2 else None


def normalize_tile_line_coordinates(line: list[Any] | tuple[Any, ...]) -> list[list[int]] | None:
    normalized = []
    for point in line:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        normalized_point = [
            clamp_geometry_coordinate(int(point[0])),
            clamp_geometry_coordinate(int(point[1])),
        ]
        if not normalized or normalized[-1] != normalized_point:
            normalized.append(normalized_point)
    return normalized if len(normalized) >= 2 else None


def normalize_tile_boundary_line_coordinates(line: list[Any] | tuple[Any, ...]) -> list[list[list[int]]]:
    normalized = normalize_tile_line_coordinates(line)
    if normalized is None:
        return []

    line_parts = []
    current_part: list[list[int]] = []
    for start, end in zip(normalized, normalized[1:]):
        if is_tile_edge_line_segment(start, end):
            if len(current_part) >= 2:
                line_parts.append(current_part)
            current_part = []
            continue
        if not current_part:
            current_part = [start]
        elif current_part[-1] != start:
            if len(current_part) >= 2:
                line_parts.append(current_part)
            current_part = [start]
        current_part.append(end)
    if len(current_part) >= 2:
        line_parts.append(current_part)
    return line_parts


def is_tile_edge_line_segment(start: list[int], end: list[int]) -> bool:
    return (
        start[0] == end[0]
        and start[0] in {0, MVT_EXTENT}
    ) or (
        start[1] == end[1]
        and start[1] in {0, MVT_EXTENT}
    )


def snap_line_visual_coordinate(value: int) -> int:
    snapped = round(value / ADMIN_REGION_LINE_VISUAL_SNAP_UNITS) * ADMIN_REGION_LINE_VISUAL_SNAP_UNITS
    return clamp_geometry_coordinate(int(snapped))


def deduplicate_line_geometry_segments(
    geometry: dict[str, Any],
    seen_line_intervals: dict[tuple[int, int, int], list[tuple[int, int]]],
) -> dict[str, Any] | None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, (list, tuple)):
        lines = [coordinates]
    elif geometry_type == "MultiLineString" and isinstance(coordinates, (list, tuple)):
        lines = coordinates
    else:
        return None

    deduplicated_lines: list[list[list[int]]] = []
    for line in lines:
        if not isinstance(line, (list, tuple)):
            continue
        for segment_line in split_line_into_unique_segment_parts(line, seen_line_intervals):
            if len(segment_line) >= 2:
                deduplicated_lines.append(segment_line)

    deduplicated_lines = merge_contiguous_tile_line_segments(deduplicated_lines)
    if not deduplicated_lines:
        return None
    if len(deduplicated_lines) == 1:
        return {"type": "LineString", "coordinates": deduplicated_lines[0]}
    return {"type": "MultiLineString", "coordinates": deduplicated_lines}


def split_line_into_unique_segment_parts(
    line: list[Any] | tuple[Any, ...],
    seen_line_intervals: dict[tuple[int, int, int], list[tuple[int, int]]],
) -> list[list[list[int]]]:
    points = [
        [int(point[0]), int(point[1])]
        for point in line
        if isinstance(point, (list, tuple)) and len(point) >= 2
    ]
    segment_parts = []

    for start, end in zip(points, points[1:]):
        descriptor = create_tile_line_segment_descriptor(start, end)
        if descriptor is None:
            continue
        key, lower, upper, direction_x, direction_y, norm, base_point, base_position = descriptor
        uncovered_intervals = subtract_line_interval(
            lower,
            upper,
            seen_line_intervals.get(key, []),
        )
        add_seen_line_interval(seen_line_intervals, key, lower, upper)
        for interval_start, interval_end in uncovered_intervals:
            start_point = interpolate_tile_line_point(
                base_point,
                base_position,
                interval_start,
                direction_x=direction_x,
                direction_y=direction_y,
                norm=norm,
            )
            end_point = interpolate_tile_line_point(
                base_point,
                base_position,
                interval_end,
                direction_x=direction_x,
                direction_y=direction_y,
                norm=norm,
            )
            if start_point is not None and end_point is not None and start_point != end_point:
                segment_parts.append([start_point, end_point])
    return segment_parts


def create_tile_line_segment_descriptor(
    start: list[int],
    end: list[int],
) -> tuple[tuple[int, int, int], int, int, int, int, int, tuple[int, int], int] | None:
    start_x = int(start[0])
    start_y = int(start[1])
    end_x = int(end[0])
    end_y = int(end[1])
    delta_x = end_x - start_x
    delta_y = end_y - start_y
    divisor = math.gcd(abs(delta_x), abs(delta_y))
    if divisor == 0:
        return None

    direction_x = delta_x // divisor
    direction_y = delta_y // divisor
    if direction_x < 0 or (direction_x == 0 and direction_y < 0):
        direction_x = -direction_x
        direction_y = -direction_y

    line_offset = (-direction_y * start_x) + (direction_x * start_y)
    key = (direction_x, direction_y, line_offset)
    start_position = (start_x * direction_x) + (start_y * direction_y)
    end_position = (end_x * direction_x) + (end_y * direction_y)
    lower = min(start_position, end_position)
    upper = max(start_position, end_position)
    if lower == upper:
        return None
    norm = (direction_x * direction_x) + (direction_y * direction_y)
    return key, lower, upper, direction_x, direction_y, norm, (start_x, start_y), start_position


def subtract_line_interval(
    lower: int,
    upper: int,
    covered_intervals: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    uncovered = [(lower, upper)]
    for covered_lower, covered_upper in covered_intervals:
        next_uncovered = []
        for current_lower, current_upper in uncovered:
            if covered_upper <= current_lower or covered_lower >= current_upper:
                next_uncovered.append((current_lower, current_upper))
                continue
            if current_lower < covered_lower:
                next_uncovered.append((current_lower, min(current_upper, covered_lower)))
            if covered_upper < current_upper:
                next_uncovered.append((max(current_lower, covered_upper), current_upper))
        uncovered = next_uncovered
        if not uncovered:
            break
    return uncovered


def add_seen_line_interval(
    seen_line_intervals: dict[tuple[int, int, int], list[tuple[int, int]]],
    key: tuple[int, int, int],
    lower: int,
    upper: int,
) -> None:
    seen_line_intervals[key] = merge_line_intervals([
        *seen_line_intervals.get(key, []),
        (lower, upper),
    ])


def merge_line_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not intervals:
        return []
    merged = []
    current_lower, current_upper = sorted(intervals)[0]
    for lower, upper in sorted(intervals)[1:]:
        if lower <= current_upper:
            current_upper = max(current_upper, upper)
            continue
        merged.append((current_lower, current_upper))
        current_lower, current_upper = lower, upper
    merged.append((current_lower, current_upper))
    return merged


def interpolate_tile_line_point(
    base_point: tuple[int, int],
    base_position: int,
    target_position: int,
    *,
    direction_x: int,
    direction_y: int,
    norm: int,
) -> list[int] | None:
    delta = target_position - base_position
    if delta % norm != 0:
        return None
    step = delta // norm
    return [
        base_point[0] + (step * direction_x),
        base_point[1] + (step * direction_y),
    ]


def merge_contiguous_tile_line_segments(
    segment_lines: list[list[list[int]]],
) -> list[list[list[int]]]:
    grouped_intervals: dict[
        tuple[int, int, int],
        tuple[int, int, int, tuple[int, int], int, list[tuple[int, int]]],
    ] = {}
    for segment_line in segment_lines:
        if len(segment_line) < 2:
            continue
        descriptor = create_tile_line_segment_descriptor(segment_line[0], segment_line[-1])
        if descriptor is None:
            continue
        key, lower, upper, direction_x, direction_y, norm, base_point, base_position = descriptor
        existing = grouped_intervals.get(key)
        if existing is None:
            grouped_intervals[key] = (
                direction_x,
                direction_y,
                norm,
                base_point,
                base_position,
                [(lower, upper)],
            )
            continue
        existing_direction_x, existing_direction_y, existing_norm, existing_base, existing_position, intervals = existing
        grouped_intervals[key] = (
            existing_direction_x,
            existing_direction_y,
            existing_norm,
            existing_base,
            existing_position,
            merge_line_intervals([*intervals, (lower, upper)]),
        )

    merged_lines = []
    for direction_x, direction_y, norm, base_point, base_position, intervals in grouped_intervals.values():
        for lower, upper in intervals:
            start_point = interpolate_tile_line_point(
                base_point,
                base_position,
                lower,
                direction_x=direction_x,
                direction_y=direction_y,
                norm=norm,
            )
            end_point = interpolate_tile_line_point(
                base_point,
                base_position,
                upper,
                direction_x=direction_x,
                direction_y=direction_y,
                norm=norm,
            )
            if start_point is not None and end_point is not None and start_point != end_point:
                merged_lines.append([start_point, end_point])
    return merged_lines


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
    render_geometry = transform_admin_region_render_geometry(row.geometry, row.row)
    min_lng, min_lat, max_lng, max_lat = render_geometry.bounds
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
