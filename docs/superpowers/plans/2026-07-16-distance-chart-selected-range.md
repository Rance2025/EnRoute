# 距离图表选中日期范围 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让距离图表按界面选中的明确开始、结束日期生成完整日桶，并禁止自定义结束日期超过今天。

**Architecture:** 地图瓦片继续使用现有开放式 `range=all`，足迹指标请求改为直接携带 `TimeRangeSelection.start/end`。自定义日期模型集中限制结束日，日期选择器同步禁用未来结束日，避免 UI 与模型出现不同约束。

**Tech Stack:** React 19、TypeScript 6、Vitest、Testing Library、FastAPI 既有 metrics 接口

---

### Task 1: 限制自定义结束日期

**Files:**
- Modify: `apps/web/src/time/timeRange.ts`
- Test: `apps/web/src/time/timeRange.test.ts`
- Modify: `apps/web/src/components/TimeContextPanel.tsx`
- Test: `apps/web/src/components/TimeContextPanel.test.tsx`

- [ ] **Step 1: 写日期模型失败测试**

在 `timeRange.test.ts` 增加测试，固定当前时间为 `2026-06-19`，证明直接创建和编辑自定义范围都会把未来结束日限制到今天，同时本季度预设也不越过今天：

```ts
it('clamps editable custom range ends to today', () => {
  expect(setCustomDateRange('2026-06-10', '2026-06-25')).toMatchObject({
    start: '2026-06-10',
    end: '2026-06-19',
    anchorDate: '2026-06-19',
  })

  const current = setCustomDateRange('2026-06-10', '2026-06-18')
  expect(updateCustomDateBoundary(current, 'end', '2026-06-25')).toMatchObject({
    start: '2026-06-10',
    end: '2026-06-19',
    anchorDate: '2026-06-19',
  })

  expect(selectPresetRange('quarter')).toMatchObject({
    start: '2026-04-01',
    end: '2026-06-19',
  })
})
```

- [ ] **Step 2: 写日期选择器失败测试**

在 `TimeContextPanel.test.tsx` 增加测试，打开结束日期选择器并确认明天不可选：

```tsx
it('disables future days when choosing a custom end date', () => {
  render(
    <TimeContextPanel
      view="map"
      selection={setCustomDateRange('2026-06-10', '2026-06-20')}
      onSelectionChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /打开结束日期选择器/ }))

  const picker = screen.getByRole('dialog', { name: '结束日期选择' })
  expect(within(picker).getByRole('button', { name: '21' })).toBeDisabled()
})
```

- [ ] **Step 3: 运行测试并确认按预期失败**

Run:

```powershell
npm --workspace apps/web exec vitest run src/time/timeRange.test.ts src/components/TimeContextPanel.test.tsx
```

Expected: 新增模型测试因结束日期仍为未来而失败；新增组件测试因 `6月21日` 按钮未禁用而失败。

- [ ] **Step 4: 实现最小日期上限**

在 `selectPresetRange('quarter')` 中把季度结束日限制到今天：

```ts
const end = minDateKey(
  formatDateKey(new Date(currentDate.getFullYear(), quarterStartMonth + 3, 0)),
  today,
)
```

在 `normalizeCustomSelection` 中先排序，再把结束日限制到今天；如果整个输入都在未来，开始日也随结束日收敛到今天：

```ts
function normalizeCustomSelection(selection: TimeRangeSelection): TimeRangeSelection {
  const orderedStart = minDateKey(selection.start, selection.end)
  const orderedEnd = selection.start <= selection.end ? selection.end : selection.start
  const end = minDateKey(orderedEnd, createTodayKey())
  const start = minDateKey(orderedStart, end)

  return {
    ...selection,
    mode: 'custom',
    start,
    end,
    anchorDate: end,
    label: '自定义',
    isOpenEnded: false,
  }
}
```

从 `../time/timeRange` 导入 `createTodayKey`，在 `CustomDatePicker` 中计算今天，并只对结束日期禁用未来日按钮：

