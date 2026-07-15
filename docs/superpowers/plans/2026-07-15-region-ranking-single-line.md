# 区域足迹排行榜单行布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把区域页右侧足迹排行榜改为排名、四字名称列、比例柱和数量同排的单行布局，并移除行间分割线。

**Architecture:** 保留 `AdminRegionContextPanel` 的数据和交互边界，只扁平化 `RankingRow` 内部标记，并由现有 `App.css` 使用四列 CSS Grid 完成对齐。现有比例计算、五行滚动和选择回调保持不变，新增组件语义测试与 CSS 布局契约防止回归。

**Tech Stack:** React 19、TypeScript 6、CSS Grid、Vitest、Testing Library

---

## 文件结构

- 修改 `apps/web/src/components/AdminRegionContextPanel.test.tsx`：验证长名称完整提示和单行子元素顺序。
- 修改 `apps/web/src/components/mapLayout.test.ts`：验证四列轨道、四字名称宽度、无分割线及数字排版。
- 修改 `apps/web/src/components/AdminRegionContextPanel.tsx`：移除名称/柱条两行包裹，并为名称提供完整 `title`。
- 修改 `apps/web/src/App.css`：实现四列单行网格，删除旧两行容器规则和底部分割线。

### Task 1：建立单行排行榜回归契约

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx:209`
- Modify: `apps/web/src/components/mapLayout.test.ts:2046`
- Test: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Test: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1：添加组件结构失败测试**

在 `AdminRegionContextPanel.test.tsx` 的排行榜测试后添加：

```tsx
it('renders ranking names, bars, and counts as direct single-row content', () => {
  const longNameSummary: AdminRegionSummary = {
    ...citySummary,
    rankings: citySummary.rankings.map((ranking, index) => (
      index === 0 ? { ...ranking, name: '呼和浩特市' } : ranking
    )),
  }
  renderPanel({ summary: longNameSummary })

  const row = screen.getByRole('button', { name: /第 1 名 呼和浩特市/ })
  const rank = within(row).getByText('1')
  const name = within(row).getByText('呼和浩特市')
  const bar = row.querySelector('.admin-region-ranking-card__bar')
  const count = within(row).getByText('12')

  expect(name).toHaveAttribute('title', '呼和浩特市')
  expect(row.querySelector('.admin-region-ranking-card__main')).not.toBeInTheDocument()
  expect(bar).not.toBeNull()
  expectElementsInDocumentOrder(rank, name, bar as Element, count)
})
```

- [ ] **Step 2：添加 CSS 布局失败测试**

在 `mapLayout.test.ts` 的行政区层级控件测试后添加：

```ts
it('aligns administrative region rankings in one line without separators', () => {
  const rowRule = cssRule('.admin-region-ranking-card__row')
  const nameRule = cssRule('.admin-region-ranking-card__name')
  const barRule = cssRule('.admin-region-ranking-card__bar')
  const valueRule = cssRule('.admin-region-ranking-card__row strong')

  expect(rowRule).toContain('grid-template-columns: 22px 4em minmax(0, 1fr) auto')
  expect(rowRule).toContain('font-size: 12px')
  expect(rowRule).not.toContain('border-bottom')
  expect(nameRule).toContain('overflow: hidden')
  expect(nameRule).toContain('text-overflow: ellipsis')
  expect(nameRule).toContain('white-space: nowrap')
  expect(barRule).toContain('min-width: 0')
  expect(cssRule('.admin-region-ranking-card__bar span')).toContain(
    'transform-origin: left center',
  )
  expect(valueRule).toContain('font-variant-numeric: tabular-nums')
})
```

- [ ] **Step 3：运行聚焦测试并确认红灯**

Run:

```powershell
npm run test:web -- src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts
```

Expected: FAIL。组件测试应指出名称缺少 `title` 或旧的 `admin-region-ranking-card__main` 仍存在；布局测试应指出旧网格仍为三列并包含 `border-bottom`。

### Task 2：实现四列单行布局

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx:158`
- Modify: `apps/web/src/App.css:2479`
- Test: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Test: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1：扁平化排行按钮内容**

