# Time Calendar Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the day calendar switch from `周历` to `月历` with a natural expanding animation while every date button keeps the week-calendar height.

**Architecture:** Keep `TimeContextPanel` as the owner of the calendar mode and add a small calendar-body wrapper around the existing week/month calendar render. Use CSS custom properties for the shared button height and mode-specific row counts so animation and dimensions are testable without adding a motion dependency.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS transitions in `src/App.css`.

---

## File Structure

- `src/components/TimeContextPanel.tsx`: add a stable `.time-calendar-body` wrapper and a mode-specific class around the existing calendar grid output.
- `src/App.css`: define `--time-calendar-day-height`, animate calendar body height, keep both week and month date buttons at the same height, and reveal added month rows smoothly.
- `src/components/mapLayout.test.ts`: add source-level CSS contract tests for shared height and animated body.
- `src/components/mapShellLayout.test.tsx`: add render-level structure tests for the week/month wrapper classes.

---

### Task 1: Add Calendar Layout Contract Tests

**Files:**
- Modify: `src/components/mapLayout.test.ts`
- Modify: `src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: Write the failing CSS contract test**

Add this test after `applies the same restrained hover-only motion to week month and year selectors` in `src/components/mapLayout.test.ts`:

```ts
  it('animates day calendar expansion while preserving the week row button height', () => {
    const shellRule = cssRule('.time-calendar-shell')
    const bodyRule = cssRule('.time-calendar-body')
    const weekBodyRule = cssRule('.time-calendar-body--week')
    const monthBodyRule = cssRule('.time-calendar-body--month')
    const buttonRule = cssRule('.time-calendar-grid button')
    const monthButtonRule = cssRule('.time-calendar-grid--month button')

    expect(shellRule).toContain('--time-calendar-day-height: 37px')
    expect(bodyRule).toContain('overflow: hidden')
    expect(bodyRule).toContain('transition:')
    expect(bodyRule).toContain('max-height')
    expect(bodyRule).toContain('opacity')
    expect(weekBodyRule).toContain('--time-calendar-visible-rows: 1')
    expect(monthBodyRule).toContain('--time-calendar-visible-rows: 6')
    expect(buttonRule).toContain('height: var(--time-calendar-day-height)')
    expect(buttonRule).toContain('min-height: var(--time-calendar-day-height)')
    expect(monthButtonRule).not.toContain('min-height: 31px')
  })
```

- [ ] **Step 2: Write the failing render structure test**

Add this test before `applies concrete selections from every time panel button group` in `src/components/mapShellLayout.test.tsx`:

```ts
  it('wraps week and month day calendars in animated mode-specific bodies', () => {
    render(<App amapConfig={configuredAmap} />)

    const weekBody = screen.getByLabelText('日历日期').closest('.time-calendar-body')

    expect(weekBody).toHaveClass('time-calendar-body--week')
    expect(within(weekBody as HTMLElement).getAllByRole('button')).toHaveLength(7)

    fireEvent.click(screen.getByRole('button', { name: '月历' }))

    const monthBody = screen.getByLabelText('日历日期').closest('.time-calendar-body')

    expect(monthBody).toHaveClass('time-calendar-body--month')
    expect(within(monthBody as HTMLElement).getAllByRole('button')).toHaveLength(35)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
npm test -- --run src/components/mapLayout.test.ts src/components/mapShellLayout.test.tsx
```

Expected: FAIL because `.time-calendar-body` does not exist and month buttons still use `min-height: 31px`.

---

### Task 2: Add the Animated Calendar Body

**Files:**
- Modify: `src/components/TimeContextPanel.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Update the calendar render wrapper**

In `src/components/TimeContextPanel.tsx`, replace the direct conditional calendar render:

```tsx
        {calendarMode === 'week' ? (
          <WeekCalendar selection={selection} onSelect={onSelectionChange} />
        ) : (
          <MonthCalendar selection={selection} onSelect={onSelectionChange} />
        )}
```

with:

```tsx
        <div className={`time-calendar-body time-calendar-body--${calendarMode}`}>
          {calendarMode === 'week' ? (
            <WeekCalendar selection={selection} onSelect={onSelectionChange} />
          ) : (
            <MonthCalendar selection={selection} onSelect={onSelectionChange} />
          )}
        </div>
```

- [ ] **Step 2: Add accessible labels to the date grids**

In `WeekCalendar`, change:

```tsx
    <div className="time-calendar-grid time-calendar-grid--week">
```

to:

```tsx
    <div className="time-calendar-grid time-calendar-grid--week" aria-label="日历日期">
```

In `MonthCalendar`, change:

```tsx
    <div className="time-calendar-grid time-calendar-grid--month">
```

to:

```tsx
    <div className="time-calendar-grid time-calendar-grid--month" aria-label="日历日期">
```

- [ ] **Step 3: Add the CSS animation and shared height**

In `src/App.css`, update `.time-calendar-shell` with:

```css
.time-calendar-shell {
  --time-calendar-day-height: 37px;
  --time-calendar-weekday-height: 17px;
  --time-calendar-grid-gap: 5px;
}
```

Add after `.time-calendar-grid`:

```css
.time-calendar-body {
  --time-calendar-visible-rows: 1;

  max-height: calc(
    var(--time-calendar-weekday-height) +
    var(--time-calendar-grid-gap) +
    var(--time-calendar-visible-rows) * var(--time-calendar-day-height) +
    (var(--time-calendar-visible-rows) - 1) * var(--time-calendar-grid-gap)
  );
  overflow: hidden;
  opacity: 1;
  transition:
    max-height 260ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease;
}

.time-calendar-body--week {
  --time-calendar-visible-rows: 1;
}

.time-calendar-body--month {
  --time-calendar-visible-rows: 6;
}
```

Update `.time-calendar-weekday` to use:

```css
  height: var(--time-calendar-weekday-height);
  min-height: var(--time-calendar-weekday-height);
```

Update `.time-calendar-grid button` to use:

```css
  height: var(--time-calendar-day-height);
  min-height: var(--time-calendar-day-height);
```

Update `.time-calendar-grid--month button` so it no longer sets `min-height: 31px`.

- [ ] **Step 4: Run focused tests to verify they pass**

Run:

```powershell
npm test -- --run src/components/mapLayout.test.ts src/components/mapShellLayout.test.tsx
```

Expected: PASS.

---

### Task 3: Full Verification

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Run full test suite**

Run:

```powershell
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit 0.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Browser verify the calendar transition**

Run the dev server:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Open the app in a browser, switch `周历` to `月历`, and verify:

- The calendar expands smoothly.
- Week and month date buttons share the same height.
- Month mode does not show the shorter old buttons.
- No console runtime errors appear.

---

## Self-Review

- Spec coverage: Task 1 covers the test contract; Task 2 implements wrapper, accessible structure, animation, and shared height; Task 3 covers required verification.
- Placeholder scan: no placeholder implementation steps remain.
- Type consistency: no new TypeScript types are introduced; class names are consistent across test, JSX, and CSS.
