# Administrative Region Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current open-ended administrative unlock prototype with a China-first AreaCity province/city/district path, country attribution on footprints, and viewport-aware region loading that avoids showing footprint points in region mode.

**Architecture:** Keep China administrative polygons as local GCJ-02 GeoJSON derived from AreaCity, normalize AreaCity properties into the existing `admin_regions` table, and assign `country_id = "CHN"` whenever the local China region match succeeds. Add a small country-classification module that first performs a conservative China bbox check and only marks non-domestic points as eligible for future AMap reverse geocoding. Region display requests are filtered by viewport bbox plus zoom and the frontend only exposes province/city/district levels.

**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest, React 19, TypeScript 6, Vite 8, Vitest, AMap JS API 2.0.

---

## File Structure

- Modify `apps/api/src/enroute_api/admin_regions/store.py` for AreaCity normalization and viewport-aware region querying.
- Create `apps/api/src/enroute_api/footprints/country.py` for China coarse classification and country attribution decisions.
- Modify `apps/api/src/enroute_api/footprints/store.py` for `country_id`, domestic-first attribution, and import compatibility signatures.
- Modify `apps/api/src/enroute_api/main.py` for `bbox` and `zoom` query parameters on `/api/admin-regions`.
- Modify `apps/api/tests/test_admin_regions_import.py` for AreaCity, country attribution, and API bbox coverage.
- Modify `apps/web/src/layers/adminRegionTypes.ts` and `apps/web/src/layers/adminRegionDataSource.ts` for viewport request inputs and levels `2 | 3 | 4`.
- Modify `apps/web/src/layers/adminRegionDataSource.test.ts`.
- Modify `apps/web/src/components/AmapCanvas.tsx` and `apps/web/src/components/AmapCanvas.footprints.test.tsx` for viewport-aware admin region refreshes on enable, moveend, zoomend, resize, and level changes.
- Modify `apps/web/src/components/mapShellLayout.test.tsx` and `apps/web/src/components/mapLayout.test.ts` to lock the province/city/district control contract.
- Modify `README.md` and `.env.example` only for current, runnable facts.

## Task 1: Backend Country Classification

**Files:**
- Create: `apps/api/src/enroute_api/footprints/country.py`
- Modify: `apps/api/tests/test_admin_regions_import.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`

- [ ] **Step 1: Write the failing tests**

Add tests for `classify_country_lookup(...)`, `country_id_for_region_match(...)`, schema column `country_id`, and matched China footprints storing `country_id = "CHN"`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_regions_import.py -q
```

Expected: fail because `footprints.country` and `footprints.country_id` do not exist.

- [ ] **Step 3: Implement the minimal backend country path**

Implement `country.py` with a conservative China bbox of longitude `73..136` and latitude `3..54`, returning `remote_lookup_allowed = False` when the point may be domestic. Add `country_id TEXT` to the `footprints` table after `region_id`; migrate incompatible old schemas by clearing imported footprints; insert `"CHN"` when `find_finest_region_id(...)` returns a region id, otherwise leave `NULL` for now.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_regions_import.py -q
```

Expected: pass.

## Task 2: AreaCity Normalization

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/store.py`
- Modify: `apps/api/tests/test_admin_regions_import.py`

- [ ] **Step 1: Write the failing AreaCity tests**

Add an AreaCity-derived GeoJSON fixture with `adcode`, `parent`, and string levels `province`, `city`, and `district`. Assert the importer stores levels `2`, `3`, and `4`, preserves the first GCJ-02 coordinate exactly, and links `310115 -> 310100 -> 310000`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_regions_import.py::test_normalizes_areacity_province_city_district_geojson_without_coordinate_transform -q
```

Expected: fail because string levels and AreaCity parent properties are not normalized.

- [ ] **Step 3: Implement AreaCity normalization**

In `normalize_admin_region_feature(...)`, detect `adcode` plus string `level` values `province`, `city`, and `district`, map them to EnRoute levels `2`, `3`, and `4`, set `id = str(adcode)`, set `parentId` from `parent`, `parentId`, `parent_id`, `pid`, or `parent_adcode`, and return geometry unchanged because AreaCity `ok_geo` uses GCJ-02.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_regions_import.py::test_normalizes_areacity_province_city_district_geojson_without_coordinate_transform -q
```

Expected: pass.

## Task 3: Viewport-Aware Region API

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/store.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Modify: `apps/api/tests/test_admin_regions_import.py`

- [ ] **Step 1: Write failing API tests**

Add tests that call `/api/admin-regions?level=4&west=121.3&south=31.0&east=121.9&north=31.5&zoom=10` and `/api/admin-regions?level=4&west=10&south=10&east=11&north=11&zoom=10`. Assert the first response includes the intersecting district and the second returns an empty `regions` array. Also assert `level=5` returns HTTP 400.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_regions_import.py::test_serves_admin_regions_intersecting_viewport_bbox apps/api/tests/test_admin_regions_import.py::test_rejects_unavailable_admin_region_levels -q
```

