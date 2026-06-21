from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable

from enroute_api.footprints.coordinates import transform_footprint_coordinate

from .geometry import calculate_geometry_bbox, geometry_contains_point

OSM_ADMIN_LEVEL_TO_ENROUTE_LEVEL = {
    2: 1,
    4: 2,
    5: 3,
    6: 4,
    8: 5,
}
AREACITY_LEVEL_TO_ENROUTE_LEVEL = {
    "province": 2,
    "city": 3,
    "district": 4,
}


def initialize_admin_region_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS admin_regions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          level INTEGER NOT NULL,
          geometry TEXT NOT NULL,
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
    connection.commit()


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
    return normalized_features


def normalize_admin_region_feature(feature: dict[str, Any]) -> dict[str, Any] | None:
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return feature
    areacity_feature = normalize_areacity_admin_region_feature(properties, geometry)
    if areacity_feature is not None:
        return areacity_feature
    if properties.get("id") and properties.get("level") is not None:
        return feature

    osm_admin_level = parse_osm_admin_level(properties)
    if osm_admin_level is None:
        return feature
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

    return {
        "type": "Feature",
        "properties": normalized_properties,
        "geometry": transform_geometry_coordinates(geometry, source_coordinate_system="wgs84"),
    }


def normalize_areacity_admin_region_feature(
    properties: dict[str, Any],
    geometry: dict[str, Any],
) -> dict[str, Any] | None:
    adcode = properties.get("adcode") or properties.get("id")
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
        "id": str(adcode),
        "name": str(name),
        "level": enroute_level,
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


def transform_geometry_coordinates(
    geometry: dict[str, Any],
    *,
    source_coordinate_system: str,
) -> dict[str, Any]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type not in {"Polygon", "MultiPolygon"} or not isinstance(coordinates, list):
        return geometry

    return {
        "type": geometry_type,
        "coordinates": transform_nested_coordinates(
            coordinates,
            source_coordinate_system=source_coordinate_system,
        ),
    }


def transform_nested_coordinates(
    coordinates: list[Any],
    *,
    source_coordinate_system: str,
) -> list[Any]:
    if is_position(coordinates):
        longitude, latitude = transform_footprint_coordinate(
            longitude=float(coordinates[0]),
            latitude=float(coordinates[1]),
            source_coordinate_system=source_coordinate_system,
        )
        return [longitude, latitude, *coordinates[2:]]

    return [
        transform_nested_coordinates(coordinate, source_coordinate_system=source_coordinate_system)
        if isinstance(coordinate, list)
        else coordinate
        for coordinate in coordinates
    ]


def is_position(value: list[Any]) -> bool:
    if len(value) < 2:
        return False
    try:
        float(value[0])
        float(value[1])
    except (TypeError, ValueError):
        return False
    return True


def insert_admin_region_feature(connection: sqlite3.Connection, feature: dict[str, Any]) -> None:
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry")
    region_id = properties.get("id")
    name = properties.get("name")
    level = properties.get("level")
    if not region_id or not name or level is None or not isinstance(geometry, dict):
        raise ValueError("Admin region feature requires id, name, level, and geometry")

    bbox = calculate_geometry_bbox(geometry)
    connection.execute(
        """
        INSERT INTO admin_regions (
          id,
          name,
          level,
          geometry,
          min_lng,
          max_lng,
          min_lat,
          max_lat,
          first_seen_timestamp,
          footprint_count,
          stay_duration_seconds,
          travel_distance_meters
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0)
        """,
        (
            str(region_id),
            str(name),
            int(level),
            json.dumps(geometry, ensure_ascii=False, separators=(",", ":")),
            bbox["min_lng"],
            bbox["max_lng"],
            bbox["min_lat"],
            bbox["max_lat"],
        ),
    )


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
