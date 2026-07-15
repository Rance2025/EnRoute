# Region Map Display Controls Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate visited-thumbnail seams, preserve region boundary visibility across level changes, and show footprint or region map controls only when their layers are meaningful.

**Architecture:** Keep the existing precomputed thumbnail and Mapbox vector-tile request paths unchanged. Make layer creation consume current controlled preferences from refs, update paint/layout properties in place for normal edits, and let `App` derive control visibility from the active map subpage plus the region-footprint preference.

**Tech Stack:** React 19, TypeScript 6, Mapbox GL JS, Vitest, Testing Library, CSS SVG styling.

---

### Task 1: Region fill opacity preference and layer factory

**Files:**
- Modify: `apps/web/src/layers/adminRegionVectorTileSource.ts`
- Modify: `apps/web/src/layers/adminRegionVectorTileSource.test.ts`
- Modify: `apps/web/src/navigationPreferences.ts`
- Modify: `apps/web/src/navigationPreferences.test.ts`

- [ ] **Step 1: Write failing normalization and persistence tests**

Add assertions that define the exact public contract:

```ts
expect(adminRegionVectorTiles.DEFAULT_ADMIN_REGION_FILL_OPACITY).toBe(0.18)
expect(adminRegionVectorTiles.ADMIN_REGION_FILL_OPACITY_MIN).toBe(0.05)
expect(adminRegionVectorTiles.ADMIN_REGION_FILL_OPACITY_MAX).toBe(1)
expect(adminRegionVectorTiles.ADMIN_REGION_FILL_OPACITY_STEP).toBe(0.01)
expect(adminRegionVectorTiles.normalizeAdminRegionFillOpacity(0.736)).toBe(0.74)
expect(adminRegionVectorTiles.normalizeAdminRegionFillOpacity(0.01)).toBe(0.05)
expect(adminRegionVectorTiles.normalizeAdminRegionFillOpacity(1.2)).toBe(1)
expect(adminRegionVectorTiles.createAdminRegionFillLayer(undefined, 0.42).paint)
  .toMatchObject({ 'fill-opacity': 0.42 })
```

```ts
expect(readAdminRegionFillOpacity(createStorage('0.42', ADMIN_REGION_FILL_OPACITY_STORAGE_KEY)))
  .toBe(0.42)
expect(readAdminRegionFillOpacity(createStorage('wide', ADMIN_REGION_FILL_OPACITY_STORAGE_KEY)))
  .toBe(0.18)
writeAdminRegionFillOpacity(0.736, storage)
expect(storage.setItem).toHaveBeenCalledWith(ADMIN_REGION_FILL_OPACITY_STORAGE_KEY, '0.74')
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
npm run test:web -- src/layers/adminRegionVectorTileSource.test.ts src/navigationPreferences.test.ts
```

Expected: FAIL because the opacity constants, normalizer, storage functions, and fill-layer parameter do not exist.

- [ ] **Step 3: Implement the exact opacity contract**

Add to `adminRegionVectorTileSource.ts`:

```ts
export const DEFAULT_ADMIN_REGION_FILL_OPACITY = 0.18
export const ADMIN_REGION_FILL_OPACITY_MIN = 0.05
export const ADMIN_REGION_FILL_OPACITY_MAX = 1
export const ADMIN_REGION_FILL_OPACITY_STEP = 0.01

export function normalizeAdminRegionFillOpacity(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ADMIN_REGION_FILL_OPACITY
  }
  return Math.round(Math.min(Math.max(value, 0.05), 1) * 100) / 100
}
```

Change `createAdminRegionFillLayer` to accept an optional opacity and use the normalized value. Add `ADMIN_REGION_FILL_OPACITY_STORAGE_KEY`, `readAdminRegionFillOpacity`, and `writeAdminRegionFillOpacity` to `navigationPreferences.ts`, reusing the existing guarded local-storage pattern.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the command from Step 2. Expected: both files PASS.

- [ ] **Step 5: Commit the preference contract**