Expected: fail because the endpoint ignores bbox and still accepts level 5.

- [ ] **Step 3: Implement bbox query**

Add `query_admin_regions(...)` that accepts `level`, optional bbox fields, and `zoom`. It should filter by bbox intersection when all bbox values are present, support antimeridian viewports with `west > east`, keep returning full level rows when bbox is omitted for compatibility, and ignore `zoom` until geometry simplification is added. In `main.py`, accept `west`, `south`, `east`, `north`, and `zoom`, validate `level in {2,3,4}`, then call the new query.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_regions_import.py -q
```

Expected: pass.

## Task 4: Frontend Viewport Request Contract

**Files:**
- Modify: `apps/web/src/layers/adminRegionTypes.ts`
- Modify: `apps/web/src/layers/adminRegionDataSource.ts`
- Modify: `apps/web/src/layers/adminRegionDataSource.test.ts`

- [ ] **Step 1: Write failing frontend data-source tests**

Update the data-source test to call `loadAdminRegions('/api/admin-regions', { level: 4, zoom: 10, viewportBounds: { west: 120, south: 30, east: 122, north: 32 } }, signal)` and assert the fetched URL includes `level=4&west=120&south=30&east=122&north=32&zoom=10`. Assert runtime payloads with `level: 5` are rejected.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/adminRegionDataSource.test.ts
```

Expected: fail because `loadAdminRegions` still accepts `(apiUrl, level, signal)` and level 5.

- [ ] **Step 3: Implement viewport request input**

Change `AdminRegionLevel` to `2 | 3 | 4`. Add `AdminRegionRequestInput` with `level`, `zoom`, and `viewportBounds`. Build URL query params with bbox fields when present. Keep the default API URL fallback.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/adminRegionDataSource.test.ts
```

Expected: pass.

## Task 5: Frontend Canvas Region Refresh

**Files:**
- Modify: `apps/web/src/components/AmapCanvas.tsx`
- Modify: `apps/web/src/components/AmapCanvas.footprints.test.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Write failing canvas/control tests**

Assert that enabling region mode calls `loadAdminRegions` with level `4`, current zoom, and viewport bounds, not level `5`. Assert `moveend`, `zoomend`, and resize refresh the admin-region request while region mode is active. Assert footprint refresh count does not increase in region mode. Assert the level selector has exactly `省级`, `市级`, and `区县` buttons, with `区县` selected by default.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/AmapCanvas.footprints.test.tsx src/components/mapShellLayout.test.tsx src/components/mapLayout.test.ts
```

Expected: fail because the canvas still defaults to level 5 and region refresh is not viewport-aware.

- [ ] **Step 3: Implement region refresh**

Set `ADMIN_REGION_LEVELS` to levels `2`, `3`, and `4`; default `adminRegionLevel` to `4`; reuse `calculateCurrentViewportSampleInput(...)` for region bbox and zoom; extract `refreshDisplayedAdminRegionsForCurrentViewport(...)`; call it when enabling region mode, when level changes, after `moveend`/`zoomend`, and after resize. Keep destroying the footprint MassMarks layer whenever `adminRegionUnlockEnabled` is true.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/AmapCanvas.footprints.test.tsx src/components/mapShellLayout.test.tsx src/components/mapLayout.test.ts
```

Expected: pass.

## Task 6: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Optional modify: `apps/web/src/layers/README.md`

- [ ] **Step 1: Update docs**

State the current facts: `ADMIN_REGION_DATA_PATH` should point to an AreaCity-derived province/city/district GeoJSON; AreaCity geometry is treated as GCJ-02; matched China footprints get `country_id = CHN`; non-domestic future points are eligible for a later AMap reverse-geocode fallback; `/api/admin-regions` accepts `level`, `west`, `south`, `east`, `north`, and `zoom`.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm test -- --runInBand
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 3: Check worktree**

Run:

```powershell
git status --short --ignored
```

Expected: only intended tracked changes plus ignored cache/dependency files.

