# Admin Level Scope CN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit global administrative unlocks to country level while keeping China administrative unlocks through level 4, and move the admin-region depth control into the right context panel.

**Architecture:** Keep `admin_regions` and `admin_region_tree` unchanged. Change normalization/query/tile policy so world focus can expose level 1 globally and levels 2-4 only for China descendants. Hoist admin-region depth state to `App.tsx` so the right panel owns the selector and `MapboxCanvas` only receives the selected depth.

**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest, React 19, TypeScript, Vitest.

---

### Task 1: Backend Admin-Level Scope

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/store.py`
- Modify: `apps/api/src/enroute_api/admin_regions/tiles.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Test: `apps/api/tests/test_admin_regions_import.py`
- Test: `apps/api/tests/test_admin_region_tiles.py`

- [ ] Add failing tests proving global Overture/OSM imports keep only countries, AreaCity imports keep province/city/district, `/api/admin-regions?level=4` is valid, and world-focus tiles include China level 4 but skip non-China level 2/3/4.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Implement minimal scope helpers and validation changes.
- [ ] Run focused API tests and confirm they pass.

### Task 2: Right Panel Depth Control

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Modify: `apps/web/src/layers/adminRegionVectorTileSource.ts`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Test: `apps/web/src/layers/adminRegionVectorTileSource.test.ts`

- [ ] Add failing tests proving the depth control renders in the right context panel for the Region tab, no longer renders as a map overlay, and clicking level 4 updates the Mapbox admin tile depth.
- [ ] Run focused web tests and confirm the expected failures.
- [ ] Hoist depth state into `App.tsx`, pass it to `MapboxCanvas`, and render the selector in the right panel.
- [ ] Run focused web tests and confirm they pass.

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `apps/web/src/layers/README.md`

- [ ] Update docs to state global level 1 plus China level 1-4.
- [ ] Run focused API/web tests, `npm run lint`, and `npm run build`.
- [ ] Report any unrelated baseline failures separately.
