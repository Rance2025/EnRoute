# Region Ranking Typography And Scrollbar Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让区域页右侧排行榜以更轻的中灰名称、窄体千分位数字和常驻细滚动条呈现，同时保留现有比例柱体与点击聚焦行为。

**Architecture:** 展示格式继续由 `AdminRegionContextPanel` 负责，仅新增一个模块级英文数字格式化器；视觉规则继续集中在 `App.css`，不引入新的组件或状态。组件测试锁定数字文本与无障碍名称，CSS 契约测试锁定桌面端名称、数字列和滚动条细节。

**Tech Stack:** React 19、TypeScript 6、Vitest、Testing Library、CSS

---

### Task 1: 排行榜数字千分位

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx:225-248`
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx:1-182`

- [ ] **Step 1: 写入数字格式化失败测试**

在现有单行内容测试之后新增：

```tsx
it('formats ranking counts with English thousands separators', () => {
  const formattedSummary: AdminRegionSummary = {
    ...citySummary,
    rankings: [
      {
        ...citySummary.rankings[0],
        footprintCount: 12120,
      },
    ],
  }

  renderPanel({ summary: formattedSummary })

  const row = screen.getByRole('button', { name: /上海市/ })
  expect(within(row).getByText('12,120')).toBeInTheDocument()
  expect(row).toHaveAccessibleName('第 1 名 上海市，12,120 个足迹点')
})
```

- [ ] **Step 2: 运行聚焦测试并确认 RED**

Run:

```powershell
npm --workspace apps/web exec -- vitest run src/components/AdminRegionContextPanel.test.tsx -t "formats ranking counts with English thousands separators"
```

Expected: FAIL。当前可见数字仍为 `12120`，按钮无障碍名称也没有千分位。

- [ ] **Step 3: 写入最小格式化实现**

在类型和常量区域新增模块级格式化器：

```ts
const FOOTPRINT_COUNT_FORMATTER = new Intl.NumberFormat('en-US')
```

在 `RankingRow` 中复用格式化结果：

```tsx
const formattedFootprintCount = FOOTPRINT_COUNT_FORMATTER.format(ranking.footprintCount)

return (
  <li className="admin-region-ranking-card__item">
    <button
      type="button"
      className={`admin-region-ranking-card__row${isSelected ? ' is-selected' : ''}`}
      aria-label={`第 ${ranking.rank} 名 ${ranking.name}，${formattedFootprintCount} 个足迹点`}
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
      <strong>{formattedFootprintCount}</strong>
    </button>
  </li>
)
```

- [ ] **Step 4: 运行组件测试并确认 GREEN**

Run:

```powershell
npm --workspace apps/web exec -- vitest run src/components/AdminRegionContextPanel.test.tsx
```

Expected: PASS，组件测试全部通过。

- [ ] **Step 5: 提交数字格式化改动**

```powershell
git add apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx
git commit -m "fix: 格式化区域排行榜足迹数量"
```

### Task 2: 名称、数字列与滚动条样式

**Files:**
- Modify: `apps/web/src/components/mapLayout.test.ts:2071-2131`
- Modify: `apps/web/src/App.css:2461-2560`

- [ ] **Step 1: 扩展 CSS 契约失败测试**

在 `renders administrative region rankings as a compact trackless bar chart` 中读取滚动条规则：

```ts
const scrollbarRule = cssRule('.admin-region-ranking-card__list::-webkit-scrollbar')
const scrollbarButtonRule = cssRule(
  '.admin-region-ranking-card__list::-webkit-scrollbar-button',
)
const scrollbarTrackRule = cssRule(
  '.admin-region-ranking-card__list::-webkit-scrollbar-track',
)
const scrollbarThumbRule = cssRule(
  '.admin-region-ranking-card__list::-webkit-scrollbar-thumb',
)
const hoverScrollbarThumbRule = cssRule(
  '.admin-region-ranking-card__list:hover::-webkit-scrollbar-thumb',
)
```

把名称、行、数字和交互断言调整为最终契约：

```ts
expect(listRule).toContain('scrollbar-gutter: stable')
expect(listRule).toContain('scrollbar-width: thin')
expect(listRule).toContain('scrollbar-color: rgba(23, 62, 53, 0.18) transparent')
expect(rowRule).toContain('padding: 0 10px 0 2px')
expect(nameRule).toContain('color: rgba(23, 35, 31, 0.62)')
expect(nameRule).toContain('font-weight: 400')
expect(hoverNameRule).toContain('color: #17231f')
expect(selectedNameRule).toContain('color: #17231f')
expect(valueRule).toContain(
  'font-family: "Aptos Narrow", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
)
expect(valueRule).toContain('font-weight: 700')
expect(valueRule).toContain('font-variant-numeric: tabular-nums')
expect(valueRule).toContain('letter-spacing: 0')
expect(valueRule).toContain('text-align: right')
expect(scrollbarRule).toContain('width: 4px')
expect(scrollbarButtonRule).toContain('display: none')
expect(scrollbarButtonRule).toContain('width: 0')
expect(scrollbarButtonRule).toContain('height: 0')
expect(scrollbarTrackRule).toContain('background: transparent')
expect(scrollbarThumbRule).toContain('background: rgba(23, 62, 53, 0.18)')
expect(hoverScrollbarThumbRule).toContain('background: rgba(23, 62, 53, 0.3)')
```

