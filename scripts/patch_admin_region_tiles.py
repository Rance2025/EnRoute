from __future__ import annotations

import argparse
import copy
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

from mapbox_vector_tile import encode
from mapbox_vector_tile.Mapbox import vector_tile_pb2
import requests
from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.validation import make_valid

api_src_dir = Path(__file__).resolve().parents[1] / "apps" / "api" / "src"
if str(api_src_dir) not in sys.path:
    sys.path.insert(0, str(api_src_dir))

from enroute_api.admin_regions.geometry import calculate_geometry_bbox
from enroute_api.admin_regions.precompute_meta import (
    invalidate_admin_region_daily_stats,
    invalidate_admin_region_thumbnail_paths,
)
from enroute_api.admin_regions.store import (
    insert_admin_region_feature,
    normalize_admin_region_features,
    transform_geojson_geometry_coordinates,
)
from enroute_api.admin_regions.tiles import (
    ADMIN_REGION_BOUNDARY_REGION_IDS_PROPERTY,
    ADMIN_REGION_FILL_FEATURE_KIND,
    ADMIN_REGION_LINE_FEATURE_KIND,
    ADMIN_REGION_LEGACY_REBUILD_TILE_BBOX_PADDING_DEGREES,
    ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
    ADMIN_REGION_TILE_LAYER_NAME,
    ADMIN_REGION_WORLD_FOCUS_ID,
    AdminRegionTileBuildResult,
    build_admin_region_tiles,
    coordinate_to_tile,
    count_tile_features,
    create_admin_region_line_features_from_fill_features,
    create_admin_region_tile_line_features_from_prepared_rows,
    decode_admin_region_tile,
    encode_admin_region_mvt_from_prepared_rows,
    enumerate_admin_region_tile_keys,
    index_admin_region_tile_rows,
    initialize_admin_region_tile_schema,
    prepare_admin_region_tile_rows,
    resolve_focused_region_rows,
)
from enroute_api.config import Settings
from enroute_api.footprints.coordinates import transform_gcj02_to_wgs84_coordinate
from enroute_api.footprints.visual_tiles import MVT_EXTENT, tile_bounds
from enroute_api.footprints.store import (
    ADMIN_REGION_LOADER_VERSION,
    ADMIN_REGION_STATS_SIGNATURE_KEY,
    create_source_signature,
    delete_meta_value,
    initialize_schema,
    set_meta_value,
)


