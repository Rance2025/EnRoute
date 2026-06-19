# Unified Time Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate day/week/month/year selectors in the shared time panel with one paged grid selector pattern.

**Architecture:** Keep `src/time/timeRange.ts` as the pure date/range model and add page-option helpers for day, week, month, and year. Keep `TimeContextPanel` as the shared UI owner, but render all four range modes through one local picker shell. Preserve `all` and `custom` content and the existing app shell geometry.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, CSS.

---

### File Structure

- Modify: `src/time/timeRange.ts`
  - Add typed page models for day/week/month/year picker pages.
  - Add pure helpers for page titles, visible options, and page movement.
  - Keep existing selection functions and display formatting.
- Modify: `src/time/timeRange.test.ts`
  - Add RED tests for month/year/week/day picker page behavior.
  - Update old movement expectations from week/month day-calendar behavior to month-paged day behavior.
- Modify: `src/components/TimeContextPanel.tsx`
  - Remove day-only `week/month` calendar toggle.
  - Render day/week/month/year with one shared picker shell.
  - Keep `all` and `custom` sections.
- Modify: `src/components/mapShellLayout.test.tsx`
  - Update panel tests to expect the unified page bar and picker grids.
  - Verify month has 12 choices and year has 10 choices.
- Modify: `src/App.css`
  - Reuse existing visual language while adding fixed grid classes for week/month/year.
  - Remove now-unused calendar switch rules.

---

### Task 1: Time Range Page Model

**Files:**
- Modify: `src/time/timeRange.test.ts`
- Modify: `src/time/timeRange.ts`

- [ ] **Step 1: Write failing model tests**

Add these imports in `src/time/timeRange.test.ts`:

```ts
  getPickerPage,
  movePickerPage,
```

Add this test before `selects concrete day, week, month, and year ranges`:

```ts
  it('builds unified picker pages for day, week, month, and year modes', () => {
    const dayPage = getPickerPage(selectDay('2026-07-14'))

    expect(dayPage).toMatchObject({
      mode: 'day',
      title: '2026年7月',
      gridClassName: 'time-picker-grid--days',
    })
    expect(dayPage.options).toHaveLength(35)
    expect(dayPage.options[0]).toMatchObject({
      key: '2026-06-29',
      label: '29',
      start: '2026-06-29',
      outsidePage: true,
    })
    expect(dayPage.options.find((option) => option.key === '2026-07-14')).toMatchObject({
      label: '14',
      start: '2026-07-14',
      active: true,
      outsidePage: false,
    })

    const weekPage = getPickerPage(selectWeek('2026-07-20'))

    expect(weekPage).toMatchObject({
      mode: 'week',
      title: '2026年7月',
      gridClassName: 'time-picker-grid--weeks',
    })
    expect(weekPage.options.map((option) => option.start)).toEqual([
      '2026-06-29',
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
    ])
    expect(weekPage.options.find((option) => option.start === '2026-07-20')).toMatchObject({
      label: '第30周',
      detail: '7月20日 - 7月26日',
      active: true,
    })

    const monthPage = getPickerPage(selectMonth(2026, 7))

    expect(monthPage).toMatchObject({
      mode: 'month',
      title: '2026年',
      gridClassName: 'time-picker-grid--months',
    })
    expect(monthPage.options).toHaveLength(12)
    expect(monthPage.options[6]).toMatchObject({
      key: '2026-07',
      label: '7月',
      start: '2026-07-01',
      active: true,
    })

    const yearPage = getPickerPage(selectYear(2026))

    expect(yearPage).toMatchObject({
      mode: 'year',
      title: '2020 - 2029',
      gridClassName: 'time-picker-grid--years',
    })
    expect(yearPage.options.map((option) => option.label)).toEqual([
      '2020年',
      '2021年',
      '2022年',
      '2023年',
      '2024年',
      '2025年',
      '2026年',
      '2027年',
      '2028年',
      '2029年',
    ])
    expect(yearPage.options.find((option) => option.key === '2026')).toMatchObject({
      active: true,
      start: '2026-01-01',
    })
  })
```

