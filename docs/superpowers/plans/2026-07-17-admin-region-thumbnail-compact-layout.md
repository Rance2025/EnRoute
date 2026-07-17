# 行政区域缩略图紧凑布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让足迹版图缩略图外框跟随 base path 实际高度，并在同一内容框右侧复用纵向 `SegmentedControl` 展示国省市区。

**Architecture:** 扩展通用 `SegmentedControl` 支持横向和纵向两种轴向，默认行为保持横向。区域面板用 `useLayoutEffect` 测量 base path 的 SVG 边界，收紧 viewBox，并用两列内容行组合缩略图和纵向控件。

**Tech Stack:** React 19、TypeScript 6、CSS、Vitest、Testing Library、Playwright CLI

---

## 文件与职责

- `apps/web/src/components/SegmentedControl.tsx`：通用控件方向、轴向指针计算和 ARIA。
- `apps/web/src/components/SegmentedControl.test.tsx`：纵向滑块行为与横向兼容性。
- `apps/web/src/components/AdminRegionContextPanel.tsx`：同框内容行和 base path 边界测量。
- `apps/web/src/components/AdminRegionContextPanel.test.tsx`：动态 viewBox、结构和层级切换。
- `apps/web/src/App.css`：通用纵向滑块几何及区域卡片两列布局。
- `apps/web/src/components/mapLayout.test.ts`：CSS 布局契约。

### Task 1: 为通用 SegmentedControl 增加纵向方向

**Files:**
- Modify: `apps/web/src/components/SegmentedControl.tsx`
- Modify: `apps/web/src/components/SegmentedControl.test.tsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: 写纵向模式失败测试**

新增测试，传入 `orientation="vertical"` 后断言修饰类与 `aria-orientation="vertical"`，并把容器 mock 为高 160px、宽 40px；从 `clientY=20` 拖到 `clientY=140` 后应选择第四项。现有未传方向的用例继续断言横向类和 X 轴拖动。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm --workspace apps/web exec vitest run src/components/SegmentedControl.test.tsx`

Expected: FAIL，指出 `orientation` 属性不存在或纵向拖动没有选择第四项。

- [ ] **Step 3: 最小实现纵向轴向**

给 props 增加：

```ts
orientation?: 'horizontal' | 'vertical'
```

默认值为 `horizontal`。把指针位置函数改为同时接收 `clientX/clientY`，按方向选择 `left/width` 或 `top/height`；根节点增加 `segmented-control--vertical` / `segmented-control--horizontal`，滑块增加对应 `aria-orientation`。

在 `App.css` 增加纵向模式：根节点按四行网格排列；thumb 固定左右边距并按 `--segment-index` 计算 top/height；活动标签改为单列多行并用 `translateY` 跟随滑块。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm --workspace apps/web exec vitest run src/components/SegmentedControl.test.tsx`

Expected: PASS。

### Task 2: 收紧缩略图并把层级控件移入右侧列

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: 写区域布局失败测试**

测试要求：

```ts
expect(thumbnail.closest('.admin-region-atlas-card__body')).toContainElement(depthControl)
expect(depthControl).toHaveClass('segmented-control--vertical')
expect(thumbnail).toHaveAttribute('viewBox', '12 18 296 150')
```

其中 `getBBox()` 在测试中 mock 为 `{ x: 12, y: 18, width: 296, height: 150 }`。CSS 契约要求 body 使用 `grid-template-columns: minmax(0, 1fr) auto`，thumbnail 不再包含 `aspect-ratio: 16 / 9`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm --workspace apps/web exec vitest run src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts`

Expected: FAIL，指出缺少 body 两列结构、纵向通用控件和收紧后的 viewBox。

- [ ] **Step 3: 最小实现同框两列布局与动态 viewBox**

在区域面板中引入 `SegmentedControl`，让 `DepthControl` 直接复用它并传入 `orientation="vertical"`。用 `useRef` 保存 base path，用 `useLayoutEffect` 在 `thumbnailBasePath` 变化后读取 `getBBox()`；只有 x/y/width/height 均有限且宽高大于 0 时更新 viewBox，否则使用 `0 0 320 180`。

把 SVG 和 `DepthControl` 包在：

```tsx
<div className="admin-region-atlas-card__body">
  <svg className="admin-region-atlas-card__thumbnail">...</svg>
  <DepthControl ... />
</div>
```

CSS 将 body 设为左右两列并保持 `align-items: stretch`；缩略图使用 `width: 100%; height: auto`；层级控件为独立窄列，不使用 absolute，因此不会覆盖地图。

- [ ] **Step 4: 运行区域测试确认 GREEN**

Run: `npm --workspace apps/web exec vitest run src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts src/components/mapShellLayout.test.tsx`

Expected: PASS。

### Task 3: 完整验证与桌面浏览器验收

**Files:**
- Verify only

- [ ] **Step 1: 运行前端测试、lint 和 build**

Run:

```powershell
npm run test:web
npm run lint
npm run build
```

Expected: 区域相关测试全部通过；若完整 Web 套件只出现已知的 AccountingPage 基线失败，单独记录；lint 和 build 通过。

- [ ] **Step 2: 浏览器检查两个桌面视口**

在 2048×1114 和 1366×768 打开区域页，确认：缩略图上下无约 30px 多余外框、纵向滑块位于同框右侧且不遮挡地图、点击和拖动切换四级、下方排行与拼图上移且拼图继续撑满。

- [ ] **Step 3: 提交实现**

```powershell
git add apps/web/src/components/SegmentedControl.tsx apps/web/src/components/SegmentedControl.test.tsx apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/components/mapLayout.test.ts apps/web/src/App.css docs/superpowers/specs/2026-07-17-admin-region-thumbnail-compact-layout-design.md docs/superpowers/plans/2026-07-17-admin-region-thumbnail-compact-layout.md
git commit -m "fix: 压缩行政区域缩略图布局"
```

Expected: 提交成功，工作树干净。