GREENLAND_REGION_ID = "gl"
GREENLAND_SOURCE_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"
TAIWAN_PROVINCE_ID = "710000"
TAIWAN_COUNTY_ID_PREFIX = "tw-county-"
TAIWAN_TOWN_ID_PREFIX = "tw-town-"
MAINLAND_AUTHORITY_MIN_PROVINCE_CODE = 11
MAINLAND_AUTHORITY_MAX_PROVINCE_CODE = 65
TAIWAN_MAINLAND_OVERLAP_AREA_EPSILON = 1e-12
TAIWAN_MAINLAND_AUTHORITY_REGION_PREFIXES = (
    f"{TAIWAN_COUNTY_ID_PREFIX}09007",
    f"{TAIWAN_COUNTY_ID_PREFIX}09020",
    f"{TAIWAN_TOWN_ID_PREFIX}09007",
    f"{TAIWAN_TOWN_ID_PREFIX}09020",
)
TAIWAN_PROVINCE_MASK_BBOX_TOLERANCE_DEGREES = 0.5
ADMIN_REGION_TARGET_LINE_PATCH_SIGNATURE = "admin-region-mvt-target-line-overlay-v1"


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    settings = Settings.from_env()
    db_path = resolve_path(args.database or settings.footprint_db_path)
    greenland_source_path = resolve_path(args.greenland_source) if args.greenland_source else None
    source_cache_path = resolve_path(args.source_cache)
    china_admin_region_data_path = (
        resolve_path(args.china_admin_region_data_path)
        if args.china_admin_region_data_path is not None
        else None
    )
    taiwan_county_data_path = (
        resolve_path(args.taiwan_county_data_path)
        if args.taiwan_county_data_path is not None
        else None
    )
    taiwan_town_data_path = (
        resolve_path(args.taiwan_town_data_path)
        if args.taiwan_town_data_path is not None
        else None
    )
    depths = parse_depths(args.depth, args.depths)

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        initialize_admin_region_tile_schema(connection)
        if args.patch_cached_region_lines:
            for depth in depths:
                result = patch_cached_admin_region_target_lines(
                    connection,
                    focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                    depth=depth,
                    region_id=args.patch_cached_region_lines,
                    min_zoom=args.min_zoom,
                    max_zoom=args.max_zoom,
                    commit_interval=args.commit_interval,
                )
                print(
                    f"Patched cached line features in {result.built_count} admin region tile rows "
                    f"from {result.candidate_count} bounded candidates for region "
                    f"{args.patch_cached_region_lines} depth {depth} "
                    f"zoom {args.min_zoom}-{args.max_zoom}",
                )
            return 0
        if args.rebuild_china_admin_levels:
            if china_admin_region_data_path is None:
                raise ValueError("--rebuild-china-admin-levels requires --china-admin-region-data-path")
            result = rebuild_china_admin_levels(
                connection,
                china_admin_region_data_path=china_admin_region_data_path,
                depths=depths,
                min_zoom=args.min_zoom,
                max_zoom=args.max_zoom,
                commit_interval=args.commit_interval,
                rebuild_tiles=not args.skip_china_admin_tile_rebuild,
            )
            print(
                f"Restored {result['region_count']} admin regions "
                f"and rebuilt {result['tile_count']} tile rows "
                f"for depths {','.join(str(depth) for depth in depths)} "
                f"zoom {args.min_zoom}-{args.max_zoom}",
            )
        if args.patch_taiwan_admin_levels:
            if taiwan_county_data_path is None or taiwan_town_data_path is None:
                raise ValueError(
                    "--patch-taiwan-admin-levels requires "
                    "--taiwan-county-data-path and --taiwan-town-data-path",
                )
            result = patch_taiwan_admin_levels(
                connection,
                county_geojson_path=taiwan_county_data_path,
                town_geojson_path=taiwan_town_data_path,
            )
            tile_count = 0
            if not args.skip_taiwan_admin_tile_rebuild:
                for depth in depths:
                    if depth not in {3, 4}:
                        continue
                    build_result = rebuild_admin_region_tile_depth_range(
                        connection,
                        focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                        depth=depth,
                        min_zoom=args.min_zoom,
                        max_zoom=args.max_zoom,
                        commit_interval=args.commit_interval,
                    )
                    tile_count += build_result.built_count
                    print(
                        f"Rebuilt {build_result.built_count} admin region tile rows "
                        f"from {build_result.candidate_count} candidate keys "
                        f"for depth {depth} zoom {args.min_zoom}-{args.max_zoom}",
                    )
            print(
                f"Restored {result['county_count']} Taiwan county/city regions "
                f"and {result['town_count']} Taiwan township/district regions "
                f"with {tile_count} rebuilt tile rows",
            )
        if args.patch_taiwan_mainland_overlap:
            result = patch_taiwan_mainland_overlaps(
                connection,
                depths=depths,
                min_zoom=args.min_zoom,
                max_zoom=args.max_zoom,
                commit_interval=args.commit_interval,
                rebuild_tiles=not args.skip_taiwan_mainland_tile_rebuild,
            )
            print(
                f"Clipped {result['changed_region_count']} Taiwan admin regions "
                f"({result['changed_county_count']} county/city, {result['changed_town_count']} township/district) "
                f"against mainland authority and rebuilt {result['tile_count']} tile rows "
                f"from {result['candidate_tile_count']} candidate tile keys",
            )
        if args.rebuild_admin_region_tiles:
            for depth in depths:
                result = rebuild_admin_region_tile_depth_range(
                    connection,
                    focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                    depth=depth,
                    min_zoom=args.min_zoom,
                    max_zoom=args.max_zoom,
                    commit_interval=args.commit_interval,
                )
                print(
                    f"Rebuilt {result.built_count} admin region tile rows "
                    f"from {result.candidate_count} candidate keys "
                    f"for depth {depth} zoom {args.min_zoom}-{args.max_zoom}",
                )
        if args.patch_admin_region_tile_lines:
            for depth in depths:
                result = patch_admin_region_tile_lines(
                    connection,
                    focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                    depth=depth,
                    min_zoom=args.min_zoom,
                    max_zoom=args.max_zoom,
                    commit_interval=args.commit_interval,
                )
                print(
                    f"Patched line features in {result.built_count} existing admin region tile rows "
                    f"from {result.candidate_count} cached rows "
                    f"for depth {depth} zoom {args.min_zoom}-{args.max_zoom}",
                )
        if args.patch_greenland:
            greenland_feature = load_greenland_feature(
                source_path=greenland_source_path,
                source_cache_path=source_cache_path,
            )
            upsert_admin_region_feature(connection, greenland_feature)
            patch_region_tile_keys(
                connection,
                region_id=GREENLAND_REGION_ID,
                depths=[1],
                min_zoom=args.greenland_min_zoom,
                max_zoom=args.greenland_max_zoom,
                commit_interval=args.commit_interval,
            )
        if args.build_zooms:
            for depth in depths:
                result = build_admin_region_tiles(
                    connection,
                    focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                    depth=depth,
                    min_zoom=args.min_zoom,
                    max_zoom=args.max_zoom,
                    commit_interval=args.commit_interval,
                )
                print(
                    f"Built {result.built_count} admin region tile rows "
                    f"from {result.candidate_count} candidate keys "
                    f"for depth {depth} zoom {args.min_zoom}-{args.max_zoom}",
                )
        if args.patch_missing_tiles:
            for depth in depths:
                result = patch_missing_admin_region_tile_keys(
                    connection,
                    focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                    depth=depth,
                    min_zoom=args.min_zoom,
                    max_zoom=args.max_zoom,
                    commit_interval=args.commit_interval,
                )
                print(
                    f"Patched {result.built_count} missing admin region tile rows "
                    f"from {result.candidate_count} missing candidate keys "
                    f"for depth {depth} zoom {args.min_zoom}-{args.max_zoom}",
                )
    finally:
        connection.close()

    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply small admin-region data/tile patches without clearing the tile table.",
    )
    parser.add_argument("--database", type=Path, help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.")
    parser.add_argument(
        "--greenland-source",
        type=Path,
        help="Optional local GeoJSON containing a Greenland country feature.",
    )
    parser.add_argument(
        "--source-cache",
        type=Path,
        default=Path("output/geo-countries.geojson"),
        help="Local cache for the downloaded country source.",
    )
    parser.add_argument("--skip-greenland", dest="patch_greenland", action="store_false")
    parser.set_defaults(patch_greenland=True)
    parser.add_argument("--skip-build-zooms", dest="build_zooms", action="store_false")
    parser.set_defaults(build_zooms=True)
    parser.add_argument(
        "--patch-missing-tiles",
        action="store_true",
        help="Build only missing admin_region_tiles rows for the selected world focus/depth/zoom range.",
    )
    parser.add_argument(
        "--china-admin-region-data-path",
        type=Path,
        help="China province/city/district GeoJSON path used by --rebuild-china-admin-levels.",
    )
    parser.add_argument(
        "--rebuild-china-admin-levels",
        action="store_true",
        help="Restore China level 2/3/4 rows and rebuild only the selected admin tile depths/zooms.",
    )
    parser.add_argument(
        "--skip-china-admin-tile-rebuild",
        action="store_true",
        help="With --rebuild-china-admin-levels, restore admin region rows/tree only.",
    )
    parser.add_argument(
        "--rebuild-admin-region-tiles",
        action="store_true",
        help="Rebuild only selected admin_region_tiles rows from existing admin_regions/admin_region_tree.",
    )
    parser.add_argument(
        "--patch-admin-region-tile-lines",
        action="store_true",
        help="Regenerate only line features in existing admin_region_tiles rows, preserving cached fill features.",
    )
    parser.add_argument(
        "--patch-cached-region-lines",
        metavar="REGION_ID",
        help="Derive one region's boundary lines from cached fills without loading global source geometry.",
    )
    parser.add_argument(
        "--taiwan-county-data-path",
        type=Path,
        help="Official Taiwan county/city GeoJSON path used by --patch-taiwan-admin-levels.",
    )
    parser.add_argument(
        "--taiwan-town-data-path",
        type=Path,
        help="Official Taiwan township/district GeoJSON path used by --patch-taiwan-admin-levels.",
    )
    parser.add_argument(
        "--patch-taiwan-admin-levels",
        action="store_true",
        help="Restore Taiwan level 3/4 rows under the existing Taiwan province row.",
    )
    parser.add_argument(
        "--skip-taiwan-admin-tile-rebuild",
        action="store_true",
        help="With --patch-taiwan-admin-levels, restore admin region rows/tree only.",
    )
    parser.add_argument(
        "--patch-taiwan-mainland-overlap",
        action="store_true",
        help="Clip generated Taiwan level 3/4 rows by mainland-authoritative province polygons.",
    )
    parser.add_argument(
        "--skip-taiwan-mainland-tile-rebuild",
        action="store_true",
        help="With --patch-taiwan-mainland-overlap, update admin region rows only.",
    )
    parser.add_argument("--depth", type=int, help="Build one depth instead of --depths.")
    parser.add_argument("--depths", default="1,2,3,4", help="Comma-separated depths to build.")
    parser.add_argument("--min-zoom", type=int, default=8)
    parser.add_argument("--max-zoom", type=int, default=9)
    parser.add_argument("--greenland-min-zoom", type=int, default=0)
    parser.add_argument("--greenland-max-zoom", type=int, default=9)
    parser.add_argument("--commit-interval", type=int, default=1000)
    return parser.parse_args(argv)


def resolve_path(path: Path) -> Path:
    return path if path.is_absolute() else (Path.cwd() / path).resolve()


def parse_depths(depth: int | None, depths: str) -> list[int]:
    if depth is not None:
        return [depth]
    parsed_depths = [int(part.strip()) for part in depths.split(",") if part.strip()]
    return parsed_depths


def rebuild_china_admin_levels(
    connection: sqlite3.Connection,
    *,
    china_admin_region_data_path: Path,
    depths: Iterable[int],
    min_zoom: int,
    max_zoom: int,
    commit_interval: int,
    rebuild_tiles: bool,
) -> dict[str, int]:
    level_1_features = export_current_level_one_features(connection)
    china_features = load_china_admin_region_features(
        china_admin_region_data_path,
        china_country_id=find_china_country_id(connection),
    )
    replace_admin_region_fact_rows(
        connection,
        [
            *level_1_features,
            *china_features,
        ],
    )
    set_meta_value(
        connection,
        "adminRegionSourceSignature",
        create_china_patch_source_signature(
            china_admin_region_data_path,
        ),
    )
    delete_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY)

    tile_count = 0
    if rebuild_tiles:
        for depth in depths:
            if depth == 1:
                continue
            result = rebuild_admin_region_tile_depth_range(
                connection,
                focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                depth=depth,
                min_zoom=min_zoom,
                max_zoom=max_zoom,
                commit_interval=commit_interval,
            )
            tile_count += result.built_count
            print(
                f"Rebuilt {result.built_count} admin region tile rows "
                f"from {result.candidate_count} candidate keys "
                f"for depth {depth} zoom {min_zoom}-{max_zoom}",
            )

    region_count = connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0]
    return {
        "region_count": int(region_count),
        "tile_count": tile_count,
    }


