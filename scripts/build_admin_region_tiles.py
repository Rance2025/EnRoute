from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import copy
from pathlib import Path
from typing import Any, Sequence

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

api_src_dir = Path(__file__).resolve().parents[1] / "apps" / "api" / "src"
if str(api_src_dir) not in sys.path:
    sys.path.insert(0, str(api_src_dir))
from enroute_api.footprints.coordinates import transform_gcj02_to_wgs84_coordinate


DEFAULT_ADMIN_REGION_FOCUS_ID = "world"
DEFAULT_ADMIN_REGION_DEPTHS = (1, 2, 3, 4)
CHINA_COUNTRY_ID_CANDIDATES = {"cn", "chn", "156", "china"}
CHINA_COUNTRY_NAMES = {"china", "中国", "中华人民共和国", "people's republic of china"}
CHINA_WORLDVIEW_COUNTRY_IDS = {
    "b0a31070-27f2-4949-ae87-87e730237575",
    "hk",
    "hkg",
    "344",
    "mo",
    "mac",
    "446",
    "tw",
    "twn",
    "158",
}
CHINA_WORLDVIEW_COUNTRY_NAMES = {
    "hong kong",
    "hong kong sar china",
    "macao",
    "macau",
    "macau sar china",
    "taiwan",
    "台灣",
    "台湾",
    "臺灣",
    "香港",
    "澳门",
    "澳門",
}
CHINA_WORLD_GAP_NEIGHBOR_DISTANCE_DEGREES = 0.05
COUNTRY_LINE_MASK_BUFFER_DEGREES = 0.08
COUNTRY_GEOMETRY_EPSILON_AREA = 1e-8


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
    repository_root_dir = Path(__file__).resolve().parents[1]
    resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
    add_api_src_to_path(repository_root_dir)

    from enroute_api.admin_regions.store import load_admin_regions
    from enroute_api.admin_regions.tiles import (
        DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM,
        build_admin_region_tiles,
        clear_admin_region_tiles,
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

    args = parse_args(argv, max_zoom_default=DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM)
    settings = Settings.from_env()
    admin_region_data_path = resolve_path(
        resolved_root_dir,
        args.admin_region_data_path or settings.admin_region_data_path,
    )
    china_admin_region_data_path = (
        resolve_path(resolved_root_dir, args.china_admin_region_data_path)
        if args.china_admin_region_data_path is not None
        else None
    )
    db_path = resolve_path(resolved_root_dir, args.database or settings.footprint_db_path)
    min_zoom = args.zoom if args.zoom is not None else args.min_zoom
    max_zoom = args.zoom if args.zoom is not None else args.max_zoom

    if not admin_region_data_path.exists():
        raise FileNotFoundError(admin_region_data_path)
    if china_admin_region_data_path is not None and not china_admin_region_data_path.exists():
        raise FileNotFoundError(china_admin_region_data_path)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        feature_collection = load_admin_region_feature_collection(
            admin_region_data_path,
            china_admin_region_data_path=china_admin_region_data_path,
        )
        load_admin_regions(connection, feature_collection)
        set_meta_value(
            connection,
            "adminRegionSourceSignature",
            create_admin_region_source_signature(
                admin_region_data_path,
                china_admin_region_data_path=china_admin_region_data_path,
                loader_version=ADMIN_REGION_LOADER_VERSION,
                create_source_signature=create_source_signature,
            ),
        )
        delete_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY)
        clear_admin_region_tiles(connection)
        depths = resolve_depths(depth=args.depth, depths=args.depths)
        results = [
            build_admin_region_tiles(
                connection,
                focus_region_id=args.focus_region_id,
                depth=depth,
                min_zoom=min_zoom,
                max_zoom=max_zoom,
                commit_interval=args.commit_interval,
            )
            for depth in depths
        ]
    finally:
        connection.close()

    for result in results:
        print(
            f"Built {result.built_count} admin region tile rows "
            f"from {result.candidate_count} candidate keys "
            f"for focus {result.focus_region_id} depth {result.depth} "
            f"zoom {result.min_zoom}-{result.max_zoom} into {db_path}",
        )
    return 0


