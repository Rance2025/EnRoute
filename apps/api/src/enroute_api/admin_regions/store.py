from __future__ import annotations

import json
import copy
import sqlite3
from dataclasses import dataclass
from typing import Any, Iterable

from enroute_api.footprints.coordinates import transform_gcj02_to_wgs84_coordinate

from .geometry import BoundingBox, calculate_geometry_bbox, geometry_contains_point
from .scope import is_antarctica_admin_region_properties

OSM_ADMIN_LEVEL_TO_ENROUTE_LEVEL = {
    2: 1,
}
AREACITY_LEVEL_TO_ENROUTE_LEVEL = {
    "province": 2,
    "city": 3,
    "district": 4,
}
OVERTURE_SUBTYPE_TO_ENROUTE_LEVEL = {
    "country": 1,
}
CHINA_REGION_IDS = {"cn", "CN", "chn", "CHN", "156"}
SOURCE_COORDINATE_SYSTEM_WGS84 = "wgs84"
SOURCE_COORDINATE_SYSTEM_GCJ02 = "gcj02"


def initialize_admin_region_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS admin_regions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          level INTEGER NOT NULL,
          geometry TEXT NOT NULL,
          source_geometry TEXT,
          source_coordinate_system TEXT,
          line_geometry TEXT,
          line_mask_geometry TEXT,
          min_lng REAL NOT NULL,
          max_lng REAL NOT NULL,
          min_lat REAL NOT NULL,
          max_lat REAL NOT NULL,
          first_seen_timestamp INTEGER,
          footprint_count INTEGER NOT NULL DEFAULT 0,
          stay_duration_seconds INTEGER NOT NULL DEFAULT 0,
          travel_distance_meters REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_admin_regions_level ON admin_regions(level);
        CREATE INDEX IF NOT EXISTS idx_admin_regions_bbox
          ON admin_regions(min_lng, max_lng, min_lat, max_lat);
        CREATE TABLE IF NOT EXISTS admin_region_tree (
          parent_id TEXT NOT NULL,
          child_id TEXT NOT NULL,
          PRIMARY KEY (parent_id, child_id),
          FOREIGN KEY(parent_id) REFERENCES admin_regions(id),
          FOREIGN KEY(child_id) REFERENCES admin_regions(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_region_tree_child
          ON admin_region_tree(child_id);
        """,
    )
    migrate_admin_region_line_geometry(connection)
    migrate_admin_region_line_mask_geometry(connection)
    migrate_admin_region_source_geometry(connection)
    connection.commit()


def migrate_admin_region_line_geometry(connection: sqlite3.Connection) -> None:
    columns = [column[1] for column in connection.execute("PRAGMA table_info(admin_regions)")]
    if "line_geometry" not in columns:
        connection.execute("ALTER TABLE admin_regions ADD COLUMN line_geometry TEXT")


def migrate_admin_region_line_mask_geometry(connection: sqlite3.Connection) -> None:
    columns = [column[1] for column in connection.execute("PRAGMA table_info(admin_regions)")]
    if "line_mask_geometry" not in columns:
        connection.execute("ALTER TABLE admin_regions ADD COLUMN line_mask_geometry TEXT")


def migrate_admin_region_source_geometry(connection: sqlite3.Connection) -> None:
    columns = [column[1] for column in connection.execute("PRAGMA table_info(admin_regions)")]
    if "source_geometry" not in columns:
        connection.execute("ALTER TABLE admin_regions ADD COLUMN source_geometry TEXT")
    if "source_coordinate_system" not in columns:
        connection.execute("ALTER TABLE admin_regions ADD COLUMN source_coordinate_system TEXT")

    rows = connection.execute(
        """
        SELECT id, level, geometry, source_geometry, source_coordinate_system
        FROM admin_regions
        WHERE source_geometry IS NULL
           OR source_coordinate_system IS NULL
        """,
    ).fetchall()
    for row in rows:
        source_geometry = (
            str(row["geometry"]) if row["source_geometry"] is None else str(row["source_geometry"])
        )
        source_coordinate_system = normalize_source_coordinate_system(
            row["source_coordinate_system"],
        )
        if row["source_coordinate_system"] is None:
            source_coordinate_system = infer_legacy_source_coordinate_system(
                region_id=str(row["id"]),
                level=int(row["level"]),
            )
        canonical_geometry = convert_geometry_to_wgs84(
            json.loads(source_geometry),
            source_coordinate_system=source_coordinate_system,
        )
        bbox = calculate_geometry_bbox(canonical_geometry)
        connection.execute(
            """
            UPDATE admin_regions
            SET geometry = ?,
                source_geometry = ?,
                source_coordinate_system = ?,
                min_lng = ?,
                max_lng = ?,
                min_lat = ?,
                max_lat = ?
            WHERE id = ?
            """,
            (
                json.dumps(canonical_geometry, ensure_ascii=False, separators=(",", ":")),
                source_geometry,
                source_coordinate_system,
                bbox["min_lng"],
                bbox["max_lng"],
                bbox["min_lat"],
                bbox["max_lat"],
                str(row["id"]),
            ),
        )


def load_admin_regions(connection: sqlite3.Connection, feature_collection: dict[str, Any]) -> None:
    features = normalize_admin_region_features(feature_collection)

    with connection:
        connection.execute("DELETE FROM admin_region_tree")
        connection.execute("DELETE FROM admin_regions")
        for feature in features:
            insert_admin_region_feature(connection, feature)
        for feature in features:
            properties = feature.get("properties", {})
            parent_id = properties.get("parentId") or properties.get("parent_id")
            child_id = properties.get("id")
            if parent_id:
                connection.execute(
                    "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
                    (str(parent_id), str(child_id)),
                )


def normalize_admin_region_features(feature_collection: dict[str, Any]) -> list[dict[str, Any]]:
    features = feature_collection.get("features")
    if not isinstance(features, list):
        raise ValueError("Admin region GeoJSON must be a FeatureCollection")

    normalized_features = []
    for feature in features:
        normalized_feature = normalize_admin_region_feature(feature)
        if normalized_feature is not None:
            normalized_features.append(normalized_feature)
    return filter_supported_admin_region_scope(normalized_features)


def filter_supported_admin_region_scope(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    feature_by_id: dict[str, dict[str, Any]] = {}
    for feature in features:
        properties = feature.get("properties") or {}
        region_id = properties.get("id")
        if region_id not in {None, ""}:
            feature_by_id[str(region_id)] = feature

    return [
        feature
        for feature in features
        if is_supported_admin_region_feature(feature, feature_by_id)
    ]


def is_supported_admin_region_feature(
    feature: dict[str, Any],
    feature_by_id: dict[str, dict[str, Any]],
) -> bool:
    properties = feature.get("properties") or {}
    level = parse_int(properties.get("level"))
    region_id = properties.get("id")
    if level is None or region_id in {None, ""}:
        return True
    if level == 1 and is_antarctica_admin_region_properties(properties):
        return False
    if level == 1:
        return True
    if level < 1 or level > 4:
        return False
    return is_china_region_id(str(region_id)) or has_china_ancestor(properties, feature_by_id)


def has_china_ancestor(
    properties: dict[str, Any],
    feature_by_id: dict[str, dict[str, Any]],
) -> bool:
    parent_id = get_admin_region_parent_id(properties)
    seen: set[str] = set()
    while parent_id:
        if is_china_region_id(parent_id):
            return True
        if parent_id in seen:
            return False
        seen.add(parent_id)
        parent = feature_by_id.get(parent_id)
        if parent is None:
            return False
        parent_properties = parent.get("properties") or {}
        parent_id = get_admin_region_parent_id(parent_properties)
    return False


def is_china_region_id(region_id: str) -> bool:
    if region_id in CHINA_REGION_IDS:
        return True
    adcode_prefix = region_id[:6]
    if len(adcode_prefix) != 6 or not adcode_prefix.isdigit():
        return False
    province_code = int(adcode_prefix[:2])
    return 11 <= province_code <= 82


def get_admin_region_parent_id(properties: dict[str, Any]) -> str | None:
    parent_id = properties.get("parentId") or properties.get("parent_id")
    return None if parent_id in {None, ""} else str(parent_id)


def normalize_admin_region_feature(feature: dict[str, Any]) -> dict[str, Any] | None:
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry")
    line_geometry = get_feature_line_geometry(feature)
    line_mask_geometry = get_feature_line_mask_geometry(feature)
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return attach_feature_line_metadata(feature, line_geometry, line_mask_geometry)
    if is_overture_admin_region_feature(properties):
        return attach_feature_line_metadata(
            normalize_overture_admin_region_feature(properties, geometry),
            line_geometry,
            line_mask_geometry,
        )
    if is_areacity_admin_region_feature(properties):
        return attach_feature_line_metadata(
            normalize_areacity_admin_region_feature(properties, geometry),
            line_geometry,
            line_mask_geometry,
        )
    if properties.get("id") and properties.get("level") is not None:
        level = parse_int(properties.get("level"))
        if level is None:
            raise ValueError("Admin region feature level must be numeric")
        if level < 1 or level > 4:
            return None
        return attach_feature_line_metadata(feature, line_geometry, line_mask_geometry)

    osm_admin_level = parse_osm_admin_level(properties)
    if osm_admin_level is None:
        return attach_feature_line_metadata(feature, line_geometry, line_mask_geometry)
    enroute_level = OSM_ADMIN_LEVEL_TO_ENROUTE_LEVEL.get(osm_admin_level)
    if enroute_level is None:
        return None

    region_id = properties.get("id") or format_osm_region_id(properties)
    name = properties.get("name")
    if not region_id or not name:
        raise ValueError("OSM admin region feature requires osm_id, name, and admin level")

    normalized_properties = {
        "id": region_id,
        "name": str(name),
        "level": enroute_level,
    }
    parent_id = (
        properties.get("parentId")
        or properties.get("parent_id")
        or format_osm_parent_region_id(properties)
    )
    if parent_id:
        normalized_properties["parentId"] = parent_id

    return attach_feature_line_metadata(
        {
            "type": "Feature",
            "properties": normalized_properties,
            "geometry": copy.deepcopy(geometry),
        },
        line_geometry,
        line_mask_geometry,
    )


def get_feature_line_geometry(feature: dict[str, Any]) -> dict[str, Any] | None:
    line_geometry = feature.get("lineGeometry") or feature.get("line_geometry")
    return line_geometry if isinstance(line_geometry, dict) else None


def get_feature_line_mask_geometry(feature: dict[str, Any]) -> dict[str, Any] | None:
    line_mask_geometry = feature.get("lineMaskGeometry") or feature.get("line_mask_geometry")
    return line_mask_geometry if isinstance(line_mask_geometry, dict) else None


def attach_feature_line_metadata(
    feature: dict[str, Any] | None,
    line_geometry: dict[str, Any] | None,
    line_mask_geometry: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if feature is None or (line_geometry is None and line_mask_geometry is None):
        return feature
    feature_with_line_metadata = copy.deepcopy(feature)
    if line_geometry is not None:
        feature_with_line_metadata["lineGeometry"] = copy.deepcopy(line_geometry)
    if line_mask_geometry is not None:
        feature_with_line_metadata["lineMaskGeometry"] = copy.deepcopy(line_mask_geometry)
    return feature_with_line_metadata


def normalize_overture_admin_region_feature(
    properties: dict[str, Any],
    geometry: dict[str, Any],
) -> dict[str, Any] | None:
    subtype = properties.get("subtype")
    if not isinstance(subtype, str):
        return None

    enroute_level = OVERTURE_SUBTYPE_TO_ENROUTE_LEVEL.get(subtype)
    if enroute_level is None:
        return None

    region_id = properties.get("id")
    name = parse_overture_name(properties)
    if not region_id or not name:
        raise ValueError("Overture admin region feature requires id, names.primary, and subtype")

    normalized_properties = {
        "id": str(region_id),
        "name": name,
        "level": enroute_level,
    }
    parent_id = (
        properties.get("parentId")
        or properties.get("parent_id")
        or properties.get("parent")
        or properties.get("parent_division_id")
    )
    if parent_id not in {None, ""}:
        normalized_properties["parentId"] = str(parent_id)

    return {
        "type": "Feature",
        "properties": normalized_properties,
        "geometry": copy.deepcopy(geometry),
    }


def is_overture_admin_region_feature(properties: dict[str, Any]) -> bool:
    return (
        isinstance(properties.get("subtype"), str)
        and (
            str(properties.get("id", "")).startswith("overture:")
            or isinstance(properties.get("names"), dict)
        )
    )


def parse_overture_name(properties: dict[str, Any]) -> str | None:
    names = properties.get("names")
    if isinstance(names, dict):
        primary_name = names.get("primary")
        if isinstance(primary_name, str) and primary_name:
            return primary_name
        common_names = names.get("common")
        if isinstance(common_names, dict):
            for value in common_names.values():
                if isinstance(value, str) and value:
                    return value

    name = properties.get("name")
    if isinstance(name, str) and name:
        return name
    return None


def normalize_areacity_admin_region_feature(
    properties: dict[str, Any],
    geometry: dict[str, Any],
) -> dict[str, Any] | None:
    explicit_id = properties.get("id")
    adcode = properties.get("adcode") or explicit_id
    level = properties.get("level")
    if adcode in {None, ""} or not isinstance(level, str):
        return None

    enroute_level = AREACITY_LEVEL_TO_ENROUTE_LEVEL.get(level)
    if enroute_level is None:
        return None

    name = properties.get("name")
    if not name:
        raise ValueError("AreaCity admin region feature requires adcode, name, and level")

    normalized_properties = {
        "id": str(explicit_id or adcode),
        "name": str(name),
        "level": enroute_level,
        "sourceCoordinateSystem": SOURCE_COORDINATE_SYSTEM_GCJ02,
    }
    parent_id = (
        properties.get("parent")
        or properties.get("parentId")
        or properties.get("parent_id")
        or properties.get("pid")
        or properties.get("parent_adcode")
    )
    if parent_id not in {None, ""}:
        normalized_properties["parentId"] = str(parent_id)

    return {
        "type": "Feature",
        "properties": normalized_properties,
        "geometry": geometry,
    }


def is_areacity_admin_region_feature(properties: dict[str, Any]) -> bool:
    return (
        (properties.get("adcode") not in {None, ""} or properties.get("pid") not in {None, ""})
        and isinstance(properties.get("level"), str)
    )


def parse_osm_admin_level(properties: dict[str, Any]) -> int | None:
    fclass = properties.get("fclass")
    if isinstance(fclass, str) and fclass.startswith("admin_level"):
        return parse_int(fclass.removeprefix("admin_level"))

    admin_level = properties.get("admin_level")
    if admin_level is not None:
        return parse_int(admin_level)

    code = parse_int(properties.get("code"))
    if code is not None and 1200 < code < 1300:
        return code - 1200
    return None


def parse_int(value: Any) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def format_osm_region_id(properties: dict[str, Any]) -> str | None:
    osm_id = properties.get("osm_id") or properties.get("osmId")
    return None if osm_id in {None, ""} else f"osm:{osm_id}"


def format_osm_parent_region_id(properties: dict[str, Any]) -> str | None:
    parent_osm_id = properties.get("parent_osm_id") or properties.get("parentOsmId")
    return None if parent_osm_id in {None, ""} else f"osm:{parent_osm_id}"


def insert_admin_region_feature(connection: sqlite3.Connection, feature: dict[str, Any]) -> None:
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry")
    region_id = properties.get("id")
    name = properties.get("name")
    level = properties.get("level")
    if not region_id or not name or level is None or not isinstance(geometry, dict):
        raise ValueError("Admin region feature requires id, name, level, and geometry")

    source_geometry = copy.deepcopy(geometry)
    source_coordinate_system = get_feature_source_coordinate_system(properties)
    canonical_geometry = convert_geometry_to_wgs84(
        source_geometry,
        source_coordinate_system=source_coordinate_system,
    )
    bbox = calculate_geometry_bbox(canonical_geometry)
    line_geometry = get_feature_line_geometry(feature)
    line_mask_geometry = get_feature_line_mask_geometry(feature)
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0)
        """,
        (
            str(region_id),
            str(name),
            int(level),
            json.dumps(canonical_geometry, ensure_ascii=False, separators=(",", ":")),
            json.dumps(source_geometry, ensure_ascii=False, separators=(",", ":")),
            source_coordinate_system,
            None
            if line_geometry is None
            else json.dumps(line_geometry, ensure_ascii=False, separators=(",", ":")),
            None
            if line_mask_geometry is None
            else json.dumps(line_mask_geometry, ensure_ascii=False, separators=(",", ":")),
            bbox["min_lng"],
            bbox["max_lng"],
            bbox["min_lat"],
            bbox["max_lat"],
        ),
    )


def get_feature_source_coordinate_system(properties: dict[str, Any]) -> str:
    value = (
        properties.get("sourceCoordinateSystem")
        or properties.get("source_coordinate_system")
        or properties.get("coordinateSystem")
        or properties.get("coordinate_system")
    )
    return normalize_source_coordinate_system(value)


def normalize_source_coordinate_system(value: object) -> str:
    normalized = str(value or SOURCE_COORDINATE_SYSTEM_WGS84).strip().lower()
    if normalized == SOURCE_COORDINATE_SYSTEM_GCJ02:
        return SOURCE_COORDINATE_SYSTEM_GCJ02
    return SOURCE_COORDINATE_SYSTEM_WGS84


def infer_legacy_source_coordinate_system(*, region_id: str, level: int) -> str:
    if level > 1 and is_mainland_china_region_id(region_id):
        return SOURCE_COORDINATE_SYSTEM_GCJ02
    return SOURCE_COORDINATE_SYSTEM_WGS84


def is_mainland_china_region_id(region_id: str) -> bool:
    adcode_prefix = region_id[:6]
    if len(adcode_prefix) != 6 or not adcode_prefix.isdigit():
        return False
    province_code = int(adcode_prefix[:2])
    return 11 <= province_code <= 65


def convert_geometry_to_wgs84(
    geometry: dict[str, Any],
    *,
    source_coordinate_system: str,
) -> dict[str, Any]:
    if source_coordinate_system != SOURCE_COORDINATE_SYSTEM_GCJ02:
        return copy.deepcopy(geometry)
    return transform_geojson_geometry_coordinates(
        geometry,
        transform_gcj02_to_wgs84_position,
    )


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
            return copy.deepcopy(geometry)
        return {
            "type": "GeometryCollection",
            "geometries": [
                transform_geojson_geometry_coordinates(current_geometry, transformer)
                for current_geometry in geometries
                if isinstance(current_geometry, dict)
            ],
        }
    return copy.deepcopy(geometry)


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


def find_finest_region_id(
    connection: sqlite3.Connection,
    *,
    longitude: float,
    latitude: float,
) -> str | None:
    rows = connection.execute(
        """
        SELECT id, level, geometry
        FROM admin_regions
        WHERE min_lng <= ?
          AND max_lng >= ?
          AND min_lat <= ?
          AND max_lat >= ?
        ORDER BY level DESC
        """,
        (longitude, longitude, latitude, latitude),
    ).fetchall()

    for row in rows:
        geometry = json.loads(str(row["geometry"]))
        if geometry_contains_point(geometry, longitude=longitude, latitude=latitude):
            return str(row["id"])
    return None


@dataclass(frozen=True)
class CachedRegion:
    id: str
    level: int
    geometry: dict[str, Any]
    bbox: BoundingBox


class RegionMatcher:
    def __init__(self, regions: list[CachedRegion]) -> None:
        self.regions = regions

    def find_finest_region_id(
        self,
        *,
        longitude: float,
        latitude: float,
    ) -> str | None:
        for region in self.regions:
            bbox = region.bbox
            if (
                bbox["min_lng"] > longitude
                or bbox["max_lng"] < longitude
                or bbox["min_lat"] > latitude
                or bbox["max_lat"] < latitude
            ):
                continue
            if geometry_contains_point(
                region.geometry,
                longitude=longitude,
                latitude=latitude,
            ):
                return region.id
        return None


def create_region_matcher(connection: sqlite3.Connection) -> RegionMatcher:
    rows = connection.execute(
        """
        SELECT id, level, geometry, min_lng, max_lng, min_lat, max_lat
        FROM admin_regions
        ORDER BY level DESC
        """,
    ).fetchall()
    return RegionMatcher(
        [
            CachedRegion(
                id=str(row["id"]),
                level=int(row["level"]),
                geometry=json.loads(str(row["geometry"])),
                bbox={
                    "min_lng": float(row["min_lng"]),
                    "max_lng": float(row["max_lng"]),
                    "min_lat": float(row["min_lat"]),
                    "max_lat": float(row["max_lat"]),
                },
            )
            for row in rows
        ],
    )


def get_region_chain(connection: sqlite3.Connection, region_id: str | None) -> list[str]:
    if not region_id:
        return []

    chain = [region_id]
    current_id = region_id
    while True:
        row = connection.execute(
            "SELECT parent_id FROM admin_region_tree WHERE child_id = ?",
            (current_id,),
        ).fetchone()
        if row is None:
            return chain
        current_id = str(row["parent_id"])
        chain.append(current_id)


def get_region_levels(connection: sqlite3.Connection, region_ids: Iterable[str]) -> dict[int, str]:
    ids = list(region_ids)
    if not ids:
        return {}

    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT id, level FROM admin_regions WHERE id IN ({placeholders})",
        ids,
    ).fetchall()
    return {int(row["level"]): str(row["id"]) for row in rows}