def patch_taiwan_admin_levels(
    connection: sqlite3.Connection,
    *,
    county_geojson_path: Path,
    town_geojson_path: Path,
    taiwan_province_id: str = TAIWAN_PROVINCE_ID,
) -> dict[str, int]:
    features = load_taiwan_admin_region_features(
        county_geojson_path,
        town_geojson_path,
        taiwan_province_id=taiwan_province_id,
    )
    county_count = sum(1 for feature in features if int(feature["properties"]["level"]) == 3)
    town_count = sum(1 for feature in features if int(feature["properties"]["level"]) == 4)
    generated_region_ids = {
        str(feature["properties"]["id"])
        for feature in features
    }

    with connection:
        delete_existing_taiwan_generated_admin_rows(connection)
        for feature in features:
            insert_admin_region_feature(connection, feature)
        for feature in features:
            properties = feature["properties"]
            connection.execute(
                "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
                (str(properties["parentId"]), str(properties["id"])),
            )
        delete_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY)
        invalidate_admin_region_thumbnail_paths(connection)
        invalidate_admin_region_daily_stats(connection)

    inserted_count = connection.execute(
        """
        SELECT COUNT(*)
        FROM admin_regions
        WHERE id IN ({})
        """.format(",".join("?" for _ in generated_region_ids)),
        sorted(generated_region_ids),
    ).fetchone()[0] if generated_region_ids else 0
    if int(inserted_count) != len(generated_region_ids):
        raise RuntimeError("Taiwan admin region patch did not insert all generated rows")

    return {
        "county_count": county_count,
        "town_count": town_count,
    }


def patch_taiwan_mainland_overlaps(
    connection: sqlite3.Connection,
    *,
    depths: Iterable[int],
    min_zoom: int,
    max_zoom: int,
    commit_interval: int,
    rebuild_tiles: bool,
) -> dict[str, int]:
    taiwan_rows = query_generated_taiwan_admin_rows(connection)
    if not taiwan_rows:
        return {
            "changed_region_count": 0,
            "changed_county_count": 0,
            "changed_town_count": 0,
            "deleted_region_count": 0,
            "tile_count": 0,
            "candidate_tile_count": 0,
        }

    changes = create_taiwan_mainland_overlap_changes(connection, taiwan_rows)
    if not changes:
        return {
            "changed_region_count": 0,
            "changed_county_count": 0,
            "changed_town_count": 0,
            "deleted_region_count": 0,
            "tile_count": 0,
            "candidate_tile_count": 0,
        }

    changed_ids = [str(change["id"]) for change in changes]
    deleted_ids = [str(change["id"]) for change in changes if change["geometry"] is None]
    updated_ids = [str(change["id"]) for change in changes if change["geometry"] is not None]
    old_rows_by_depth = {
        depth: [change["row"] for change in changes if int(change["row"]["level"]) == depth]
        for depth in {3, 4}
    }
    old_tile_keys_by_depth = {
        depth: enumerate_admin_region_keys_for_rows(
            rows,
            min_zoom=min_zoom,
            max_zoom=max_zoom,
        )
        for depth, rows in old_rows_by_depth.items()
    }

    with connection:
        for change in changes:
            geometry = change["geometry"]
            if geometry is None:
                continue
            update_admin_region_geometry(
                connection,
                region_id=str(change["id"]),
                geometry=geometry,
            )
        delete_admin_region_rows_by_ids(connection, deleted_ids)
        delete_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY)
        invalidate_admin_region_thumbnail_paths(connection)
        invalidate_admin_region_daily_stats(connection)

    new_rows = query_admin_rows_by_ids(connection, updated_ids)
    new_rows_by_depth = {
        depth: [row for row in new_rows if int(row["level"]) == depth]
        for depth in {3, 4}
    }
    new_tile_keys_by_depth = {
        depth: enumerate_admin_region_keys_for_rows(
            rows,
            min_zoom=min_zoom,
            max_zoom=max_zoom,
        )
        for depth, rows in new_rows_by_depth.items()
    }

    tile_count = 0
    candidate_tile_count = 0
    if rebuild_tiles:
        for depth in depths:
            if depth not in {3, 4}:
                continue
            tile_keys = sorted(old_tile_keys_by_depth.get(depth, set()) | new_tile_keys_by_depth.get(depth, set()))
            candidate_tile_count += len(tile_keys)
            result = patch_admin_region_changed_tile_keys(
                connection,
                focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
                depth=depth,
                tile_keys=tile_keys,
                changed_region_ids=changed_ids,
                changed_rows=new_rows_by_depth.get(depth, []),
                commit_interval=commit_interval,
            )
            tile_count += result.built_count

    return {
        "changed_region_count": len(changes),
        "changed_county_count": sum(1 for change in changes if int(change["row"]["level"]) == 3),
        "changed_town_count": sum(1 for change in changes if int(change["row"]["level"]) == 4),
        "deleted_region_count": len(deleted_ids),
        "tile_count": tile_count,
        "candidate_tile_count": candidate_tile_count,
    }


def load_taiwan_province_authority_geometry(connection: sqlite3.Connection) -> BaseGeometry | None:
    row = connection.execute(
        """
        SELECT geometry
        FROM admin_regions
        WHERE id = ?
        """,
        (TAIWAN_PROVINCE_ID,),
    ).fetchone()
    if row is None:
        return None
    return repair_polygonal_shapely_geometry(
        shape(json.loads(str(row["geometry"]))),
        label=f"Taiwan province authority {TAIWAN_PROVINCE_ID}",
    )


def query_mainland_authority_rows_for_bounds(
    connection: sqlite3.Connection,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
) -> list[sqlite3.Row]:
    padding = ADMIN_REGION_LEGACY_REBUILD_TILE_BBOX_PADDING_DEGREES
    return list(
        connection.execute(
            """
            SELECT id, geometry
            FROM admin_regions
            WHERE level = 2
              AND length(id) >= 6
              AND substr(id, 1, 6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
              AND CAST(substr(id, 1, 2) AS INTEGER) BETWEEN ? AND ?
              AND min_lng <= ?
              AND max_lng >= ?
              AND min_lat <= ?
              AND max_lat >= ?
            ORDER BY id
            """,
            (
                MAINLAND_AUTHORITY_MIN_PROVINCE_CODE,
                MAINLAND_AUTHORITY_MAX_PROVINCE_CODE,
                east + padding,
                west - padding,
                north + padding,
                south - padding,
            ),
        ),
    )


def get_mainland_authority_geometries_for_row(
    row: sqlite3.Row,
    cache: dict[str, list[BaseGeometry]],
) -> list[BaseGeometry]:
    region_id = str(row["id"])
    if region_id in cache:
        return cache[region_id]
    geometry = json.loads(str(row["geometry"]))
    cache[region_id] = [
        repair_polygonal_shapely_geometry(
            shape(geometry),
            label=f"mainland authority stored {region_id}",
        ),
        repair_polygonal_shapely_geometry(
            shape(transform_gcj02_geometry_to_wgs84(geometry)),
            label=f"mainland authority rendered {region_id}",
        ),
    ]
    return cache[region_id]


def get_mainland_authority_geometries_for_bounds(
    connection: sqlite3.Connection,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    cache: dict[str, list[BaseGeometry]],
) -> list[BaseGeometry]:
    rows = query_mainland_authority_rows_for_bounds(
        connection,
        west=west,
        south=south,
        east=east,
        north=north,
    )
    geometries: list[BaseGeometry] = []
    for row in rows:
        geometries.extend(get_mainland_authority_geometries_for_row(row, cache))
    return geometries


