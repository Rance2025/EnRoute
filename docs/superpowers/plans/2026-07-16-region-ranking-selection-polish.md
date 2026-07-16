# Region Ranking Selection Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让区域页右侧排行榜按真实比例绘制直角细柱，并以轻量强调色持续显示当前选中的行政区。

**Architecture:** 保留现有 `AdminRegionContextPanel`、应用级 `selectedAdminRegion` 状态和排行榜点击回调，只新增一个可选的 `selectedRegionId` 单向属性。比例计算继续在排行榜行组件内完成；视觉规则继续集中在 `App.css`，由现有组件测试、应用集成测试和 CSS 契约测试共同覆盖。

**Tech Stack:** React 19、TypeScript 6、Vitest、Testing Library、CSS

---

### Task 1: 排行榜比例与选中语义

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx:54-244`
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx:5-177`

- [ ] **Step 1: 扩展测试渲染助手并写入比例失败测试**

在 `renderPanel` 参数中加入 `selectedRegionId`，并把它传给组件：

```tsx
function renderPanel({
  depth = 3,
  status = 'ready',
  summary = citySummary,
  thumbnailBasePath = 'M0 0L320 0L320 180L0 180Z',
  selectedRegionId = null,
  onDepthChange = vi.fn(),
  onRegionSelect = vi.fn(),
  onRetry = vi.fn(),
}: {
  depth?: AdminRegionDepth
  status?: 'idle' | 'loading' | 'ready' | 'error'
  summary?: AdminRegionSummary | null
  thumbnailBasePath?: string
  selectedRegionId?: string | null
  onDepthChange?: (depth: AdminRegionDepth) => void
  onRegionSelect?: (ranking: AdminRegionSummary['rankings'][number]) => void
  onRetry?: () => void
} = {}) {
  render(
    <AdminRegionContextPanel
      depth={depth}
      status={status}
      summary={summary}
      thumbnailBasePath={thumbnailBasePath}
      selectedRegionId={selectedRegionId}
      onDepthChange={onDepthChange}
      onRegionSelect={onRegionSelect}
      onRetry={onRetry}
    />,
  )

  return { onDepthChange, onRegionSelect, onRetry }
}
```

在排行榜测试附近新增真实比例、正数最小 `2%` 和零值测试：

```tsx
it('uses real ranking ratios with a two-percent floor only for positive values', () => {
  const ratioSummary: AdminRegionSummary = {
    ...citySummary,
    rankings: citySummary.rankings.slice(0, 4).map((ranking, index) => ({
      ...ranking,
      footprintCount: [1000, 500, 1, 0][index],
    })),
  }

  renderPanel({ summary: ratioSummary })

  const ratios = ratioSummary.rankings.map((ranking) => {
    const row = screen.getByRole('button', { name: new RegExp(ranking.name) })
    return row.querySelector('.admin-region-ranking-card__bar span')
  })

  expect(ratios[0]).toHaveStyle({ transform: 'scaleX(1)' })
  expect(ratios[1]).toHaveStyle({ transform: 'scaleX(0.5)' })
  expect(ratios[2]).toHaveStyle({ transform: 'scaleX(0.02)' })
  expect(ratios[3]).toHaveStyle({ transform: 'scaleX(0)' })
})
```

- [ ] **Step 2: 运行组件测试并确认比例测试按预期失败**

Run:

```powershell
npm --workspace apps/web exec vitest run src/components/AdminRegionContextPanel.test.tsx
```

Expected: FAIL；正数小值和零值仍得到 `scaleX(0.08)`，且新增的 `selectedRegionId` 属性尚未定义时 TypeScript/运行测试会指出该契约缺失。

- [ ] **Step 3: 写入持久选中态失败测试**

在同一测试文件新增：

```tsx
it('marks only the selected ranking as the current location', () => {
  renderPanel({ selectedRegionId: '330100' })

  const selectedRow = screen.getByRole('button', { name: /第 2 名 杭州市/ })
  const otherRow = screen.getByRole('button', { name: /第 1 名 上海市/ })

  expect(selectedRow).toHaveClass('is-selected')
  expect(selectedRow).toHaveAttribute('aria-current', 'location')
  expect(otherRow).not.toHaveClass('is-selected')
  expect(otherRow).not.toHaveAttribute('aria-current')
})
```

- [ ] **Step 4: 再运行组件测试并确认选中测试按预期失败**

Run:

```powershell
npm --workspace apps/web exec vitest run src/components/AdminRegionContextPanel.test.tsx
```

Expected: FAIL；杭州市按钮没有 `.is-selected` 和 `aria-current="location"`。

- [ ] **Step 5: 最小实现比例和选中属性**

在 `AdminRegionContextPanelProps` 增加可选 ID：

