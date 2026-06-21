# Administrative Region Unlocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build administrative-region unlock attribution for imported footprints and an on-demand map overlay for region unlock coverage.

**Architecture:** Add a backend `admin_regions` package for geometry, boundary storage, chain lookup, and cached unlock stats; refactor the footprint importer so every new point is assigned to the finest known region and updates current cumulative region fields incrementally. Add a frontend region data source and AMap polygon overlay layer that is created only when the user enables the map page's "区域" mode.

**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest, React 19, TypeScript 6, Vite 8, Vitest, AMap JS API 2.0.

---

## File Structure

- Create `apps/api/src/enroute_api/admin_regions/__init__.py` for package exports.
- Create `apps/api/src/enroute_api/admin_regions/geometry.py` for GeoJSON bbox and point-in-polygon behavior.
- Create `apps/api/src/enroute_api/admin_regions/store.py` for region schema, fixture/boundary import, chain lookup, and level query formatting.
- Create `apps/api/tests/test_admin_regions_geometry.py` for Polygon, MultiPolygon, and hole coverage.
- Create `apps/api/tests/test_admin_regions_import.py` for schema, chain lookup, region stats, duplicate handling, and API contract.
- Modify `apps/api/src/enroute_api/footprints/csv_loader.py` so parsed points expose only retained fields.
- Modify `apps/api/src/enroute_api/footprints/store.py` so schema/import support `region_id`, incremental inserts, region stat updates, and the existing snapshot route.
- Modify `apps/api/src/enroute_api/main.py` to expose `GET /api/admin-regions?level=N`.
- Modify `apps/api/tests/test_footprints_api.py` to align with the new footprint field contract.
- Modify `scripts/import_footprints.py` to report incremental import results and keep the large import verification path.
- Create `apps/web/src/layers/adminRegionTypes.ts` for shared frontend response/overlay types.
- Create `apps/web/src/layers/adminRegionDataSource.ts` and `apps/web/src/layers/adminRegionDataSource.test.ts` for API loading and response validation.
- Create `apps/web/src/layers/adminRegionLayer.ts` and `apps/web/src/layers/adminRegionLayer.test.ts` for AMap Polygon overlay creation, hole preservation, stale clearing, and destruction.
- Modify `apps/web/src/App.tsx` and `apps/web/src/components/mapShellLayout.test.tsx` so the right-side "区域" secondary tab enables the unlock overlay.
- Modify `apps/web/src/components/AmapCanvas.tsx` and `apps/web/src/components/AmapCanvas.footprints.test.tsx` for lazy overlay orchestration and level selection.
- Modify `apps/web/src/App.css` and `apps/web/src/components/mapLayout.test.ts` for compact, non-obscuring overlay controls.
- Update `README.md`, `.env.example`, or `docs/` only where current startup/import facts change.

## Task 1: Geometry Kernel

**Files:**
- Create: `apps/api/src/enroute_api/admin_regions/__init__.py`
- Create: `apps/api/src/enroute_api/admin_regions/geometry.py`
- Test: `apps/api/tests/test_admin_regions_geometry.py`

- [ ] **Step 1: Write failing geometry tests**

Create `apps/api/tests/test_admin_regions_geometry.py`:

```python
from enroute_api.admin_regions.geometry import (
    calculate_geometry_bbox,
    geometry_contains_point,
)


DONUT = {
    "type": "Polygon",
    "coordinates": [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
    ],
}

MULTIPOLYGON = {
    "type": "MultiPolygon",
    "coordinates": [
        [
            [[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]],
        ],
        [
            [[30, 30], [32, 30], [32, 32], [30, 32], [30, 30]],
        ],
    ],
}


def test_polygon_contains_exterior_but_excludes_hole():
    assert geometry_contains_point(DONUT, longitude=2, latitude=2)
    assert not geometry_contains_point(DONUT, longitude=5, latitude=5)
    assert not geometry_contains_point(DONUT, longitude=12, latitude=5)


def test_multipolygon_contains_any_member_polygon():
    assert geometry_contains_point(MULTIPOLYGON, longitude=21, latitude=21)
    assert geometry_contains_point(MULTIPOLYGON, longitude=31, latitude=31)
    assert not geometry_contains_point(MULTIPOLYGON, longitude=25, latitude=25)


def test_bbox_includes_all_polygon_and_multipolygon_rings():
    assert calculate_geometry_bbox(DONUT) == {
        "min_lng": 0,
        "max_lng": 10,
        "min_lat": 0,
        "max_lat": 10,
    }
    assert calculate_geometry_bbox(MULTIPOLYGON) == {
        "min_lng": 20,
        "max_lng": 32,
        "min_lat": 20,
        "max_lat": 32,
    }
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_geometry.py -q
```

Expected: fail with `ModuleNotFoundError: No module named 'enroute_api.admin_regions'`.

- [ ] **Step 3: Implement geometry helpers**