def query_generated_taiwan_admin_rows(connection: sqlite3.Connection) -> list[sqlite3.Row]:
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
            WHERE r.id LIKE ?
               OR r.id LIKE ?
            ORDER BY r.level, r.id
            """,
            (
                f"{TAIWAN_COUNTY_ID_PREFIX}%",
                f"{TAIWAN_TOWN_ID_PREFIX}%",
            ),
        ),
    )


def query_admin_rows_by_ids(connection: sqlite3.Connection, region_ids: list[str]) -> list[sqlite3.Row]:
    if not region_ids:
        return []
    placeholders = ",".join("?" for _ in region_ids)
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
            region_ids,
        ),
    )


def create_taiwan_mainland_overlap_changes(
    connection: sqlite3.Connection,
    rows: list[sqlite3.Row],
) -> list[dict[str, Any]]:
    changes = []
    mainland_authority_cache: dict[str, list[BaseGeometry]] = {}
    taiwan_province_authority = load_taiwan_province_authority_geometry(connection)
    for row in rows:
        geometry = repair_polygonal_shapely_geometry(
            shape(json.loads(str(row["geometry"]))),
            label=f"Taiwan admin region {row['id']}",
        )
        west, south, east, north = geometry.bounds
        mainland_authority_geometries = get_mainland_authority_geometries_for_bounds(
            connection,
            west=west,
            south=south,
            east=east,
            north=north,
            cache=mainland_authority_cache,
        )

        clipped = geometry
        changed = False
        for mainland_authority in mainland_authority_geometries:
            overlap = clipped.intersection(mainland_authority)
            if overlap.is_empty or overlap.area <= TAIWAN_MAINLAND_OVERLAP_AREA_EPSILON:
                continue
            clipped = clipped.difference(mainland_authority)
            changed = True
            if clipped.is_empty:
                break
            clipped = repair_polygonal_shapely_geometry(
                clipped,
                label=f"Taiwan admin region {row['id']} clipped by mainland authority",
            )

        if (
            not clipped.is_empty
            and taiwan_province_authority is not None
            and should_apply_taiwan_province_authority_mask(
                region_id=str(row["id"]),
                geometry=clipped,
                taiwan_province_authority=taiwan_province_authority,
            )
        ):
            province_masked = clipped.intersection(taiwan_province_authority)
            if province_masked.is_empty:
                clipped = province_masked
                changed = True
            elif province_masked.area < clipped.area - TAIWAN_MAINLAND_OVERLAP_AREA_EPSILON:
                clipped = repair_polygonal_shapely_geometry(
                    province_masked,
                    label=f"Taiwan admin region {row['id']} clipped by Taiwan province authority",
                )
                changed = True

        if not changed:
            continue
        changes.append(
            {
                "id": str(row["id"]),
                "row": row,
                "geometry": None if clipped.is_empty else clipped,
            },
        )
    return changes


def should_apply_taiwan_province_authority_mask(
    *,
    region_id: str,
    geometry: BaseGeometry,
    taiwan_province_authority: BaseGeometry,
) -> bool:
    if region_id.startswith(TAIWAN_MAINLAND_AUTHORITY_REGION_PREFIXES):
        return True

    min_lng, min_lat, max_lng, max_lat = geometry.bounds
    province_min_lng, province_min_lat, province_max_lng, province_max_lat = taiwan_province_authority.bounds
    tolerance = TAIWAN_PROVINCE_MASK_BBOX_TOLERANCE_DEGREES
    return (
        min_lng < province_min_lng - tolerance
        or max_lng > province_max_lng + tolerance
        or min_lat < province_min_lat - tolerance
        or max_lat > province_max_lat + tolerance
    )


def update_admin_region_geometry(
    connection: sqlite3.Connection,
    *,
    region_id: str,
    geometry: BaseGeometry,
) -> None:
    geojson_geometry = shapely_geometry_to_geojson(geometry)
    bbox = calculate_geometry_bbox(geojson_geometry)
    connection.execute(
        """
        UPDATE admin_regions
        SET geometry = ?,
            source_geometry = ?,
            source_coordinate_system = 'wgs84',
            min_lng = ?,
            max_lng = ?,
            min_lat = ?,
            max_lat = ?
        WHERE id = ?
        """,
        (
            json.dumps(geojson_geometry, ensure_ascii=False, separators=(",", ":")),
            json.dumps(geojson_geometry, ensure_ascii=False, separators=(",", ":")),
            bbox["min_lng"],
            bbox["max_lng"],
            bbox["min_lat"],
            bbox["max_lat"],
            region_id,
        ),
    )


def delete_admin_region_rows_by_ids(connection: sqlite3.Connection, region_ids: list[str]) -> None:
    if not region_ids:
        return
    placeholders = ",".join("?" for _ in region_ids)
    connection.execute(
        f"""
        DELETE FROM admin_region_tree
        WHERE parent_id IN ({placeholders})
           OR child_id IN ({placeholders})
        """,
        [*region_ids, *region_ids],
    )
    connection.execute(
        f"""
        DELETE FROM admin_regions
        WHERE id IN ({placeholders})
        """,
        region_ids,
    )


def enumerate_admin_region_keys_for_rows(
    rows: list[sqlite3.Row],
    *,
    min_zoom: int,
    max_zoom: int,
) -> set[tuple[int, int, int]]:
    if not rows:
        return set()
    return set(
        enumerate_admin_region_tile_keys(
            prepare_admin_region_tile_rows(rows),
            min_zoom=min_zoom,
            max_zoom=max_zoom,
        ),
    )


def delete_existing_taiwan_generated_admin_rows(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        DELETE FROM admin_region_tree
        WHERE child_id LIKE ?
           OR child_id LIKE ?
           OR parent_id LIKE ?
           OR parent_id LIKE ?
        """,
        (
            f"{TAIWAN_COUNTY_ID_PREFIX}%",
            f"{TAIWAN_TOWN_ID_PREFIX}%",
            f"{TAIWAN_COUNTY_ID_PREFIX}%",
            f"{TAIWAN_TOWN_ID_PREFIX}%",
        ),
    )
    connection.execute(
        """
        DELETE FROM admin_regions
        WHERE id LIKE ?
           OR id LIKE ?
        """,
        (
            f"{TAIWAN_COUNTY_ID_PREFIX}%",
            f"{TAIWAN_TOWN_ID_PREFIX}%",
        ),
    )


def load_taiwan_admin_region_features(
    county_geojson_path: Path,
    town_geojson_path: Path,
    *,
    taiwan_province_id: str = TAIWAN_PROVINCE_ID,
) -> list[dict[str, Any]]:
    county_source = load_geojson_feature_collection(county_geojson_path, label="Taiwan county/city")
    town_source = load_geojson_feature_collection(town_geojson_path, label="Taiwan township/district")
    county_features = create_taiwan_county_features(
        county_source["features"],
        taiwan_province_id=taiwan_province_id,
    )
    town_features = create_taiwan_town_features(town_source["features"])

    county_ids = {
        str(feature["properties"]["id"])
        for feature in county_features
    }
    orphan_town_parent_ids = sorted(
        {
            str(feature["properties"]["parentId"])
            for feature in town_features
            if str(feature["properties"]["parentId"]) not in county_ids
        },
    )
    if orphan_town_parent_ids:
        raise ValueError(
            "Taiwan town source references county codes missing from county source: "
            + ", ".join(orphan_town_parent_ids),
        )

    return [
        *county_features,
        *town_features,
    ]


def load_geojson_feature_collection(path: Path, *, label: str) -> dict[str, Any]:
    source = json.loads(path.read_text(encoding="utf-8-sig"))
    if source.get("type") != "FeatureCollection" or not isinstance(source.get("features"), list):
        raise ValueError(f"{label} GeoJSON must be a FeatureCollection: {path}")
    return source


def create_taiwan_county_features(
    source_features: list[Any],
    *,
    taiwan_province_id: str,
) -> list[dict[str, Any]]:
    features = []
    seen_county_codes: set[str] = set()
    for feature in source_features:
        if not isinstance(feature, dict):
            continue
        properties = require_feature_properties(feature, label="Taiwan county/city")
        county_code = require_source_property(properties, "COUNTYCODE", label="Taiwan county/city")
        if county_code in seen_county_codes:
            raise ValueError(f"Duplicate Taiwan county/city code: {county_code}")
        seen_county_codes.add(county_code)
        county_name = require_source_property(properties, "COUNTYNAME", label="Taiwan county/city")
        geometry = repair_polygonal_geojson_geometry(
            require_feature_geometry(feature, label=f"Taiwan county/city {county_code}"),
            label=f"Taiwan county/city {county_code}",
        )
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"{TAIWAN_COUNTY_ID_PREFIX}{county_code}",
                    "name": county_name,
                    "level": 3,
                    "parentId": taiwan_province_id,
                },
                "geometry": geometry,
            },
        )
    return sorted(features, key=lambda feature: str(feature["properties"]["id"]))


