# Footprint Tile Z16 Ceiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap footprint tile rendering and precomputation at z16, then remove redundant local z17/z18 visual tile rows.

**Architecture:** Keep the ceiling explicit in the existing frontend and backend tile modules. Frontend Mapbox camera, vector source, and debug metrics share z16; backend precompute, dirty marking, and validation share `MAX_VISUAL_TILE_ZOOM = 16`.

**Tech Stack:** React, TypeScript, Vitest, Python 3.12, FastAPI, SQLite, pytest, unittest.

---

## File Structure

- Modify `apps/web/src/layers/footprintVectorTileSource.ts`: export the footprint tile max zoom constant and use it in the source.
- Modify `apps/web/src/layers/footprintVectorTileSource.test.ts`: expect source `maxzoom` 16.
- Modify `apps/web/src/components/MapboxCanvas.tsx`: use the frontend constant for `maxZoom` and debug z clamp.
- Modify `apps/web/src/components/MapboxCanvas.test.tsx`: expect max zoom 16 and add debug clamp coverage.
- Modify `apps/web/src/components/mapLayout.test.ts`: update source-level contract to z16.
- Modify `apps/api/src/enroute_api/footprints/visual_tiles.py`: set `MAX_VISUAL_TILE_ZOOM = 16`.
- Modify `scripts/build_footprint_visual_tiles.py`: import/use backend max zoom for CLI default/help.
- Modify `apps/api/tests/test_visual_tiles.py`: expect z16 in MVT stale/dirty rebuild coverage and max zoom validation.
- Modify `apps/api/tests/test_footprints_api.py`: expect dirty marking only at z16.
- Modify `tests/test_import_footprints.py`: expect default CLI max zoom 16.
- Modify `README.md`: document z16.
- Local data cleanup: run SQLite deletion for `visual_tiles.z > 16` in `data/footprints.sqlite`.

### Task 1: Frontend Tile Ceiling Tests

**Files:**
- Modify: `apps/web/src/layers/footprintVectorTileSource.test.ts`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: Write failing vector source expectations**

Change the first two tests in `apps/web/src/layers/footprintVectorTileSource.test.ts`:

```ts
it('builds a Mapbox vector source capped at zoom 16', () => {
  const source = footprintVectorTiles.createFootprintVectorTileSource({
    start: '2024-02-10',
    end: '2026-03-09',
  })

  expect(source.type).toBe('vector')
  expect(source.maxzoom).toBe(16)
  expect(source.tiles).toEqual([
    '/api/map/tiles/footprints/{z}/{x}/{y}.mvt?start=2024-02-10&end=2026-03-09',
  ])
  expect(source.tiles[0]).not.toContain('datasetVersion')
  expect(source.tiles[0]).not.toContain('mode=')
  expect(source.tiles[0]).not.toContain('count=')
})
```

```ts
expect(source.maxzoom).toBe(16)
```

- [ ] **Step 2: Write failing Mapbox canvas expectations**

In `apps/web/src/components/MapboxCanvas.test.tsx`, change the initialization test title and assertions:

```ts
it('initializes Mapbox as a fixed globe map at max zoom 16 and adds the footprint vector circle layer', async () => {
```

```ts
expect(mapRecords[0].options).toMatchObject({
  dragRotate: false,
  maxPitch: 0,
  maxZoom: 16,
  minPitch: 0,
  pitch: 0,
  projection: 'globe',
  renderWorldCopies: false,
  style: 'mapbox://styles/enroute/test',
  touchPitch: false,
  touchZoomRotate: false,
  zoom: 1.75,
})
```

Update all footprint source `maxzoom` expectations in the same file to `16`.

- [ ] **Step 3: Add failing debug clamp test**

Add this test after `shows footprint tile debug metrics for the current Mapbox viewport`:

