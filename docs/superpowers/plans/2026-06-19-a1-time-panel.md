# A1 Time Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current left time panel with the approved A1 dark header-card interaction model.

**Architecture:** Keep `TimeContextPanel` as the shared left-panel component and make it own the lightweight demo interaction state for day calendar display. Continue passing only the selected top-level time range to `App` and `AccountingPage`. CSS stays in `src/App.css` to match the current prototype structure.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS.

---

### Task 1: Time Range Contract And Tests

**Files:**

- Modify: `src/components/mapShellLayout.test.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/TimeContextPanel.tsx`
- Modify: `src/components/AccountingPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing tests for the approved hierarchy**

Add test coverage that expects the shared panel to expose exactly one top-level mode row: `日 / 周 / 月 / 年 / 全部 / 自定义`. The test must verify that `日` shows calendar controls, `周/月/年` show aggregate selectors, and `全部/自定义` are first-class modes.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- --run src/components/mapShellLayout.test.tsx src/App.test.tsx`

Expected: failure because the old panel still exposes `本年/本月/本周/昨天/今天` and always renders a date grid.

- [ ] **Step 3: Update the time range type contract**

Change `TimeRangeKey` to `day | week | month | year | all | custom`, set the default app range to `day`, and update `AccountingPage` labels to these six keys.

- [ ] **Step 4: Implement A1 mode rendering**

Render a dark header card with the six mode buttons. In `day`, show week/month calendar toggle and selectable day cells. In `week/month/year`, render aggregate selectors without daily calendar grids. In `all/custom`, render dedicated summary/range content.

- [ ] **Step 5: Run focused tests and confirm pass**

Run: `npm test -- --run src/components/mapShellLayout.test.tsx src/App.test.tsx`

Expected: pass.

### Task 2: A1 Visual Integration

**Files:**

- Modify: `src/App.css`

- [ ] **Step 1: Style the panel from the A1 mock**

Apply the dark iOS-style header card, compact six-way segmented mode control, day calendar shell, aggregate rows, summary cards, and scroll-contained body.

- [ ] **Step 2: Run visual-adjacent tests**

Run: `npm test -- --run src/components/mapShellLayout.test.tsx src/components/mapLayout.test.ts`

Expected: pass.

- [ ] **Step 3: Browser verify**

Run the app on a non-5173 port, open it in a browser, check the left panel on map and accounting pages, and confirm no full-page scroll is required.

### Task 3: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Full test suite**

Run: `npm test -- --run`

Expected: all tests pass.

- [ ] **Step 2: Lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: exit 0.
