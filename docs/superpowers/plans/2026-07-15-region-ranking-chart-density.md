# 区域排行榜条形图密度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将区域页右侧排行榜调整为无灰色底轨的紧密横向条形图，同时保留整行点击聚焦和五行后滚动。

**Architecture:** 保持 `AdminRegionContextPanel` 的数据、比例计算和整行按钮结构不变，只在现有组件测试中固化柱体点击行为，并在共享 CSS 中调整排行榜行步进和柱厚。布局契约继续由 `mapLayout.test.ts` 读取 CSS 规则验证，不引入新组件或状态。

**Tech Stack:** React 19、TypeScript 6、CSS Grid、Vitest、Testing Library

---

### Task 1: 固化紧密条形图与整行点击契约

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx:205`
- Modify: `apps/web/src/components/mapLayout.test.ts:2071`

- [ ] **Step 1: 补充柱体点击回归测试**

在 `renders ranking names, bars, and counts as direct single-row content` 测试中取得 `onRegionSelect`，并在结构断言后点击柱体：

```tsx
const { onRegionSelect } = renderPanel({ summary: longNameSummary })

// 保留现有结构断言。
fireEvent.click(bar as Element)
expect(onRegionSelect).toHaveBeenCalledWith(longNameSummary.rankings[0])
```

该断言确认柱体仍位于完整行按钮内部，点击柱体会沿用现有 `onRegionSelect(ranking)` 聚焦链路。

- [ ] **Step 2: 添加 CSS 密度失败断言**

把 `aligns administrative region rankings in one line without separators` 扩展为：

```ts
it('renders administrative region rankings as a compact trackless bar chart', () => {
  const cardRule = cssRule('.admin-region-ranking-card')
  const listRule = cssRule('.admin-region-ranking-card__list')
  const rowRule = cssRule('.admin-region-ranking-card__row')
  const nameRule = cssRule('.admin-region-ranking-card__name')
  const barRule = cssRule('.admin-region-ranking-card__bar')
  const fillRule = cssRule('.admin-region-ranking-card__bar span')
  const valueRule = cssRule('.admin-region-ranking-card__row strong')

  expect(cardRule).toContain('--admin-region-rank-row-height: 24px')
  expect(listRule).toContain(
    'max-height: calc(var(--admin-region-rank-row-height) * 5)',
  )
  expect(rowRule).toContain('height: var(--admin-region-rank-row-height)')
  expect(rowRule).toContain('grid-template-columns: 22px 4em minmax(0, 1fr) auto')
  expect(rowRule).toContain('padding: 0 2px')
  expect(rowRule).toContain('font-size: 12px')
  expect(rowRule).not.toContain('border-bottom')
  expect(nameRule).toContain('overflow: hidden')
  expect(nameRule).toContain('text-overflow: ellipsis')
  expect(nameRule).toContain('white-space: nowrap')
  expect(barRule).toContain('min-width: 0')
  expect(barRule).toContain('height: 12px')
  expect(barRule).toContain('background: transparent')
  expect(barRule).not.toMatch(/background: rgba\(/)
  expect(fillRule).toContain('background: #2c8572')
  expect(fillRule).toContain('transform-origin: left center')
  expect(valueRule).toContain('font-variant-numeric: tabular-nums')
})
```

- [ ] **Step 3: 运行聚焦测试并确认红灯原因**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:web -- src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts
```

Expected: `AdminRegionContextPanel.test.tsx` 的柱体点击断言通过；`mapLayout.test.ts` 因现有 `49px` 行高、`4px` 柱厚和灰色 `rgba(...)` 底轨而失败。

### Task 2: 实现 24px/12px 无轨条形图

**Files:**
- Modify: `apps/web/src/App.css:2440`
- Test: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Test: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: 收紧排行行步进**

把排行榜行变量和行规则调整为：

```css
.admin-region-ranking-card {
  --admin-region-rank-row-height: 24px;

  min-height: 0;
}

.admin-region-ranking-card__row {
  width: 100%;
  min-width: 0;
  height: var(--admin-region-rank-row-height);
  display: grid;
  grid-template-columns: 22px 4em minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
```

列表继续使用 `gap: 0` 与 `max-height: calc(var(--admin-region-rank-row-height) * 5)`，因此五行视口从 `245px` 收紧为 `120px`，第六行起保持纵向滚动。

- [ ] **Step 2: 删除灰轨并增厚实际柱体**

把柱体规则调整为：

```css
.admin-region-ranking-card__bar {
  min-width: 0;
  height: 12px;
  overflow: hidden;
  border-radius: 1px 3px 3px 1px;
  background: transparent;
}

.admin-region-ranking-card__bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2c8572;
  transform-origin: left center;
}
```

保留 `RankingRow` 中现有 `scaleX(ratio)` 和 `Math.max(0.08, ...)` 计算，不改变柱长与排序语义。

- [ ] **Step 3: 运行聚焦测试并确认绿灯**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:web -- src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts
```

Expected: 两个测试文件全部通过。

- [ ] **Step 4: 检查差异并提交实现**

Run:

```powershell
git diff --check
git status --short
```

Expected: 只有 `App.css`、`AdminRegionContextPanel.test.tsx` 和 `mapLayout.test.ts` 有预期修改，且 `git diff --check` 无输出。

Commit:

```powershell
git add -- apps/web/src/App.css apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/components/mapLayout.test.ts
git commit -m "fix: 收紧区域排行榜条形图"
```

### Task 3: 完整验证与桌面浏览器验收

**Files:**
- Verify: `apps/web/src/App.css`
- Verify: `apps/web/src/components/AdminRegionContextPanel.tsx`

- [ ] **Step 1: 运行完整自动化验证**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected: Web、API、仓库工具测试全部通过，ESLint 无错误，Vite 生产构建成功。

- [ ] **Step 2: 在桌面视口验证真实页面**

在功能工作树启动前端预览并连接现有 API，打开区域页后检查：

```text
1. 排行榜最多直接显示五行，第六行起可滚动。
2. 绿色柱体厚度约等于相邻柱体间的垂直空隙。
3. 每根柱子只有实际数值长度，没有满宽灰色底轨。
4. 名称列仍预留四个中文字符，所有柱体左端对齐。
5. 点击名称、柱体或数量均聚焦对应行政区。
6. 桌面视口内文字、滚动条和卡片边界不重叠。
```

- [ ] **Step 3: 检查功能分支最终状态**

Run:

```powershell
git status --short
git log -3 --oneline --decorate
```

Expected: 受跟踪工作树干净；设计、计划和实现提交均位于 `feat/region-ranking-chart-density`。