```ts
it('clamps footprint tile debug metrics requests to z16', async () => {
  const { mapRecords } = mockMapboxRuntime()
  const fetchMock = mockMetricsAndDebugFetch({
    ok: true,
    json: async () => ({
      tileZoom: 16,
      requestedTileCount: 1,
      populatedTileCount: 1,
      readyTileCount: 1,
      dirtyTileCount: 0,
      rawCount: 12,
      representativeCount: 6,
      renderRatio: 0.5,
    }),
  })
  const { MapboxCanvas } = await import('./MapboxCanvas')

  render(
    <MapboxCanvas
      accessToken="test-mapbox-token"
      tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
      timeRange={allRange}
      debugPanelVisible
    />,
  )

  mapRecords[0].setZoom(17.8)
  mapRecords[0].setBounds({ west: 120, south: 30, east: 122, north: 32 })
  act(() => mapRecords[0].emit('load'))
  await act(async () => {})

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/map/tiles/footprints/debug?z=16&west=120&south=30&east=122&north=32&range=all',
    expect.objectContaining({ method: 'GET' }),
  )
})
```

- [ ] **Step 4: Update CSS/source contract test**

In `apps/web/src/components/mapLayout.test.ts`, change:

```ts
expect(mapboxCanvasSource).toContain('maxZoom: 16')
```

- [ ] **Step 5: Run frontend focused tests and confirm failure**

Run:

```powershell
npm --workspace apps/web run test -- src/layers/footprintVectorTileSource.test.ts src/components/MapboxCanvas.test.tsx src/components/mapLayout.test.ts --run
```

Expected: FAIL because implementation still returns `18`.

### Task 2: Frontend Tile Ceiling Implementation

**Files:**
- Modify: `apps/web/src/layers/footprintVectorTileSource.ts`
- Modify: `apps/web/src/components/MapboxCanvas.tsx`

- [ ] **Step 1: Export and use the frontend tile ceiling**

Add in `apps/web/src/layers/footprintVectorTileSource.ts`:

```ts
export const MAX_FOOTPRINT_TILE_ZOOM = 16
```

Change the returned source:

```ts
return {
  type: 'vector' as const,
  tiles: [`${tileUrl}?${params.toString()}`],
  minzoom: 0,
  maxzoom: MAX_FOOTPRINT_TILE_ZOOM,
}
```

- [ ] **Step 2: Use the frontend constant in MapboxCanvas**

Import the constant:

```ts
  MAX_FOOTPRINT_TILE_ZOOM,
```

Change Mapbox construction:

```ts
maxZoom: MAX_FOOTPRINT_TILE_ZOOM,
```

Change debug viewport:

```ts
z: Math.max(0, Math.min(MAX_FOOTPRINT_TILE_ZOOM, Math.floor(map.getZoom()))),
```

- [ ] **Step 3: Run frontend focused tests and confirm pass**

Run:

```powershell
npm --workspace apps/web run test -- src/layers/footprintVectorTileSource.test.ts src/components/MapboxCanvas.test.tsx src/components/mapLayout.test.ts --run
```

Expected: PASS.

### Task 3: Backend Tile Ceiling Tests

**Files:**
- Modify: `apps/api/tests/test_visual_tiles.py`
- Modify: `apps/api/tests/test_footprints_api.py`
- Modify: `tests/test_import_footprints.py`

- [ ] **Step 1: Add max zoom validation test**

In `apps/api/tests/test_visual_tiles.py`, import `MAX_VISUAL_TILE_ZOOM` and add:

```py
def test_visual_tile_zoom_ceiling_is_16():
    assert MAX_VISUAL_TILE_ZOOM == 16
```

```py
def test_build_visual_tiles_rejects_zoom_above_current_ceiling(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        try:
            build_visual_tiles(connection, min_zoom=17, max_zoom=17, bucket="all")
        except ValueError as error:
            assert str(error) == "max_zoom must be less than or equal to 16"
        else:
            raise AssertionError("expected ValueError")
    finally:
        connection.close()
```

- [ ] **Step 2: Update MVT stale/dirty tests to z16**

In `apps/api/tests/test_visual_tiles.py`, replace the z18 Shanghai key with the z16 key for those coordinates:

```py
z = 16
x = 54888
y = 26764
```

Use `16/54888/26764` in inserted rows, endpoint paths, store calls, and SELECT predicates in `test_mvt_request_imports_changed_csv_before_reading_visual_tiles` and `test_dirty_mvt_request_rebuilds_visual_tile_after_serving_old_cells`.

- [ ] **Step 3: Update import dirty marking test to z16**

In `apps/api/tests/test_footprints_api.py`, replace the z18 inserted rows and query with:

```sql
VALUES (16, 54888, 26764, 0, 0, ?, X'455654430100000000', 1000)
```

