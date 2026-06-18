# Unified Shell Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved A shell: global centered capsule navigation, shared dynamic time panel, and single-world-width main work area for map and accounting pages.

**Architecture:** Keep the existing map-measured panel width as the authoritative runtime width, and add a deterministic fallback for non-map pages. Move the left panel from an empty map-only placeholder into a shared `TimeContextPanel`, while wrapping accounting in the same right-side main pane geometry. Preserve current map behavior and the accounting MVP data model.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, CSS.

---

### Task 1: Add Shared Shell Width Fallback

**Files:**
- Modify: `src/config/mapPaneLayout.ts`
- Test: `src/config/mapPaneLayout.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `describe('single-world map pane layout', ...)` in `src/config/mapPaneLayout.test.ts`:

```ts
it('calculates a deterministic fallback layout for non-map detail pages', () => {
  expect(
    calculateFallbackSingleWorldPaneLayout({
      viewportWidth: 1440,
      viewportHeight: 800,
    }),
  ).toEqual({
    mapPaneWidth: 1024,
    sidePanelWidth: 416,
  })
})
```

Update the import list in the same file:

```ts
import {
  calculateFallbackSingleWorldPaneLayout,
  calculateSingleWorldMapPaneLayout,
  calculateWorldPixelWidthAtZoom,
  measureAmapWorldPixelWidthAtZoom,
} from './mapPaneLayout'
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- src/config/mapPaneLayout.test.ts --run
```

Expected: FAIL because `calculateFallbackSingleWorldPaneLayout` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/config/mapPaneLayout.ts`, import the minimum zoom helper and add the fallback function:

```ts
import { calculateMinimumZoomForWorldCoverage, TILE_SIZE } from './mercator'
```

```ts
type FallbackSingleWorldPaneLayoutOptions = {
  viewportWidth: number
  viewportHeight: number
}

export function calculateFallbackSingleWorldPaneLayout({
  viewportWidth,
  viewportHeight,
}: FallbackSingleWorldPaneLayoutOptions) {
  return calculateSingleWorldMapPaneLayout({
    viewportWidth,
    worldWidthPx: calculateWorldPixelWidthAtZoom(
      calculateMinimumZoomForWorldCoverage(viewportHeight),
    ),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- src/config/mapPaneLayout.test.ts --run
```

Expected: PASS for all tests in `mapPaneLayout.test.ts`.

- [ ] **Step 5: Commit**

```powershell
git add src/config/mapPaneLayout.ts src/config/mapPaneLayout.test.ts
git commit -m "feat: 增加统一壳宽度回退计算"
```

### Task 2: Add Shared Time Panel and Shell Behavior Tests

**Files:**
- Create: `src/components/TimeContextPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/components/mapShellLayout.test.tsx`
- Modify: `src/App.test.tsx`
- Test: `src/components/mapShellLayout.test.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing shell tests**

Replace `src/components/mapShellLayout.test.tsx` with:

```tsx
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import App from '../App'

afterEach(() => {
  cleanup()
})

