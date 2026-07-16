# Map Visible Viewport Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every footprint, administrative-region, and current-location focus action keep its target inside the unobscured center map viewport with a uniform 64px breathing margin.

**Architecture:** Add a focused geometry module that measures the full-screen map and its actual left/right overlay rectangles at action time, then returns Mapbox edge padding. `MapboxCanvas` owns two small shared camera callbacks—one for bounds and one for points—and routes the existing focus consumers through them without changing the full-screen map DOM or world-view camera behavior.

**Tech Stack:** React 19, TypeScript 6, Mapbox GL JS 3.25, Vitest 4, Testing Library, Playwright browser verification

---

## File map

- Create `apps/web/src/config/mapFocusViewport.ts`: pure rectangle validation/clipping plus DOM measurement for visible-map edge padding.
- Create `apps/web/src/config/mapFocusViewport.test.ts`: focused unit tests for symmetric, asymmetric, hidden, invalid, and clipped overlays.
- Modify `apps/web/src/components/MapboxCanvas.tsx`: replace direct focus camera calls with shared visible-viewport callbacks.
- Modify `apps/web/src/components/MapboxCanvas.test.tsx`: provide deterministic overlay geometry and verify bounds/point focus consumers.
- Keep `README.md`, CSS, API code, SQLite code, and world-view camera behavior unchanged.

### Task 1: Calculate visible-map padding from real overlay geometry

**Files:**
- Create: `apps/web/src/config/mapFocusViewport.test.ts`
- Create: `apps/web/src/config/mapFocusViewport.ts`

- [ ] **Step 1: Write the failing geometry tests**

Create `apps/web/src/config/mapFocusViewport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  calculateMapFocusPadding,
  DEFAULT_MAP_FOCUS_MARGIN_PX,
} from './mapFocusViewport'

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom }
}

describe('map focus viewport padding', () => {
  it('adds the same 64px margin outside symmetric overlay panels', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(20, 16, 320, 884),
      rightPanelRect: rect(1120, 16, 1420, 884),
    })).toEqual({ top: 64, right: 384, bottom: 64, left: 384 })
  })

  it('measures asymmetric overlays independently', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(100, 50, 1700, 950),
      leftPanelRect: rect(120, 70, 420, 930),
      rightPanelRect: rect(1480, 70, 1680, 930),
    })).toEqual({ top: 64, right: 284, bottom: 64, left: 384 })
  })

  it('falls back to the safe margin for hidden, outside, or invalid overlays', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(20, 16, 20, 884),
      rightPanelRect: rect(Number.NaN, 16, 1420, 884),
    })).toEqual({ top: 64, right: 64, bottom: 64, left: 64 })

    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(-500, 16, -100, 884),
      rightPanelRect: rect(1540, 16, 1740, 884),
    })).toEqual({ top: 64, right: 64, bottom: 64, left: 64 })
  })

  it('clips partially outside panels to the map rectangle', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(-100, -20, 250, 920),
      rightPanelRect: rect(1300, -20, 1500, 920),
    })).toEqual({ top: 64, right: 204, bottom: 64, left: 314 })
  })

  it('uses a uniform safe margin when the map rectangle is invalid', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 0, 900),
      leftPanelRect: rect(20, 16, 320, 884),
      rightPanelRect: rect(1120, 16, 1420, 884),
    })).toEqual({
      top: DEFAULT_MAP_FOCUS_MARGIN_PX,
      right: DEFAULT_MAP_FOCUS_MARGIN_PX,
      bottom: DEFAULT_MAP_FOCUS_MARGIN_PX,
      left: DEFAULT_MAP_FOCUS_MARGIN_PX,
    })
  })
})
```

- [ ] **Step 2: Run the geometry test and verify RED**

Run:

```powershell
node scripts/run-web-tests.mjs src/config/mapFocusViewport.test.ts
```

Expected: FAIL because `./mapFocusViewport` does not exist.

- [ ] **Step 3: Implement the geometry and DOM measurement module**

Create `apps/web/src/config/mapFocusViewport.ts`:

```ts
export const DEFAULT_MAP_FOCUS_MARGIN_PX = 64

export type MapFocusRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type MapFocusPadding = {
  top: number
  right: number
  bottom: number
  left: number
}

type MapFocusPaddingOptions = {
  mapRect: MapFocusRect
  leftPanelRect?: MapFocusRect | null
  rightPanelRect?: MapFocusRect | null
  safeMargin?: number
}

function isValidRect(rect: MapFocusRect | null | undefined): rect is MapFocusRect {
  return Boolean(
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    rect.right > rect.left &&
    rect.bottom > rect.top,
  )
}

function overlapsMap(mapRect: MapFocusRect, panelRect: MapFocusRect) {
  return (
    Math.min(mapRect.right, panelRect.right) > Math.max(mapRect.left, panelRect.left) &&
    Math.min(mapRect.bottom, panelRect.bottom) > Math.max(mapRect.top, panelRect.top)
  )
}

function normalizeSafeMargin(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : DEFAULT_MAP_FOCUS_MARGIN_PX
}

function uniformPadding(value: number): MapFocusPadding {
  return { top: value, right: value, bottom: value, left: value }
}

export function calculateMapFocusPadding({
  mapRect,
  leftPanelRect,
  rightPanelRect,
  safeMargin,
}: MapFocusPaddingOptions): MapFocusPadding {
  const margin = normalizeSafeMargin(safeMargin)
  if (!isValidRect(mapRect)) return uniformPadding(margin)

  const leftOcclusion = isValidRect(leftPanelRect) && overlapsMap(mapRect, leftPanelRect)
    ? Math.min(Math.max(leftPanelRect.right, mapRect.left), mapRect.right) - mapRect.left
    : 0
  const rightOcclusion = isValidRect(rightPanelRect) && overlapsMap(mapRect, rightPanelRect)
    ? mapRect.right - Math.max(Math.min(rightPanelRect.left, mapRect.right), mapRect.left)
    : 0

  return {
    top: margin,
    right: rightOcclusion + margin,
    bottom: margin,
    left: leftOcclusion + margin,
  }
}

export function measureMapFocusPadding(
  mapNode: HTMLElement,
  safeMargin = DEFAULT_MAP_FOCUS_MARGIN_PX,
): MapFocusPadding {
  const shell = mapNode.closest('.app-shell')
  const leftPanel = shell?.querySelector<HTMLElement>('.time-context-panel')
  const rightPanel = shell?.querySelector<HTMLElement>('.right-context-panel')

  return calculateMapFocusPadding({
    mapRect: mapNode.getBoundingClientRect(),
    leftPanelRect: leftPanel?.getBoundingClientRect(),
    rightPanelRect: rightPanel?.getBoundingClientRect(),
    safeMargin,
  })
}
```

- [ ] **Step 4: Run the geometry test and verify GREEN**

Run:

```powershell
node scripts/run-web-tests.mjs src/config/mapFocusViewport.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the geometry helper**

```powershell
git add apps/web/src/config/mapFocusViewport.ts apps/web/src/config/mapFocusViewport.test.ts
git commit -m "fix: 计算地图可见视口聚焦边距"
```

### Task 2: Route footprint and administrative bounds through one focus callback

**Files:**
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx:47-71,1066-1096,1522-1556`
- Modify: `apps/web/src/components/MapboxCanvas.tsx:36-43,192-195,569-602,1057-1075,1249-1261`

- [ ] **Step 1: Add deterministic DOM rectangle helpers to the component test**

Add below the time-range fixtures in `MapboxCanvas.test.tsx`:

```ts
function domRect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }
}

function renderMapFocusShell(children: ReactNode) {
  return render(
    <main className="app-shell">
      <aside className="time-context-panel" />
      <aside className="right-context-panel" />
      {children}
    </main>,
  )
}

function mockMapFocusShellRects(container: HTMLElement) {
  const mapNode = container.querySelector<HTMLElement>('.mapbox-surface')
  const leftPanel = container.querySelector<HTMLElement>('.time-context-panel')
  const rightPanel = container.querySelector<HTMLElement>('.right-context-panel')
  if (!mapNode || !leftPanel || !rightPanel) throw new Error('map focus shell is incomplete')

  vi.spyOn(mapNode, 'getBoundingClientRect').mockReturnValue(domRect(0, 0, 1440, 900))
  vi.spyOn(leftPanel, 'getBoundingClientRect').mockReturnValue(domRect(20, 16, 320, 884))
  vi.spyOn(rightPanel, 'getBoundingClientRect').mockReturnValue(domRect(1120, 16, 1420, 884))
}
```

Add this import at the top of the test file:

```ts
import type { ReactNode } from 'react'
```

- [ ] **Step 2: Change the admin-region and footprint tests to expect dynamic padding**

In both existing tests, replace `render(...)` with `const { container } = renderMapFocusShell(...)`, call `mockMapFocusShellRects(container)` before emitting `load`, and change the assertions to:

```ts
expect(mapRecords[0].fitBoundsCalls).toContainEqual([
  [[121.4, 31.1], [121.8, 31.4]],
  {
    padding: { top: 64, right: 384, bottom: 64, left: 384 },
    duration: 600,
  },
])
```

and:

```ts
expect(mapRecords[0].fitBoundsCalls).toEqual([
  [
    [[118, 30], [121.5, 31.3]],
    {
      duration: 900,
      padding: { top: 64, right: 384, bottom: 64, left: 384 },
    },
  ],
])
```