def query_admin_regions_by_level(connection: sqlite3.Connection, level: int) -> list[sqlite3.Row]:
    return query_admin_regions(connection, level=level)


def query_admin_regions(
    connection: sqlite3.Connection,
    *,
    level: int,
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
    zoom: float | None = None,
) -> list[sqlite3.Row]:
    del zoom
    parameters: dict[str, float | int] = {"level": level}
    country_scope_filter = ""
    if level == 1:
        country_scope_filter = """
          AND lower(name) != 'antarctica'
          AND lower(id) NOT IN ('aq', 'ata', '010', 'country:aq', 'country:ata')
          AND lower(id) NOT LIKE '%:aq'
          AND lower(id) NOT LIKE '%:ata'
        """
    bbox_filter = ""
    if None not in {west, south, east, north}:
        parameters.update(
            {
                "west": float(west),
                "south": float(south),
                "east": float(east),
                "north": float(north),
            },
        )
        if float(west) <= float(east):
            longitude_clause = "min_lng <= :east AND max_lng >= :west"
        else:
            longitude_clause = "(min_lng <= :east OR max_lng >= :west)"
        bbox_filter = f"""
          AND min_lat <= :north
          AND max_lat >= :south
          AND {longitude_clause}
        """

    return list(
        connection.execute(
            f"""
            SELECT
              id,
              name,
              level,
              geometry,
              first_seen_timestamp,
              footprint_count,
              stay_duration_seconds,
              travel_distance_meters
            FROM admin_regions
            WHERE level = :level
            {country_scope_filter}
            {bbox_filter}
            ORDER BY id
            """,
            parameters,
        ),
    )


def format_admin_region(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "level": int(row["level"]),
        "geometry": json.loads(str(row["geometry"])),
        "firstSeenTimestamp": None
        if row["first_seen_timestamp"] is None
        else int(row["first_seen_timestamp"]),
        "footprintCount": int(row["footprint_count"]),
        "stayDurationSeconds": int(row["stay_duration_seconds"]),
        "travelDistanceMeters": float(row["travel_distance_meters"]),
    }
