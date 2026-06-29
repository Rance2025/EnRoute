# Left Panel Real Distance Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder left-panel distance chart with real distance series data, refined hover behavior, and mode-specific visibility rules.

**Architecture:** Extend the existing `/api/footprints/metrics` response with a read-only `distanceSeries` computed from `footprints.distance` for the selected time range. Pass that series through the existing `FootprintMetrics` flow into `TimeContextPanel`, where the chart owns presentation state, hover/focus behavior, and visibility decisions. Keep shared left-panel positioning untouched.

**Tech Stack:** Python 3.12, FastAPI, SQLite, React 19, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Backend Distance Series

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Modify: `apps/api/tests/test_footprints_api.py`

- [ ] Add a failing API test that expects `/api/footprints/metrics?start=2026-06-18&end=2026-06-19` to return `distanceSeries.granularity === "day"` and two daily buckets with real summed distances.
- [ ] Add a failing API test that expects a one-day query to return `distanceSeries.granularity === "hour"` and 24 hourly buckets.
- [ ] Implement a read-only distance-series query in `query_metrics`; it must only `SELECT` from `footprints`.
- [ ] Run `python scripts/run_api_tests.py`.

### Task 2: Frontend Metrics Plumbing

**Files:**
- Modify: `apps/web/src/layers/footprintTypes.ts`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`
- Modify: `apps/web/src/components/TimeContextPanel.tsx`
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] Add `distanceSeries` to `FootprintMetrics` and `TimeContextPanel` props.
- [ ] Update tests so the panel receives and renders real bucket labels/values instead of the placeholder source array.
- [ ] Keep fallback empty series for missing-token and request failures.
- [ ] Run focused web tests for `TimeContextPanel`, `App`, and `MapboxCanvas`.

### Task 3: Chart Interaction And Visibility

**Files:**
- Modify: `apps/web/src/components/TimeContextPanel.tsx`
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] Add tests for hiding the chart when day mode switches to month calendar.
- [ ] Add tests for hiding the chart when a custom start/end picker is expanded.
- [ ] Add tests for hover/focus showing a specific bucket label/value and only highlighting the active bar.
- [ ] Add CSS contract tests for darker metric colors, fixed chart height, wider bars, and no average-label background.
- [ ] Implement the component and CSS changes.
- [ ] Run focused web tests.

### Task 4: Full Verification

- [ ] Run `npm --workspace apps/web exec vitest run --maxWorkers=1`.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Browser verify the left panel on day/week/month/year/custom modes.
