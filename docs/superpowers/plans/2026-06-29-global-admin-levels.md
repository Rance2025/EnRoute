# Global Admin Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global administrative boundary support for EnRoute levels 1-3.

**Architecture:** Keep `admin_regions` and `admin_region_tree` as the canonical source tables with WGS84 geometry. Normalize Overture-style division features into levels 1, 2, and 3, serve cached MVT admin-region tiles from SQLite, and let Mapbox GL render those vector tiles when administrative boundaries are enabled.

**Tech Stack:** Python 3.12, FastAPI, SQLite, `mapbox-vector-tile`, Shapely, React, Mapbox GL JS, Vitest, pytest.

---

### Task 1: Normalize Global Level 1-3 Regions

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/store.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Test: `apps/api/tests/test_admin_regions_import.py`

- [x] Add failing tests for Overture `country`, `region`, and `locality` features mapping to EnRoute levels 1, 2, and 3.
- [x] Add a failing API test proving `/api/admin-regions?level=1` is valid and `level=4` is no longer part of the global default scope.
- [x] Implement Overture property normalization and WGS84-preserving storage.
- [x] Update API level validation to accept only 1, 2, and 3.
- [x] Run targeted API tests.

### Task 2: Add Admin Region MVT Cache

**Files:**
- Create: `apps/api/src/enroute_api/admin_regions/tiles.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Create: `scripts/build_admin_region_tiles.py`
- Test: `apps/api/tests/test_admin_region_tiles.py`
- Test: `tests/test_build_admin_region_tiles.py`

- [x] Add failing tests for admin tile schema, world focus depth 3, cached tile reads, and HTTP tile endpoint.
- [x] Implement SQLite-backed admin-region tile cache.
- [x] Expose `GET /api/map/tiles/admin-regions/{z}/{x}/{y}.mvt`.
- [x] Add the admin-tile build script.
- [x] Run targeted API/repo tests.

### Task 3: Render Admin Region Tiles In Mapbox

**Files:**
- Create: `apps/web/src/layers/adminRegionVectorTileSource.ts`
- Create: `apps/web/src/layers/adminRegionVectorTileSource.test.ts`
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`
- Modify: `.env.example`
- Modify: `README.md`

- [x] Add failing tests for admin vector source URL, fill/line layers, and MapboxCanvas source lifecycle.
- [x] Implement source/layer helpers.
- [x] Wire MapboxCanvas to add/remove admin-region vector tiles when boundary visibility is enabled.
- [x] Document the ODbL attribution/data-distribution constraint and the precompute command.
- [x] Run web tests, lint, build, and browser verification.
