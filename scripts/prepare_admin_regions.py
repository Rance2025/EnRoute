from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Sequence


AREACITY_DEEP_TO_LEVEL = {
    "0": "province",
    "1": "city",
    "2": "district",
}
AREACITY_LEVEL_SUFFIX = {
    "province": "province",
    "city": "city",
    "district": "district",
}
CSV_FIELD_SIZE_LIMIT = 1_000_000_000


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
    resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
    args = parse_args(argv)
    source_csv = resolve_path(resolved_root_dir, args.source_csv)
    output_path = resolve_path(resolved_root_dir, args.output)
    shanghai_level5_geojson = (
        None
        if args.shanghai_level5_geojson is None
        else resolve_path(resolved_root_dir, args.shanghai_level5_geojson)
    )

    features = load_areacity_features(source_csv)
    if shanghai_level5_geojson is not None and shanghai_level5_geojson.exists():
        features.extend(load_shanghai_level5_features(shanghai_level5_geojson, features))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": features,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(features)} admin region features to {output_path}")
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert AreaCity ok_geo.csv into the local EnRoute admin-region GeoJSON.",
    )
    parser.add_argument(
        "--source-csv",
        type=Path,
        default=Path("external/ok_geo.csv"),
        help="AreaCity ok_geo.csv path.",
    )
    parser.add_argument(
        "--shanghai-level5-geojson",
        type=Path,
        default=Path("external/osm/shanghai-admin-level8.geojson"),
        help="Optional Shanghai OSM admin_level8 GeoJSON to append as EnRoute level 5.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("external/admin-regions.geojson"),
        help="Output GeoJSON path consumed by ADMIN_REGION_DATA_PATH.",
    )
    return parser.parse_args(argv)


def load_areacity_features(source_csv: Path) -> list[dict[str, Any]]:
    set_large_csv_field_limit()
    rows: list[dict[str, str]] = []
    normalized_adcode_by_raw_id: dict[str, str] = {}
    levels_by_adcode: dict[str, set[str]] = {}

    with source_csv.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            level = AREACITY_DEEP_TO_LEVEL.get(row.get("deep", ""))
            if level is None:
                continue
            normalized_adcode = normalize_areacity_adcode(row["id"], level)
            rows.append(row)
            normalized_adcode_by_raw_id[row["id"]] = normalized_adcode
            levels_by_adcode.setdefault(normalized_adcode, set()).add(level)

    features = []
    for row in rows:
        level = AREACITY_DEEP_TO_LEVEL[row.get("deep", "")]
        polygon = parse_areacity_polygon(row.get("polygon", ""))
        if polygon is None:
            continue
        adcode = normalized_adcode_by_raw_id[row["id"]]
        region_id = format_areacity_region_id(adcode, level, levels_by_adcode)
        properties = {
            "id": region_id,
            "adcode": adcode,
            "name": row["name"],
            "level": level,
        }
        parent_id = normalize_areacity_parent_adcode(
            row.get("pid", ""),
            level,
            normalized_adcode_by_raw_id,
            levels_by_adcode,
        )
        if parent_id is not None:
            properties["parent"] = parent_id
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": polygon,
            },
        )
    return features


def set_large_csv_field_limit() -> None:
    limit = CSV_FIELD_SIZE_LIMIT
    while limit > 131_072:
        try:
            csv.field_size_limit(limit)
            return
        except OverflowError:
            limit //= 10


def normalize_areacity_adcode(adcode: str, level: str) -> str:
    if level == "province":
        return adcode if len(adcode) >= 6 else adcode[:2].ljust(6, "0")
    if level == "city":
        return adcode if len(adcode) >= 6 else adcode[:4].ljust(6, "0")
    return adcode


def format_areacity_region_id(
    adcode: str,
    level: str,
    levels_by_adcode: dict[str, set[str]],
) -> str:
    if len(levels_by_adcode.get(adcode, set())) <= 1:
        return adcode
    return f"{adcode}:{AREACITY_LEVEL_SUFFIX[level]}"


def normalize_areacity_parent_adcode(
    parent_id: str,
    level: str,
    normalized_adcode_by_raw_id: dict[str, str],
    levels_by_adcode: dict[str, set[str]],
) -> str | None:
    if level == "province" or parent_id in {"", "0"}:
        return None
    if parent_id in normalized_adcode_by_raw_id:
        parent_adcode = normalized_adcode_by_raw_id[parent_id]
        parent_level = "province" if level == "city" else "city"
        return format_areacity_region_id(parent_adcode, parent_level, levels_by_adcode)
    if level == "city":
        parent_adcode = parent_id if len(parent_id) >= 6 else parent_id[:2].ljust(6, "0")
        return format_areacity_region_id(parent_adcode, "province", levels_by_adcode)
    parent_adcode = parent_id if len(parent_id) >= 6 else parent_id[:4].ljust(6, "0")
    return format_areacity_region_id(parent_adcode, "city", levels_by_adcode)