```tsx
const today = createTodayKey()

// 日期按钮
disabled={boundary === 'end' && day.date > today}
```

- [ ] **Step 5: 更新既有日期测试期望并验证通过**

把原先允许本季度结束于未来的断言改为截至今天；把反向自定义范围测试的结束日期改为 `2026-06-19`。当前周、月、年模式不是可编辑的自定义结束日期，本任务不改变它们。然后重新运行 Step 3 命令。

Expected: 两个测试文件全部通过。

- [ ] **Step 6: 提交日期约束**

```powershell
git add apps/web/src/time/timeRange.ts apps/web/src/time/timeRange.test.ts apps/web/src/components/TimeContextPanel.tsx apps/web/src/components/TimeContextPanel.test.tsx
git commit -m "fix: 限制时间范围结束日期不超过今天"
```

### Task 2: 将图表指标绑定到明确选择范围

**Files:**
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Test: `apps/web/src/components/MapboxCanvas.test.tsx`

- [ ] **Step 1: 修改指标请求测试使其先失败**

在现有“先加载全部范围、再切换单日”的测试中，把第一次指标请求期望改为明确日期，同时保留已有瓦片测试对 `range=all` 的断言：

```ts
expect(fetchMock).toHaveBeenNthCalledWith(
  1,
  '/api/footprints/metrics?start=2022-03-01&end=2026-06-19',
  expect.objectContaining({ method: 'GET' }),
)
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npm --workspace apps/web exec vitest run src/components/MapboxCanvas.test.tsx
```

Expected: FAIL，实际第一次请求仍是 `/api/footprints/metrics?range=all`。

- [ ] **Step 3: 实现指标与瓦片范围解耦**

把指标 URL 构造器改为接收 `TimeRangeSelection` 并始终写入明确日期：

```ts
function createFootprintMetricsUrl(
  metricsUrl: string,
  timeRange: TimeRangeSelection,
) {
  const params = new URLSearchParams()
  params.set('start', timeRange.start)
  params.set('end', timeRange.end)

  return `${metricsUrl}?${params.toString()}`
}
```

指标 effect 调用 `createFootprintMetricsUrl(resolvedMetricsUrl, timeRange)`，依赖使用 `timeRange.start` 与 `timeRange.end`。`createFootprintTileRange` 和所有瓦片调用保持不变。

- [ ] **Step 4: 运行 Mapbox 测试并确认通过**

Run:

```powershell
npm --workspace apps/web exec vitest run src/components/MapboxCanvas.test.tsx
```

Expected: PASS；指标请求为明确日期，开放式瓦片测试仍断言 `?range=all`。

- [ ] **Step 5: 提交指标请求修复**

```powershell
git add apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "fix: 按选中日期请求足迹图表指标"
```

### Task 3: 回归验证与桌面验收

**Files:**
- Verify only; no planned production edits

- [ ] **Step 1: 运行相关前端回归测试**

```powershell
npm --workspace apps/web exec vitest run src/time/timeRange.test.ts src/components/TimeContextPanel.test.tsx src/components/MapboxCanvas.test.tsx src/App.test.tsx
```

Expected: 全部通过。

- [ ] **Step 2: 运行仓库规定验证**

```powershell
npm test
npm run lint
npm run build
```

Expected: lint、build 通过；`npm test` 除已确认的 `AccountingPage.integration.test.tsx` 基线失败外没有新增失败。

- [ ] **Step 3: 浏览器桌面验收**

启动隔离 worktree 的前后端后，在桌面视口选择“全部”，验证：

- 开始为 `2026-01-11`，结束为当天；
- 顶部范围天数与“按日汇总 · N天”一致；
- `2026-06-20` 至当天对应零值柱；
- 结束日期选择器中明天及以后不可点击；
- 地图正常渲染，地图瓦片仍通过 `range=all` 读取；
- 控制台无新增运行时错误。

- [ ] **Step 4: 检查差异与提交状态**

```powershell
git diff --check
git status --short
git log --oneline -4
```

Expected: 无空白错误，工作区干净，包含设计、日期约束和指标请求提交。
