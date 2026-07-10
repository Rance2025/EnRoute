# Admin Region Dual Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store administrative region geometries in both their original source coordinate system and canonical WGS-84, and use WGS-84 for footprint attribution and Mapbox tiles.

**Architecture:** `admin_regions.geometry` becomes the canonical WGS-84 geometry used by matching, API output, and tile building. New columns `source_geometry` and `source_coordinate_system` preserve the original source geometry, with AreaCity China detail stored as `gcj02` and world sources stored as `wgs84`. Existing databases are migrated in place by copying old geometry to `source_geometry`, converting China level 2-4 geometries to WGS-84, and refreshing their bounding boxes.

**Tech Stack:** Python 3.12, SQLite migrations, existing GeoJSON geometry helpers, pytest.

---

### Task 1: Schema and Import Tests

**Files:**
- Modify: `apps/api/tests/test_admin_regions_import.py`
- Modify: `apps/api/src/enroute_api/admin_regions/store.py`

- [ ] **Step 1: Write failing tests**

Add tests that verify AreaCity import stores `geometry` as WGS-84, stores the original GCJ-02 geometry in `source_geometry`, and marks `source_coordinate_system='gcj02'`. Add a migration test that starts from an old `admin_regions` table and verifies the new columns and converted bbox.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `python -m pytest apps/api/tests/test_admin_regions_import.py -k "source_geometry or wgs84" -q`

Expected: fail because the new columns and WGS-84 import behavior do not exist yet.

- [ ] **Step 3: Implement schema migration and import conversion**

Add `source_geometry` and `source_coordinate_system` columns. For new rows, compute source metadata from feature properties and transform GCJ-02 AreaCity geometry to WGS-84 before storing `geometry`. For existing rows, copy old geometry into `source_geometry`, mark China detail rows as `gcj02`, transform their canonical `geometry`, and recalculate bbox.

- [ ] **Step 4: Run focused tests to verify pass**

Run: `python -m pytest apps/api/tests/test_admin_regions_import.py -k "source_geometry or wgs84" -q`

Expected: pass.

### Task 2: Tile Builder and Matcher Consistency

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/tiles.py`
- Modify: `apps/api/tests/test_admin_region_tiles.py`
- Modify: `apps/api/tests/test_admin_regions_import.py`

- [ ] **Step 1: Write failing tests**

Update or add tests proving Mapbox tile encoding does not double-transform already canonical WGS-84 `admin_regions.geometry`, and footprint matching uses the same WGS-84 geometry as the map fill.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `python -m pytest apps/api/tests/test_admin_region_tiles.py apps/api/tests/test_admin_regions_import.py -k "wgs84 or areacity" -q`

Expected: fail until the tile transformation path is updated.

- [ ] **Step 3: Remove render-time geometry conversion for canonical rows**

Keep tile clipping, simplification, boundary derivation, and MVT encoding unchanged, but make `transform_admin_region_render_geometry` return stored `geometry` because `admin_regions.geometry` is already WGS-84 after import/migration.

- [ ] **Step 4: Run focused tests to verify pass**

Run: `python -m pytest apps/api/tests/test_admin_region_tiles.py apps/api/tests/test_admin_regions_import.py -k "wgs84 or areacity" -q`

Expected: pass.

### Task 3: Database Backfill and Verification

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/store.py` if a reusable backfill helper is needed.
- Runtime data: `data/footprints.sqlite` only after backup.

- [ ] **Step 1: Backup live database**

Copy `data/footprints.sqlite` to a timestamped backup before any write.

- [ ] **Step 2: Apply schema migration to the live database**

Open the database through existing initialization code so `admin_regions` gains the new columns and China detail geometry is converted to WGS-84.

- [ ] **Step 3: Full backfill footprint attribution**

Recompute every `footprints.region_id` from the WGS-84 matcher, then rebuild admin-region stats from footprints. Do not touch `visual_tiles` and do not rebuild `admin_region_tiles` unless code changes require it.

- [ ] **Step 4: Verify database invariants**

Run read-only SQL checks: `PRAGMA integrity_check`, `COUNT(*)` for `footprints`, `visual_tiles`, `admin_region_tiles`, `region_id IS NULL`, and footprint region level distribution.

Expected: integrity `ok`, `visual_tiles` unchanged, `admin_region_tiles` unchanged unless explicitly rebuilt, and all existing footprints assigned to the finest available WGS-84 region.

### Task 4: Final Verification and Integration

**Files:**
- All modified source and tests.

- [ ] **Step 1: Run full verification**

Run: `npm test`, `npm run lint`, and `npm run build`.

- [ ] **Step 2: Commit and merge locally**

Commit with a Chinese conventional message and merge back to `master` locally. Do not push.

- [ ] **Step 3: Restart services on master**

Restart with `python start.py restart` after the live database is migrated and verified.