def parse_args(argv: Sequence[str] | None, *, max_zoom_default: int) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build precomputed admin-region vector tile rows from local GeoJSON.",
    )
    parser.add_argument(
        "--admin-region-data-path",
        type=Path,
        help="Admin region GeoJSON path. Defaults to ADMIN_REGION_DATA_PATH.",
    )
    parser.add_argument(
        "--china-admin-region-data-path",
        type=Path,
        help="Optional China province/city/district GeoJSON merged under the China country feature.",
    )
    parser.add_argument("--database", type=Path, help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.")
    parser.add_argument(
        "--focus-region-id",
        default=DEFAULT_ADMIN_REGION_FOCUS_ID,
        help=f"Focused region id to build. Defaults to {DEFAULT_ADMIN_REGION_FOCUS_ID}.",
    )
    parser.add_argument("--depth", type=int, help="Descendant depth to render when --depths is not set.")
    parser.add_argument(
        "--depths",
        help="Comma-separated depths to build. Defaults to 1,2,3,4 for the UI switch.",
    )
    parser.add_argument("--min-zoom", type=int, default=0, help="Minimum zoom to build. Defaults to 0.")
    parser.add_argument(
        "--max-zoom",
        type=int,
        default=max_zoom_default,
        help=f"Maximum zoom to build. Defaults to {max_zoom_default}.",
    )
    parser.add_argument("--zoom", type=int, help="Build one zoom level, overriding --min-zoom and --max-zoom.")
    parser.add_argument(
        "--commit-interval",
        type=int,
        default=1000,
        help="Commit after this many populated tiles. Use 0 to commit only at the end.",
    )
    return parser.parse_args(argv)


def load_admin_region_feature_collection(
    world_data_path: Path,
    *,
    china_admin_region_data_path: Path | None,
) -> dict[str, Any]:
    world_feature_collection = read_feature_collection(world_data_path)
    if china_admin_region_data_path is None:
        return world_feature_collection

    china_feature_collection = read_feature_collection(china_admin_region_data_path)
    china_country_id = find_china_country_feature_id(world_feature_collection)
    if china_country_id is None:
        raise ValueError("China admin region source requires a China country feature in the world source")

    china_country_geometry = create_china_country_geometry(china_feature_collection)
    world_features = merge_china_country_geometry(
        world_feature_collection,
        china_country_id=china_country_id,
        china_country_geometry=china_country_geometry,
    )

    return {
        "type": "FeatureCollection",
        "features": [
            *world_features,
            *attach_china_root_parent(china_feature_collection, china_country_id=china_country_id),
        ],
    }


def read_feature_collection(path: Path) -> dict[str, Any]:
    feature_collection = json.loads(path.read_text(encoding="utf-8-sig"))
    if feature_collection.get("type") != "FeatureCollection" or not isinstance(
        feature_collection.get("features"),
        list,
    ):
        raise ValueError(f"Admin region GeoJSON must be a FeatureCollection: {path}")
    return feature_collection


def copy_features(feature_collection: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        copy.deepcopy(feature)
        for feature in feature_collection.get("features", [])
        if isinstance(feature, dict)
    ]


def create_china_country_geometry(china_feature_collection: dict[str, Any]) -> dict[str, Any]:
    province_geometries = []
    for feature in china_feature_collection.get("features", []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        if should_attach_to_china_country(properties):
            province_geometries.append(shape(transform_gcj02_geometry_to_wgs84(geometry)))

    if not province_geometries:
        raise ValueError("China admin region source requires province-level features")

    china_geometry = unary_union(province_geometries).buffer(0)
    if china_geometry.is_empty:
        raise ValueError("China admin region source produced an empty country geometry")
    return to_geojson_geometry(china_geometry)


def merge_china_country_geometry(
    world_feature_collection: dict[str, Any],
    *,
    china_country_id: str,
    china_country_geometry: dict[str, Any],
) -> list[dict[str, Any]]:
    merged_features = []
    china_geometry = shape(china_country_geometry)
    china_worldview_geometries = [
        shape(geometry)
        for properties, geometry in iter_country_feature_properties_and_geometries(world_feature_collection)
        if str(properties.get("id")) != china_country_id and is_china_worldview_country_properties(properties)
    ]
    if china_worldview_geometries:
        china_geometry = unary_union([china_geometry, *china_worldview_geometries]).buffer(0)
        china_country_geometry = to_geojson_geometry(china_geometry)
    world_china_geometry = find_country_geometry(
        world_feature_collection,
        region_id=china_country_id,
    )
    china_world_line_mask_geometry = None
    if world_china_geometry is not None:
        china_geometry = unary_union([world_china_geometry, china_geometry]).buffer(0)
        china_country_geometry = to_geojson_geometry(china_geometry)
        china_world_line_mask_geometry = world_china_geometry.buffer(COUNTRY_LINE_MASK_BUFFER_DEGREES)

    for feature in copy_features(world_feature_collection):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            merged_features.append(feature)
            continue
        if not is_country_level_feature(properties):
            merged_features.append(feature)
            continue

        region_id = properties.get("id")
        if str(region_id) == china_country_id:
            feature["geometry"] = china_country_geometry
            merged_features.append(feature)
            continue
        if is_china_worldview_country_properties(properties):
            continue

        difference_geometry = normalize_country_difference_geometry(shape(geometry).difference(china_geometry).buffer(0))
        if difference_geometry.is_empty:
            continue
        feature["geometry"] = to_geojson_geometry(difference_geometry)
        mask_source_geometries = [china_world_line_mask_geometry]
        line_mask_geometry = create_country_line_mask_geometry(
            difference_geometry,
            mask_source_geometries=mask_source_geometries,
        )
        if line_mask_geometry is not None:
            feature["lineMaskGeometry"] = to_geojson_geometry(line_mask_geometry)
        merged_features.append(feature)

    return merged_features


def create_country_line_mask_geometry(country_geometry, *, mask_source_geometries):
    mask_sources = [
        mask_source_geometry
        for mask_source_geometry in mask_source_geometries
        if mask_source_geometry is not None and not mask_source_geometry.is_empty
    ]
    if not mask_sources:
        return None
    boundary = country_geometry.boundary
    if boundary.is_empty:
        return None
    line_mask_source = unary_union(mask_sources).buffer(COUNTRY_LINE_MASK_BUFFER_DEGREES)
    masked_boundary = boundary.intersection(line_mask_source)
    if masked_boundary.is_empty:
        return None
    if masked_boundary.length <= 1e-9:
        return None
    return masked_boundary.buffer(COUNTRY_LINE_MASK_BUFFER_DEGREES)


def normalize_country_difference_geometry(geometry):
    if geometry.is_empty:
        return geometry
    if geometry.area <= COUNTRY_GEOMETRY_EPSILON_AREA:
        return geometry.difference(geometry)
    return geometry


def find_country_geometry(feature_collection: dict[str, Any], *, region_id: str):
    for properties, geometry in iter_country_feature_properties_and_geometries(feature_collection):
        if str(properties.get("id")) == region_id and is_country_level_feature(properties):
            return shape(geometry)
    return None


def iter_country_feature_properties_and_geometries(feature_collection: dict[str, Any]):
    for feature in feature_collection.get("features", []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        if not is_country_level_feature(properties):
            continue
        yield properties, geometry


def assign_china_world_gap_to_neighbor_countries(
    world_feature_collection: dict[str, Any],
    *,
    china_country_id: str,
    china_geometry,
    gap_geometry,
) -> dict[str, Any]:
    if gap_geometry is None or gap_geometry.is_empty:
        return {}

    neighbor_candidates = []
    for feature in world_feature_collection.get("features", []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        region_id = properties.get("id")
        if str(region_id) == china_country_id or not is_country_level_feature(properties):
            continue
        candidate_geometry = shape(geometry).difference(china_geometry).buffer(0)
        if not candidate_geometry.is_empty:
            neighbor_candidates.append((str(region_id), candidate_geometry))

    assigned_gap_parts: dict[str, list[Any]] = {}
    for gap_part in iter_shapely_parts(gap_geometry):
        nearest_region_id = None
        nearest_distance = None
        for region_id, candidate_geometry in neighbor_candidates:
            distance = candidate_geometry.distance(gap_part)
            if nearest_distance is None or distance < nearest_distance:
                nearest_distance = distance
                nearest_region_id = region_id
        if (
            nearest_region_id is None
            or nearest_distance is None
            or nearest_distance > CHINA_WORLD_GAP_NEIGHBOR_DISTANCE_DEGREES
        ):
            continue
        assigned_gap_parts.setdefault(nearest_region_id, []).append(gap_part)

    return {
        region_id: unary_union(parts).buffer(0)
        for region_id, parts in assigned_gap_parts.items()
        if parts
    }


def iter_shapely_parts(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type in {"MultiPolygon", "GeometryCollection"}:
        for child_geometry in geometry.geoms:
            yield from iter_shapely_parts(child_geometry)
        return
    yield geometry


def to_geojson_geometry(geometry) -> dict[str, Any]:
    return json.loads(json.dumps(mapping(geometry)))


def transform_gcj02_geometry_to_wgs84(geometry: dict[str, Any]) -> dict[str, Any]:
    return transform_geojson_geometry_coordinates(geometry, transform_gcj02_to_wgs84_position)


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


def find_china_country_feature_id(feature_collection: dict[str, Any]) -> str | None:
    for feature in feature_collection.get("features", []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        if not isinstance(properties, dict):
            continue
        if not is_country_level_feature(properties):
            continue
        region_id = properties.get("id")
        if region_id in {None, ""}:
            continue
        if is_china_country_properties(properties):
            return str(region_id)
    return None


def is_country_level_feature(properties: dict[str, Any]) -> bool:
    if str(properties.get("subtype", "")).lower() == "country":
        return True
    try:
        return int(str(properties.get("level"))) == 1
    except (TypeError, ValueError):
        return False


def is_china_country_properties(properties: dict[str, Any]) -> bool:
    region_id = str(properties.get("id", "")).strip().lower()
    if region_id in CHINA_COUNTRY_ID_CANDIDATES or region_id.endswith(":cn"):
        return True

    names = parse_country_names(properties)
    return any(name.strip().lower() in CHINA_COUNTRY_NAMES for name in names)


def is_china_worldview_country_properties(properties: dict[str, Any]) -> bool:
    region_id = str(properties.get("id", "")).strip().lower()
    if region_id in CHINA_WORLDVIEW_COUNTRY_IDS or region_id.endswith((":hk", ":hkg", ":mo", ":mac", ":tw", ":twn")):
        return True

    names = parse_country_names(properties)
    return any(name.strip().lower() in CHINA_WORLDVIEW_COUNTRY_NAMES for name in names)


def parse_country_names(properties: dict[str, Any]) -> list[str]:
    names: list[str] = []
    name = properties.get("name")
    if isinstance(name, str) and name:
        names.append(name)

    overture_names = properties.get("names")
    if isinstance(overture_names, dict):
        primary_name = overture_names.get("primary")
        if isinstance(primary_name, str) and primary_name:
            names.append(primary_name)
        common_names = overture_names.get("common")
        if isinstance(common_names, dict):
            names.extend(value for value in common_names.values() if isinstance(value, str) and value)
    return names


def attach_china_root_parent(
    china_feature_collection: dict[str, Any],
    *,
    china_country_id: str,
) -> list[dict[str, Any]]:
    attached_features = []
    for feature in copy_features(china_feature_collection):
        properties = feature.get("properties") or {}
        if not isinstance(properties, dict):
            attached_features.append(feature)
            continue
        if should_attach_to_china_country(properties):
            properties["parentId"] = china_country_id
            feature["properties"] = properties
        attached_features.append(feature)
    return attached_features


def should_attach_to_china_country(properties: dict[str, Any]) -> bool:
    if properties.get("parent") or properties.get("parentId") or properties.get("parent_id"):
        return False
    if properties.get("pid") or properties.get("parent_adcode"):
        return False
    return properties.get("level") == "province"


def create_admin_region_source_signature(
    world_data_path: Path,
    *,
    china_admin_region_data_path: Path | None,
    loader_version: str,
    create_source_signature,
) -> str:
    world_signature = json.loads(create_source_signature(world_data_path, loader_version))
    if china_admin_region_data_path is None:
        return json.dumps(world_signature, separators=(",", ":"))

    return json.dumps(
        {
            "loaderVersion": loader_version,
            "world": world_signature,
            "china": json.loads(create_source_signature(china_admin_region_data_path, loader_version)),
        },
        separators=(",", ":"),
    )


def resolve_depths(*, depth: int | None, depths: str | None) -> tuple[int, ...]:
    if depths:
        return tuple(parse_depths(depths))
    if depth is not None:
        return (depth,)
    return DEFAULT_ADMIN_REGION_DEPTHS


def parse_depths(value: str) -> list[int]:
    depths: list[int] = []
    for part in value.split(","):
        text = part.strip()
        if not text:
            continue
        depth = int(text)
        if depth not in depths:
            depths.append(depth)
    if not depths:
        raise ValueError("depths must include at least one depth")
    return depths


def add_api_src_to_path(root_dir: Path) -> None:
    api_src_dir = root_dir / "apps" / "api" / "src"
    sys.path.insert(0, str(api_src_dir))


def resolve_path(root_dir: Path, path: Path | str) -> Path:
    resolved_path = Path(path)
    if resolved_path.is_absolute():
        return resolved_path
    return root_dir / resolved_path


if __name__ == "__main__":
    raise SystemExit(main())