- [ ] **Step 3: Run the two focused tests and verify RED**

Run:

```powershell
node scripts/run-web-tests.mjs src/components/MapboxCanvas.test.tsx -t "highlights the selected admin region and fits its bounds|fits the map to selected footprint bounds"
```

Expected: both tests FAIL because production still sends numeric padding `72` and `96`.

- [ ] **Step 4: Add the shared bounds focus callback**

In `MapboxCanvas.tsx`, import the measurement helper:

```ts
import { measureMapFocusPadding } from '../config/mapFocusViewport'
```

Remove `MAP_FIT_BOUNDS_PADDING_PX` and `ADMIN_REGION_SELECTION_FIT_BOUNDS_PADDING_PX`. Add the following callback after `stopGlobeRotation` is declared and before effects that consume it:

```ts
type MapFocusBounds = [[number, number], [number, number]]

const fitBoundsInVisibleViewport = useCallback((
  bounds: MapFocusBounds,
  duration: number,
) => {
  const map = mapRef.current
  const mapNode = mapNodeRef.current
  if (!map || !mapNode) return

  map.fitBounds(bounds, {
    padding: measureMapFocusPadding(mapNode),
    duration,
  })
}, [])
```

Replace the administrative-region call with:

```ts
if (selectedAdminRegion) {
  const { west, south, east, north } = selectedAdminRegion.bounds
  fitBoundsInVisibleViewport(
    [[west, south], [east, north]],
    ADMIN_REGION_SELECTION_FIT_BOUNDS_DURATION_MS,
  )
}
```

Add `fitBoundsInVisibleViewport` to that effect's dependency array. Replace the footprint call with:

```ts
stopGlobeRotation()
fitBoundsInVisibleViewport(
  [bounds.southWest, bounds.northEast],
  MAP_FIT_BOUNDS_DURATION_MS,
)
```

Add `fitBoundsInVisibleViewport` to `fitDisplayedFootprints` dependencies.

- [ ] **Step 5: Run the two focused tests and verify GREEN**

Run the same command from Step 3.

Expected: both tests PASS and both camera calls contain identical measured padding.

- [ ] **Step 6: Commit the shared range focus behavior**

```powershell
git add apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "fix: 让地图范围聚焦避开左右面板"
```

### Task 3: Route current-location point focus through the same visible viewport

