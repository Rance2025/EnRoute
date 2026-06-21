from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable

from .geometry import calculate_geometry_bbox, geometry_contains_point


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
    features = feature_collection.get("features")
    if not isinstance(features, list):
        raise ValueError("Admin region GeoJSON must be a FeatureCollection")

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
    return list(
        connection.execute(
            """
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
            WHERE level = ?
            ORDER BY id
            """,
            (level,),
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
