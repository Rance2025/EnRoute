# Admin Region Active Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle that renders only administrative regions containing footprints in the current time range.

**Architecture:** Keep `admin_region_tiles` static and cached. Add a lightweight backend endpoint that returns active `region_id` values for the selected time range and depth, then use Mapbox layer filters on the existing admin-region MVT layers.

**Tech Stack:** FastAPI, SQLite, React, TypeScript, Mapbox GL JS, Vitest, pytest.

---

### File Structure

- Modify `apps/api/src/enroute_api/main.py`: expose `GET /api/admin-regions/active`.
- Modify `apps/api/src/enroute_api/footprints/store.py`: add active region query helpers that use `footprints.region_id`, `admin_region_tree`, and `admin_regions.level`.
- Modify `apps/api/tests/test_admin_regions_import.py`: cover depth-level active id expansion from level 4 footprints to ancestors.
- Modify `apps/web/src/layers/adminRegionVectorTileSource.ts`: add active-id filter builders for fill and line layers.
- Modify `apps/web/src/layers/adminRegionVectorTileSource.test.ts`: cover unfiltered and active-filter layer expressions.
- Modify `apps/web/src/components/MapboxCanvas.tsx`: fetch active ids when enabled, apply filters with `map.setFilter`, abort stale requests.
- Modify `apps/web/src/components/MapboxCanvas.test.tsx`: cover request URL, active filter application, and stale request handling.
- Modify `apps/web/src/App.tsx`: add the user-facing right-panel switch and pass `adminRegionActiveOnly` into `MapboxCanvas`.
- Modify `apps/web/src/components/mapShellLayout.test.tsx`: cover the visible switch and prop handoff.

### Task 1: Backend Active Region Ids

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Test: `apps/api/tests/test_admin_regions_import.py`

- [ ] **Step 1: Write the failing backend API test**

Add a test that loads a country/province/city/district tree, inserts footprints into two districts across two dates, and expects `GET /api/admin-regions/active?start=2026-06-19&end=2026-06-19&depth=3` to return only the active city id.

- [ ] **Step 2: Run the backend test and verify RED**

Run: `python -m pytest apps/api/tests/test_admin_regions_import.py::test_serves_active_admin_region_ids_for_date_range -q`

Expected: fails with 404 because `/api/admin-regions/active` does not exist yet.

- [ ] **Step 3: Implement the active region query**

Add `get_active_admin_region_ids()` on `FootprintStore`, normalize the same `range/start/end` inputs used by metrics, select distinct `footprints.region_id`, recursively add ancestors through `get_region_chain()`, and filter to `level = depth`.

- [ ] **Step 4: Expose the FastAPI route**

Add `GET /api/admin-regions/active` with `depth`, `range`, `start`, and `end` query parameters. Reject depth outside `1..4`.

- [ ] **Step 5: Run backend targeted tests and commit**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_regions_import.py::test_serves_active_admin_region_ids_for_date_range -q
python -m pytest apps/api/tests/test_footprints_api.py apps/api/tests/test_admin_regions_import.py -q
```

Expected: targeted tests pass.

Commit: `feat: 支持按时间查询活跃行政区`

### Task 2: Admin Region Layer Filters

**Files:**
- Modify: `apps/web/src/layers/adminRegionVectorTileSource.ts`
- Test: `apps/web/src/layers/adminRegionVectorTileSource.test.ts`

- [ ] **Step 1: Write failing filter builder tests**

Cover these expected filters:

```ts
createAdminRegionFillFilter(['310115']) === [
  'all',
  ['==', ['get', 'kind'], 'fill'],
  ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
  ['in', ['get', 'region_id'], ['literal', ['310115']]],
]
```

Use the same shape for line features with `kind = line`.

- [ ] **Step 2: Run the filter tests and verify RED**

Run: `npm --workspace apps/web run test -- src/layers/adminRegionVectorTileSource.test.ts --run`

Expected: fails because the filter builders do not exist.

- [ ] **Step 3: Implement filter builders and wire layer creation**

Export `createAdminRegionFillFilter(activeRegionIds?: string[])` and `createAdminRegionLineFilter(activeRegionIds?: string[])`. Make existing `createAdminRegionFillLayer()` and `createAdminRegionLineLayer()` use the builders.

- [ ] **Step 4: Run filter tests and commit**

Run: `npm --workspace apps/web run test -- src/layers/adminRegionVectorTileSource.test.ts --run`

Expected: pass.

Commit: `feat: 支持行政区图层筛选表达式`

### Task 3: Mapbox Runtime Toggle

**Files:**
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Test: `apps/web/src/components/MapboxCanvas.test.tsx`

- [ ] **Step 1: Write failing Mapbox runtime tests**

Add a test that renders `MapboxCanvas` with `adminRegionUnlockEnabled`, `adminRegionDepth={4}`, `adminRegionActiveOnly`, and a selected `timeRange`. Mock `fetch` so `/api/admin-regions/active` returns `{ regionIds: ['310115'] }`. Assert `map.setFilter()` receives active filters for `admin-regions-fill` and `admin-regions-line`.

- [ ] **Step 2: Run the Mapbox targeted test and verify RED**

Run: `npm --workspace apps/web run test -- src/components/MapboxCanvas.test.tsx --run`

Expected: fails because `adminRegionActiveOnly` and `setFilter` handling are absent.

- [ ] **Step 3: Implement active id loading and filter application**

Add an optional `adminRegionActiveOnly?: boolean` prop. When admin regions are enabled and active-only is true, fetch `/api/admin-regions/active` with the same `range/start/end` convention as footprint tiles plus `depth`. Store ids in state and call `map.setFilter()` for both admin-region layers. On inactive mode, restore the base filters.

- [ ] **Step 4: Run Mapbox tests and commit**

Run: `npm --workspace apps/web run test -- src/components/MapboxCanvas.test.tsx --run`

Expected: pass.

Commit: `feat: 按时间筛选行政区渲染`

### Task 4: Visible Region Panel Switch

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: Write failing UI handoff test**

Add a test that opens the `区域` secondary nav, finds a switch labeled `仅显示当前时间有足迹的区域`, clicks it, and asserts the mocked `MapboxCanvas` receives `data-admin-region-active-only="true"`.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `npm --workspace apps/web run test -- src/components/mapShellLayout.test.tsx --run`

Expected: fails because the switch does not exist yet.

- [ ] **Step 3: Implement the right-panel switch**

Add `const [adminRegionActiveOnly, setAdminRegionActiveOnly] = useState(false)` in `App`. Extend `AdminRegionDepthControl` into a small region control block that renders the existing depth buttons plus a `role="switch"` button. Pass `adminRegionActiveOnly` to `LazyMapboxCanvas`.

- [ ] **Step 4: Run UI tests and commit**

Run: `npm --workspace apps/web run test -- src/components/mapShellLayout.test.tsx --run`

Expected: pass.

Commit: `feat: 增加活跃行政区显示开关`

### Task 5: Verification

**Files:**
- No code edits expected.

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all pass. Existing Vite large chunk warning is acceptable.

- [ ] **Step 2: Browser smoke check**

Start services with `python start.py start`, open `http://127.0.0.1:5173`, enable region view and active-only mode, switch time ranges, and confirm admin-region fill/line layers remain visible without Mapbox console errors.

- [ ] **Step 3: Final commit if needed**

Commit verification-only documentation or small test adjustments only if files changed.