def create_taiwan_town_features(source_features: list[Any]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    geometries_by_town_code: dict[str, list[BaseGeometry]] = {}

    for feature in source_features:
        if not isinstance(feature, dict):
            continue
        properties = require_feature_properties(feature, label="Taiwan township/district")
        town_code = require_source_property(properties, "TOWNCODE", label="Taiwan township/district")
        town_name = require_source_property(properties, "TOWNNAME", label=f"Taiwan township/district {town_code}")
        county_code = require_source_property(properties, "COUNTYCODE", label=f"Taiwan township/district {town_code}")
        geometry = repair_polygonal_shapely_geometry(
            shape(require_feature_geometry(feature, label=f"Taiwan township/district {town_code}")),
            label=f"Taiwan township/district {town_code}",
        )

        existing = grouped.get(town_code)
        current_record = {
            "town_name": town_name,
            "county_code": county_code,
        }
        if existing is None:
            grouped[town_code] = current_record
            geometries_by_town_code[town_code] = [geometry]
            continue
        if existing != current_record:
            raise ValueError(f"Conflicting Taiwan township/district duplicate for code: {town_code}")
        geometries_by_town_code[town_code].append(geometry)

    features = []
    for town_code, record in sorted(grouped.items()):
        merged_geometry = repair_polygonal_shapely_geometry(
            unary_union(geometries_by_town_code[town_code]),
            label=f"Taiwan township/district {town_code}",
        )
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"{TAIWAN_TOWN_ID_PREFIX}{town_code}",
                    "name": str(record["town_name"]),
                    "level": 4,
                    "parentId": f"{TAIWAN_COUNTY_ID_PREFIX}{record['county_code']}",
                },
                "geometry": shapely_geometry_to_geojson(merged_geometry),
            },
        )
    return features


def require_feature_properties(feature: dict[str, Any], *, label: str) -> dict[str, Any]:
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        raise ValueError(f"{label} feature is missing properties")
    return properties


def require_feature_geometry(feature: dict[str, Any], *, label: str) -> dict[str, Any]:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        raise ValueError(f"{label} feature is missing geometry")
    return geometry


def require_source_property(properties: dict[str, Any], key: str, *, label: str) -> str:
    value = properties.get(key)
    if value in {None, ""}:
        raise ValueError(f"{label} feature is missing {key}")
    return str(value)


def repair_polygonal_geojson_geometry(geometry: dict[str, Any], *, label: str) -> dict[str, Any]:
    return shapely_geometry_to_geojson(repair_polygonal_shapely_geometry(shape(geometry), label=label))


def repair_polygonal_shapely_geometry(geometry: BaseGeometry, *, label: str) -> BaseGeometry:
    if geometry.is_empty:
        raise ValueError(f"{label} geometry is empty")
    repaired = make_valid(geometry) if not geometry.is_valid else geometry
    polygonal = extract_polygonal_geometry(repaired)
    if polygonal is None or polygonal.is_empty:
        raise ValueError(f"{label} geometry does not contain polygonal data")
    if not polygonal.is_valid:
        polygonal = make_valid(polygonal)
    polygonal = extract_polygonal_geometry(polygonal)
    if polygonal is None or polygonal.is_empty or not polygonal.is_valid:
        raise ValueError(f"{label} geometry could not be repaired")
    return polygonal


def extract_polygonal_geometry(geometry: BaseGeometry) -> BaseGeometry | None:
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    if isinstance(geometry, GeometryCollection):
        polygons = [
            current_geometry
            for current_geometry in geometry.geoms
            if isinstance(current_geometry, (Polygon, MultiPolygon)) and not current_geometry.is_empty
        ]
        if not polygons:
            return None
        return unary_union(polygons)
    return None


def shapely_geometry_to_geojson(geometry: BaseGeometry) -> dict[str, Any]:
    return json.loads(json.dumps(mapping(geometry), separators=(",", ":")))


def transform_gcj02_geometry_to_wgs84(geometry: dict[str, Any]) -> dict[str, Any]:
    return transform_geojson_geometry_coordinates(geometry, transform_gcj02_to_wgs84_position)


def transform_gcj02_to_wgs84_position(position: Any) -> Any:
    if not isinstance(position, (list, tuple)) or len(position) < 2:
        return position
    longitude, latitude = transform_gcj02_to_wgs84_coordinate(
        longitude=float(position[0]),
        latitude=float(position[1]),
    )
    return [longitude, latitude, *list(position[2:])]