Add this test immediately after it:

```ts
  it('moves unified picker pages by the visible page unit', () => {
    expect(movePickerPage(selectDay('2026-07-14'), -1)).toMatchObject({
      mode: 'day',
      anchorDate: '2026-06-14',
      start: '2026-06-14',
    })

    expect(movePickerPage(selectWeek('2026-07-20'), 1)).toMatchObject({
      mode: 'week',
      anchorDate: '2026-08-17',
      start: '2026-08-17',
      end: '2026-08-23',
    })

    expect(movePickerPage(selectMonth(2026, 7), 1)).toMatchObject({
      mode: 'month',
      anchorDate: '2027-07-01',
      start: '2027-07-01',
      end: '2027-07-31',
    })

    expect(movePickerPage(selectYear(2026), -1)).toMatchObject({
      mode: 'year',
      anchorDate: '2016-06-30',
      start: '2016-01-01',
      end: '2016-12-31',
    })
  })
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
npm test -- --run src/time/timeRange.test.ts
```

Expected: fail because `getPickerPage` and `movePickerPage` are not exported.

- [ ] **Step 3: Add picker page types and helpers**

In `src/time/timeRange.ts`, add these exported types after `WeekOption`:

```ts
export type PickerPageMode = Extract<TimeRangeMode, 'day' | 'week' | 'month' | 'year'>

export type PickerPageOption = {
  key: string
  label: string
  detail?: string
  start: string
  end: string
  active: boolean
  outsidePage?: boolean
}

export type PickerPage = {
  mode: PickerPageMode
  title: string
  label: string
  gridClassName: string
  options: PickerPageOption[]
}
```

Add these functions after `getCalendarLabel`:

```ts
export function getPickerPage(selection: TimeRangeSelection): PickerPage {
  if (selection.mode === 'week') return getWeekPickerPage(selection)
  if (selection.mode === 'month') return getMonthPickerPage(selection)
  if (selection.mode === 'year') return getYearPickerPage(selection)

  return getDayPickerPage(selection)
}

export function movePickerPage(
  selection: TimeRangeSelection,
  direction: -1 | 1,
): TimeRangeSelection {
  const anchor = parseDate(selection.anchorDate)

  if (selection.mode === 'week') {
    const nextMonth = addMonths(anchor, direction)
    return selectWeek(formatDateKey(startOfWeek(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 15))))
  }

  if (selection.mode === 'month') {
    return selectMonth(anchor.getFullYear() + direction, anchor.getMonth() + 1)
  }

  if (selection.mode === 'year') {
    return selectYear(parseDate(selection.start).getFullYear() + direction * 10)
  }

  return selectDay(formatDateKey(addMonths(anchor, direction)))
}
```

Add these internal helpers before `normalizeCustomSelection`:

```ts
function getDayPickerPage(selection: TimeRangeSelection): PickerPage {
  const anchor = parseDate(selection.anchorDate)

  return {
    mode: 'day',
    title: formatYearMonth(selection.anchorDate),
    label: '按日选择',
    gridClassName: 'time-picker-grid--days',
    options: getVisibleMonthDays(selection.anchorDate).map((day) => ({
      key: day.date,
      label: String(day.day),
      start: day.date,
      end: day.date,
      active: selection.mode === 'day' && selection.start === day.date,
      outsidePage: day.inCurrentMonth ? false : true,
    })),
  }
}

function getWeekPickerPage(selection: TimeRangeSelection): PickerPage {
  const anchor = parseDate(selection.anchorDate)
  const firstVisibleWeek = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const lastMonthDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const lastVisibleWeek = startOfWeek(lastMonthDay)
  const weekCount =
    Math.round((lastVisibleWeek.getTime() - firstVisibleWeek.getTime()) / (86_400_000 * 7)) + 1

  return {
    mode: 'week',
    title: formatYearMonth(selection.anchorDate),
    label: '按周聚合',
    gridClassName: 'time-picker-grid--weeks',
    options: Array.from({ length: weekCount }, (_, index) => {
      const start = addDays(firstVisibleWeek, index * 7)
      const startKey = formatDateKey(start)
      const endKey = formatDateKey(addDays(start, 6))

      return {
        key: startKey,
        label: `第${getWeekNumber(startKey)}周`,
        detail: `${formatMonthDay(startKey)} - ${formatMonthDay(endKey)}`,
        start: startKey,
        end: endKey,
        active: selection.mode === 'week' && selection.start === startKey,
      }
    }),
  }
}

function getMonthPickerPage(selection: TimeRangeSelection): PickerPage {
  const anchor = parseDate(selection.anchorDate)
  const year = anchor.getFullYear()

  return {
    mode: 'month',
    title: `${year}年`,
    label: '按月聚合',
    gridClassName: 'time-picker-grid--months',
    options: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const start = formatDateKey(new Date(year, index, 1))
      const end = formatDateKey(new Date(year, month, 0))

      return {
        key: `${year}-${String(month).padStart(2, '0')}`,
        label: `${month}月`,
        start,
        end,
        active: selection.mode === 'month' && selection.start === start,
      }
    }),
  }
}

function getYearPickerPage(selection: TimeRangeSelection): PickerPage {
  const selectedYear = parseDate(selection.start).getFullYear()
  const pageStart = Math.floor(selectedYear / 10) * 10
  const pageEnd = pageStart + 9

  return {
    mode: 'year',
    title: `${pageStart} - ${pageEnd}`,
    label: '按年聚合',
    gridClassName: 'time-picker-grid--years',
    options: Array.from({ length: 10 }, (_, index) => {
      const year = pageStart + index

      return {
        key: String(year),
        label: `${year}年`,
        start: `${year}-01-01`,
        end: `${year}-12-31`,
        active: selection.mode === 'year' && selectedYear === year,
      }
    }),
  }
}
```

Add this formatter near the other format helpers:

```ts
function formatYearMonth(value: string) {
  const date = parseDate(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```powershell
npm test -- --run src/time/timeRange.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/time/timeRange.ts src/time/timeRange.test.ts
git commit -m "test: 补充统一时间选择模型"
```

Expected: commit succeeds.

---

### Task 2: Unified Time Panel Rendering

**Files:**
- Modify: `src/components/mapShellLayout.test.tsx`
- Modify: `src/components/TimeContextPanel.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write failing panel tests**

In `src/components/mapShellLayout.test.tsx`, update the first shared-panel test so it no longer expects `周历`, the calendar display slider, or `日历显示方式`. It should assert:

```ts
    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.getByText('2026年6月')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '日历显示方式' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '周历' })).not.toBeInTheDocument()
```

Add this test after `renders month aggregation as a compact two-row picker without helper copy`:

```ts
  it('renders day, week, month, and year with the same paged picker shell', () => {
    render(<App amapConfig={configuredAmap} />)

    const dayPicker = screen.getByLabelText('时间选择页')

    expect(within(dayPicker).getByText('按日选择')).toBeInTheDocument()
    expect(within(dayPicker).getByText('2026年6月')).toBeInTheDocument()
    expect(within(dayPicker).getByLabelText('上一页')).toBeInTheDocument()
    expect(within(dayPicker).getByLabelText('下一页')).toBeInTheDocument()
    expect(within(dayPicker).getAllByRole('button')).toHaveLength(37)

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    const weekPicker = screen.getByLabelText('时间选择页')
    expect(within(weekPicker).getByText('按周聚合')).toBeInTheDocument()
    expect(within(weekPicker).getByText('2026年6月')).toBeInTheDocument()
    expect(within(weekPicker).getByRole('button', { name: /第25周/ })).toBeInTheDocument()
    expect(screen.queryByText('选择一周')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月' }))

    const monthPicker = screen.getByLabelText('时间选择页')
    expect(within(monthPicker).getByText('2026年')).toBeInTheDocument()
    expect(within(monthPicker).getAllByRole('button')).toHaveLength(14)
    expect(within(monthPicker).getByRole('button', { name: '12月' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))

    const yearPicker = screen.getByLabelText('时间选择页')
    expect(within(yearPicker).getByText('2020 - 2029')).toBeInTheDocument()
    expect(within(yearPicker).getAllByRole('button')).toHaveLength(12)
    expect(within(yearPicker).getByRole('button', { name: '2029年' })).toBeInTheDocument()
  })
```

