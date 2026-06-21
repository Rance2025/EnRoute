# Unified Page Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the EnRoute page background a single continuous app surface across the shared time panel, map view, and accounting view.

**Architecture:** Keep `.app-shell` as the only full-viewport background owner. Page content, the shared time panel, the map stage, and the AMap fallback surface remain transparent at the large layout level, while cards and local panels keep their own surfaces. This removes route-specific full-page background overrides and filter boundaries that make accounting or map views look split into left and right slabs.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS contract tests in `apps/web/src/components/mapLayout.test.ts`, styles in `apps/web/src/App.css`.

---

### Task 1: Lock the Background Contract

**Files:**
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Read: `apps/web/src/App.css`

- [ ] **Step 1: Write the failing CSS contract test**

Update the existing desktop layout background test so it asserts:

```ts
expect(cssRule('.app-shell')).toContain('--page-board-bg:')
expect(cssRule('.app-shell')).toContain('background: var(--page-board-bg)')
expect(cssRule('.time-context-panel')).toContain('background: transparent')
expect(cssRule('.time-context-panel')).not.toContain('backdrop-filter')
expect(cssRule('.main-workspace')).toContain('background: transparent')
expect(cssRule('.app-shell--accounting')).toBe('')
expect(cssRule('.accounting-page')).toContain('background: transparent')
expect(cssRule('.map-stage')).toContain('background: transparent')
expect(cssRule('.map-stage')).not.toContain('var(--page-board-bg)')
expect(cssRule('.amap-surface')).toContain('background: transparent')
expect(cssRule('.amap-surface')).not.toContain('var(--page-board-bg)')
```

The goal is a C-style "sea color unified background + right lightweight panels" direction: only `.app-shell` paints the page board, and fixed/layout containers must not repaint or filter the same board.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/mapLayout.test.ts --maxWorkers=1
```

Expected: FAIL because `.app-shell--accounting` still overrides `--page-board-bg`, `.time-context-panel` still uses `background: var(--page-board-bg)` plus `backdrop-filter`, and the map containers still repaint `var(--page-board-bg)`.

- [ ] **Step 3: Implement the minimal CSS fix**

In `apps/web/src/App.css`:

```css
.app-shell {
  --page-board-bg:
    radial-gradient(circle at 46% 6%, rgba(255, 255, 255, 0.68), transparent 34%),
    linear-gradient(145deg, rgba(238, 244, 242, 0.66), rgba(204, 214, 215, 0.78)),
    #ccd6d7;

  background: var(--page-board-bg);
}

.time-context-panel {
  background: transparent;
  /* no backdrop-filter on the full-height rail */
}

.main-workspace {
  background: transparent;
}

.map-stage {
  background: transparent;
}

.amap-surface {
  background: transparent;
}

.accounting-page {
  background: transparent;
}
```

Remove the `.app-shell--accounting` rule entirely so route changes cannot change the app-level board background. Remove the full-height `backdrop-filter` from `.time-context-panel`, because it creates a vertical processed/unprocessed boundary even when the background token is shared.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/mapLayout.test.ts --maxWorkers=1
```

Expected: PASS.

### Task 2: Verify Full App Behavior

**Files:**
- Read: `apps/web/src/App.css`
- Read: `apps/web/src/App.tsx`

- [ ] **Step 1: Run web tests**

Run:

```powershell
npm --workspace apps/web run test -- --run --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run required repository verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all exit with code 0.

- [ ] **Step 3: Browser verify accounting and map backgrounds**

Start the frontend:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`, switch between map and accounting, and verify:

- The shared time panel and the accounting workspace sit on one continuous page background.
- The route switch does not recolor the page board.
- The map page still renders with the map covering the main pane and any exposed page background matching the left side.
- The browser console has no new runtime errors.

- [ ] **Step 4: Review diff**

Run:

```powershell
git diff -- apps/web/src/App.css apps/web/src/components/mapLayout.test.ts docs/superpowers/plans/2026-06-20-unified-page-background.md
```

Expected: diff is limited to the background contract, CSS fix, and this plan.