```sql
VALUES (16, 54888, 26764, 3, 20260111, ?, X'455654430100000000', 1000)
```

```sql
WHERE z = 16 AND x = 54888 AND y = 26764
```

- [ ] **Step 4: Update CLI default test**

In `tests/test_import_footprints.py`, add a test:

```py
    def test_build_footprint_visual_tiles_cli_defaults_to_zoom_16(self):
        completed = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).resolve().parents[1] / "scripts" / "build_footprint_visual_tiles.py"),
                "--help",
            ],
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("Defaults to 16", completed.stdout)
```

- [ ] **Step 5: Run backend/repo focused tests and confirm failure**

Run:

```powershell
$env:PYTHONPATH = 'apps/api/src'; python -m pytest apps/api/tests/test_visual_tiles.py apps/api/tests/test_footprints_api.py -q
python -m unittest tests.test_import_footprints.ImportFootprintsTests.test_build_footprint_visual_tiles_cli_defaults_to_zoom_16
```

Expected: Run both commands from the repository root. Both fail because backend constant and CLI help still use 18.

### Task 4: Backend Tile Ceiling Implementation

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/visual_tiles.py`
- Modify: `scripts/build_footprint_visual_tiles.py`

- [ ] **Step 1: Set backend constant to 16**

Change:

```py
MAX_VISUAL_TILE_ZOOM = 16
```

- [ ] **Step 2: Use backend constant in CLI default/help**

In `scripts/build_footprint_visual_tiles.py`, import `MAX_VISUAL_TILE_ZOOM` with `build_visual_tiles`:

```py
  from enroute_api.footprints.visual_tiles import MAX_VISUAL_TILE_ZOOM, build_visual_tiles
```

Move argument parser creation after `add_api_src_to_path(repository_root_dir)` so `parse_args` can receive the constant:

```py
  args = parse_args(argv, max_zoom_default=MAX_VISUAL_TILE_ZOOM)
```

Change parser function:

```py
def parse_args(argv: Sequence[str] | None, *, max_zoom_default: int) -> argparse.Namespace:
```

Change argument:

```py
  parser.add_argument(
    "--max-zoom",
    type=int,
    default=max_zoom_default,
    help=f"Maximum zoom to build. Defaults to {max_zoom_default}.",
  )
```

- [ ] **Step 3: Run backend/repo focused tests and confirm pass**

Run:

```powershell
$env:PYTHONPATH = 'apps/api/src'; python -m pytest apps/api/tests/test_visual_tiles.py apps/api/tests/test_footprints_api.py -q
python -m unittest tests.test_import_footprints.ImportFootprintsTests.test_build_footprint_visual_tiles_cli_defaults_to_zoom_16
```

Expected: Run both commands from the repository root. Both pass.

### Task 5: Documentation and Local SQLite Cleanup

**Files:**
- Modify: `README.md`
- Local ignored data: `data/footprints.sqlite`

- [ ] **Step 1: Update README**

Change README statements:

```md
`npm run prepare:footprint-tiles` precomputes the footprint visual tile cells
for `all`, `day`, `month`, and `year` buckets up to zoom 16.
```

```md
The current location page uses a Mapbox GL map surface capped at zoom 16 and a
vector-tile circle layer for footprint points.
```

- [ ] **Step 2: Clean local redundant rows**

Run from repository root, not the worktree, because ignored local data is in the root workspace:

```powershell
sqlite3 data\footprints.sqlite "SELECT z, COUNT(*) FROM visual_tiles WHERE z > 16 GROUP BY z ORDER BY z;"
sqlite3 data\footprints.sqlite "DELETE FROM visual_tiles WHERE z > 16; VACUUM;"
sqlite3 data\footprints.sqlite "SELECT MAX(z) FROM visual_tiles;"
sqlite3 data\footprints.sqlite "SELECT COUNT(*) FROM visual_tiles WHERE z > 16;"
sqlite3 data\footprints.sqlite "SELECT z, COUNT(*) FROM visual_tiles GROUP BY z ORDER BY z;"
```

Expected: first query shows z17/z18 rows; after delete, max remaining z is 16 and `z > 16` count is 0.

### Task 6: Full Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run required verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 2: Inspect final diff and status**

Run:

```powershell
git diff --stat
git diff --check
git status --short
```

Expected: no whitespace errors, only intended tracked file edits plus ignored cache artifacts.
