# Region ID Only Footprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `footprints.region_id` the only persisted admin-region attribution for footprint points.

**Architecture:** `region_id` stores the finest admin region the local polygon data can match. Country/province/city/district context is derived later from `admin_region_tree`, so `footprints.country_id` is removed from the runtime contract and no new signature mechanism is added.

**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest, Vitest through the existing repo commands.

---

### Task 1: Contract Tests

**Files:**
- Modify: `apps/api/tests/test_admin_regions_import.py`
- Modify: `apps/api/tests/test_footprints_api.py`

- [ ] **Step 1: Update schema and classifier expectations**

In `test_initializes_admin_region_tables_and_new_footprint_contract`, expect the `footprints` columns to end at `region_id` with no `country_id`.

In `test_classifies_new_footprint_against_finest_cached_admin_region`, expect `classify_footprint_admin_region(...)` to return the region id string `sanlin`.

- [ ] **Step 2: Update import expectations**

In `test_incremental_import_assigns_finest_region_and_updates_cached_stats`, query only `timestamp_seconds, region_id` and assert:

```python
assert [(row["timestamp_seconds"], row["region_id"]) for row in footprints] == [
    (100, "sanlin"),
    (130, "sanlin"),
    (160, "pudong"),
]
```

- [ ] **Step 3: Update API expectations**

In `test_serves_get_footprints_as_json`, remove the `countryId` key from the expected raw point.

- [ ] **Step 4: Verify RED**

Run:

```powershell
python scripts/run_api_tests.py apps/api/tests/test_admin_regions_import.py::test_initializes_admin_region_tables_and_new_footprint_contract apps/api/tests/test_admin_regions_import.py::test_classifies_new_footprint_against_finest_cached_admin_region apps/api/tests/test_admin_regions_import.py::test_incremental_import_assigns_finest_region_and_updates_cached_stats apps/api/tests/test_footprints_api.py::test_serves_get_footprints_as_json
```

Expected: failures that still show `country_id`/`countryId` in the implementation contract.

### Task 2: Region-Only Runtime

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Modify: `apps/api/tests/test_admin_regions_import.py`
- Modify: `apps/api/tests/test_footprints_api.py`

- [ ] **Step 1: Remove `country_id` from the new schema**

Change the `CREATE TABLE IF NOT EXISTS footprints` statement so it contains `region_id TEXT` as the final column.

- [ ] **Step 2: Accept both current and old footprints schemas**

Change `migrate_legacy_footprints_schema(...)` so a table with the old trailing `country_id` column is migrated to the region-only shape by rebuilding `footprints` into a new table that copies all columns except `country_id`.

- [ ] **Step 3: Simplify insertion and duplicate validation**

Make `classify_footprint_admin_region(...)` return `str | None`, remove `country_id_for_region_match` usage from `store.py`, insert only `region_id`, and compare duplicates without `country_id`.

- [ ] **Step 4: Simplify raw point API output**

Remove `country_id AS countryId` from `query_all_points(...)` and remove `countryId` from `format_raw_point(...)`.

- [ ] **Step 5: Verify GREEN**

Run the same focused API tests from Task 1. Expected: all selected tests pass.

### Task 3: Database Baseline Migration

**Files:**
- Database: `data/footprints.sqlite` in the root workspace after code verification

- [ ] **Step 1: Rehearse schema migration on the worktree copy**

Run a short Python script that opens `.worktrees/region-id-only-footprints/data/footprints.sqlite`, calls `initialize_schema(connection)`, and checks:

```sql
PRAGMA table_info(footprints);
SELECT COUNT(*) FROM footprints;
SELECT COUNT(*) FROM visual_tiles;
PRAGMA integrity_check;
```

Expected: no `country_id`, row count remains `40441`, `visual_tiles` remains `63221`, integrity is `ok`.

- [ ] **Step 2: Apply schema migration to root database**

After tests pass and before final merge, run the same initialization against `D:\Coding\EnRoute\data\footprints.sqlite`. Keep the existing `footprints.sqlite.backup-current-region-id-only-baseline-*` file as rollback.

### Task 4: Verification and Integration

**Files:**
- All modified files

- [ ] **Step 1: Run full verification in the worktree**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

- [ ] **Step 2: Commit and merge locally**

Commit with:

```powershell
git commit -m "refactor: 简化足迹行政区归属"
```

Merge to `master` locally with a Chinese merge commit.

- [ ] **Step 3: Verify merged result and restart**

Run `npm test`, `npm run lint`, and `npm run build` from root `master`, then restart with:

```powershell
python start.py stop
python start.py start
```