const configuredAmap = {
  key: 'test-key',
  securityJsCode: 'test-security-code',
  isConfigured: true,
  missingKeys: [],
  defaultCenter: [104.195397, 35.86166] as [number, number],
  defaultZoom: 5.1,
  defaultBounds: {
    southWest: [73.3, 17.8] as [number, number],
    northEast: [135.1, 53.7] as [number, number],
  },
  renderBounds: {
    southWest: [-180, -85.05112878] as [number, number],
    northEast: [180, 85.05112878] as [number, number],
  },
  themes: [{ id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' }],
  features: ['bg', 'road', 'building'] as Array<'bg' | 'road' | 'building'>,
  showLabel: false,
}

describe('unified shell layout', () => {
  it('renders a shared time panel beside the map workspace', () => {
    render(<App amapConfig={configuredAmap} />)

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '6月18日' })).toBeInTheDocument()
    expect(screen.getByText('位置 3')).toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 地图工作区')).toBeInTheDocument()
  })

  it('keeps the shared time panel when switching to accounting', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByText('支出 ¥51')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--accounting')
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Add App behavior assertions**

In `src/App.test.tsx`, update the existing navigation test so that after switching to accounting it also asserts:

```tsx
expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
npm test -- src/components/mapShellLayout.test.tsx src/App.test.tsx --run
```

Expected: FAIL because the time panel and main workspace label do not exist yet.

- [ ] **Step 4: Create `TimeContextPanel`**

Create `src/components/TimeContextPanel.tsx`:

```tsx
import type { AppView } from '../App'

const panelSummaries: Record<AppView, Array<{ label: string; value: string }>> = {
  overview: [
    { label: '今日', value: '概览' },
    { label: '本月', value: '趋势' },
    { label: '全部人生', value: '导入后' },
  ],
  map: [
    { label: '今天', value: '位置 3' },
    { label: '本月', value: '足迹 42' },
    { label: '大学阶段', value: '1,284 天' },
  ],
  schedule: [
    { label: '今天', value: '日程 2' },
    { label: '本周', value: '待办 6' },
    { label: '人生事件', value: '待整理' },
  ],
  accounting: [
    { label: '今天', value: '支出 ¥51' },
    { label: '本月', value: '支出 ¥182' },
    { label: '青岛之行', value: '4 笔' },
  ],
}

export function TimeContextPanel({ view }: { view: AppView }) {
  return (
    <aside className="time-context-panel" aria-label="时间范围面板">
      <div className="time-context-panel__scroll">
        <header className="time-context-panel__head">
          <div>
            <span>当前时间范围</span>
            <h2>6月18日</h2>
          </div>
          <button type="button">今天</button>
        </header>

        <div className="mini-calendar" aria-label="六月日期">
          {['一', '二', '三', '四', '五', '六', '日', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23'].map(
            (item) => (
              <span key={item} className={item === '18' ? 'is-today' : undefined}>
                {item}
              </span>
            ),
          )}
        </div>

        <div className="time-scope-list">
          {panelSummaries[view].map((item, index) => (
            <button
              type="button"
              key={item.label}
              className={index === 0 ? 'is-active' : undefined}
            >
              <span>{item.label}</span>
              <b>{item.value}</b>
            </button>
          ))}
        </div>

        <div className="time-life-line">
          <article>
            <strong>青岛之行</strong>
            <span>位置 18 · 记账 4 · 日程 2</span>
          </article>
          <article>
            <strong>待导入</strong>
            <span>位置数据仍以导入为主</span>
          </article>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 5: Export `AppView` and wire the shell**

In `src/App.tsx`:

1. Export the view type and include planned tabs:

```ts
export type AppView = 'overview' | 'map' | 'schedule' | 'accounting'
```

2. Import `calculateFallbackSingleWorldPaneLayout` and `TimeContextPanel`.
3. Add a viewport-size state and resize effect for non-map fallback width.
4. Compute `sharedPanelWidth` as map-measured width when available, otherwise fallback width.
5. Render `TimeContextPanel` for every view.
6. Wrap non-map content in:

```tsx
<section className="main-workspace" aria-label="在途 EnRoute 主工作区">
  <AccountingPage />
</section>
```

7. Add disabled placeholder buttons for `概览` and `日程` in the capsule so the nav shape reflects the approved architecture without implementing those pages.

- [ ] **Step 6: Update CSS for unified shell**

In `src/App.css`, replace the old `.data-panel` styles with `.time-context-panel` styles, keep `.map-stage` using `--data-panel-width`, and make `.main-workspace` use the same right pane geometry:

```css
.app-shell {
  position: relative;
  height: 100svh;
  width: 100vw;
  overflow: hidden;
  background: #eef1f0;
}

.time-context-panel {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 1;
  width: var(--data-panel-width, 0px);
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid rgba(23, 31, 29, 0.08);
  background: rgba(247, 250, 249, 0.9);
  backdrop-filter: blur(18px) saturate(1.08);
}

.app-shell:not(.has-data-panel) .time-context-panel {
  display: none;
}

.main-workspace {
  position: absolute;
  inset: 0 0 0 var(--data-panel-width);
  width: calc(100vw - var(--data-panel-width));
  min-width: 0;
  height: 100svh;
  overflow: hidden;
}
```

Move accounting scrolling from body/page level to local panels by making `.accounting-page` fill `.main-workspace`, and make `.accounting-workspace` a fixed-height grid with internal panel overflow.

- [ ] **Step 7: Run tests to verify they pass**

Run:

```powershell
npm test -- src/components/mapShellLayout.test.tsx src/App.test.tsx --run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/App.tsx src/App.css src/components/TimeContextPanel.tsx src/components/mapShellLayout.test.tsx src/App.test.tsx
git commit -m "feat: 接入统一页面壳"
```

### Task 3: Update Layout Source Tests and Full Verification

**Files:**
- Modify: `src/components/mapLayout.test.ts`
- Test: `src/components/mapLayout.test.ts`

- [ ] **Step 1: Update source-level layout expectations**

In `src/components/mapLayout.test.ts`, update the panel test to assert `.time-context-panel` and `.main-workspace` instead of `.data-panel`:

```ts
const panelRule = cssRule('.time-context-panel')
const workspaceRule = cssRule('.main-workspace')
const stageRule = cssRule('.map-stage')

expect(panelRule).toContain('width: var(--data-panel-width, 0px)')
expect(panelRule).toContain('overflow: hidden')
expect(cssRule('.app-shell:not(.has-data-panel) .time-context-panel')).toContain('display: none')
expect(workspaceRule).toContain('inset: 0 0 0 var(--data-panel-width)')
expect(workspaceRule).toContain('width: calc(100vw - var(--data-panel-width))')
expect(stageRule).toContain('inset: 0 0 0 var(--data-panel-width)')
expect(stageRule).toContain('width: calc(100vw - var(--data-panel-width))')
```

- [ ] **Step 2: Run targeted source test**

Run:

```powershell
npm test -- src/components/mapLayout.test.ts --run
```

Expected: PASS.

- [ ] **Step 3: Run required verification**

Run:

```powershell
npm test -- --run
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Browser verify on a non-5173 port**

Start the dev server on port 5177:

```powershell
npm run dev -- --host 127.0.0.1 --port 5177
```

Open `http://127.0.0.1:5177`, verify:

- Map page renders or shows the existing missing-key state without runtime crash.
- Top capsule remains centered over the full viewport.
- Shared time panel appears on desktop and disappears on narrow viewport.
- Accounting page is inside the same right-side main workspace.
- Body does not scroll; local accounting areas can scroll if content overflows.
- Console has no app runtime errors.

- [ ] **Step 5: Commit test/source cleanup**

If Step 1 changed files after Task 2, commit:

```powershell
git add src/components/mapLayout.test.ts
git commit -m "test: 覆盖统一页面壳布局"
```

If Step 1 had already been included in Task 2, skip this commit.