**Files:**
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx:1522-1556`
- Modify: `apps/web/src/components/MapboxCanvas.tsx:569-602,1263-1273`

- [ ] **Step 1: Write the failing current-location focus test**

Add alongside the other toolbar focus tests in `MapboxCanvas.test.tsx`:

```ts
it('keeps the located point inside the visible viewport without retaining camera padding', async () => {
  const { mapRecords } = mockMapboxRuntime()
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({
      coords: {
        latitude: 31.23,
        longitude: 121.47,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: 0,
    })
  })
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: { getCurrentPosition },
  })
  const { MapboxCanvas } = await import('./MapboxCanvas')

  const { container } = renderMapFocusShell(
    <MapboxCanvas
      accessToken="test-mapbox-token"
      timeRange={selectedRange}
    />,
  )
  mockMapFocusShellRects(container)

  fireEvent.click(screen.getByRole('button', { name: '定位当前位置' }))

  expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  expect(mapRecords[0].flyToCalls).toEqual([{
    center: [121.47, 31.23],
    zoom: 14,
    padding: { top: 64, right: 384, bottom: 64, left: 384 },
    retainPadding: false,
  }])
})
```

- [ ] **Step 2: Run the current-location test and verify RED**

Run:

```powershell
node scripts/run-web-tests.mjs src/components/MapboxCanvas.test.tsx -t "keeps the located point inside the visible viewport"
```

Expected: FAIL because the existing `flyTo` call has only `center` and `zoom`.

- [ ] **Step 3: Add the shared point focus callback and use it for geolocation**

Add this type near `MapFocusBounds`:

```ts
type MapPointFocusOptions = {
  center: [number, number]
  zoom: number
  duration?: number
}
```

Add this callback beside `fitBoundsInVisibleViewport`:

```ts
const flyToPointInVisibleViewport = useCallback(({
  center,
  zoom,
  duration,
}: MapPointFocusOptions) => {
  const map = mapRef.current
  const mapNode = mapNodeRef.current
  if (!map || !mapNode) return

  map.flyTo({
    center,
    zoom,
    ...(duration === undefined ? {} : { duration }),
    padding: measureMapFocusPadding(mapNode),
    retainPadding: false,
  })
}, [])
```

Replace the current-location `mapRef.current?.flyTo(...)` call with:

```ts
flyToPointInVisibleViewport({
  center: [position.coords.longitude, position.coords.latitude],
  zoom: 14,
})
```

Add `flyToPointInVisibleViewport` to `locate` dependencies.

- [ ] **Step 4: Run the current-location test and verify GREEN**

Run the same command from Step 2.

Expected: PASS with measured padding and `retainPadding: false`.

- [ ] **Step 5: Run all geometry and Mapbox canvas tests**

```powershell
node scripts/run-web-tests.mjs src/config/mapFocusViewport.test.ts src/components/MapboxCanvas.test.tsx
```

Expected: all tests in both files PASS.

- [ ] **Step 6: Commit point focus behavior**

```powershell
git add apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "fix: 让当前位置聚焦使用可见视口"
```

### Task 4: Verify repository checks and desktop browser behavior

**Files:**
- Verify only: `apps/web/src/config/mapFocusViewport.ts`
- Verify only: `apps/web/src/components/MapboxCanvas.tsx`
- Local ignored data/output only: `data/footprints.sqlite`, `output/`

- [ ] **Step 1: Run the required automated checks**

```powershell
npm test
npm run test:api
npm run test:repo
npm run lint
npm run build
```

Expected:

- All new geometry and Mapbox tests PASS.
- `npm run test:api`, `npm run test:repo`, lint, and build PASS.
- If `npm test` still stops only at the pre-existing `AccountingPage.integration.test.tsx` “requests the latest imported month once when the untouched current month is empty” failure, record it verbatim as the known baseline failure; do not modify accounting code or tests.
- Any additional failure is new evidence and must be investigated before continuing.

- [ ] **Step 2: Prepare safe local runtime data without rebuilding visual tiles**

First check whether the worktree already has data:

```powershell
Test-Path -LiteralPath data/footprints.sqlite
```

If it returns `False`, copy the known-good ignored baseline without modifying the source database:

```powershell
New-Item -ItemType Directory -Force data | Out-Null
Copy-Item -LiteralPath D:\Coding\EnRoute\data\footprints.sqlite -Destination data\footprints.sqlite
```

Do not run `prepare:footprint-tiles`, do not rebuild SQLite, and do not execute any `DELETE FROM visual_tiles` path.

- [ ] **Step 3: Copy ignored local configuration and start isolated worktree services**

If the worktree does not yet contain `.env.local`, copy the ignored local configuration without printing its contents:

```powershell
if (-not (Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath D:\Coding\EnRoute\.env.local -Destination .env.local
}
```

Use fixed alternate ports and an isolated runtime directory so the worktree cannot collide with another EnRoute process:

```powershell
python start.py status --frontend-port 5183 --api-port 5188 --runtime-dir output/start-manager-focus
python start.py start --frontend-port 5183 --api-port 5188 --runtime-dir output/start-manager-focus
python start.py status --frontend-port 5183 --api-port 5188 --runtime-dir output/start-manager-focus
```

Expected: API `5188` and frontend `5183` report worktree-owned running PIDs. If either alternate port is already occupied, stop here and inspect the listener PID and command line before choosing another verified-free pair; never terminate an unrelated listener.

- [ ] **Step 4: Perform desktop browser acceptance**

Use the `playwright` skill against `http://127.0.0.1:5183` with a 1440×900 desktop viewport. Verify:

1. Click “聚焦当前足迹”; the full selected footprint bounds remain between the two panels with approximately 64px inner clearance.
2. Open the administrative-region view and select a ranking row; the complete region bounds remain in the same visible center viewport with approximately 64px clearance.
3. Stub or grant a deterministic browser geolocation, click “定位当前位置”, and confirm the location is centered in the unobscured viewport rather than beneath either panel.
4. Resize to a second desktop width and repeat one bounds focus action to prove geometry is measured at action time.
5. Confirm the map still fills the page, the shared left panel and right panel did not move, the toolbar remains usable, and the console has no new Mapbox runtime errors.
6. Save any screenshots only under ignored `output/`; do not commit them.

- [ ] **Step 5: Stop temporary worktree services and inspect the final diff**

```powershell
python start.py stop --frontend-port 5183 --api-port 5188 --runtime-dir output/start-manager-focus
git status --short --ignored
git diff master...HEAD --check
git diff master...HEAD --stat
```

Expected: no temporary listener remains, only intended committed source/test/docs changes appear, and ignored runtime data/output stays untracked.

- [ ] **Step 6: Commit any verification-only correction, if one was required**

Only if browser verification exposed a defect and a new RED/GREEN cycle fixed it:

```powershell
git add apps/web/src/config/mapFocusViewport.ts apps/web/src/config/mapFocusViewport.test.ts apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "fix: 校正地图可见视口聚焦行为"
```

If no correction was required, do not create an empty commit.