将 `RankingRow` 返回值中的按钮内容改为：

```tsx
<span className="admin-region-ranking-card__rank">{ranking.rank}</span>
<span className="admin-region-ranking-card__name" title={ranking.name}>
  {ranking.name}
</span>
<span className="admin-region-ranking-card__bar" aria-hidden="true">
  <span style={{ transform: `scaleX(${ratio})` }} />
</span>
<strong>{ranking.footprintCount}</strong>
```

保持按钮的 `aria-label`、`onClick`、比例计算及列表结构原样。

- [ ] **Step 2：实现四列 CSS Grid 并删除分割线**

把 `.admin-region-ranking-card__row` 改为：

```css
.admin-region-ranking-card__row {
  width: 100%;
  min-width: 0;
  min-height: var(--admin-region-rank-row-height);
  display: grid;
  grid-template-columns: 22px 4em minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 2px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
```

删除完整的 `.admin-region-ranking-card__main` 规则。保留名称的单行省略规则，并在柱状条规则中加入 `min-width: 0`：

```css
.admin-region-ranking-card__bar {
  min-width: 0;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(23, 35, 31, 0.07);
}
```

在数量规则中加入等宽数字：

```css
.admin-region-ranking-card__row strong {
  color: #123f35;
  font-size: 12px;
  font-weight: 860;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
```

`.admin-region-ranking-card__name`、柱状条填充、行高、列表最大高度、滚动和悬停/焦点规则保持现有值。

- [ ] **Step 3：运行聚焦测试并确认绿灯**

Run:

```powershell
npm run test:web -- src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts
```

Expected: 两个测试文件全部 PASS。

- [ ] **Step 4：检查差异和格式**

Run:

```powershell
git diff --check
git diff -- apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/App.css apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/components/mapLayout.test.ts
```

Expected: `git diff --check` 无输出；差异只包含已批准的排行榜结构、样式和测试。

- [ ] **Step 5：提交实现**

```powershell
git add -- apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/App.css apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/components/mapLayout.test.ts
git commit -m "feat: 调整区域排行榜为单行布局"
```

### Task 3：全量验证与桌面验收

**Files:**
- Verify: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Verify: `apps/web/src/App.css`

- [ ] **Step 1：运行完整自动化验证**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: Web、API 和仓库工具测试全部 PASS；lint 和生产构建退出码为 `0`。允许记录既有 Mapbox 大 chunk 构建提示，但不能出现新增错误。

- [ ] **Step 2：启动工作树桌面验收服务**

保持主工作区 `5173/5178` 不变。将主工作区 `.env.local` 复制到工作树的忽略文件位置但不输出内容，然后在 `5174` 启动工作树 Vite；其 `/api` 继续代理主工作区 `5178`：

```powershell
Copy-Item -LiteralPath D:\Coding\EnRoute\.env.local -Destination .env.local
npm run dev -- --host 127.0.0.1 --port 5174
```

Expected: `http://127.0.0.1:5174/` 返回 `200`，且主工作区端口不被停止或覆盖。

- [ ] **Step 3：在桌面视口验收排行榜**

在 `1440 x 900` 打开区域页并切换到区级，检查：

- 每行按排名、名称、柱状条、数量单行排列；
- 所有柱状条左边缘对齐；
- 四字内名称完整显示，五字及以上名称显示省略号，悬停可见完整名称；
- 数量右对齐，行间没有分割线；
- 列表最多显示五行，超过五条可滚动；
- 点击排行项仍可聚焦对应行政区；
- 页面无横向溢出，浏览器控制台无新增错误。

- [ ] **Step 4：停止临时服务并确认分支状态**

停止工作树 `5174` Vite 进程，不停止主工作区 `5173/5178`。随后运行：

```powershell
git status --short
git log -3 --oneline --decorate
```

Expected: 只有忽略的本地运行文件，受跟踪工作区干净；设计、计划和实现提交均位于 `feat/region-ranking-single-line`。
