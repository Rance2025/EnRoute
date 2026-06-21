# Administrative Region Unlocks Design

Date: 2026-06-21

## Goal
Implement an "行政区划解锁程度" capability for EnRoute that assigns every imported footprint to its finest known administrative region, keeps cumulative unlock statistics on region records, and displays region unlock coverage on the existing AMap page only when the user asks for that mode.

## Product Scope
- Treat the existing 40,441 footprint CSV rows as one large incremental import from an empty database, not as a one-off special import.
- Keep the same incremental import path for future daily batches of hundreds to thousands of new points.
- Keep the location page focused on imported external location data. Do not add in-app live recording.
- Do not add accounting or schedule architecture as part of this feature.
- Do not optimize historical time-window region statistics in this phase; current cumulative region state is precomputed and stored on `admin_regions`.

## Region Coverage Rules
- Level 1: country.
- Level 2: province or direct-admin municipality.
- Level 3: city.
- Level 4: district or county.
- Level 5: street, township, or town.
- International coverage starts at country-level boundaries only.
- China can be represented to level 5, but this phase only requires Shanghai level 5 boundaries. Other Chinese areas can stop at levels 2-4 according to the available boundary data.
- Boundary geometry and stored footprint coordinates must be GCJ-02 so overlays align with AMap.
- Public AMap/Baidu-style data can seed levels 1-4 where available. Shanghai level 5 should come from the verified offline OSM/Geofabrik-derived township/street dataset.

## Data Model
The SQLite database keeps three core domain tables and may keep auxiliary indexes or metadata tables needed for import integrity.

### `footprints`
`footprints` stores only fields supplied by the CSV that are useful now, plus the computed finest region.

Columns:
- `timestamp_seconds INTEGER PRIMARY KEY`
- `longitude REAL NOT NULL`
- `latitude REAL NOT NULL`
- `accuracy REAL NOT NULL`
- `speed REAL NOT NULL`
- `distance REAL NOT NULL`
- `heading REAL NOT NULL`
- `altitude REAL NOT NULL`
- `region_id TEXT`

Do not keep `locType`, `isBackForeground`, or `stepType`. The current sample has unique second-level timestamps. Future imports treat an existing `timestamp_seconds` as already imported only when the stored row is identical after coordinate normalization; if a new row has the same `timestamp_seconds` but different normalized data, the importer rejects that row and reports the conflict instead of silently overwriting history.

### `admin_regions`
`admin_regions` stores every administrative region that EnRoute knows about, not only leaf regions.

Columns:
- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `level INTEGER NOT NULL`
- `geometry TEXT NOT NULL`
- `min_lng REAL NOT NULL`
- `max_lng REAL NOT NULL`
- `min_lat REAL NOT NULL`
- `max_lat REAL NOT NULL`
- `first_seen_timestamp INTEGER`
- `footprint_count INTEGER NOT NULL DEFAULT 0`
- `stay_duration_seconds INTEGER NOT NULL DEFAULT 0`
- `travel_distance_meters REAL NOT NULL DEFAULT 0`

`geometry` is GeoJSON geometry JSON using GCJ-02 coordinates. It must accept `Polygon` and `MultiPolygon`. Polygon rings follow GeoJSON semantics: first ring is the exterior boundary and following rings are holes. A point inside a hole is not inside the polygon. This is required for donut and double-ring administrative shapes.

The bounding box columns are stored directly on each row for fast candidate filtering before exact point-in-polygon checks.

### `admin_region_tree`
`admin_region_tree` represents parent-child hierarchy.

Columns:
- `parent_id TEXT NOT NULL`
- `child_id TEXT NOT NULL`

The table expresses country -> province/municipality -> city -> district/county -> street/township/town. A region can have at most one parent in this phase. The full region chain for a footprint is derived from the assigned `region_id` by walking this tree upward.

## Import Flow
Importing a footprint batch uses the same logic whether the batch has 40,441 rows or a few hundred rows.

1. Read CSV rows as a stream.
2. Parse only `dataTime`, `longitude`, `latitude`, `accuracy`, `speed`, `distance`, `heading`, and `altitude`.
3. Convert raw source coordinates to GCJ-02 using the existing local coordinate conversion path when the source is WGS84.
4. For each point, query `admin_regions` by bbox:
   - `min_lng <= longitude <= max_lng`
   - `min_lat <= latitude <= max_lat`
5. Run exact point-in-polygon checks against candidate geometries.
6. Choose the matching region with the greatest `level` as the finest region. If no region matches, store `region_id = NULL` and still insert the footprint.
7. Insert the footprint with `timestamp_seconds` as primary key. Existing timestamps are treated as already imported and are not counted again.
8. For a newly inserted point with a `region_id`, walk the current point's full region chain.
9. Update every region in the current chain:
   - `footprint_count += 1`
   - `first_seen_timestamp = MIN(existing first_seen_timestamp, current timestamp)` with null treated as unseen.
10. Find the previous imported footprint by `timestamp_seconds < current timestamp`, ordered descending.
11. If the previous footprint has a region chain, compare current and previous chains independently by level.
12. For each level where the current and previous region id are the same, update that same region:
   - `stay_duration_seconds += current.timestamp_seconds - previous.timestamp_seconds`
   - `travel_distance_meters += current.distance`
13. For levels where the current and previous region id differ, do not add duration or distance for that level.
14. Do not apply a maximum time-gap threshold in this phase.

This means parent regions are not computed by summing child totals. Parent duration and distance are independently accumulated when consecutive points are in the same parent-level region.

