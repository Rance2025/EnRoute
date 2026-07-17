# 行政区域纵向控件旧样式恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留国/省/市/区文字中心对齐修复，同时恢复上一版纵向控件的视觉样式。

**Architecture:** 继续使用共享 `SegmentedControl` 和反色文字覆盖层。纵向控件保留 `--segmented-padding: 2px` 与 `padding: 2px 0` 的统一几何，只把轨道、边框、滑块阴影和文字颜色恢复为上一版取值。

**Tech Stack:** React 19、TypeScript、CSS、Vitest、Playwright CLI

---

### Task 1: 恢复纵向控件视觉样式

**Files:**
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Modify: `apps/web/src/App.css`

- [x] **Step 1: 写入失败的样式契约**

要求纵向控件保留 `--segmented-padding: 2px` 和 `padding: 2px 0`，同时恢复旧版的 `--segmented-thumb-shadow`、灰绿色文字、1px 边框和浅绿色背景。

- [x] **Step 2: 运行测试确认失败**

Run: `npm --workspace apps/web exec vitest run src/components/mapLayout.test.ts`

Expected: FAIL，当前白色半透明轨道不满足旧版视觉契约。

- [x] **Step 3: 最小修改纵向控件 CSS**

恢复旧版视觉值，但不恢复会导致错位的 `--segmented-padding: 3px` 与 `padding: 0`。

- [x] **Step 4: 运行测试确认通过**

Run: `npm --workspace apps/web exec vitest run src/components/SegmentedControl.test.tsx src/components/mapLayout.test.ts`

Expected: PASS，83 项相关测试全部通过。

- [x] **Step 5: 浏览器验证**

在 `1366x768` 和 `2048x1114` 下测量四档普通文字与反色文字中心差值为 `0px`，并验证点击、拖动、世界/中国缩略图等高及控制台无错误。

- [x] **Step 6: 完整验证并提交**

Run: `npm run lint`, `npm run build`, `npm test`

Commit: `fix: 恢复行政区域纵向控件样式`

验证说明：完整 Web 套件为 `655/656`，唯一失败是主分支可复现的记账月份回退用例；相关前端测试、lint、build、API `309/309` 和仓库测试 `47/47` 均通过。