```ts
type AdminRegionContextPanelProps = {
  depth: AdminRegionDepth
  summary: AdminRegionSummary | null
  thumbnailBasePath: string
  status: AdminRegionSummaryStatus
  selectedRegionId?: string | null
  onDepthChange: (depth: AdminRegionDepth) => void
  onRegionSelect: (ranking: AdminRegionRanking) => void
  onRetry: () => void
}
```

解构属性并传给排行榜行：

```tsx
export function AdminRegionContextPanel({
  depth,
  summary,
  thumbnailBasePath,
  status,
  selectedRegionId = null,
  onDepthChange,
  onRegionSelect,
  onRetry,
}: AdminRegionContextPanelProps) {
```

```tsx
<RankingRow
  key={ranking.regionId}
  ranking={ranking}
  maxFootprintCount={summary.rankings[0]?.footprintCount ?? ranking.footprintCount}
  isSelected={ranking.regionId === selectedRegionId}
  onRegionSelect={onRegionSelect}
/>
```

更新 `RankingRow`：

```tsx
function RankingRow({
  ranking,
  maxFootprintCount,
  isSelected,
  onRegionSelect,
}: {
  ranking: AdminRegionRanking
  maxFootprintCount: number
  isSelected: boolean
  onRegionSelect: (ranking: AdminRegionRanking) => void
}) {
  const ratio = maxFootprintCount <= 0 || ranking.footprintCount <= 0
    ? 0
    : Math.max(0.02, Math.min(1, ranking.footprintCount / maxFootprintCount))

  return (
    <li className="admin-region-ranking-card__item">
      <button
        type="button"
        className={`admin-region-ranking-card__row${isSelected ? ' is-selected' : ''}`}
        aria-label={`第 ${ranking.rank} 名 ${ranking.name}，${ranking.footprintCount} 个足迹点`}
        aria-current={isSelected ? 'location' : undefined}
        onClick={() => onRegionSelect(ranking)}
      >
        <span className="admin-region-ranking-card__rank">{ranking.rank}</span>
        <span className="admin-region-ranking-card__name" title={ranking.name}>
          {ranking.name}
        </span>
        <span className="admin-region-ranking-card__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${ratio})` }} />
        </span>
        <strong>{ranking.footprintCount}</strong>
      </button>
    </li>
  )
}
```

- [ ] **Step 6: 运行组件测试并确认通过**

Run:

```powershell
npm --workspace apps/web exec vitest run src/components/AdminRegionContextPanel.test.tsx
```

Expected: PASS，组件测试全部通过。

- [ ] **Step 7: 提交组件行为**

```powershell
git add apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx
git commit -m "fix: 校准区域排行榜比例与选中语义"
```

### Task 2: 将地图选中状态回传右栏

**Files:**
- Modify: `apps/web/src/App.test.tsx:519-555`
- Modify: `apps/web/src/App.tsx:922-930`

- [ ] **Step 1: 写入应用级失败测试**

在 `shows the region cards and uses visited ids by default in region mode` 测试之后新增：

```tsx
it('keeps the map-selected administrative region selected in the ranking', async () => {
  render(<App amapConfig={missingAmapConfig} />)
  await settleLazyImports()

  fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
    .getByRole('button', { name: '区域' }))

  const rankingRow = await screen.findByRole('button', { name: /第 1 名 中国/ })
  fireEvent.click(rankingRow)

  expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
    'data-selected-admin-region-id',
    'CN',
  )
  expect(rankingRow).toHaveClass('is-selected')
  expect(rankingRow).toHaveAttribute('aria-current', 'location')
})
```

- [ ] **Step 2: 运行应用聚焦测试并确认失败**

Run:

```powershell
npm --workspace apps/web exec vitest run src/App.test.tsx -t "keeps the map-selected administrative region selected in the ranking"
```

Expected: FAIL；地图 mock 收到 `CN`，但排行榜按钮没有选中类和当前地点语义，证明右栏尚未收到应用状态。

- [ ] **Step 3: 把选中 ID 传入右栏**

在 `App.tsx` 的区域右栏调用中增加：

```tsx
<AdminRegionContextPanel
  depth={adminRegionDepth}
  summary={currentAdminRegionSummary}
  thumbnailBasePath={adminRegionThumbnailBasePath}
  status={currentAdminRegionSummaryStatus}
  selectedRegionId={selectedAdminRegion?.regionId}
  onDepthChange={handleAdminRegionDepthChange}
  onRegionSelect={setSelectedAdminRegion}
  onRetry={handleAdminRegionSummaryRetry}
