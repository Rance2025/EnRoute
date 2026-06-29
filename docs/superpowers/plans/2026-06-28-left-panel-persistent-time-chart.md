# Left Panel Persistent Time Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved A direction for the left panel: persistent time selector, refined four metric values, and a distance bar chart with an inline average label.

**Architecture:** Keep `TimeContextPanel` as the owner of the left rail. Add small formatting helpers for metric value/unit splitting and chart metadata, reuse existing time picker components, and keep shared left-panel positioning untouched. CSS changes stay in `App.css` under existing time panel selectors.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS.

---

### Task 1: Persistent Selector Behavior

**Files:**
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`
- Modify: `apps/web/src/components/TimeContextPanel.tsx`

- [ ] Write a failing test that expects the map selector and trend chart to be present before any click.
- [ ] Run `npm --workspace apps/web exec vitest run src/components/TimeContextPanel.test.tsx --maxWorkers=1` and confirm the new test fails.
- [ ] Remove the hidden-editor state from the map panel, render the selector and chart by default, and keep the action button as a reset button.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Metric Value Split

**Files:**
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`
- Modify: `apps/web/src/components/TimeContextPanel.tsx`
- Modify: `apps/web/src/App.css`

- [ ] Write a failing test for `.time-context-metric-strip__number` and `.time-context-metric-strip__unit`.
- [ ] Add `splitMetricValue(value: string)` and render number/unit spans inside each metric value.
- [ ] Scope condensed font styling only to `.time-context-metric-strip__number`.
- [ ] Re-run the focused component test.

### Task 3: Distance Chart With Inline Average

**Files:**
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`
- Modify: `apps/web/src/components/TimeContextPanel.tsx`
- Modify: `apps/web/src/App.css`

- [ ] Write a failing test for chart top metadata and `.time-context-trend__average-label`.
- [ ] Render top metadata, average line, average label, and CSS custom property for average position.
- [ ] Refine chart CSS for taller, thinner bars with small top radius.
- [ ] Re-run the focused component test.

### Task 4: App Metrics And Layout Contracts

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] Write or update tests ensuring the map metric list has four entries and left panel position remains shared.
- [ ] Add the fourth map metric item without adding new backend fields.
- [ ] Re-run focused tests.

### Task 5: Full Verification

- [ ] Run `npm --workspace apps/web exec vitest run --maxWorkers=1`.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run a browser smoke check on the local dev app.

