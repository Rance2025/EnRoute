# 行政区域缩略图固定画框与纵向滑块优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让世界与中国缩略图在同一 `32:15` 画框内等高显示，并把纵向层级控件优化为单轨道单滑块。

**Architecture:** 新增纯函数把任意 SVG base 边界居中扩展到固定画框比例，面板只负责测量和应用结果。CSS 固定 SVG 比例，并移除层级按钮的独立胶囊背景，保留通用 `SegmentedControl` 的 thumb。

**Tech Stack:** React 19、TypeScript 6、CSS、Vitest、Testing Library、Playwright CLI

---

### Task 1: 固定缩略图画框比例

**Files:**
- Create: `apps/web/src/components/adminRegionThumbnailViewBox.ts`
- Create: `apps/web/src/components/adminRegionThumbnailViewBox.test.ts`
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: 写失败测试**

纯函数测试传入世界边界 `{ x: 6, y: 16.8, width: 308, height: 144.7 }` 和中国边界 `{ x: 46.2, y: 12.4, width: 225.9, height: 158.5 }`，断言输出 viewBox 的宽高比均为 `32/15`，且两者保持原始高度、只居中扩展宽度。非法边界断言回退到 `0 15 320 150`。CSS 契约断言缩略图含 `aspect-ratio: 32 / 15`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm --workspace apps/web exec vitest run src/components/adminRegionThumbnailViewBox.test.ts src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts`

Expected: FAIL，指出 helper 不存在、当前 viewBox 仍直接使用原始 bbox，CSS 未固定比例。

- [ ] **Step 3: 最小实现**

实现 `fitAdminRegionThumbnailViewBox(bounds)`：验证有限正宽高；比较当前比例和 `32/15`；较窄时保持高度并居中扩宽，较宽时保持宽度并居中扩高；数值保留三位小数。面板测量后调用 helper，CSS 添加固定比例。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm --workspace apps/web exec vitest run src/components/adminRegionThumbnailViewBox.test.ts src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts`

Expected: PASS。

### Task 2: 优化纵向滑块视觉

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: 写失败 CSS 契约测试**

断言层级轨道宽 34px、padding 变量为 3px、轨道具有连续背景与轻边框；按钮规则包含 `background: transparent`、`border-radius: 0`，且不再包含按钮灰色背景。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm --workspace apps/web exec vitest run src/components/mapLayout.test.ts`

Expected: FAIL，指出当前宽度为 32px、按钮仍有独立胶囊背景。

- [ ] **Step 3: 最小 CSS 调整**

把轨道宽度改为 34px、内缩改为 3px、阴影减弱并增加轻边框；按钮背景透明、圆角为 0、鼠标样式继承轨道。不要修改通用组件交互实现。

- [ ] **Step 4: 运行相关测试确认 GREEN**

Run: `npm --workspace apps/web exec vitest run src/components/SegmentedControl.test.tsx src/components/AdminRegionContextPanel.test.tsx src/components/adminRegionThumbnailViewBox.test.ts src/components/mapLayout.test.ts src/components/mapShellLayout.test.tsx`

Expected: PASS。

### Task 3: 完整验证与本地集成

**Files:**
- Verify only

- [ ] **Step 1:** 运行 `npm run test:web`、`npm run test:api`、`npm run test:repo`、`npm run lint`、`npm run build`。
- [ ] **Step 2:** 在 2048×1114 和 1366×768 验证国/省切换前后卡片高度相同，滑块为单轨道且可点击、拖动。
- [ ] **Step 3:** 使用 `fix: 统一行政区域缩略图画框` 提交；按仓库默认流程本地合并到 `master` 并清理 worktree，不执行远程写入。