```powershell
git add apps/web/src/layers/adminRegionVectorTileSource.ts apps/web/src/layers/adminRegionVectorTileSource.test.ts apps/web/src/navigationPreferences.ts apps/web/src/navigationPreferences.test.ts
git commit -m "feat: 增加区域填充透明度偏好"
```

### Task 2: Preserve current layer state across rebuilds

**Files:**
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`

- [ ] **Step 1: Write failing level-rebuild tests**

Add one regression test that renders `adminRegionLinesVisible={false}`, emits `load`, rerenders with a different `adminRegionDepth`, and asserts:

```ts
expect(getMockLayerVisibility(mapRecords[0], 'admin-regions-line')).toBe('none')
```

Add a second test that renders `adminRegionFillOpacity={0.42}`, verifies the initial fill layer paint, changes the controlled value to `0.64`, then changes depth and verifies both the in-place paint call and rebuilt layer:

```ts
expect(mapRecords[0].paintProperties).toContainEqual([
  'admin-regions-fill',
  'fill-opacity',
  0.64,
])
expect(mapRecords[0].layers.find(({ id }) => id === 'admin-regions-fill')?.paint)
  .toMatchObject({ 'fill-opacity': 0.64 })
```

- [ ] **Step 2: Run the focused Mapbox test and confirm RED**

```powershell
npm run test:web -- src/components/MapboxCanvas.test.tsx
```

Expected: the line layer becomes visible after depth rebuild and the new opacity prop is unsupported.

- [ ] **Step 3: Make layer creation consume current refs**

Add controlled props and refs:

```ts
adminRegionFillOpacity?: number
onAdminRegionFillOpacityChange?: (opacity: number) => void
footprintStyleControlsVisible?: boolean
```

```ts
const adminRegionLinesVisibleRef = useRef(adminRegionLinesVisible)
const adminRegionFillOpacityRef = useRef(normalizeAdminRegionFillOpacity(adminRegionFillOpacity))
```

Update both refs before any rebuild effect. In `refreshAdminRegionLayers`, create the fill layer with `adminRegionFillOpacityRef.current` and create the line layer with:

```ts
layout: {
  visibility: adminRegionLinesVisibleRef.current ? 'visible' : 'none',
}
```

For controlled opacity changes, call:

```ts
map.setPaintProperty(
  ADMIN_REGION_FILL_LAYER_ID,
  'fill-opacity',
  normalizedOpacity,
)
```

Pass the controlled value and callback to `MapControls` without recreating a source or layer.

- [ ] **Step 4: Run focused Mapbox tests and confirm GREEN**

Run the command from Step 2. Expected: all `MapboxCanvas` tests PASS.

- [ ] **Step 5: Commit layer-state restoration**

```powershell
git add apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "fix: 保持区域图层重建后的显示设置"
```

### Task 3: Context-aware map configuration controls

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/MapControls.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: Write failing control-visibility tests**

Cover these four states using the existing map navigation and settings helpers:

```ts
// Footprints page
expect(within(popover).getByLabelText('足迹点大小')).toBeInTheDocument()
expect(within(popover).queryByRole('switch', { name: '显示区域边界线' }))
  .not.toBeInTheDocument()

// Regions page, footprints disabled
expect(within(popover).queryByLabelText('足迹点大小')).not.toBeInTheDocument()
expect(within(popover).getByLabelText('区域填充透明度')).toBeInTheDocument()
expect(within(popover).getByRole('switch', { name: '显示区域边界线' }))
  .toBeInTheDocument()

// Regions page, footprints enabled in Settings > Map
expect(within(popover).getByLabelText('足迹点大小')).toBeInTheDocument()

