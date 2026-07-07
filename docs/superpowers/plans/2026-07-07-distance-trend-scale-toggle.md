# Distance Trend Scale Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small button to the map time-panel distance chart that manually toggles bar and average-line positioning between linear and logarithmic scales.

**Architecture:** Keep the scale choice as local `TimeContextPanel` UI state. The existing distance aggregation, average calculation, hover labels, and metric formatting remain real-value based; only rendered bar heights and average-line position use the selected scale. CSS changes stay beside the existing `.time-context-trend` rules.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Add Failing Tests For Scale Toggle

**Files:**
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`

- [ ] **Step 1: Add a test that expects a scale button and logarithmic heights**

Add a test near the existing distance trend tests:

```tsx
it('toggles the distance chart between linear and logarithmic scales without changing real labels', () => {
  const longTailSeries: FootprintDistanceSeries = {
    granularity: 'day',
    unit: 'day',
    buckets: [
      { key: '2026-06-18', label: '6月18日', distanceMeters: 0 },
      { key: '2026-06-19', label: '6月19日', distanceMeters: 1000 },
      { key: '2026-06-20', label: '6月20日', distanceMeters: 100000 },
    ],
  }
  const { container } = render(
    <TimeContextPanel
      view="map"
      selection={selectWeek('2026-06-19')}
      distanceSeries={longTailSeries}
      onSelectionChange={vi.fn()}
    />,
  )
  const bars = Array.from(container.querySelectorAll<HTMLElement>('.time-context-trend__bar'))
  const chart = container.querySelector<HTMLElement>('.time-context-trend__chart')
  const scaleButton = screen.getByRole('button', { name: '距离图表尺度：线性，点击切换到对数' })

  expect(bars.map((bar) => bar.style.getPropertyValue('--trend-height'))).toEqual([
    '0%',
    '1%',
    '100%',
  ])
  expect(chart?.style.getPropertyValue('--trend-average-position')).toBe('33.666666666666664%')

  fireEvent.click(scaleButton)

  expect(screen.getByRole('button', { name: '距离图表尺度：对数，点击切换到线性' })).toBeInTheDocument()
  expect(bars[0]?.style.getPropertyValue('--trend-height')).toBe('0%')
  expect(parseFloat(bars[1]?.style.getPropertyValue('--trend-height') ?? '')).toBeCloseTo(15.019, 3)
  expect(bars[2]?.style.getPropertyValue('--trend-height')).toBe('100%')
  expect(parseFloat(chart?.style.getPropertyValue('--trend-average-position') ?? '')).toBeCloseTo(76.83, 2)

  fireEvent.pointerEnter(container.querySelectorAll('.time-context-trend__column')[1])

  expect(screen.getByText('6月19日 · 1 km')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '距离图表尺度：对数，点击切换到线性' }))

  expect(screen.getByRole('button', { name: '距离图表尺度：线性，点击切换到对数' })).toBeInTheDocument()
  expect(bars.map((bar) => bar.style.getPropertyValue('--trend-height'))).toEqual([
    '0%',
    '1%',
    '100%',
  ])
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run apps/web/src/components/TimeContextPanel.test.tsx --maxWorkers=1
```

Expected: FAIL because the scale button does not exist.

### Task 2: Implement Scale Model And Button

**Files:**
- Modify: `apps/web/src/components/TimeContextPanel.tsx`

- [ ] **Step 1: Add scale type and component state**

Add:

```ts
type DistanceTrendScale = 'linear' | 'log'
```

Inside `TimeContextPanel`, add:

```ts
const [distanceTrendScale, setDistanceTrendScale] = useState<DistanceTrendScale>('linear')
```

Change:

```ts
const distanceTrend = getDistanceTrendModel(distanceSeries)
```

to:

```ts
const distanceTrend = getDistanceTrendModel(distanceSeries, distanceTrendScale)
```

- [ ] **Step 2: Render the scale toggle button in the trend head**

Replace the current head title span with a grouped title and button:

```tsx
<div className="time-context-trend__title">
  <span>{distanceTrend.title}</span>
  <button
    className="time-context-trend__scale-button"
    type="button"
    aria-label={`距离图表尺度：${distanceTrend.scaleLabel}，点击切换到${distanceTrend.nextScaleLabel}`}
    onClick={() => setDistanceTrendScale(distanceTrend.nextScale)}
  >
    {distanceTrend.scaleLabel}
  </button>