def export_current_level_one_features(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, name, level, geometry, line_geometry, line_mask_geometry
        FROM admin_regions
        WHERE level = 1
        ORDER BY id
        """,
    ).fetchall()
    if not rows:
        raise ValueError("Current database must contain level 1 admin regions before China rebuild")

    features = []
    for row in rows:
        feature: dict[str, Any] = {
            "type": "Feature",
            "properties": {
                "id": str(row["id"]),
                "name": str(row["name"]),
                "level": int(row["level"]),
            },
            "geometry": json.loads(str(row["geometry"])),
        }
        line_geometry = row["line_geometry"]
        line_mask_geometry = row["line_mask_geometry"]
        if line_geometry is not None:
            feature["lineGeometry"] = json.loads(str(line_geometry))
        if line_mask_geometry is not None:
            feature["lineMaskGeometry"] = json.loads(str(line_mask_geometry))
        features.append(feature)
    return features


def find_china_country_id(connection: sqlite3.Connection) -> str:
    row = connection.execute(
        """
        SELECT id
        FROM admin_regions
        WHERE level = 1
          AND (
            id IN ('cn', 'CN', 'chn', 'CHN', '156')
            OR lower(id) LIKE '%:cn'
            OR lower(name) = 'china'
            OR name = '中国'
          )
        ORDER BY
          CASE
            WHEN id = 'cn' THEN 0
            WHEN lower(id) LIKE '%:cn' THEN 1
            ELSE 2
          END,
          id
        LIMIT 1
        """,
    ).fetchone()
    if row is not None:
        return str(row["id"])

    geometry_match = find_country_id_covering_point(
        connection,
        longitude=116.397,
        latitude=39.908,
    )
    if geometry_match is not None:
        return geometry_match
    raise ValueError("Current database must contain a China country row before China rebuild")


def find_country_id_covering_point(
    connection: sqlite3.Connection,
    *,
    longitude: float,
    latitude: float,
) -> str | None:
    point = Point(longitude, latitude)
    rows = connection.execute(
        """
        SELECT id, geometry
        FROM admin_regions
        WHERE level = 1
          AND min_lng <= ?
          AND max_lng >= ?
          AND min_lat <= ?
          AND max_lat >= ?
        ORDER BY id
        """,
        (longitude, longitude, latitude, latitude),
    ).fetchall()
    for row in rows:
        geometry = shape(json.loads(str(row["geometry"])))
        if geometry.covers(point):
            return str(row["id"])
    return None


def load_china_admin_region_features(
    china_admin_region_data_path: Path,
    *,
    china_country_id: str,
) -> list[dict[str, Any]]:
    source = json.loads(china_admin_region_data_path.read_text(encoding="utf-8-sig"))
    if source.get("type") != "FeatureCollection" or not isinstance(source.get("features"), list):
        raise ValueError(f"China admin region GeoJSON must be a FeatureCollection: {china_admin_region_data_path}")

    attached_features = []
    for feature in source["features"]:
        if not isinstance(feature, dict):
            continue
        attached_feature = copy.deepcopy(feature)
        properties = attached_feature.get("properties") or {}
        if not isinstance(properties, dict):
            attached_features.append(attached_feature)
            continue
        if should_attach_china_feature_to_country(properties):
            properties["parentId"] = china_country_id
            attached_feature["properties"] = properties
        attached_features.append(attached_feature)

    return normalize_admin_region_features(
        {
            "type": "FeatureCollection",
            "features": attached_features,
        },
    )


def should_attach_china_feature_to_country(properties: dict[str, Any]) -> bool:
    if properties.get("parent") or properties.get("parentId") or properties.get("parent_id"):
        return False
    if properties.get("pid") or properties.get("parent_adcode"):
        return False
    return properties.get("level") == "province"


def replace_admin_region_fact_rows(
    connection: sqlite3.Connection,
    features: list[dict[str, Any]],
) -> None:
    with connection:
        connection.execute("DELETE FROM admin_region_tree")
        connection.execute("DELETE FROM admin_regions")
        for feature in features:
            insert_admin_region_feature(connection, feature)
        for feature in features:
            properties = feature.get("properties", {})
            if not isinstance(properties, dict):
                continue
            parent_id = properties.get("parentId") or properties.get("parent_id")
            child_id = properties.get("id")
            if parent_id and child_id:
                connection.execute(
                    "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
                    (str(parent_id), str(child_id)),
                )
        invalidate_admin_region_thumbnail_paths(connection)
        invalidate_admin_region_daily_stats(connection)


def create_china_patch_source_signature(china_admin_region_data_path: Path) -> str:
    china_signature = json.loads(
        create_source_signature(china_admin_region_data_path, ADMIN_REGION_LOADER_VERSION),
    )
    return json.dumps(
        {
            "loaderVersion": ADMIN_REGION_LOADER_VERSION,
            "world": "current-db-level-1",
            "china": china_signature,
        },
        separators=(",", ":"),
    )


def rebuild_admin_region_tile_depth_range(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    min_zoom: int,
    max_zoom: int,
    commit_interval: int,
) -> AdminRegionTileBuildResult:
    connection.execute(
        """
        DELETE FROM admin_region_tiles
        WHERE focus_region_id = ?
          AND depth = ?
          AND z BETWEEN ? AND ?
        """,
        (focus_region_id, depth, min_zoom, max_zoom),
    )
    connection.commit()
    return build_admin_region_tiles(
        connection,
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        commit_interval=commit_interval,
    )


def load_greenland_feature(
    *,
    source_path: Path | None,
    source_cache_path: Path,
) -> dict[str, Any]:
    feature_collection = (
        json.loads(source_path.read_text(encoding="utf-8-sig"))
        if source_path is not None
        else load_cached_country_source(source_cache_path)
    )
    for feature in feature_collection.get("features", []):
        properties = feature.get("properties") or {}
        if is_greenland_source_feature(properties):
            geometry = feature.get("geometry")
            if not isinstance(geometry, dict):
                raise ValueError("Greenland source feature is missing geometry")
            return {
                "type": "Feature",
                "properties": {
                    "id": GREENLAND_REGION_ID,
                    "name": "Greenland",
                    "level": 1,
                },
                "geometry": geometry,
            }
    raise ValueError("Greenland feature not found in source")


def load_cached_country_source(source_cache_path: Path) -> dict[str, Any]:
    if not source_cache_path.exists():
        source_cache_path.parent.mkdir(parents=True, exist_ok=True)
        response = requests.get(GREENLAND_SOURCE_URL, timeout=30)
        response.raise_for_status()
        source_cache_path.write_text(response.text, encoding="utf-8")
    return json.loads(source_cache_path.read_text(encoding="utf-8-sig"))


def is_greenland_source_feature(properties: dict[str, Any]) -> bool:
    names = {
        str(properties.get("name", "")).casefold(),
        str(properties.get("ADMIN", "")).casefold(),
        str(properties.get("NAME", "")).casefold(),
    }
    codes = {
        str(properties.get("ISO3166-1-Alpha-2", "")).upper(),
        str(properties.get("ISO3166-1-Alpha-3", "")).upper(),
        str(properties.get("ISO_A2", "")).upper(),
        str(properties.get("ISO_A3", "")).upper(),
    }
    return "greenland" in names or "GL" in codes or "GRL" in codes


def upsert_admin_region_feature(connection: sqlite3.Connection, feature: dict[str, Any]) -> None:
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        raise ValueError("Admin region feature requires geometry")
    region_id = str(properties["id"])
    bbox = calculate_geometry_bbox(geometry)
    connection.execute(
        """
        INSERT INTO admin_regions (
          id,
          name,
          level,
          geometry,
          source_geometry,
          source_coordinate_system,
          line_geometry,
          line_mask_geometry,
          min_lng,
          max_lng,
          min_lat,
          max_lat,
          first_seen_timestamp,
          footprint_count,
          stay_duration_seconds,
          travel_distance_meters
        ) VALUES (?, ?, ?, ?, ?, 'wgs84', NULL, NULL, ?, ?, ?, ?, NULL, 0, 0, 0)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          level = excluded.level,
          geometry = excluded.geometry,
          source_geometry = excluded.source_geometry,
          source_coordinate_system = excluded.source_coordinate_system,
          line_geometry = excluded.line_geometry,
          line_mask_geometry = excluded.line_mask_geometry,
          min_lng = excluded.min_lng,
          max_lng = excluded.max_lng,
          min_lat = excluded.min_lat,
          max_lat = excluded.max_lat
        """,
        (
            region_id,
            str(properties["name"]),
            int(properties["level"]),
            json.dumps(geometry, ensure_ascii=False, separators=(",", ":")),
            json.dumps(geometry, ensure_ascii=False, separators=(",", ":")),
            bbox["min_lng"],
            bbox["max_lng"],
            bbox["min_lat"],
            bbox["max_lat"],
        ),
    )
    connection.execute("DELETE FROM admin_region_tree WHERE child_id = ?", (region_id,))
    invalidate_admin_region_thumbnail_paths(connection)
    invalidate_admin_region_daily_stats(connection)
    connection.commit()
    print(f"Upserted admin region {region_id} ({properties['name']})")


def patch_region_tile_keys(
    connection: sqlite3.Connection,
    *,
    region_id: str,
    depths: Iterable[int],
    min_zoom: int,
    max_zoom: int,
    commit_interval: int,
) -> None:
    row = connection.execute(
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
          NULL AS parent_id
        FROM admin_regions r
        WHERE r.id = ?
        """,
        (region_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"Admin region {region_id} does not exist")

    prepared_rows = prepare_admin_region_tile_rows([row])
    tile_keys = enumerate_admin_region_tile_keys(
        prepared_rows,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
    )
    for depth in depths:
        result = patch_admin_region_overlay_tile_keys(
            connection,
            focus_region_id=ADMIN_REGION_WORLD_FOCUS_ID,
            depth=depth,
            region_id=region_id,
            tile_keys=tile_keys,
            commit_interval=commit_interval,
        )
        print(
            f"Patched {result.built_count} admin region tile rows "
            f"from {result.candidate_count} {region_id} tile keys "
            f"for depth {depth} zoom {min_zoom}-{max_zoom}",
        )


def patch_admin_region_overlay_tile_keys(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    region_id: str,
    tile_keys: Iterable[tuple[int, int, int]],
    commit_interval: int,
) -> AdminRegionTileBuildResult:
    resolved_tile_keys = sorted(set(tile_keys))
    updated_at = int(time.time() * 1000)
    built_count = 0
    min_zoom = min((z for z, _x, _y in resolved_tile_keys), default=0)
    max_zoom = max((z for z, _x, _y in resolved_tile_keys), default=0)
    source_rows = resolve_focused_region_rows(
        connection,
        focus_region_id=focus_region_id,
        depth=depth,
    )
    rows_by_tile_key = index_admin_region_tile_rows(
        prepare_admin_region_tile_rows(source_rows),
        min_zoom=min_zoom,
        max_zoom=max_zoom,
    )

    for z, x, y in resolved_tile_keys:
        tile = encode_admin_region_mvt_from_prepared_rows(
            rows_by_tile_key.get((z, x, y), []),
            z=z,
            x=x,
            y=y,
        )
        if not tile or not tile_has_region_fill(tile, region_id=region_id):
            continue
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
                count_tile_features(tile),
                updated_at,
            ),
        )
        built_count += 1
        if commit_interval > 0 and built_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(resolved_tile_keys),
        built_count=built_count,
        feature_count=len(source_rows),
    )


def patch_admin_region_changed_tile_keys(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    tile_keys: Iterable[tuple[int, int, int]],
    changed_region_ids: Iterable[str],
    changed_rows: list[sqlite3.Row],
    commit_interval: int,
) -> AdminRegionTileBuildResult:
    resolved_tile_keys = sorted(set(tile_keys))
    changed_region_id_set = set(changed_region_ids)
    prepared_changed_rows = prepare_admin_region_tile_rows(changed_rows)
    updated_at = int(time.time() * 1000)
    built_count = 0
    min_zoom = min((z for z, _x, _y in resolved_tile_keys), default=0)
    max_zoom = max((z for z, _x, _y in resolved_tile_keys), default=0)

    for z, x, y in resolved_tile_keys:
        existing_tile_row = connection.execute(
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
        if existing_tile_row is None:
            continue

        existing_features = get_admin_region_tile_features(bytes(existing_tile_row["tile"]))
        remaining_features = [
            feature
            for feature in existing_features
            if get_admin_region_feature_region_id(feature) not in changed_region_id_set
        ]
        changed_tile = encode_admin_region_mvt_from_prepared_rows(
            prepared_changed_rows,
            z=z,
            x=x,
            y=y,
        )
        changed_features = get_admin_region_tile_features(changed_tile) if changed_tile else []
        tile = encode_admin_region_tile_features([*remaining_features, *changed_features])
        if not tile:
            connection.execute(
                """
                DELETE FROM admin_region_tiles
                WHERE z = ?
                  AND x = ?
                  AND y = ?
                  AND focus_region_id = ?
                  AND depth = ?
                """,
                (z, x, y, focus_region_id, depth),
            )
            continue
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
                len(remaining_features) + len(changed_features),
                updated_at,
            ),
        )
        built_count += 1
        if commit_interval > 0 and built_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(resolved_tile_keys),
        built_count=built_count,
        feature_count=len(prepared_changed_rows),
    )