def parse_areacity_polygon(polygon_text: str) -> dict[str, Any] | None:
    polygons = []
    for ring_text in polygon_text.split(";"):
        ring = parse_areacity_ring(ring_text)
        if ring is not None:
            polygons.append([ring])

    if not polygons:
        return None
    if len(polygons) == 1:
        return {
            "type": "Polygon",
            "coordinates": polygons[0],
        }
    return {
        "type": "MultiPolygon",
        "coordinates": polygons,
    }


def parse_areacity_ring(ring_text: str) -> list[list[float]] | None:
    ring = []
    for point_text in ring_text.split(","):
        point_parts = point_text.strip().split()
        if len(point_parts) < 2:
            continue
        ring.append([float(point_parts[0]), float(point_parts[1])])

    if len(ring) < 3:
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def load_shanghai_level5_features(
    source_geojson: Path,
    areacity_features: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    payload = json.loads(source_geojson.read_text(encoding="utf-8-sig"))
    features = payload.get("features")
    if not isinstance(features, list):
        raise ValueError("Shanghai level 5 GeoJSON must be a FeatureCollection")

    district_features = [
        feature
        for feature in areacity_features
        if feature.get("properties", {}).get("level") == "district"
    ]
    normalized_features = []
    for feature in features:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        osm_id = properties.get("osm_id") or properties.get("osmId")
        name = properties.get("name")
        if not osm_id or not name or not isinstance(geometry, dict):
            continue

        normalized_properties = {
            "id": f"osm:{osm_id}",
            "name": str(name),
            "level": 5,
            "sourceCoordinateSystem": "wgs84",
        }
        parent_id = infer_shanghai_level5_parent_id(geometry, district_features)
        if parent_id is not None:
            normalized_properties["parentId"] = parent_id
        normalized_features.append(
            {
                "type": "Feature",
                "properties": normalized_properties,
                "geometry": geometry,
            },
        )
    return normalized_features


def infer_shanghai_level5_parent_id(
    geometry: dict[str, Any],
    district_features: list[dict[str, Any]],
) -> str | None:
    point = first_geometry_position(geometry)
    if point is None:
        return None
    longitude, latitude = point
    for feature in district_features:
        district_geometry = feature.get("geometry")
        if not isinstance(district_geometry, dict):
            continue
        if geometry_contains_point(district_geometry, longitude=longitude, latitude=latitude):
            district_id = feature.get("properties", {}).get("id")
            return None if district_id is None else str(district_id)
    return None


def first_geometry_position(geometry: dict[str, Any]) -> tuple[float, float] | None:
    coordinates = geometry.get("coordinates")
    geometry_type = geometry.get("type")
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        return first_position_in_polygon(coordinates)
    if geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        for polygon in coordinates:
            point = first_position_in_polygon(polygon)
            if point is not None:
                return point
    return None


def first_position_in_polygon(polygon: Any) -> tuple[float, float] | None:
    if not isinstance(polygon, list):
        return None
    for ring in polygon:
        if not isinstance(ring, list):
            continue
        for position in ring:
            if isinstance(position, list) and len(position) >= 2:
                return float(position[0]), float(position[1])
    return None


def geometry_contains_point(geometry: dict[str, Any], *, longitude: float, latitude: float) -> bool:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        return polygon_contains_point(coordinates, longitude=longitude, latitude=latitude)
    if geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        return any(
            polygon_contains_point(polygon, longitude=longitude, latitude=latitude)
            for polygon in coordinates
        )
    return False


def polygon_contains_point(
    polygon: list[Any],
    *,
    longitude: float,
    latitude: float,
) -> bool:
    if not polygon:
        return False
    exterior, *holes = polygon
    return ring_contains_point(exterior, longitude=longitude, latitude=latitude) and not any(
        ring_contains_point(hole, longitude=longitude, latitude=latitude)
        for hole in holes
    )


def ring_contains_point(ring: list[Any], *, longitude: float, latitude: float) -> bool:
    if len(ring) < 4:
        return False

    inside = False
    previous_lng, previous_lat = ring[-1]
    for current_lng, current_lat in ring:
        intersects = (current_lat > latitude) != (previous_lat > latitude)
        if intersects:
            x_at_latitude = (
                (previous_lng - current_lng)
                * (latitude - current_lat)
                / (previous_lat - current_lat)
                + current_lng
            )
            if longitude < x_at_latitude:
                inside = not inside
        previous_lng, previous_lat = current_lng, current_lat

    return inside


def resolve_path(root_dir: Path, path: Path | str) -> Path:
    resolved_path = Path(path)
    if resolved_path.is_absolute():
        return resolved_path
    return root_dir / resolved_path


if __name__ == "__main__":
    raise SystemExit(main())