/>
```

- [ ] **Step 4: 运行应用聚焦测试并确认通过**

Run:

```powershell
npm --workspace apps/web exec vitest run src/App.test.tsx -t "keeps the map-selected administrative region selected in the ranking"
```

Expected: PASS。

- [ ] **Step 5: 提交状态回传**

```powershell
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "fix: 同步区域排行榜地图选中态"
```

### Task 3: 收紧柱体与交互样式

**Files:**
- Modify: `apps/web/src/components/mapLayout.test.ts:2070-2104`
- Modify: `apps/web/src/App.css:2479-2544`

- [ ] **Step 1: 更新 CSS 契约测试**

扩展 `renders administrative region rankings as a compact trackless bar chart` 测试：

```ts
const hoverRule = cssRule('.admin-region-ranking-card__row:hover')
const focusRule = cssRule('.admin-region-ranking-card__row:focus-visible')
const hoverNameRule = cssRule(
  '.admin-region-ranking-card__row:hover .admin-region-ranking-card__name',
)
const selectedNameRule = cssRule(
  '.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__name',
)
const hoverFillRule = cssRule(
  '.admin-region-ranking-card__row:hover .admin-region-ranking-card__bar span',
)
const selectedFillRule = cssRule(
  '.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__bar span',
)

expect(nameRule).toContain('font-weight: 600')
expect(barRule).toContain('height: 8px')
expect(barRule).not.toContain('border-radius')
expect(fillRule).toContain('background: #3d8f7d')
expect(fillRule).not.toContain('border-radius')
expect(hoverRule).toContain('background: transparent')
expect(focusRule).toContain('outline: 1px solid #2c8572')
expect(focusRule).not.toContain('background:')
expect(hoverNameRule).toContain('color: #2c8572')
expect(selectedNameRule).toContain('color: #2c8572')
expect(hoverFillRule).toContain('background: #2c8572')
expect(selectedFillRule).toContain('background: #2c8572')
```

同时移除旧的 `height: 12px` 和默认填充色 `#2c8572` 断言。

- [ ] **Step 2: 运行 CSS 契约测试并确认失败**

Run:

```powershell
npm --workspace apps/web exec vitest run src/components/mapLayout.test.ts -t "renders administrative region rankings as a compact trackless bar chart"
```

Expected: FAIL；当前仍为 `820` 字重、`12px` 圆角柱、深强调色和灰色整行反馈。

- [ ] **Step 3: 实现最终排行榜样式**

将对应 CSS 规则更新为：

```css
.admin-region-ranking-card__row:hover {
  background: transparent;
}

.admin-region-ranking-card__row:focus-visible {
  outline: 1px solid #2c8572;
  outline-offset: -1px;
}

.admin-region-ranking-card__name {
  min-width: 0;
  overflow: hidden;
  color: #17231f;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-region-ranking-card__bar {
  min-width: 0;
  height: 8px;
  overflow: hidden;
  background: transparent;
}

.admin-region-ranking-card__bar span {
  display: block;
  height: 100%;
  background: #3d8f7d;
  transform-origin: left center;
}

.admin-region-ranking-card__row:hover .admin-region-ranking-card__name {
  color: #2c8572;
}

.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__name {
  color: #2c8572;
}

.admin-region-ranking-card__row:hover .admin-region-ranking-card__bar span {
  background: #2c8572;
}

.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__bar span {
  background: #2c8572;
}
```

排名和数量规则保持原样，因此 hover 与选中不会改变它们的颜色；行高、列宽、五行最大高度和滚动规则也不改。

- [ ] **Step 4: 运行聚焦前端测试**

Run:

```powershell
npm --workspace apps/web exec vitest run src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts src/App.test.tsx
```

Expected: PASS，三个相关测试文件全部通过。

- [ ] **Step 5: 提交样式**

```powershell
git add apps/web/src/App.css apps/web/src/components/mapLayout.test.ts
git commit -m "fix: 优化区域排行榜柱体与交互样式"
```

### Task 4: 完整验证与桌面验收

**Files:**
- Verify only: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Verify only: `apps/web/src/App.tsx`
- Verify only: `apps/web/src/App.css`

- [ ] **Step 1: 运行完整自动化验证**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Expected: `lint` 和 `build` 通过；任务相关测试通过。若完整 `npm test` 仅保留既有的 `AccountingPage.integration.test.tsx:100` 回调次数 `0` 与预期 `1` 的失败，则原样记录，不修改记账模块。

- [ ] **Step 2: 启动标准本地服务并完成桌面浏览器验收**

Run:

```powershell
python start.py start
```

在 `http://127.0.0.1:5173` 的桌面视口验证：排行榜最多显示五行并可滚动；名称为较轻的 `600` 字重；柱高 `8px`、顶部和端部均无圆角；榜首为满长、普通值按真实比例、极小正数可见而零值无柱；hover 与选中只强调名称和柱体；点击整行后地图聚焦且选中态在移开鼠标后保留；控制台没有新增运行时错误。

- [ ] **Step 3: 检查分支状态**

Run:

```powershell
git status --short
git log --oneline --decorate -5
```

Expected: 只有明确保留的本地浏览器调试输出处于忽略状态，功能分支包含设计、组件行为、状态回传和样式提交。