def get_admin_region_feature_region_id(feature: dict[str, Any]) -> str | None:
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return None
    region_id = properties.get("region_id")
    return str(region_id) if region_id is not None else None


def encode_admin_region_tile_features(features: list[dict[str, Any]]) -> bytes:
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


def replace_cached_admin_region_target_lines(
    tile: bytes,
    *,
    decoded_features: list[dict[str, Any]],
    region_id: str,
    replacement_line_features: list[dict[str, object]],
) -> tuple[bytes, int]:
    tile_message = vector_tile_pb2.tile()
    tile_message.ParseFromString(tile)
    layer = next(
        (layer for layer in tile_message.layers if layer.name == ADMIN_REGION_TILE_LAYER_NAME),
        None,
    )
    if layer is None:
        raise ValueError(f"Tile is missing {ADMIN_REGION_TILE_LAYER_NAME} layer")
    if len(layer.features) != len(decoded_features):
        raise ValueError("Decoded admin-region feature count does not match raw MVT features")

    remove_indexes = [
        index
        for index, feature in enumerate(decoded_features)
        if get_admin_region_feature_kind(feature) == ADMIN_REGION_LINE_FEATURE_KIND
        and get_admin_region_feature_region_id(feature) == region_id
    ]
    for index in reversed(remove_indexes):
        del layer.features[index]

    replacement_tile = vector_tile_pb2.tile()
    replacement_tile.ParseFromString(
        encode_admin_region_tile_features(replacement_line_features),
    )
    replacement_layer = next(
        (layer for layer in replacement_tile.layers if layer.name == ADMIN_REGION_TILE_LAYER_NAME),
        None,
    )
    if replacement_layer is None:
        raise ValueError(f"Replacement tile is missing {ADMIN_REGION_TILE_LAYER_NAME} layer")

    key_indexes = {key: index for index, key in enumerate(layer.keys)}
    replacement_key_indexes: dict[int, int] = {}
    for index, key in enumerate(replacement_layer.keys):
        target_index = key_indexes.get(key)
        if target_index is None:
            target_index = len(layer.keys)
            layer.keys.append(key)
            key_indexes[key] = target_index
        replacement_key_indexes[index] = target_index

    value_indexes = {
        value.SerializeToString(): index
        for index, value in enumerate(layer.values)
    }
    replacement_value_indexes: dict[int, int] = {}
    for index, value in enumerate(replacement_layer.values):
        serialized = value.SerializeToString()
        target_index = value_indexes.get(serialized)
        if target_index is None:
            target_index = len(layer.values)
            layer.values.add().CopyFrom(value)
            value_indexes[serialized] = target_index
        replacement_value_indexes[index] = target_index

    for replacement_feature in replacement_layer.features:
        tags = list(replacement_feature.tags)
        if len(tags) % 2 != 0:
            raise ValueError("Replacement MVT feature has an invalid tag sequence")
        target_feature = layer.features.add()
        target_feature.CopyFrom(replacement_feature)
        del target_feature.tags[:]
        target_feature.tags.extend(
            mapped_index
            for index in range(0, len(tags), 2)
            for mapped_index in (
                replacement_key_indexes[tags[index]],
                replacement_value_indexes[tags[index + 1]],
            )
        )

    return tile_message.SerializeToString(), len(layer.features)


def rebuild_admin_region_overlay_tile_keys(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    tile_keys: Iterable[tuple[int, int, int]],
    commit_interval: int,
) -> AdminRegionTileBuildResult:
    resolved_tile_keys = sorted(set(tile_keys))
    updated_at = int(time.time() * 1000)
    built_count = 0
    min_zoom = min((z for z, _x, _y in resolved_tile_keys), default=0)
    max_zoom = max((z for z, _x, _y in resolved_tile_keys), default=0)
    candidate_feature_count = 0

    for z, x, y in resolved_tile_keys:
        source_rows = query_focused_region_rows_for_tile(
            connection,
            focus_region_id=focus_region_id,
            depth=depth,
            z=z,
            x=x,
            y=y,
        )
        candidate_feature_count += len(source_rows)
        tile = encode_admin_region_mvt_from_prepared_rows(
            prepare_admin_region_tile_rows(source_rows),
            z=z,
            x=x,
            y=y,
        )
        if not tile:
            connection.execute(
                """
                DELETE FROM admin_region_tiles
                WHERE z = ?
                  AND x = ?
                  AND y = ?
                  AND focus_region_id = ?
                  AND depth = ?
                """,
                (z, x, y, focus_region_id, depth),
            )
            continue
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
                count_tile_features(tile),
                updated_at,
            ),
        )
        built_count += 1
        if commit_interval > 0 and built_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(resolved_tile_keys),
        built_count=built_count,
        feature_count=candidate_feature_count,
    )


def patch_cached_admin_region_target_lines(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    region_id: str,
    min_zoom: int,
    max_zoom: int,
    commit_interval: int,
) -> AdminRegionTileBuildResult:
    region_bounds = connection.execute(
        """
        SELECT min_lng, max_lng, min_lat, max_lat
        FROM admin_regions
        WHERE id = ?
        """,
        (region_id,),
    ).fetchone()
    if region_bounds is None:
        raise ValueError(f"Admin region {region_id} does not exist")

    candidate_keys: list[tuple[int, int, int]] = []
    for z in range(min_zoom, max_zoom + 1):
        west_x, north_y = coordinate_to_tile(
            longitude=float(region_bounds["min_lng"]),
            latitude=float(region_bounds["max_lat"]),
            z=z,
        )
        east_x, south_y = coordinate_to_tile(
            longitude=float(region_bounds["max_lng"]),
            latitude=float(region_bounds["min_lat"]),
            z=z,
        )
        candidate_keys.extend(
            (int(row["z"]), int(row["x"]), int(row["y"]))
            for row in connection.execute(
                """
                SELECT z, x, y
                FROM admin_region_tiles
                WHERE focus_region_id = ?
                  AND depth = ?
                  AND z = ?
                  AND x BETWEEN ? AND ?
                  AND y BETWEEN ? AND ?
                  AND algorithm_signature != ?
                ORDER BY x, y
                """,
                (
                    focus_region_id,
                    depth,
                    z,
                    min(west_x, east_x),
                    max(west_x, east_x),
                    min(north_y, south_y),
                    max(north_y, south_y),
                    ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
                ),
            )
        )

    updated_at = int(time.time() * 1000)
    built_count = 0
    for z, x, y in candidate_keys:
        tile_row = connection.execute(
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
        if tile_row is None:
            continue

        existing_features = get_admin_region_tile_features(bytes(tile_row["tile"]))
        target_fill_features = [
            feature
            for feature in existing_features
            if get_admin_region_feature_kind(feature) == ADMIN_REGION_FILL_FEATURE_KIND
            and get_admin_region_feature_region_id(feature) == region_id
        ]
        target_line_features = create_admin_region_line_features_from_fill_features(
            target_fill_features,
        )
        if not target_line_features:
            continue

        for feature in target_line_features:
            properties = feature.get("properties")
            if isinstance(properties, dict):
                properties[ADMIN_REGION_BOUNDARY_REGION_IDS_PROPERTY] = f"|{region_id}|"

        existing_target_line_features = [
            feature
            for feature in existing_features
            if get_admin_region_feature_kind(feature) == ADMIN_REGION_LINE_FEATURE_KIND
            and get_admin_region_feature_region_id(feature) == region_id
        ]
        if normalize_admin_region_feature_payloads(
            existing_target_line_features,
        ) == normalize_admin_region_feature_payloads(target_line_features):
            continue

        tile, feature_count = replace_cached_admin_region_target_lines(
            bytes(tile_row["tile"]),
            decoded_features=existing_features,
            region_id=region_id,
            replacement_line_features=target_line_features,
        )
        connection.execute(
            """
            UPDATE admin_region_tiles
            SET algorithm_signature = ?,
                tile = ?,
                feature_count = ?,
                updated_at = ?
            WHERE z = ?
              AND x = ?
              AND y = ?
              AND focus_region_id = ?
              AND depth = ?
            """,
            (
                ADMIN_REGION_TARGET_LINE_PATCH_SIGNATURE,
                tile,
                feature_count,
                updated_at,
                z,
                x,
                y,
                focus_region_id,
                depth,
            ),
        )
        built_count += 1
        if commit_interval > 0 and built_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(candidate_keys),
        built_count=built_count,
        feature_count=1,
    )