Create `apps/api/src/enroute_api/admin_regions/__init__.py`:

```python
"""Administrative region storage and geometry helpers."""
```

Create `apps/api/src/enroute_api/admin_regions/geometry.py`:

```python
from __future__ import annotations

from typing import Any, Iterable, TypedDict


class BoundingBox(TypedDict):
    min_lng: float
    max_lng: float
    min_lat: float
    max_lat: float


LngLat = list[float]
LinearRing = list[LngLat]
PolygonCoordinates = list[LinearRing]
MultiPolygonCoordinates = list[PolygonCoordinates]


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
    polygon: PolygonCoordinates,
    *,
    longitude: float,
    latitude: float,
) -> bool:
    if not polygon:
        return False

    exterior, *holes = polygon
    if not ring_contains_point(exterior, longitude=longitude, latitude=latitude):
        return False

    return not any(
        ring_contains_point(hole, longitude=longitude, latitude=latitude)
        for hole in holes
    )


def ring_contains_point(ring: LinearRing, *, longitude: float, latitude: float) -> bool:
    inside = False
    if len(ring) < 4:
        return False

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


def calculate_geometry_bbox(geometry: dict[str, Any]) -> BoundingBox:
    coordinates = list(iter_geometry_positions(geometry))
    if not coordinates:
        raise ValueError("Geometry contains no coordinates")

    longitudes = [point[0] for point in coordinates]
    latitudes = [point[1] for point in coordinates]

    return {
        "min_lng": min(longitudes),
        "max_lng": max(longitudes),
        "min_lat": min(latitudes),
        "max_lat": max(latitudes),
    }


def iter_geometry_positions(geometry: dict[str, Any]) -> Iterable[LngLat]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Polygon" and isinstance(coordinates, list):
        yield from iter_polygon_positions(coordinates)
    elif geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        for polygon in coordinates:
            yield from iter_polygon_positions(polygon)


def iter_polygon_positions(polygon: PolygonCoordinates) -> Iterable[LngLat]:
    for ring in polygon:
        for position in ring:
            if len(position) >= 2:
                yield [float(position[0]), float(position[1])]
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_geometry.py -q
```

Expected: `3 passed`.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/admin_regions apps/api/tests/test_admin_regions_geometry.py
git commit -m "feat: 增加行政区划几何判断"
```

## Task 2: Region Store And Schema

**Files:**
- Create: `apps/api/src/enroute_api/admin_regions/store.py`
- Test: `apps/api/tests/test_admin_regions_import.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`

- [ ] **Step 1: Write failing schema and region query tests**

Create the first half of `apps/api/tests/test_admin_regions_import.py`:

```python
import json
import sqlite3
from pathlib import Path

from enroute_api.admin_regions.store import (
    format_admin_region,
    get_region_chain,
    initialize_admin_region_schema,
    load_admin_regions,
    query_admin_regions_by_level,
)
from enroute_api.footprints.store import initialize_schema


REGION_COLLECTION = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"id": "cn", "name": "中国", "level": 1},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "sh", "name": "上海市", "level": 2, "parentId": "cn"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [80, 0], [80, 80], [0, 80], [0, 0]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "pudong", "name": "浦东新区", "level": 4, "parentId": "sh"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [60, 0], [60, 60], [0, 60], [0, 0]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"id": "sanlin", "name": "三林镇", "level": 5, "parentId": "pudong"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]],
            },
        },
    ],
}


