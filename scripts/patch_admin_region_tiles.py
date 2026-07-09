from __future__ import annotations

import argparse
import copy
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

import requests
from shapely.geometry import Point, shape

api_src_dir = Path(__file__).resolve().parents[1] / "apps" / "api" / "src"
if str(api_src_dir) not in sys.path:
    sys.path.insert(0, str(api_src_dir))

from enroute_api.admin_regions.geometry import calculate_geometry_bbox
from enroute_api.admin_regions.store import (
    insert_admin_region_feature,
    normalize_admin_region_features,
)
from enroute_api.admin_regions.tiles import (
    ADMIN_REGION_TILE_ALGORITHM_SIGNATURE,
    ADMIN_REGION_TILE_LAYER_NAME,
    ADMIN_REGION_WORLD_FOCUS_ID,
    AdminRegionTileBuildResult,
    build_admin_region_tiles,
    count_tile_features,
    decode_admin_region_tile,
    encode_admin_region_mvt_from_prepared_rows,
    enumerate_admin_region_tile_keys,
    index_admin_region_tile_rows,
    initialize_admin_region_tile_schema,
    prepare_admin_region_tile_rows,
    resolve_focused_region_rows,
)
from enroute_api.config import Settings
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
    depths = parse_depths(args.depth, args.depths)

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        initialize_admin_region_tile_schema(connection)
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
        ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, 0, 0, 0)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          level = excluded.level,
          geometry = excluded.geometry,
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
            bbox["min_lng"],
            bbox["max_lng"],
            bbox["min_lat"],
            bbox["max_lat"],
        ),
    )
    connection.execute("DELETE FROM admin_region_tree WHERE child_id = ?", (region_id,))
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