def normalize_admin_region_feature_payloads(
    features: Iterable[dict[str, object]],
) -> list[str]:
    return sorted(
        json.dumps(
            {
                "geometry": feature.get("geometry"),
                "properties": feature.get("properties"),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        for feature in features
    )


def patch_admin_region_tile_lines(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    min_zoom: int,
    max_zoom: int,
    commit_interval: int,
) -> AdminRegionTileBuildResult:
    existing_tile_rows = list(
        connection.execute(
            """
            SELECT z, x, y, tile
            FROM admin_region_tiles
            WHERE focus_region_id = ?
              AND depth = ?
              AND z BETWEEN ? AND ?
              AND algorithm_signature != ?
            ORDER BY z, x, y
            """,
            (focus_region_id, depth, min_zoom, max_zoom, ADMIN_REGION_TILE_ALGORITHM_SIGNATURE),
        ),
    )
    updated_at = int(time.time() * 1000)
    built_count = 0
    source_rows = resolve_focused_region_rows(
        connection,
        focus_region_id=focus_region_id,
        depth=depth,
    )
    rows_by_tile_key = index_admin_region_tile_rows(
        prepare_admin_region_tile_rows(source_rows),
        min_zoom=min_zoom,
        max_zoom=max_zoom,
    )

    for existing_tile_row in existing_tile_rows:
        z = int(existing_tile_row["z"])
        x = int(existing_tile_row["x"])
        y = int(existing_tile_row["y"])
        existing_features = get_admin_region_tile_features(bytes(existing_tile_row["tile"]))
        fill_features = [
            feature
            for feature in existing_features
            if get_admin_region_feature_kind(feature) == ADMIN_REGION_FILL_FEATURE_KIND
        ]
        line_features = create_admin_region_tile_line_features_from_prepared_rows(
            rows_by_tile_key.get((z, x, y), []),
            z=z,
            x=x,
            y=y,
        )
        tile = encode_admin_region_tile_features([*fill_features, *line_features])
        if not tile:
            connection.execute(
                """
                DELETE FROM admin_region_tiles
                WHERE z = ?
                  AND x = ?
                  AND y = ?
                  AND focus_region_id = ?
                  AND depth = ?
                """,
                (z, x, y, focus_region_id, depth),
            )
            built_count += 1
            continue
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
                count_tile_features(tile),
                updated_at,
            ),
        )
        built_count += 1
        if commit_interval > 0 and built_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(existing_tile_rows),
        built_count=built_count,
        feature_count=len(source_rows),
    )


def get_admin_region_feature_kind(feature: dict[str, Any]) -> str | None:
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return None
    kind = properties.get("kind")
    return str(kind) if kind is not None else None


def query_focused_region_rows_for_tile(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    z: int,
    x: int,
    y: int,
) -> list[sqlite3.Row]:
    if focus_region_id != ADMIN_REGION_WORLD_FOCUS_ID:
        raise ValueError("Incremental overlay tile rebuild currently supports world focus only")
    return query_world_focus_region_rows_for_tile(
        connection,
        depth=depth,
        z=z,
        x=x,
        y=y,
    )


def query_world_focus_region_rows_for_tile(
    connection: sqlite3.Connection,
    *,
    depth: int,
    z: int,
    x: int,
    y: int,
) -> list[sqlite3.Row]:
    level_limit = min(max(depth, 1), 4)
    west, south, east, north = tile_bounds(z=z, x=x, y=y)
    padding = ADMIN_REGION_LEGACY_REBUILD_TILE_BBOX_PADDING_DEGREES
    bbox_parameters = (
        east + padding,
        west - padding,
        north + padding,
        south - padding,
    )
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
                  AND r.min_lng <= ?
                  AND r.max_lng >= ?
                  AND r.min_lat <= ?
                  AND r.max_lat >= ?
                  AND lower(r.name) != 'antarctica'
                  AND lower(r.id) NOT IN ('aq', 'ata', '010', 'country:aq', 'country:ata')
                  AND lower(r.id) NOT LIKE '%:aq'
                  AND lower(r.id) NOT LIKE '%:ata'
                ORDER BY r.id
                """,
                bbox_parameters,
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
              AND r.min_lng <= ?
              AND r.max_lng >= ?
              AND r.min_lat <= ?
              AND r.max_lat >= ?
              AND r.id IN (SELECT id FROM china_descendants)
            ORDER BY r.id
            """,
            (level_limit, *bbox_parameters),
        ),
    )


def patch_missing_admin_region_tile_keys(
    connection: sqlite3.Connection,
    *,
    focus_region_id: str,
    depth: int,
    min_zoom: int,
    max_zoom: int,
    commit_interval: int,
) -> AdminRegionTileBuildResult:
    source_rows = resolve_focused_region_rows(
        connection,
        focus_region_id=focus_region_id,
        depth=depth,
    )
    prepared_rows = prepare_admin_region_tile_rows(source_rows)
    rows_by_tile_key = index_admin_region_tile_rows(
        prepared_rows,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
    )
    existing_tile_keys = {
        (int(row["z"]), int(row["x"]), int(row["y"]))
        for row in connection.execute(
            """
            SELECT z, x, y
            FROM admin_region_tiles
            WHERE focus_region_id = ?
              AND depth = ?
              AND z BETWEEN ? AND ?
            """,
            (focus_region_id, depth, min_zoom, max_zoom),
        )
    }
    missing_tile_keys = sorted(set(rows_by_tile_key) - existing_tile_keys)
    updated_at = int(time.time() * 1000)
    built_count = 0

    for z, x, y in missing_tile_keys:
        tile = encode_admin_region_mvt_from_prepared_rows(
            rows_by_tile_key[(z, x, y)],
            z=z,
            x=x,
            y=y,
        )
        if not tile:
            continue
        connection.execute(
            """
            INSERT INTO admin_region_tiles (
              z, x, y, focus_region_id, depth, algorithm_signature, tile, feature_count, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                z,
                x,
                y,
                focus_region_id,
                depth,
                ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
                tile,
                count_tile_features(tile),
                updated_at,
            ),
        )
        built_count += 1
        if commit_interval > 0 and built_count % commit_interval == 0:
            connection.commit()

    connection.commit()
    return AdminRegionTileBuildResult(
        focus_region_id=focus_region_id,
        depth=depth,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        candidate_count=len(missing_tile_keys),
        built_count=built_count,
        feature_count=len(source_rows),
    )


def get_admin_region_tile_features(tile: bytes) -> list[dict[str, Any]]:
    decoded = decode_admin_region_tile(tile)
    layer = decoded.get(ADMIN_REGION_TILE_LAYER_NAME)
    if not isinstance(layer, dict):
        return []
    features = layer.get("features")
    if not isinstance(features, list):
        return []
    return [feature for feature in features if isinstance(feature, dict)]


def tile_has_region_fill(tile: bytes, *, region_id: str) -> bool:
    for feature in get_admin_region_tile_features(tile):
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        if str(properties.get("region_id")) == region_id and properties.get("kind") == "fill":
            return True
    return False


if __name__ == "__main__":
    raise SystemExit(main())