// Stats page
expect(within(popover).queryByLabelText('足迹点大小')).not.toBeInTheDocument()
expect(within(popover).queryByLabelText('区域填充透明度')).not.toBeInTheDocument()
```

Also assert the region opacity slider has `min="0.05"`, `max="1"`, `step="0.01"`, starts at `0.18`, persists `0.42`, and the configuration button/dialog use the generic accessible name `地图显示设置`.

- [ ] **Step 2: Run shell and App tests and confirm RED**

```powershell
npm run test:web -- src/components/mapShellLayout.test.tsx src/App.test.tsx
```

Expected: region controls appear on the footprint page, footprint controls appear in irrelevant modes, and the opacity slider is absent.

- [ ] **Step 3: Implement derived visibility and controlled slider**

In `App.tsx`, add controlled state from `readAdminRegionFillOpacity`, persist with `writeAdminRegionFillOpacity`, and derive:

```ts
const footprintStyleControlsVisible = activeSecondaryNavId === 'footprints'
  || (isRegionMode && showFootprintsInRegionMode)
```

Pass that boolean and the opacity state/callback to `MapboxCanvas`.

In `MapControls.tsx`, wrap the footprint size/opacity/color/swatches in `footprintStyleControlsVisible`, show the region opacity slider and boundary switch only when `adminRegionControlsVisible`, and keep projection/style/language/place-label/base-boundary controls unconditional. Normalize slider values before invoking the callback.

- [ ] **Step 4: Run shell and App tests and confirm GREEN**

Run the command from Step 2. Expected: both files PASS in all four page states.

- [ ] **Step 5: Commit context-aware controls**

```powershell
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/MapControls.tsx apps/web/src/components/mapShellLayout.test.tsx
git commit -m "feat: 按地图页面展示相关显示设置"
```

### Task 4: Minimal visited-thumbnail seam guard

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Verify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`

- [ ] **Step 1: Write a failing CSS regression test**

Extend the CSS-rule assertions:

```ts
expect(cssRule('.admin-region-atlas-card__visited')).toContain('fill: #2c8572')
expect(cssRule('.admin-region-atlas-card__visited')).toContain('stroke: #2c8572')
expect(cssRule('.admin-region-atlas-card__visited')).toContain('stroke-width: 0.6')
expect(cssRule('.admin-region-atlas-card__visited')).toContain('stroke-linecap: round')
expect(cssRule('.admin-region-atlas-card__visited')).toContain('stroke-linejoin: round')
expect(cssRule('.admin-region-atlas-card__visited')).toContain('paint-order: stroke fill')
```

Assert the base path rule does not receive a stroke declaration.

- [ ] **Step 2: Run the focused layout test and confirm RED**

```powershell
npm run test:web -- src/components/mapLayout.test.ts src/components/AdminRegionContextPanel.test.tsx
```

Expected: FAIL because the visited path has fill only.

- [ ] **Step 3: Add the exact minimal seam guard**

```css
.admin-region-atlas-card__visited {
  fill: #2c8572;
  stroke: #2c8572;
  stroke-width: 0.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  paint-order: stroke fill;
}
```

Do not alter `basePath`, SVG geometry, API responses, or precomputed tables.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the command from Step 2. Expected: both files PASS.

- [ ] **Step 5: Commit the seam fix**

```powershell
git add apps/web/src/App.css apps/web/src/components/mapLayout.test.ts
git commit -m "fix: 消除区域缩略图填充细缝"
```

### Task 5: Full verification and local handoff

**Files:**
- Verify only: repository test, lint, build, and runtime behavior

- [ ] **Step 1: Prove no persistent map data changed**

Run read-only row-count and content-hash checks for `visual_tiles` and `admin_region_tiles` against the copied baseline. Expected: unchanged.

- [ ] **Step 2: Run the complete verification suite**

```powershell
npm test
npm run lint
npm run build
```

Expected: all commands exit `0` without warnings introduced by this branch.

- [ ] **Step 3: Run browser acceptance**

At desktop and mobile widths, verify: country/province/city/district thumbnails have no visible highlight seams; boundary lines remain hidden through all level changes; the opacity slider updates fill only; footprint and region controls follow the four specified contexts; the console has no new Mapbox errors.

- [ ] **Step 4: Review branch scope**

```powershell
git status --short
git diff master...HEAD --stat
git log --oneline master..HEAD
```

Expected: only the design/plan and focused frontend files are changed; no ignored database, environment, build, screenshot, or log files are staged.