def test_initializes_admin_region_tables_and_new_footprint_contract(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        footprint_columns = column_names(connection, "footprints")
        region_columns = column_names(connection, "admin_regions")
        tree_columns = column_names(connection, "admin_region_tree")
    finally:
        connection.close()

    assert footprint_columns == [
        "timestamp_seconds",
        "longitude",
        "latitude",
        "accuracy",
        "speed",
        "distance",
        "heading",
        "altitude",
        "region_id",
    ]
    assert "loc_type" not in footprint_columns
    assert region_columns == [
        "id",
        "name",
        "level",
        "geometry",
        "min_lng",
        "max_lng",
        "min_lat",
        "max_lat",
        "first_seen_timestamp",
        "footprint_count",
        "stay_duration_seconds",
        "travel_distance_meters",
    ]
    assert tree_columns == ["parent_id", "child_id"]


def test_loads_regions_and_walks_chain(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        chain = get_region_chain(connection, "sanlin")
        regions = query_admin_regions_by_level(connection, 5)
    finally:
        connection.close()

    assert chain == ["sanlin", "pudong", "sh", "cn"]
    assert [format_admin_region(row)["id"] for row in regions] == ["sanlin"]
    assert format_admin_region(regions[0]) == {
        "id": "sanlin",
        "name": "三林镇",
        "level": 5,
        "geometry": REGION_COLLECTION["features"][3]["geometry"],
        "firstSeenTimestamp": None,
        "footprintCount": 0,
        "stayDurationSeconds": 0,
        "travelDistanceMeters": 0,
    }


def column_names(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info({table_name})")]
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_import.py::test_initializes_admin_region_tables_and_new_footprint_contract apps/api/tests/test_admin_regions_import.py::test_loads_regions_and_walks_chain -q
```

Expected: fail because `admin_regions.store` does not exist or schema still has legacy footprint columns.

- [ ] **Step 3: Implement region store and schema initialization**

Create `apps/api/src/enroute_api/admin_regions/store.py` with:

```python
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
        """
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
        )
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
```

Modify `apps/api/src/enroute_api/footprints/store.py` so `initialize_schema()` calls `initialize_admin_region_schema(connection)` and creates the new `footprints` table. The schema script should create:

```sql
CREATE TABLE IF NOT EXISTS footprints (
  timestamp_seconds INTEGER PRIMARY KEY,
  longitude REAL NOT NULL,
  latitude REAL NOT NULL,
  accuracy REAL NOT NULL,
  speed REAL NOT NULL,
  distance REAL NOT NULL,
  heading REAL NOT NULL,
  altitude REAL NOT NULL,
  region_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_footprints_lng_lat_time
  ON footprints(longitude, latitude, timestamp_seconds);
CREATE VIRTUAL TABLE IF NOT EXISTS footprint_spatial USING rtree(
  timestamp_seconds,
  min_lng,
  max_lng,
  min_lat,
  max_lat
);
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_import.py::test_initializes_admin_region_tables_and_new_footprint_contract apps/api/tests/test_admin_regions_import.py::test_loads_regions_and_walks_chain -q
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/admin_regions/store.py apps/api/src/enroute_api/footprints/store.py apps/api/tests/test_admin_regions_import.py
git commit -m "feat: 建立行政区划存储模型"
```

## Task 3: Incremental Footprint Region Attribution

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/csv_loader.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Modify: `apps/api/tests/test_footprints_api.py`
- Modify: `apps/api/tests/test_admin_regions_import.py`

- [ ] **Step 1: Add failing importer tests**

Append to `apps/api/tests/test_admin_regions_import.py`:

```python
from enroute_api.footprints.store import ensure_imported


CSV = "\n".join(
    [
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
        "100,1,10,10,0,5,-1,0,1,0,3",
        "130,1,12,12,0,5,-1,40,1,0,3",
        "160,1,45,45,0,5,-1,60,1,0,3",
    ],
)


def test_incremental_import_assigns_finest_region_and_updates_cached_stats(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")

        footprints = connection.execute(
            "SELECT timestamp_seconds, region_id FROM footprints ORDER BY timestamp_seconds"
        ).fetchall()
        stats = {
            row["id"]: dict(row)
            for row in connection.execute(
                """
                SELECT id, footprint_count, first_seen_timestamp, stay_duration_seconds, travel_distance_meters
                FROM admin_regions
                ORDER BY id
                """
            )
        }
    finally:
        connection.close()

    assert [(row["timestamp_seconds"], row["region_id"]) for row in footprints] == [
        (100, "sanlin"),
        (130, "sanlin"),
        (160, "pudong"),
    ]
    assert stats["sanlin"]["footprint_count"] == 2
    assert stats["sanlin"]["first_seen_timestamp"] == 100
    assert stats["sanlin"]["stay_duration_seconds"] == 30
    assert stats["sanlin"]["travel_distance_meters"] == 40
    assert stats["pudong"]["footprint_count"] == 3
    assert stats["pudong"]["stay_duration_seconds"] == 60
    assert stats["pudong"]["travel_distance_meters"] == 100
    assert stats["sh"]["footprint_count"] == 3
    assert stats["cn"]["footprint_count"] == 3


def test_reimporting_same_csv_does_not_double_count_region_stats(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)

        ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        before = connection.execute(
            "SELECT footprint_count, stay_duration_seconds, travel_distance_meters FROM admin_regions WHERE id = 'pudong'"
        ).fetchone()
        ensure_imported(connection, data_path=data_path, coordinate_system="gcj02")
        after = connection.execute(
            "SELECT footprint_count, stay_duration_seconds, travel_distance_meters FROM admin_regions WHERE id = 'pudong'"
        ).fetchone()
    finally:
        connection.close()

    assert dict(after) == dict(before)
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_import.py::test_incremental_import_assigns_finest_region_and_updates_cached_stats apps/api/tests/test_admin_regions_import.py::test_reimporting_same_csv_does_not_double_count_region_stats -q
```

Expected: fail because `ensure_imported()` still rebuilds legacy rows and does not update admin region stats.

- [ ] **Step 3: Update CSV parsing contract**

Modify `apps/api/src/enroute_api/footprints/csv_loader.py`:

- Keep `REQUIRED_COLUMNS` permissive for current CSV compatibility.
- Continue validating all input columns needed to parse the current export.
- Return only:

```python
{
    "timestampSeconds": truncated_timestamp,
    "longitude": transformed_longitude,
    "latitude": transformed_latitude,
    "accuracy": numeric_fields["accuracy"],
    "speed": numeric_fields["speed"],
    "distance": numeric_fields["distance"],
    "heading": numeric_fields["heading"],
    "altitude": numeric_fields["altitude"],
}
```

Update existing API tests so expected payloads no longer include `id`, `locType`, `isBackForeground`, or `stepType`.

- [ ] **Step 4: Implement incremental import and stats update**

Modify `apps/api/src/enroute_api/footprints/store.py`:

- Replace delete-and-reinsert import with streaming inserts.
- Use `INSERT OR IGNORE` for identical already-imported timestamps.
- Insert into `footprint_spatial` with `timestamp_seconds` as `footprint_rowid`.
- Use `find_finest_region_id()`, `get_region_chain()`, and `get_region_levels()`.
- Add helper functions:

```python
def insert_footprint_if_new(connection: sqlite3.Connection, point: dict[str, Any]) -> bool:
    region_id = find_finest_region_id(
        connection,
        longitude=float(point["longitude"]),
        latitude=float(point["latitude"]),
    )
    cursor = connection.execute(
        """
        INSERT OR IGNORE INTO footprints (
          timestamp_seconds,
          longitude,
          latitude,
          accuracy,
          speed,
          distance,
          heading,
          altitude,
          region_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(point["timestampSeconds"]),
            float(point["longitude"]),
            float(point["latitude"]),
            float(point["accuracy"]),
            float(point["speed"]),
            float(point["distance"]),
            float(point["heading"]),
            float(point["altitude"]),
            region_id,
        ),
    )
    if cursor.rowcount == 0:
        validate_existing_footprint_matches(connection, point, region_id)
        return False

    connection.execute(
        """
        INSERT INTO footprint_spatial (footprint_rowid, min_lng, max_lng, min_lat, max_lat)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            int(point["timestampSeconds"]),
            float(point["longitude"]),
            float(point["longitude"]),
            float(point["latitude"]),
            float(point["latitude"]),
        ),
    )
    update_region_unlock_stats(connection, point, region_id)
    return True
```

Add `validate_existing_footprint_matches()` so a duplicate timestamp with different normalized fields raises `ValueError`.

Add `update_region_unlock_stats()`:

```python
def update_region_unlock_stats(
    connection: sqlite3.Connection,
    point: dict[str, Any],
    region_id: str | None,
) -> None:
    current_chain = get_region_chain(connection, region_id)
    timestamp_seconds = int(point["timestampSeconds"])
    for chain_region_id in current_chain:
        connection.execute(
            """
            UPDATE admin_regions
            SET footprint_count = footprint_count + 1,
                first_seen_timestamp = CASE
                  WHEN first_seen_timestamp IS NULL OR first_seen_timestamp > ?
                  THEN ?
                  ELSE first_seen_timestamp
                END
            WHERE id = ?
            """,
            (timestamp_seconds, timestamp_seconds, chain_region_id),
        )

    previous = connection.execute(
        """
        SELECT timestamp_seconds, region_id
        FROM footprints
        WHERE timestamp_seconds < ?
        ORDER BY timestamp_seconds DESC
        LIMIT 1
        """,
        (timestamp_seconds,),
    ).fetchone()
    if previous is None:
        return

    current_by_level = get_region_levels(connection, current_chain)
    previous_by_level = get_region_levels(
        connection,
        get_region_chain(connection, previous["region_id"]),
    )
    delta_seconds = timestamp_seconds - int(previous["timestamp_seconds"])
    distance = float(point["distance"])

    for level, current_region_id in current_by_level.items():
        if previous_by_level.get(level) != current_region_id:
            continue
        connection.execute(
            """
            UPDATE admin_regions
            SET stay_duration_seconds = stay_duration_seconds + ?,
                travel_distance_meters = travel_distance_meters + ?
            WHERE id = ?
            """,
            (delta_seconds, distance, current_region_id),
        )
```

- [ ] **Step 5: Verify importer tests**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_import.py apps/api/tests/test_footprints_api.py -q
```

Expected: all tests in both files pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/enroute_api/footprints apps/api/tests/test_admin_regions_import.py apps/api/tests/test_footprints_api.py
git commit -m "feat: 增量导入足迹行政区划"
```

## Task 4: Admin Region API

**Files:**
- Modify: `apps/api/src/enroute_api/main.py`
- Modify: `apps/api/tests/test_admin_regions_import.py`

- [ ] **Step 1: Write failing API test**

Append:

```python
from fastapi.testclient import TestClient

from enroute_api.config import Settings
from enroute_api.main import create_app


def test_serves_admin_regions_by_level_from_cached_region_rows(tmp_path: Path):
    data_path = tmp_path / "points.csv"
    data_path.write_text(CSV, encoding="utf-8")
    db_path = tmp_path / "footprints.sqlite"
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
    )
    client = TestClient(create_app(settings=settings))

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_admin_region_schema(connection)
        load_admin_regions(connection, REGION_COLLECTION)
    finally:
        connection.close()

    client.get("/api/footprints")
    response = client.get("/api/admin-regions?level=5")

    assert response.status_code == 200
    assert response.json()["regions"][0] | {"geometry": {}} == {
        "id": "sanlin",
        "name": "三林镇",
        "level": 5,
        "geometry": {},
        "firstSeenTimestamp": 100,
        "footprintCount": 2,
        "stayDurationSeconds": 30,
        "travelDistanceMeters": 40,
    }
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_import.py::test_serves_admin_regions_by_level_from_cached_region_rows -q
```

Expected: `404 Not Found`.

- [ ] **Step 3: Implement endpoint**

Modify `apps/api/src/enroute_api/main.py`:

```python
from .admin_regions.store import format_admin_region, query_admin_regions_by_level
```

Inside `create_app()` add:

```python
    @app.get("/api/admin-regions")
    def get_admin_regions(level: int) -> dict[str, object]:
        if level < 1 or level > 5:
            raise HTTPException(status_code=400, detail="level must be between 1 and 5")
        store.ensure_ready()
        return {
            "regions": [
                format_admin_region(row)
                for row in query_admin_regions_by_level(store.connection, level)
            ],
        }
```

Add `FootprintStore.ensure_ready()` as a small public method that calls `ensure_imported()` without querying a snapshot.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_import.py::test_serves_admin_regions_by_level_from_cached_region_rows -q
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/main.py apps/api/src/enroute_api/footprints/store.py apps/api/tests/test_admin_regions_import.py
git commit -m "feat: 提供行政区划解锁接口"
```

## Task 5: Frontend Region Data Source

**Files:**
- Create: `apps/web/src/layers/adminRegionTypes.ts`
- Create: `apps/web/src/layers/adminRegionDataSource.ts`
- Test: `apps/web/src/layers/adminRegionDataSource.test.ts`

- [ ] **Step 1: Write failing data-source tests**

Create `apps/web/src/layers/adminRegionDataSource.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { loadAdminRegions } from './adminRegionDataSource'

describe('admin region data source', () => {
  it('loads selected administrative region level from the local API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        regions: [
          {
            id: 'sanlin',
            name: '三林镇',
            level: 5,
            geometry: {
              type: 'Polygon',
              coordinates: [[[[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]]]],
            },
            firstSeenTimestamp: 100,
            footprintCount: 2,
            stayDurationSeconds: 30,
            travelDistanceMeters: 40,
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(loadAdminRegions('/api/admin-regions', 5, controller.signal)).resolves.toEqual([
      {
        id: 'sanlin',
        name: '三林镇',
        level: 5,
        geometry: {
          type: 'Polygon',
          coordinates: [[[[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]]]],
        },
        firstSeenTimestamp: 100,
        footprintCount: 2,
        stayDurationSeconds: 30,
        travelDistanceMeters: 40,
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/admin-regions?level=5', {
      method: 'GET',
      signal: controller.signal,
    })
  })

  it('rejects malformed administrative region payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ regions: [{ id: 'broken' }] }),
    }))

    await expect(loadAdminRegions('/api/admin-regions', 4, new AbortController().signal))
      .rejects.toThrow('Invalid admin regions API response')
  })
})
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/adminRegionDataSource.test.ts
```

Expected: fail because `adminRegionDataSource.ts` does not exist.

- [ ] **Step 3: Implement data-source modules**

Create `apps/web/src/layers/adminRegionTypes.ts`:

```typescript
export type AdminRegionLevel = 1 | 2 | 3 | 4 | 5

export type AdminRegionGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

export type AdminRegion = {
  id: string
  name: string
  level: AdminRegionLevel
  geometry: AdminRegionGeometry
  firstSeenTimestamp: number | null
  footprintCount: number
  stayDurationSeconds: number
  travelDistanceMeters: number
}
```

Create `apps/web/src/layers/adminRegionDataSource.ts`:

```typescript
import type { AdminRegion, AdminRegionGeometry, AdminRegionLevel } from './adminRegionTypes'

const DEFAULT_ADMIN_REGION_API_URL = '/api/admin-regions'

export async function loadAdminRegions(
  apiUrl: string | undefined,
  level: AdminRegionLevel,
  signal: AbortSignal,
): Promise<AdminRegion[]> {
  const baseUrl = apiUrl?.trim() || DEFAULT_ADMIN_REGION_API_URL
  const response = await fetch(`${baseUrl}?level=${level}`, {
    method: 'GET',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load admin regions API: ${response.status}`)
  }

  const payload = await response.json()
  if (!isAdminRegionResponse(payload)) {
    throw new Error('Invalid admin regions API response')
  }

  return payload.regions
}

function isAdminRegionResponse(payload: unknown): payload is { regions: AdminRegion[] } {
  if (typeof payload !== 'object' || payload === null) return false
  const candidate = payload as { regions?: unknown }
  return Array.isArray(candidate.regions) && candidate.regions.every(isAdminRegion)
}

function isAdminRegion(value: unknown): value is AdminRegion {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AdminRegion>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isAdminRegionLevel(candidate.level) &&
    isAdminRegionGeometry(candidate.geometry) &&
    (candidate.firstSeenTimestamp === null || isFiniteNumber(candidate.firstSeenTimestamp)) &&
    isFiniteNumber(candidate.footprintCount) &&
    isFiniteNumber(candidate.stayDurationSeconds) &&
    isFiniteNumber(candidate.travelDistanceMeters)
  )
}

function isAdminRegionLevel(value: unknown): value is AdminRegionLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5
}

function isAdminRegionGeometry(value: unknown): value is AdminRegionGeometry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AdminRegionGeometry>
  return (
    (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') &&
    Array.isArray(candidate.coordinates)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/adminRegionDataSource.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/layers/adminRegionTypes.ts apps/web/src/layers/adminRegionDataSource.ts apps/web/src/layers/adminRegionDataSource.test.ts
git commit -m "feat: 增加行政区划前端数据源"
```

## Task 6: Frontend Region Overlay Layer

**Files:**
- Create: `apps/web/src/layers/adminRegionLayer.ts`
- Test: `apps/web/src/layers/adminRegionLayer.test.ts`

- [ ] **Step 1: Write failing overlay tests**

Create `apps/web/src/layers/adminRegionLayer.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { createAdminRegionLayer } from './adminRegionLayer'
import type { AdminRegion } from './adminRegionTypes'

function createRuntime() {
  const setMap = vi.fn()
  const Polygon = vi.fn(function (this: { setMap: typeof setMap }, options: unknown) {
    Object.assign(this, { options, setMap })
  })
  return { Polygon, setMap }
}

const regions: AdminRegion[] = [
  {
    id: 'donut',
    name: 'Donut',
    level: 5,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
      ],
    },
    firstSeenTimestamp: 100,
    footprintCount: 1,
    stayDurationSeconds: 0,
    travelDistanceMeters: 0,
  },
  {
    id: 'multi',
    name: 'Multi',
    level: 5,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
        [[[30, 30], [32, 30], [32, 32], [30, 32], [30, 30]]],
      ],
    },
    firstSeenTimestamp: null,
    footprintCount: 0,
    stayDurationSeconds: 0,
    travelDistanceMeters: 0,
  },
]

describe('admin region AMap layer', () => {
  it('preserves polygon holes and multipolygon parts when creating overlays', () => {
    const runtime = createRuntime()
    const map = {} as AMap.Map
    const layer = createAdminRegionLayer(runtime as unknown as Pick<typeof AMap, 'Polygon'>, map)

    layer.update(regions)

    expect(runtime.Polygon).toHaveBeenCalledTimes(3)
    expect(runtime.Polygon.mock.calls[0]?.[0]).toMatchObject({
      path: regions[0].geometry.coordinates,
      strokeColor: '#123f35',
    })
    expect(runtime.Polygon.mock.calls[1]?.[0]).toMatchObject({
      path: regions[1].geometry.coordinates[0],
      strokeColor: 'rgba(23, 35, 31, 0.24)',
    })
  })

  it('clears old polygons on update and destroy', () => {
    const runtime = createRuntime()
    const map = {} as AMap.Map
    const layer = createAdminRegionLayer(runtime as unknown as Pick<typeof AMap, 'Polygon'>, map)

    layer.update([regions[0]])
    layer.update([])
    layer.destroy()

    expect(runtime.setMap).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/adminRegionLayer.test.ts
```

Expected: fail because `adminRegionLayer.ts` does not exist.

- [ ] **Step 3: Implement overlay layer**

Create `apps/web/src/layers/adminRegionLayer.ts`:

```typescript
import type { AdminRegion } from './adminRegionTypes'

type AdminRegionLayerRuntime = Pick<typeof AMap, 'Polygon'>
type RegionPolygon = Pick<AMap.Polygon, 'setMap'>

const UNLOCKED_STROKE = '#123f35'
const UNLOCKED_FILL = 'rgba(18, 63, 53, 0.18)'
const LOCKED_STROKE = 'rgba(23, 35, 31, 0.24)'
const LOCKED_FILL = 'rgba(23, 35, 31, 0.045)'

export function createAdminRegionLayer(
  AMapRuntime: AdminRegionLayerRuntime,
  map: AMap.Map,
) {
  let polygons: RegionPolygon[] = []
  let destroyed = false

  function clear() {
    for (const polygon of polygons) {
      polygon.setMap(null)
    }
    polygons = []
  }

  return {
    update(regions: AdminRegion[]) {
      if (destroyed) return
      clear()
      polygons = regions.flatMap((region) =>
        createRegionPolygons(AMapRuntime, map, region),
      )
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clear()
    },
  }
}

function createRegionPolygons(
  AMapRuntime: AdminRegionLayerRuntime,
  map: AMap.Map,
  region: AdminRegion,
) {
  const paths = region.geometry.type === 'Polygon'
    ? [region.geometry.coordinates]
    : region.geometry.coordinates
  const unlocked = region.footprintCount > 0

  return paths.map((path) => {
    const polygon = new AMapRuntime.Polygon({
      path,
      strokeColor: unlocked ? UNLOCKED_STROKE : LOCKED_STROKE,
      strokeOpacity: unlocked ? 0.9 : 0.42,
      strokeWeight: unlocked ? 1.4 : 0.8,
      fillColor: unlocked ? UNLOCKED_FILL : LOCKED_FILL,
      fillOpacity: 1,
      bubble: true,
      cursor: 'default',
      zIndex: unlocked ? 18 : 16,
    })
    polygon.setMap(map)
    return polygon
  })
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/adminRegionLayer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/layers/adminRegionLayer.ts apps/web/src/layers/adminRegionLayer.test.ts
git commit -m "feat: 增加行政区划地图叠加层"
```

## Task 7: Region Tab And Canvas Wiring

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AmapCanvas.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`
- Modify: `apps/web/src/components/AmapCanvas.footprints.test.tsx`

- [ ] **Step 1: Write failing control tests**

Extend `apps/web/src/components/mapShellLayout.test.tsx` with:

```typescript
it('opens administrative region unlock controls without fetching by default', async () => {
  render(<App amapConfig={configuredAmap} />)

  expect(screen.queryByRole('group', { name: '行政区划层级' })).toBeNull()
  await userEvent.click(within(screen.getByRole('navigation', { name: '二级导航' })).getByRole('button', { name: '区域' }))
  expect(screen.getByRole('group', { name: '行政区划层级' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '街道/乡镇' })).toHaveAttribute('aria-pressed', 'true')
})
```

Extend `apps/web/src/components/AmapCanvas.footprints.test.tsx` with a test that mocks `loadAdminRegions` and asserts it is not called until `adminRegionUnlockEnabled` becomes true. Reuse the file's existing AMap mocks and rerender the canvas with the region mode enabled.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/mapShellLayout.test.tsx src/components/AmapCanvas.footprints.test.tsx
```

Expected: fail because `App` does not pass the secondary "区域" selection into `AmapCanvas` and `AmapCanvas` does not load region overlays.

- [ ] **Step 3: Implement controls**

Modify `App.tsx` and `AmapCanvas.tsx`:

- Pass `adminRegionUnlockEnabled={activeSecondaryNavId === 'regions'}` from `App`.
- Keep `MapControls.tsx` focused on existing map actions and footprint display settings.
- When enabled, render a compact `role="group"` level selector with buttons for levels 1-5 as a separate map overlay.

- [ ] **Step 4: Implement canvas orchestration**

Modify `AmapCanvas.tsx`:

- Add state:

```typescript
const [adminRegionLevel, setAdminRegionLevel] = useState<AdminRegionLevel>(5)
```

- Add refs for `adminRegionLayerRef`, `adminRegionAbortControllerRef`, and `adminRegionRequestIdRef`.
- Create layer with `createAdminRegionLayer(amapRef.current, mapRef.current)` only when status is ready and the region tab is active.
- Call `loadAdminRegions(import.meta.env.VITE_ADMIN_REGION_API_URL, adminRegionLevel, signal)` only when the region tab is active.
- Abort previous requests and ignore stale request ids.
- Clear/destroy the layer when mode closes, level changes, map unmounts, or component unmounts.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/mapShellLayout.test.tsx src/components/AmapCanvas.footprints.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/App.tsx apps/web/src/components/AmapCanvas.tsx apps/web/src/components/mapShellLayout.test.tsx apps/web/src/components/AmapCanvas.footprints.test.tsx
git commit -m "feat: 接入行政区划解锁控件"
```

## Task 8: Overlay Styling And Layout Contract

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: Write failing CSS contract tests**

Append to `apps/web/src/components/mapLayout.test.ts`:

```typescript
it('places administrative region unlock level controls as a separate map overlay above the toolbar', () => {
  const panelRule = cssRule('.admin-region-unlock-panel')
  const levelRule = cssRule('.admin-region-unlock-levels')

  expect(panelRule).toContain('position: absolute')
  expect(panelRule).toContain('bottom: calc(var(--map-chrome-y) + 66px)')
  expect(panelRule).toContain('right: var(--map-chrome-x)')
  expect(levelRule).toContain('display: grid')
  expect(levelRule).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))')
})
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/mapLayout.test.ts
```

Expected: fail because CSS classes are missing.

- [ ] **Step 3: Implement compact styling**

Add CSS near existing `.footprint-style-popover` rules:

```css
.admin-region-unlock-panel {
  position: absolute;
  right: var(--map-chrome-x);
  bottom: calc(var(--map-chrome-y) + 66px);
  width: 258px;
  max-width: calc(100vw - 28px);
  padding: 10px;
  border: 1px solid rgba(23, 31, 29, 0.08);
  border-radius: 10px;
  color: #17211f;
  background: rgba(250, 252, 251, 0.74);
  box-shadow:
    0 14px 40px rgba(31, 46, 42, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(18px) saturate(1.1);
}

.admin-region-unlock-levels {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}

.admin-region-unlock-levels button {
  min-width: 0;
  height: 30px;
  padding: 0 5px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  color: rgba(23, 35, 31, 0.62);
  background: rgba(23, 35, 31, 0.06);
  font-size: 11px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-region-unlock-levels button[aria-pressed='true'] {
  color: #f8fbfa;
  background: #123f35;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/mapLayout.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/App.css apps/web/src/components/mapLayout.test.ts
git commit -m "feat: 优化行政区划解锁控件布局"
```

## Task 9: Scripts, Docs, And Large Import Verification

**Files:**
- Modify: `scripts/import_footprints.py`
- Modify: `README.md`
- Modify: `.env.example`
- Test: `tests/test_import_footprints.py`

- [ ] **Step 1: Update repo test expectations first**

Modify `tests/test_import_footprints.py` so the import command assertion expects the new import message:

```python
self.assertIn("Imported 2 new footprint rows", completed.stdout)
```

Run:

```powershell
python -m unittest tests/test_import_footprints.py -v
```

Expected: fail because the script still prints the old message.

- [ ] **Step 2: Update import script**

Modify `scripts/import_footprints.py` so it calls a public import result method and prints:

```text
Imported <new_count> new footprint rows from <source> into <database>; total rows: <total_count>
```

If no admin regions are loaded, the command still imports footprints with `region_id = NULL` and reports zero matched regions.

- [ ] **Step 3: Update docs and env example**

Add to `.env.example`:

```env
VITE_ADMIN_REGION_API_URL=/api/admin-regions
ADMIN_REGION_DATA_PATH=external/admin-regions.geojson
```

Update `README.md` to state:

- `npm run prepare:footprints` imports new rows incrementally.
- Footprints are stored with GCJ-02 coordinates and computed `region_id` when region boundaries exist.
- `GET /api/admin-regions?level=N` serves current unlock state from cached `admin_regions`.
- Boundary source files stay local unless licensing permits committing them.

- [ ] **Step 4: Verify tests and build**

Run:

```powershell
npm test -- --run --maxWorkers=1
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 5: Verify current 40,441-row import**

Use the real ignored CSV from the main checkout if it is not present in the feature worktree:

```powershell
python scripts/import_footprints.py --source D:\Coding\EnRoute\external\backUpData-all.csv --database data\admin-region-unlocks-verification.sqlite --coordinate-system wgs84
```

Then inspect:

```powershell
@'
import sqlite3
from pathlib import Path
db = Path("data/admin-region-unlocks-verification.sqlite")
connection = sqlite3.connect(db)
try:
    print("footprints", connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0])
    print("matched", connection.execute("SELECT COUNT(*) FROM footprints WHERE region_id IS NOT NULL").fetchone()[0])
    print("regions", connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0])
    print("unlocked", connection.execute("SELECT COUNT(*) FROM admin_regions WHERE footprint_count > 0").fetchone()[0])
finally:
    connection.close()
'@ | python -
```

Expected:
- `footprints 40441`
- `matched` is greater than zero when boundary data is loaded.
- `unlocked` is greater than zero when boundary data is loaded.

Run the same import command a second time and verify the counts do not increase.

- [ ] **Step 6: Browser verification**

Start the local app:

```powershell
python start.py start
```

Verify in browser:
- Map renders normally in 2D.
- Existing right-bottom toolbar buttons work.
- Region data is not fetched until the right-side "区域" secondary tab is opened.
- Level switcher requests only the selected level.
- Polygon holes are not filled as separate darker regions in the test/donut fixture or available real data.
- Console has no AMap runtime errors.

Stop services:

```powershell
python start.py stop
```

- [ ] **Step 7: Commit**

```powershell
git add scripts/import_footprints.py tests/test_import_footprints.py README.md .env.example
git commit -m "docs: 更新行政区划导入说明"
```

## Final Verification

Run from the feature worktree:

```powershell
npm test -- --run --maxWorkers=1
npm run lint
npm run build
git status --short --ignored
```

Expected:
- All tests pass.
- Lint passes.
- Build passes.
- Only ignored dependency/cache/data outputs remain untracked.

Do not push. After verification, use the repo's local merge/cleanup workflow only if the user asks to merge.