</div>
```

Keep the existing `<small>` summary on the right.

- [ ] **Step 3: Route scale through the trend model**

Change the model signature:

```ts
function getDistanceTrendModel(
  distanceSeries?: FootprintDistanceSeries,
  scale: DistanceTrendScale = 'linear',
) {
```

Inside it, compute scaled values:

```ts
const rawValues = buckets.map((bucket) => Math.max(bucket.distanceMeters, 0))
const maxValue = Math.max(...rawValues, 1)
const maxScaledValue = getDistanceTrendScaledValue(maxValue, scale)
const average = getDistanceTrendAverage(buckets, distanceSeries?.granularity)
const averageValue = average.value
const averagePosition = getDistanceTrendPosition(averageValue, maxScaledValue, scale)
const nextScale: DistanceTrendScale = scale === 'linear' ? 'log' : 'linear'
```

Return scale labels and pass scale data to bucket creation:

```ts
scale,
nextScale,
scaleLabel: scale === 'linear' ? '线性' : '对数',
nextScaleLabel: nextScale === 'linear' ? '线性' : '对数',
values: buckets.map((bucket, index) => createDistanceTrendValue(bucket, index, maxScaledValue, scale)),
```

- [ ] **Step 4: Add scale helpers**

Add below `formatLocalDateKey`:

```ts
function getDistanceTrendScaledValue(value: number, scale: DistanceTrendScale) {
  const safeValue = Math.max(value, 0)

  if (!Number.isFinite(safeValue) || safeValue <= 0) return 0
  if (scale === 'log') return Math.log1p(safeValue / 1000)

  return safeValue
}

function getDistanceTrendPosition(
  value: number,
  maxScaledValue: number,
  scale: DistanceTrendScale,
) {
  if (!Number.isFinite(maxScaledValue) || maxScaledValue <= 0) return '0%'

  const scaledValue = getDistanceTrendScaledValue(value, scale)

  return `${Math.min(Math.max((scaledValue / maxScaledValue) * 100, 0), 100)}%`
}
```

- [ ] **Step 5: Update bucket height calculation**

Change `createDistanceTrendValue` signature:

```ts
function createDistanceTrendValue(
  bucket: FootprintDistanceBucket,
  index: number,
  maxScaledValue: number,
  scale: DistanceTrendScale,
) {
```

Change the returned height:

```ts
height: getDistanceTrendPosition(distanceMeters, maxScaledValue, scale),
```

- [ ] **Step 6: Run the focused test and verify it passes or exposes style-only gaps**

Run:

```powershell
npx vitest run apps/web/src/components/TimeContextPanel.test.tsx --maxWorkers=1
```

Expected: PASS for behavior, unless selectors require CSS class adjustment in Task 3.

### Task 3: Style The Scale Button

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`

- [ ] **Step 1: Add a CSS contract test for the button class**

In `TimeContextPanel.test.tsx`, extend the scale toggle test with:

```tsx
expect(scaleButton).toHaveClass('time-context-trend__scale-button')
expect(container.querySelector('.time-context-trend__title')).toBeInTheDocument()
```

- [ ] **Step 2: Run focused test and verify it fails if classes are missing**

Run:

```powershell
npx vitest run apps/web/src/components/TimeContextPanel.test.tsx --maxWorkers=1
```

Expected: FAIL until the title/button classes exist.

- [ ] **Step 3: Add CSS near existing trend head rules**

Add:

```css
.time-context-trend__title {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.time-context-trend__scale-button {
  flex: 0 0 auto;
  height: 20px;
  padding: 0 7px;
  border: 1px solid rgba(15, 106, 92, 0.16);
  border-radius: 999px;
  color: rgba(15, 79, 69, 0.72);
  background: rgba(255, 255, 255, 0.44);
  font: inherit;
  font-size: 10px;
  font-weight: 820;
  line-height: 18px;
  cursor: pointer;
}

.time-context-trend__scale-button:hover,
.time-context-trend__scale-button:focus-visible {
  color: rgba(15, 79, 69, 0.92);
  border-color: rgba(15, 106, 92, 0.3);
  background: rgba(255, 255, 255, 0.72);
}
```

- [ ] **Step 4: Run focused test again**

Run:

```powershell
npx vitest run apps/web/src/components/TimeContextPanel.test.tsx --maxWorkers=1
```

Expected: PASS.

### Task 4: Final Verification And Commit

**Files:**
- Verify: `apps/web/src/components/TimeContextPanel.test.tsx`
- Verify: `apps/web/src/App.css`
- Verify: `docs/superpowers/specs/2026-07-07-distance-trend-scale-toggle-design.md`

- [ ] **Step 1: Run focused web tests**

Run:

```powershell
npx vitest run apps/web/src/components/TimeContextPanel.test.tsx --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Re-run full test command and record known baseline failures**

Run:

```powershell
npm test -- --run
```

Expected: Existing accounting `App.test.tsx` failures may remain if current date-range fixtures are still outside the active selection. Do not describe full test suite as passing unless this exits 0.

- [ ] **Step 5: Commit implementation**

Run:

```powershell
git add apps/web/src/components/TimeContextPanel.tsx apps/web/src/components/TimeContextPanel.test.tsx apps/web/src/App.css docs/superpowers/plans/2026-07-07-distance-trend-scale-toggle.md
git commit -m "feat: 增加距离图表尺度切换"
```