## Migration Strategy
The current SQLite schema stores an `id` column, `loc_type`, `is_back_foreground`, `step_type`, and an RTree table keyed by SQLite rowid. The new schema changes the domain contract.

Migration should:
- Create the new tables if they do not exist.
- Detect incompatible existing `footprints` schemas.
- Rebuild `footprints` into the new primary-key shape from the source CSV when the schema is incompatible.
- Recreate the `footprint_spatial` viewport index so existing map snapshot queries continue to work.
- Preserve `footprint_meta` or replace it with equivalent import metadata if needed.
- Reset `admin_regions` cumulative fields before a full re-import, then re-run the same incremental importer against all source rows.

For a normal future daily import, the importer should not wipe existing points or region totals. It should insert only unseen timestamps and update region totals only for those newly inserted rows.

## Boundary Data Import
Boundary import is a separate step from footprint import.

Inputs:
- A committed or local GeoJSON file for administrative regions, depending on licensing and personal-data constraints.
- A relationship description that can derive `admin_region_tree`, either from GeoJSON properties or a small manifest.

Processing:
- Normalize all geometries to GCJ-02 before storing.
- Validate every feature has `id`, `name`, `level`, and either a parent id or a clear root-level exception.
- Store the exact GeoJSON geometry JSON in `admin_regions.geometry`.
- Calculate and store bbox columns from all exterior and hole coordinates.
- Insert parent-child relationships into `admin_region_tree`.
- Initialize cumulative fields to zero/null.

The implementation should include a small fixture GeoJSON for tests that covers country, city, district, two street-level siblings, a polygon with a hole, and a multipolygon. Real boundary files can remain ignored under `external/` or another local data path until licensing and packaging are decided.

## Backend API
Add an API for the frontend unlock overlay:

```text
GET /api/admin-regions?level=1
GET /api/admin-regions?level=2
GET /api/admin-regions?level=3
GET /api/admin-regions?level=4
GET /api/admin-regions?level=5
```

Response:

```json
{
  "regions": [
    {
      "id": "sh-pudong-sanlin",
      "name": "三林镇",
      "level": 5,
      "geometry": { "type": "Polygon", "coordinates": [] },
      "firstSeenTimestamp": 1768144456,
      "footprintCount": 12,
      "stayDurationSeconds": 3600,
      "travelDistanceMeters": 4200.5
    }
  ]
}
```

The endpoint reads current state directly from `admin_regions`. It must not scan `footprints` to answer a normal current unlock request.

## Frontend Behavior
The map keeps the current footprint view as default. "行政区划解锁程度" is an explicit map mode opened from the existing map controls or a compact overlay control.

When the mode is off:
- Do not request region geometry.
- Do not create region overlay polygons.
- Keep existing footprint rendering behavior.

When the mode is on:
- Show a level switcher: 国家, 省/直辖市, 市, 区县, 街道/乡镇.
- Request only the selected level from the backend.
- Render region boundaries and fills with AMap polygon overlays.
- Unlocked regions (`footprintCount > 0`) use a restrained accent stroke and a light accent fill.
- Locked regions use low-contrast stroke/fill so they provide context without competing with footprints.
- Geometry with holes must render holes as holes. The frontend adapter should pass nested polygon paths in the shape expected by AMap rather than flattening rings into independent filled polygons.
- Destroy or clear region overlays when the mode turns off, the level changes, the map unmounts, or the API request is superseded.

Visual thesis: a quiet inspection layer over the existing map, with unlocked regions appearing as precise translucent progress rather than a dashboard-like card surface.

Interaction thesis:
- Mode toggle creates and removes the overlay without changing the map camera.
- Level changes swap region overlays after the request resolves; stale responses are ignored.
- Region detail popovers are out of scope for this phase; the committed behavior is level selection plus visual unlocked/locked distinction.

## Testing Requirements
Backend tests:
- Schema initializes the new `footprints`, `admin_regions`, and `admin_region_tree` contract.
- CSV parsing drops `locType`, `isBackForeground`, and `stepType`.
- Coordinate conversion still applies before region matching.
- Bbox candidate filtering narrows candidate regions.
- Point-in-polygon returns true for a point in an exterior ring, false for a point in a hole, and true for either member of a multipolygon.
- Import writes `footprints.region_id` with the finest matching region.
- Import updates `footprint_count` and `first_seen_timestamp` for every region in the current chain.
- Import compares consecutive points by same-level region and updates duration/distance only on matching same-level regions.
- Re-running import with the same source does not double-count region stats.
- `GET /api/admin-regions?level=N` returns region geometry and cached cumulative fields from `admin_regions`.

Frontend tests:
- The unlock mode does not fetch regions before the user opens it.
- Opening the mode fetches the selected level.
- Changing level aborts or ignores stale region responses.
- AMap region overlays receive Polygon, MultiPolygon, and hole paths without flattening holes incorrectly.
- Turning the mode off clears overlays.
- The UI uses a compact level selector and does not obscure the existing map toolbar.

Verification:
- Run `npm test`.
- Run `npm run lint`.
- Run `npm run build`.
- Run an import against the existing 40,441-row CSV as one large incremental batch and verify:
  - 40,441 footprint rows exist.
  - Inserted rows have `region_id` where boundary coverage exists.
  - Region cumulative fields changed for matched regions.
  - A second import of the same CSV does not increase row counts or cumulative stats.
- Browser-verify the map still renders in 2D with existing controls, and the unlock overlay loads only when selected.

## Non-Goals
- No historical region statistics acceleration for arbitrary time windows.
- No remote writes or vendor-boundary fetch automation in normal app startup.
- No React DOM markers for region rendering.
- No maximum time-gap threshold.
- No new product pages outside the current map location page.