保留现有行高、五行最大高度、四字符名称列、`8px` 柱高、直角柱体、绿色柱体 hover/选中以及无灰底断言。

- [ ] **Step 2: 运行 CSS 契约测试并确认 RED**

Run:

```powershell
npm --workspace apps/web exec -- vitest run src/components/mapLayout.test.ts -t "renders administrative region rankings as a compact trackless bar chart"
```

Expected: FAIL。当前名称仍为 `600` 和深色常态，hover/选中仍为绿色，数字仍为 `860` 且没有窄体字体，WebKit 滚动条规则尚不存在。

- [ ] **Step 3: 写入最小 CSS 实现**

在列表规则之后新增：

```css
.admin-region-ranking-card__list::-webkit-scrollbar {
  width: 4px;
}

.admin-region-ranking-card__list::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}

.admin-region-ranking-card__list::-webkit-scrollbar-track {
  background: transparent;
}

.admin-region-ranking-card__list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(23, 62, 53, 0.18);
}

.admin-region-ranking-card__list:hover::-webkit-scrollbar-thumb {
  background: rgba(23, 62, 53, 0.3);
}
```

同时把相关现有规则更新为：

```css
.admin-region-ranking-card__list {
  display: grid;
  gap: 0;
  max-height: calc(var(--admin-region-rank-row-height) * 5);
  margin: 0;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(23, 62, 53, 0.18) transparent;
  list-style: none;
}

.admin-region-ranking-card__row {
  width: 100%;
  min-width: 0;
  height: var(--admin-region-rank-row-height);
  display: grid;
  grid-template-columns: 22px 4em minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 2px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.admin-region-ranking-card__name {
  min-width: 0;
  overflow: hidden;
  color: rgba(23, 35, 31, 0.62);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-region-ranking-card__row:hover .admin-region-ranking-card__name {
  color: #17231f;
}

.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__name {
  color: #17231f;
}

.admin-region-ranking-card__row strong {
  color: #123f35;
  font-family: "Aptos Narrow", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  text-align: right;
  white-space: nowrap;
}
```

- [ ] **Step 4: 运行相关测试并确认 GREEN**

Run:

```powershell
npm --workspace apps/web exec -- vitest run src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts
```

Expected: PASS，两个相关测试文件全部通过。

- [ ] **Step 5: 提交样式改动**

```powershell
git add apps/web/src/App.css apps/web/src/components/mapLayout.test.ts
git commit -m "fix: 细化区域排行榜文字与滚动条"
```

### Task 3: 完整验证与桌面验收

**Files:**
- Verify only: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Verify only: `apps/web/src/App.css`
- Verify only: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Verify only: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: 运行完整自动化验证**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Expected: `lint`、`build` 和任务相关测试通过。完整 `npm test` 只保留既有 `AccountingPage.integration.test.tsx:100` 失败，实际回调 `0`、预期 `1`；不得修改记账模块掩盖它。

- [ ] **Step 2: 在标准端口启动 worktree 预览**

确认根工作区服务状态，停止占用 `5173` 的旧前端，保留或重新启动 `5178` API；将根目录的本地 `.env.local` 和只读数据基线提供给 worktree，再运行：

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Expected: worktree 前端在 `http://127.0.0.1:5173` 提供预览，API 请求继续指向 `127.0.0.1:5178`。

- [ ] **Step 3: 用 Playwright 完成 1440 x 900 验收**

在桌面视口进入区域页并验证：

- 名称常态为轻量中灰，hover 和选中变为深灰。
- 柱体常态为略淡绿色，hover 和选中为当前强调色。
- 大数显示英文千分位，数字列使用窄体、右对齐并与滚动条保持空隙。
- 列表最多显示五行，超过五行可滚动；滚动条为常驻细滑块，无上下箭头，hover 后略加深。
- 点击整行仍聚焦对应行政区，选中态在鼠标移开后保留。
- 控制台无本轮新增运行时错误。

截图保存到忽略目录 `output/playwright/region-ranking-typography-scrollbar.png`。

- [ ] **Step 4: 检查分支状态**

Run:

```powershell
git status --short
git log --oneline --decorate -5
```

Expected: 功能分支只包含规格、计划、数字格式化和 CSS 两类提交；浏览器截图与本地运行输出保持忽略状态。