Update `applies concrete selections from every time panel button group`:

- Remove the click on `月历`.
- Replace the day next-page assertion with `7月21日`, because day page movement is now monthly.
- Replace the week option lookup with `第30周`.
- Replace the year option lookup with `2025年`.

The relevant sequence should be:

```ts
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByRole('heading', { name: '7月21日' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '周' }))
    fireEvent.click(screen.getByRole('button', { name: /第30周/ }))
```

- [ ] **Step 2: Run panel tests and confirm RED**

Run:

```powershell
npm test -- --run src/components/mapShellLayout.test.tsx
```

Expected: fail because `TimeContextPanel` still renders separate controls.

- [ ] **Step 3: Replace mode rendering with shared picker shell**

In `src/components/TimeContextPanel.tsx`:

- Remove `SegmentedOption` type import for `calendarModeOptions` only if it becomes unused.
- Remove imports for `getCalendarLabel`, `getVisibleWeekDays`, `getWeekOptions`, `moveTimeSelection`, and `CalendarDisplayMode` if no longer needed.
- Add imports:

```ts
  getPickerPage,
  movePickerPage,
  type PickerPage,
  type PickerPageOption,
```

Keep the `calendarMode` prop for now to avoid touching `App.tsx`, but prefix it as unused in destructuring if needed:

```ts
  calendarMode: _calendarMode,
  onCalendarModeChange: _onCalendarModeChange,
```

Replace the `renderModeContent` signature with:

```ts
function renderModeContent(
  selection: TimeRangeSelection,
  onSelectionChange: (selection: TimeRangeSelection) => void,
) {
```

Change the call site to:

```tsx
          {renderModeContent(selection, onSelectionChange)}
```

For day/week/month/year, return:

```tsx
  if (
    selection.mode === 'day' ||
    selection.mode === 'week' ||
    selection.mode === 'month' ||
    selection.mode === 'year'
  ) {
    return (
      <TimePickerPage
        page={getPickerPage(selection)}
        onMove={(direction) => onSelectionChange(movePickerPage(selection, direction))}
        onSelect={(option) => onSelectionChange(createSelectionFromPickerOption(page.mode, option))}
      />
    )
  }
```

Because `page` is needed twice, implement it as:

```tsx
    const page = getPickerPage(selection)

    return (
      <TimePickerPage
        page={page}
        onMove={(direction) => onSelectionChange(movePickerPage(selection, direction))}
        onSelect={(option) => onSelectionChange(createSelectionFromPickerOption(page.mode, option))}
      />
    )
```

Add this helper above `renderModeContent`:

```ts
function createSelectionFromPickerOption(
  mode: PickerPage['mode'],
  option: PickerPageOption,
): TimeRangeSelection {
  if (mode === 'day') return selectDay(option.start)
  if (mode === 'week') return selectWeek(option.start)
  if (mode === 'month') {
    const date = new Date(`${option.start}T00:00:00`)
    return selectMonth(date.getFullYear(), date.getMonth() + 1)
  }

  return selectYear(new Date(`${option.start}T00:00:00`).getFullYear())
}
```

Add this component above `WeekCalendar` and then delete `WeekCalendar` and `MonthCalendar`:

```tsx
function TimePickerPage({
  page,
  onMove,
  onSelect,
}: {
  page: PickerPage
  onMove: (direction: -1 | 1) => void
  onSelect: (option: PickerPageOption) => void
}) {
  return (
    <section className="time-selector-shell" aria-label="时间选择页">
      <div className="time-mode-section-head">
        <strong>{page.label}</strong>
      </div>
      <div className="time-picker-bar">
        <button type="button" aria-label="上一页" onClick={() => onMove(-1)}>
          ‹
        </button>
        <span>{page.title}</span>
        <button type="button" aria-label="下一页" onClick={() => onMove(1)}>
          ›
        </button>
      </div>
      <div className={['time-picker-grid', page.gridClassName].join(' ')}>
        {page.mode === 'day' &&
          weekdayLabels.map((label) => (
            <span key={label} className="time-calendar-weekday">
              {label}
            </span>
          ))}
        {page.options.map((option) => (
          <button
            type="button"
            key={option.key}
            className={[
              option.active ? 'is-active' : null,
              option.outsidePage ? 'is-outside-page' : null,
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelect(option)}
          >
            <span>{option.label}</span>
            {option.detail ? <small>{option.detail}</small> : null}
          </button>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Update CSS for shared picker**

In `src/App.css`:

- Rename `.time-calendar-bar` rules to also target `.time-picker-bar`.
- Add these rules near the existing calendar/grid section:

```css
.time-picker-grid {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.time-picker-grid--days {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.time-picker-grid--weeks {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.time-picker-grid--months {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.time-picker-grid--years {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.time-picker-grid button {
  min-width: 0;
  min-height: 42px;
  display: grid;
  place-items: center;
  gap: 3px;
  border: 1px solid transparent;
  border-radius: 13px;
  color: rgba(17, 40, 35, 0.66);
  background: rgba(17, 40, 35, 0.055);
  font-size: 12px;
  font-weight: 820;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.58);
  transition:
    border-color 150ms ease,
    background 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.time-picker-grid--days button {
  min-height: 31px;
}

.time-picker-grid--weeks button {
  min-height: 52px;
  align-content: center;
}

.time-picker-grid button small {
  min-width: 0;
  overflow: hidden;
  color: rgba(17, 40, 35, 0.46);
  font-size: 10px;
  font-weight: 740;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-picker-grid button:hover {
  color: #123f35;
  border-color: rgba(18, 63, 53, 0.16);
  background: rgba(18, 63, 53, 0.105);
  box-shadow:
    0 8px 16px rgba(18, 63, 53, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.68);
  transform: translateY(-0.5px);
}

.time-picker-grid button.is-active {
  color: #f8fbfa;
  border-color: transparent;
  background: #123f35;
  box-shadow: 0 9px 20px rgba(18, 63, 53, 0.22);
}

.time-picker-grid button.is-active small {
  color: rgba(255, 255, 255, 0.68);
}

.time-picker-grid button.is-outside-page {
  color: rgba(17, 40, 35, 0.32);
  background: rgba(17, 40, 35, 0.032);
}
```

- Remove `.time-calendar-switch` rules if unused.
- Keep old `.time-calendar-grid` rules only if no tests or styles break; otherwise remove after GREEN.

- [ ] **Step 5: Run panel tests and confirm GREEN**

Run:

```powershell
npm test -- --run src/components/mapShellLayout.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add src/components/mapShellLayout.test.tsx src/components/TimeContextPanel.tsx src/App.css
git commit -m "feat: 统一时间面板分页选择控件"
```

Expected: commit succeeds.

---

### Task 3: Full Verification And Browser Check

**Files:**
- No code files expected.

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

- [ ] **Step 4: Start local dev server**

Run:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

If port 5173 is busy, use 5174.

- [ ] **Step 5: Browser verify**

Open the local URL and verify:

- Map page renders or shows the existing missing-key state without React crash.
- Left time panel renders `日 / 周 / 月 / 年 / 全部 / 自定义`.
- Day mode shows a single page bar titled by month and no `周历 / 月历` switch.
- Week mode shows paged week blocks.
- Month mode shows 12 months and can page by year.
- Year mode shows 10 years as `2 x 5` and can page by decade.
- Accounting page keeps the same shared time panel.
- Browser console has no app runtime errors.

- [ ] **Step 6: Final status**

Run:

```powershell
git status --short
```

Expected: clean working tree or only intentional untracked local debug files ignored by `.gitignore`.
