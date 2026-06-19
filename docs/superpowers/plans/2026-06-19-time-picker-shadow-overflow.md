# Time Picker Shadow Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make day calendar cells use the same restrained hover animation as week/month/year picker cells, and keep hover/active shadows visible for all day/week/month/year picker grids.

**Architecture:** Keep the existing React structure in `TimeContextPanel`. Encode the visual contract in the existing CSS-focused `mapLayout.test.ts`, then make a scoped CSS change in `App.css`: both grid windows keep clipping for page/row masking but gain an internal shadow buffer, while the day-cell override that removed hover lift/shadow is removed.

**Tech Stack:** React 19, TypeScript, Vitest, CSS.

---

### Task 1: CSS Contract

**Files:**
- Modify: `src/components/mapLayout.test.ts`

- [ ] **Step 1: Write failing style assertions**

Update the existing time picker layout tests so they assert:

```ts
expect(dayWindowRule).toContain('--time-picker-shadow-buffer')
expect(dayWindowRule).toContain('padding: var(--time-picker-shadow-buffer)')
expect(dayWindowRule).toContain('var(--time-picker-shadow-buffer) * 2')
expect(dayWindowRule).toContain('width: calc(100% + var(--time-picker-shadow-buffer) * 2)')
expect(dayWindowRule).toContain('calc(var(--time-picker-shadow-buffer) * -1)')
expect(pickerWindowRule).toContain('--time-picker-shadow-buffer')
expect(pickerWindowRule).toContain('padding: var(--time-picker-shadow-buffer)')
expect(pickerWindowRule).toContain('width: calc(100% + var(--time-picker-shadow-buffer) * 2)')
expect(pickerWindowRule).toContain('calc(var(--time-picker-shadow-buffer) * -1)')
expect(calendarHoverRule).toContain('0 8px 16px rgba(18, 63, 53, 0.1)')
expect(calendarHoverRule).toContain('transform: translateY(-0.5px)')
expect(calendarActiveRule).toContain('0 9px 20px rgba(18, 63, 53, 0.22)')
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `npm test -- --run src/components/mapLayout.test.ts`

Expected: FAIL because the CSS does not yet expose the shadow buffer and day hover/active still suppresses the shared outer shadow.

### Task 2: CSS Fix

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add shared shadow buffers to both grid windows**

Add `--time-picker-shadow-buffer: 12px`, matching padding, expanded width, and a negative margin to `.time-calendar-grid-window` and `.time-picker-grid-window`. For `.time-calendar-grid-window`, include the buffer in the height formula because the app uses global `box-sizing: border-box`. Keep `overflow: hidden` so week mode and page transitions still mask hidden rows/pages.

- [ ] **Step 2: Restore day hover and active outer shadows**

Remove the date-specific hover and active overrides that strip the shared outer shadow from `.time-calendar-grid button`. Mark the visible week row in `TimeContextPanel` with `is-visible-week`, and hide non-visible week buttons in week mode so the expanded shadow buffer does not reveal adjacent weeks.

- [ ] **Step 3: Run focused test to verify pass**

Run: `npm test -- --run src/components/mapLayout.test.ts`

Expected: PASS.

### Task 3: Verification

**Files:**
- No additional file changes.

- [ ] **Step 1: Run required automated checks**

Run:

```powershell
npm test -- --run
npm run lint
npm run build
```

- [ ] **Step 2: Browser check**

Run the Vite dev server and inspect the time panel. Verify day/week/month/year hover and selected states are not visually clipped at the grid edges.
