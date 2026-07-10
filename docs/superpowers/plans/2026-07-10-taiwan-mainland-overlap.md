# Taiwan Mainland Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove mainland-authoritative overlap from Taiwan level 3/4 admin polygons and rebuild only affected admin-region tile keys.

**Architecture:** Store the corrected geometry in `admin_regions.geometry`, so future footprint point-in-polygon attribution uses the same non-overlapping facts as map rendering. The patch script queries only mainland authority rows whose bbox intersects each generated Taiwan level 3/4 row, subtracts those stored and rendered mainland geometries, updates only changed rows, and patches only existing tile keys covered by changed Taiwan rows by replacing the changed region features.

**Tech Stack:** Python, SQLite, Shapely, pytest, existing admin-region MVT tile helpers.

---

### Task 1: Test Taiwan Geometry Clipping

**Files:**
- Modify: `tests/test_patch_admin_region_tiles.py`
- Modify: `scripts/patch_admin_region_tiles.py`

- [x] **Step 1: Write failing tests**

Add tests proving generated Taiwan county/town features are clipped by mainland rows, non-overlapping Taiwan rows stay unchanged, and existing non-Taiwan rows plus `visual_tiles` are preserved.

- [x] **Step 2: Verify red**

Run: `python -m pytest tests/test_patch_admin_region_tiles.py -q`

Expected: FAIL because no Taiwan-mainland clipping helper exists yet.

- [x] **Step 3: Implement minimal clipping**

Add functions in `scripts/patch_admin_region_tiles.py` that:
- load nearby mainland authoritative geometries from level 2 numeric adcode rows `110000` through `650000`;
- subtract stored and rendered mainland geometries from `tw-county-*` and `tw-town-*` polygon geometries;
- update bbox values from the clipped geometry;
- fail if clipping empties a generated Taiwan feature.

- [x] **Step 4: Verify green**

Run: `python -m pytest tests/test_patch_admin_region_tiles.py -q`

Expected: PASS.

### Task 2: Incremental Database And Tile Patch

**Files:**
- Modify: `scripts/patch_admin_region_tiles.py`
- Test: `tests/test_patch_admin_region_tiles.py`

- [x] **Step 1: Add failing test for tile scope**

Test that the patch updates only affected Taiwan rows and only changes depth 3/4 `admin_region_tiles` rows whose tile keys intersect those rows.

- [x] **Step 2: Verify red**

Run: `python -m pytest tests/test_patch_admin_region_tiles.py -q`

Expected: FAIL because the CLI still rebuilds full depth ranges for Taiwan.

- [x] **Step 3: Implement affected-key rebuild**

Add a CLI path for Taiwan-mainland overlap repair that updates changed Taiwan rows, computes affected keys from the changed rows before and after clipping, and replaces only changed region features in existing world focus depth 3/4 tile rows.

- [x] **Step 4: Verify green**

Run: `python -m pytest tests/test_patch_admin_region_tiles.py -q`

Expected: PASS.

### Task 3: Apply To Local SQLite Safely

**Files:**
- Database only: `data/footprints.sqlite`

- [x] **Step 1: Create backup**

Copy `data/footprints.sqlite` to a timestamped `data/footprints.sqlite.backup-before-taiwan-mainland-overlap-*`.

- [x] **Step 2: Run patch on copied worktree DB**

Run the new overlap patch against the worktree DB first and verify Taiwan-mainland area intersections drop to zero.

- [x] **Step 3: Run patch on root DB**

Stop only if the worktree DB verification fails. Otherwise run the same patch against root `data/footprints.sqlite`.

- [x] **Step 4: Verify DB**

Check SQLite `PRAGMA integrity_check`, Taiwan level counts, zero mainland overlap for `tw-county-*` and `tw-town-*`, and current service endpoints.

### Task 4: Commit And Integrate

**Files:**
- Commit code/tests/plan only. Do not commit SQLite or output files.

- [x] **Step 1: Run focused and full verification**

Run `python -m pytest tests/test_patch_admin_region_tiles.py -q`, `npm test`, `npm run lint`, and `npm run build`.

- [ ] **Step 2: Commit**

Commit with Chinese conventional subject: `fix: 裁剪台湾行政区划与大陆重叠面`.

- [ ] **Step 3: Merge locally**

Merge back to `master`, keep root database backup, and clean the feature worktree after final verification.
