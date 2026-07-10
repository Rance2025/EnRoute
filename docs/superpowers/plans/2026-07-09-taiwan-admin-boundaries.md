# Taiwan Admin Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Taiwan county/city and township/district boundaries under the existing China hierarchy so region depth 3 and 4 are no longer empty for Taiwan.

**Architecture:** Keep the current `710000` Taiwan province row as level 2. Convert official Taiwan county/city features into generated `tw-county-{COUNTYCODE}` level 3 rows, and township/district features into generated `tw-town-{TOWNCODE}` level 4 rows linked by `COUNTYCODE`. Replace only generated Taiwan rows and their tree edges, then use the existing admin-region tile builder for selected depth/zoom ranges.

**Tech Stack:** Python 3.12, SQLite, Shapely, pytest, existing EnRoute admin region store/tile builders.

---

### Task 1: Tests for Taiwan Boundary Loading

**Files:**
- Modify: `tests/test_patch_admin_region_tiles.py`
- Modify: `scripts/patch_admin_region_tiles.py`

- [ ] **Step 1: Write failing tests**

Add tests that build tiny official-style GeoJSON files and assert:

```python
features = load_taiwan_admin_region_features(county_path, town_path)
```

Expected behavior:
- county rows become `level=3`, parent `710000`;
- town rows become `level=4`, parent `tw-county-{COUNTYCODE}`;
- duplicate `TOWNCODE` geometries merge into one row;
- patching the database removes only `tw-county-*` and `tw-town-*` rows while preserving unrelated rows.

- [ ] **Step 2: Verify RED**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest tests/test_patch_admin_region_tiles.py -q
```

Expected: import failures for the new Taiwan helpers.

- [ ] **Step 3: Implement minimal loader and patcher**

In `scripts/patch_admin_region_tiles.py`, add:
- `TAIWAN_PROVINCE_ID = "710000"`;
- official field extraction for `COUNTYCODE`, `COUNTYNAME`, `TOWNCODE`, `TOWNNAME`;
- preserve official Taiwan display names as provided by the source;
- Shapely repair for invalid geometries;
- duplicate town-code merge with `unary_union`;
- `patch_taiwan_admin_levels()` that deletes only generated Taiwan rows/tree edges and inserts new rows.

- [ ] **Step 4: Verify GREEN**

Run the same focused pytest command and confirm it passes.

### Task 2: CLI Integration

**Files:**
- Modify: `scripts/patch_admin_region_tiles.py`
- Modify: `tests/test_patch_admin_region_tiles.py`

- [ ] **Step 1: Add failing CLI test**

Call `main()` with:

```powershell
--patch-taiwan-admin-levels --skip-taiwan-admin-tile-rebuild
--taiwan-county-data-path <county.geojson>
--taiwan-town-data-path <town.geojson>
```

Expected: database contains level 3/4 Taiwan rows and existing non-Taiwan rows remain.

- [ ] **Step 2: Implement CLI flags**

Add:
- `--patch-taiwan-admin-levels`;
- `--taiwan-county-data-path`;
- `--taiwan-town-data-path`;
- `--skip-taiwan-admin-tile-rebuild`.

When tile rebuild is enabled, rebuild selected depths and zooms through the existing `rebuild_admin_region_tile_depth_range()` function.

- [ ] **Step 3: Verify focused tests**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest tests/test_patch_admin_region_tiles.py -q
```

### Task 3: Apply to Local SQLite

**Files:**
- Local ignored: `data/footprints.sqlite`
- Local ignored: `data/footprints.sqlite.backup-*`

- [ ] **Step 1: Backup before writes**

Create a SQLite backup with the Python backup API, then verify `PRAGMA integrity_check`.

- [ ] **Step 2: Patch Taiwan rows first**

Run:

```powershell
python scripts/patch_admin_region_tiles.py `
  --database data/footprints.sqlite `
  --skip-greenland `
  --skip-build-zooms `
  --patch-taiwan-admin-levels `
  --skip-taiwan-admin-tile-rebuild `
  --taiwan-county-data-path external/taiwan-admin-boundaries/county-combined-1140318.geojson `
  --taiwan-town-data-path external/taiwan-admin-boundaries/town-combined-1140318.geojson `
  --depths 3,4 `
  --min-zoom 0 `
  --max-zoom 0
```

Expected row counts:
- `tw-county-*` = 22;
- `tw-town-*` = 368;
- `visual_tiles` unchanged.

- [ ] **Step 3: Backup after row patch**

Create a second SQLite backup and verify integrity.

- [ ] **Step 4: Rebuild admin tiles in batches**

Run explicit admin tile rebuild batches for `depths=3,4`, initially `z0..z9`, preserving `visual_tiles`.

- [ ] **Step 5: Verify database and tiles**

Check:
- `PRAGMA integrity_check`;
- row counts for `footprints`, `footprint_spatial`, `visual_tiles`, `admin_regions`, `admin_region_tree`, `admin_region_tiles`;
- sample decoded MVT features around Taiwan include `tw-county-*` and `tw-town-*`.

### Task 4: Full Verification and Commit

**Files:**
- Modify: `scripts/patch_admin_region_tiles.py`
- Modify: `tests/test_patch_admin_region_tiles.py`
- Add: `docs/superpowers/plans/2026-07-09-taiwan-admin-boundaries.md`

- [ ] **Step 1: Run full checks**

Run:

```powershell
npm test
npm run lint
npm run build
```

- [ ] **Step 2: Commit**

Commit tracked changes with:

```powershell
git add docs/superpowers/plans/2026-07-09-taiwan-admin-boundaries.md tests/test_patch_admin_region_tiles.py scripts/patch_admin_region_tiles.py
git commit -m "fix: 补齐台湾市区行政层级导入"
```
