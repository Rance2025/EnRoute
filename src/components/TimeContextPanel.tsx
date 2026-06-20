import { useEffect, useState, type CSSProperties } from 'react'

import { ledgerAtlasDataset } from '../accounting/ledgerAtlasData'
import { formatCnyFromCents } from '../accounting/money'
import { getPeriodMetrics } from '../accounting/selectors'
import type { AppView } from '../App'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import {
  createCurrentSelection,
  formatTimeRangeDate,
  getCalendarLabel,
  getCurrentRangeActionLabel,
  getPickerPage,
  getTimeRangeDisplay,
  getVisibleMonthDays,
  getVisibleMonthWeekIndex,
  moveDayCalendarPage,
  movePickerPage,
  selectDay,
  selectMonth,
  selectPresetRange,
  selectWeek,
  selectYear,
  updateCustomDateBoundary,
  type CalendarDisplayMode,
  type PickerPage,
  type PickerPageOption,
  type TimeRangeMode,
  type TimeRangeSelection,
} from '../time/timeRange'

export type TimeRangeKey = TimeRangeMode
export type TimeContextMetricItem = {
  label: string
  value: string
  tone?: 'income' | 'expense'
}

const DAY_CALENDAR_TRANSITION_MS = 260
const MAP_ALL_TIME_START_DATE = '2026-01-11'

const timeModeOptions: Array<SegmentedOption<TimeRangeMode>> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'custom', label: '自定义' },
]

const customPresetOptions: Array<{ value: 'all' | 'recent365' | 'recent30' | 'recent7'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'recent365', label: '最近一年' },
  { value: 'recent30', label: '最近一月' },
  { value: 'recent7', label: '最近一周' },
]

const calendarModeOptions: Array<SegmentedOption<CalendarDisplayMode>> = [
  { value: 'week', label: '周历' },
  { value: 'month', label: '月历' },
]

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']

type TimeContextPanelProps = {
  view: AppView
  selection: TimeRangeSelection
  metricItems?: TimeContextMetricItem[]
  onSelectionChange: (selection: TimeRangeSelection) => void
}

type TimeNavigationDirection = 'previous' | 'next'

type TimeNavigationState = {
  direction: TimeNavigationDirection | null
  sequence: number
}

type CustomDatePickerMode = 'day' | 'month'

export function TimeContextPanel({
  metricItems,
  view,
  selection,
  onSelectionChange,
}: TimeContextPanelProps) {
  const [calendarMode, setCalendarMode] = useState<CalendarDisplayMode>('week')
  const [isDayCalendarCollapsingWeek, setIsDayCalendarCollapsingWeek] = useState(false)
  const [dayCalendarCollapseSequence, setDayCalendarCollapseSequence] = useState(0)
  const [navigationState, setNavigationState] = useState<TimeNavigationState>({
    direction: null,
    sequence: 0,
  })
  const heading = getTimeRangeDisplay(selection)
  const resetLabel = getCurrentRangeActionLabel(selection.mode)
  const summaryItems = metricItems ?? (view === 'accounting'
    ? getAccountingSummary(selection)
    : [])

  useEffect(() => {
    if (!isDayCalendarCollapsingWeek) return undefined

    const timer = window.setTimeout(() => {
      setIsDayCalendarCollapsingWeek(false)
    }, DAY_CALENDAR_TRANSITION_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [dayCalendarCollapseSequence, isDayCalendarCollapsingWeek])

  function handleSelectionChange(nextSelection: TimeRangeSelection) {
    if (timeSelectionsAreEqual(selection, nextSelection)) return

    setNavigationState((current) => (
      current.direction === null ? current : { ...current, direction: null }
    ))
    onSelectionChange(nextSelection)
  }

  function handleCalendarModeChange(mode: CalendarDisplayMode) {
    if (mode === calendarMode) return

    if (calendarMode === 'month' && mode === 'week') {
      setIsDayCalendarCollapsingWeek(true)
      setDayCalendarCollapseSequence((current) => current + 1)
    } else {
      setIsDayCalendarCollapsingWeek(false)
    }

    setCalendarMode(mode)
  }

  function handlePeriodNavigate(
    direction: TimeNavigationDirection,
    nextSelection: TimeRangeSelection,
  ) {
    setNavigationState((current) => ({
      direction,
      sequence: current.sequence + 1,
    }))
    onSelectionChange(nextSelection)
  }

  function handleModeChange(range: TimeRangeMode) {
    if (range === selection.mode) return

    setIsDayCalendarCollapsingWeek(false)

    if (range === 'day') handleSelectionChange(selectDay(selection.anchorDate))
    if (range === 'week') handleSelectionChange(selectWeek(selection.anchorDate))
    if (range === 'month') {
      const anchor = new Date(`${selection.anchorDate}T00:00:00`)
      handleSelectionChange(selectMonth(anchor.getFullYear(), anchor.getMonth() + 1))
    }
    if (range === 'year') {
      handleSelectionChange(
        selectYear(new Date(`${selection.anchorDate}T00:00:00`).getFullYear()),
      )
    }
    if (range === 'custom') handleSelectionChange(selectPresetRangeForView('all', view))
  }

  return (
    <aside className="time-context-panel" aria-label="时间范围面板">
      <div className="time-context-panel__scroll">
        <header className="time-context-card">
          <div className="time-context-card__top">
            <div>
              <span>全局时间范围</span>
              <h2>{heading.title}</h2>
              <p>{heading.detail}</p>
            </div>
            <button
              type="button"
              className="time-context-card__today"
              aria-label={resetLabel}
              onClick={() =>
                handleSelectionChange(createCurrentSelectionForView(selection.mode, view))
              }
            >
              {resetLabel}
            </button>
          </div>

          {summaryItems.length > 0 ? (
            <section
              className="time-context-metric-strip"
              aria-label="全局范围指标"
            >
              {summaryItems.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong className={item.tone ? `is-${item.tone}` : undefined}>
                    {item.value}
                  </strong>
                </div>
              ))}
            </section>
          ) : null}

          <SegmentedControl
            ariaLabel="时间模式"
            className="time-mode-tabs"
            options={timeModeOptions}
            value={selection.mode}
            onChange={handleModeChange}
          />
        </header>

        <div className="time-panel-content">
          <div
            className="time-panel-content__stage"
            aria-label="时间范围内容"
          >
            {renderModeContent(
              selection,
              calendarMode,
              isDayCalendarCollapsingWeek,
              navigationState,
              handleCalendarModeChange,
              handleSelectionChange,
              handlePeriodNavigate,
              view,
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

function getAccountingSummary(selection: TimeRangeSelection): TimeContextMetricItem[] {
  const metrics = getPeriodMetrics(ledgerAtlasDataset, selection)

  return [
    {
      label: '净流入',
      value: formatSignedAccountingCurrency(metrics.netInCents),
      tone: metrics.netInCents >= 0 ? 'income' : 'expense',
    },
    {
      label: '支出',
      value: formatAccountingCurrency(metrics.expenseInCents),
      tone: 'expense',
    },
    { label: '流水', value: `${metrics.transactionCount} 笔` },
    { label: '账户', value: `${metrics.activeAccountCount} 个` },
  ]
}

function formatAccountingCurrency(amountInCents: number) {
  const prefix = amountInCents < 0 ? '-¥' : '¥'

  return `${prefix}${formatCnyFromCents(Math.abs(amountInCents))}`
}

function formatSignedAccountingCurrency(amountInCents: number) {
  if (amountInCents === 0) return '¥0.00'

  return `${amountInCents > 0 ? '+' : '-'}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}

function timeSelectionsAreEqual(
  currentSelection: TimeRangeSelection,
  nextSelection: TimeRangeSelection,
) {
  return (
    currentSelection.mode === nextSelection.mode &&
    currentSelection.start === nextSelection.start &&
    currentSelection.end === nextSelection.end &&
    currentSelection.anchorDate === nextSelection.anchorDate &&
    currentSelection.label === nextSelection.label
  )
}

function createSelectionFromPickerOption(
  mode: PickerPage['mode'],
  option: PickerPageOption,
): TimeRangeSelection {
  if (mode === 'day') return selectDay(option.start)
  if (mode === 'week') return selectWeek(option.anchorDate ?? option.start)
  if (mode === 'month') {
    const date = new Date(`${option.start}T00:00:00`)
    return selectMonth(date.getFullYear(), date.getMonth() + 1)
  }

  return selectYear(new Date(`${option.start}T00:00:00`).getFullYear())
}

function createCurrentSelectionForView(
  mode: TimeRangeMode,
  view: AppView,
): TimeRangeSelection {
  if (mode === 'custom') return selectPresetRangeForView('all', view)

  return createCurrentSelection(mode)
}

function selectPresetRangeForView(
  preset: 'all' | 'recent365' | 'recent30' | 'recent7',
  view: AppView,
) {
  const selection = selectPresetRange(preset)

  if (preset !== 'all' || view !== 'map') return selection

  return {
    ...selection,
    start: MAP_ALL_TIME_START_DATE,
  }
}

function renderModeContent(
  selection: TimeRangeSelection,
  calendarMode: CalendarDisplayMode,
  isDayCalendarCollapsingWeek: boolean,
  navigationState: TimeNavigationState,
  onCalendarModeChange: (mode: CalendarDisplayMode) => void,
  onSelectionChange: (selection: TimeRangeSelection) => void,
  onPeriodNavigate: (
    direction: TimeNavigationDirection,
    selection: TimeRangeSelection,
  ) => void,
  view: AppView,
) {
  if (selection.mode === 'day') {
    return (
      <DayCalendarSection
        selection={selection}
        calendarMode={calendarMode}
        isCollapsingWeek={isDayCalendarCollapsingWeek}
        navigationState={navigationState}
        onCalendarModeChange={onCalendarModeChange}
        onSelectionChange={onSelectionChange}
        onPeriodNavigate={onPeriodNavigate}
      />
    )
  }

  if (
    selection.mode === 'week' ||
    selection.mode === 'month' ||
    selection.mode === 'year'
  ) {
    const page = getPickerPage(selection)

    return (
      <TimePickerPage
        page={page}
        navigationState={navigationState}
        onMove={(direction) =>
          onPeriodNavigate(
            direction === -1 ? 'previous' : 'next',
            movePickerPage(selection, direction),
          )
        }
        onSelect={(option) =>
          onSelectionChange(createSelectionFromPickerOption(page.mode, option))
        }
      />
    )
  }

  return (
    <CustomRangeSection
      view={view}
      selection={selection}
      onSelectionChange={onSelectionChange}
    />
  )
}

function CustomRangeSection({
  view,
  selection,
  onSelectionChange,
}: {
  view: AppView
  selection: TimeRangeSelection
  onSelectionChange: (selection: TimeRangeSelection) => void
}) {
  const [activeBoundary, setActiveBoundary] = useState<'start' | 'end' | null>(null)
  const [pickerAnchorDate, setPickerAnchorDate] = useState(selection.anchorDate)

  function openPicker(boundary: 'start' | 'end') {
    setActiveBoundary((current) => (current === boundary ? null : boundary))
    setPickerAnchorDate(selection[boundary])
  }

  function handleBoundaryInput(boundary: 'start' | 'end', value: string) {
    onSelectionChange(updateCustomDateBoundary(selection, boundary, value))
    if (isDateKey(value)) setPickerAnchorDate(value)
  }

  function handleDatePick(date: string) {
    if (!activeBoundary) return

    onSelectionChange(updateCustomDateBoundary(selection, activeBoundary, date))
    setPickerAnchorDate(date)
    setActiveBoundary(null)
  }

  const activeValue = activeBoundary ? selection[activeBoundary] : selection.end

  return (
    <section className="time-custom-shell" aria-label="自定义时间范围">
      <div className="time-mode-section-head">
        <strong>自定义范围</strong>
      </div>
      <div className="time-custom-presets" aria-label="常用自定义范围">
        {customPresetOptions.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={selection.label === preset.label ? 'is-active' : undefined}
            onClick={() => {
              setActiveBoundary(null)
              onSelectionChange(selectPresetRangeForView(preset.value, view))
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="time-range-fields" aria-label="自定义日期字段">
        <CustomDateField
          boundary="start"
          label="开始"
          isOpen={activeBoundary === 'start'}
          value={selection.start}
          onInputChange={(value) => handleBoundaryInput('start', value)}
          onOpen={() => openPicker('start')}
        />
        <CustomDateField
          boundary="end"
          label="结束"
          isOpen={activeBoundary === 'end'}
          value={selection.end}
          onInputChange={(value) => handleBoundaryInput('end', value)}
          onOpen={() => openPicker('end')}
        />
      </div>
      {activeBoundary ? (
        <CustomDatePicker
          anchorDate={pickerAnchorDate}
          boundary={activeBoundary}
          selectedDate={activeValue}
          onAnchorDateChange={setPickerAnchorDate}
          onSelect={handleDatePick}
        />
      ) : null}
    </section>
  )
}

function CustomDateField({
  boundary,
  label,
  isOpen,
  value,
  onInputChange,
  onOpen,
}: {
  boundary: 'start' | 'end'
  label: string
  isOpen: boolean
  value: string
  onInputChange: (value: string) => void
  onOpen: () => void
}) {
  const ariaLabel = boundary === 'start' ? '开始日期' : '结束日期'

  return (
    <div className="time-date-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        className="sr-only"
        tabIndex={-1}
        type="text"
        value={value}
        onChange={(event) => onInputChange(event.target.value)}
      />
      <button
        type="button"
        className={isOpen ? 'time-date-button is-open' : 'time-date-button'}
        aria-label={`打开${ariaLabel}选择器，当前${formatTimeRangeDate(value)}`}
        aria-expanded={isOpen}
        onClick={onOpen}
      >
        <strong>{formatDateButtonValue(value)}</strong>
      </button>
    </div>
  )
}

function CustomDatePicker({
  anchorDate,
  boundary,
  selectedDate,
  onAnchorDateChange,
  onSelect,
}: {
  anchorDate: string
  boundary: 'start' | 'end'
  selectedDate: string
  onAnchorDateChange: (date: string) => void
  onSelect: (date: string) => void
}) {
  const [pickerMode, setPickerMode] = useState<CustomDatePickerMode>('day')
  const [navigationState, setNavigationState] = useState<TimeNavigationState>({
    direction: null,
    sequence: 0,
  })
  const days = getVisibleMonthDays(anchorDate)
  const [anchorYear, anchorMonth] = parseDateKey(anchorDate)
  const dialogLabel = boundary === 'start' ? '开始日期选择' : '结束日期选择'
  const isMonthPicker = pickerMode === 'month'
  const title = isMonthPicker ? `${anchorYear}年` : formatPickerMonth(anchorDate)
  const titleAriaLabel = isMonthPicker
    ? `返回日期选择，当前${title}`
    : `切换到月份选择，当前${title}`

  function clearNavigationDirection() {
    setNavigationState((current) => (
      current.direction === null ? current : { ...current, direction: null }
    ))
  }

  function handleMove(direction: -1 | 1) {
    setNavigationState((current) => ({
      direction: direction === -1 ? 'previous' : 'next',
      sequence: current.sequence + 1,
    }))
    onAnchorDateChange(
      isMonthPicker
        ? moveDateKeyByYears(anchorDate, direction)
        : moveDateKeyByMonths(anchorDate, direction),
    )
  }

  function handleTitleClick() {
    clearNavigationDirection()
    setPickerMode(isMonthPicker ? 'day' : 'month')
  }

  function handleMonthSelect(month: number) {
    onAnchorDateChange(moveDateKeyToMonth(anchorDate, month))
    clearNavigationDirection()
    setPickerMode('day')
  }

  return (
    <div className="time-date-picker" role="dialog" aria-label={dialogLabel}>
      <div className="time-date-picker__bar">
        <button
          type="button"
          aria-label={isMonthPicker ? '上一年' : '上个月'}
          onClick={() => handleMove(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="time-date-picker__title"
          aria-label={titleAriaLabel}
          onClick={handleTitleClick}
        >
          {title}
        </button>
        <button
          type="button"
          aria-label={isMonthPicker ? '下一年' : '下个月'}
          onClick={() => handleMove(1)}
        >
          ›
        </button>
      </div>
      {isMonthPicker ? null : (
        <div className="time-date-picker__weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      <div className="time-date-picker__grid-window">
        <div
          key={navigationState.sequence}
          className={[
            'time-date-picker__grid-motion',
            navigationState.direction
              ? `time-range-grid-motion--${navigationState.direction}`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {isMonthPicker ? (
            <div
              className="time-date-picker__grid time-date-picker__grid--months"
              aria-label="月份选择"
            >
              {Array.from({ length: 12 }, (_, index) => {
                const month = index + 1

                return (
                  <button
                    key={month}
                    type="button"
                    className={month === anchorMonth ? 'is-active' : undefined}
                    onClick={() => handleMonthSelect(month)}
                  >
                    {month}月
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="time-date-picker__grid" aria-label="日期选择">
              {days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className={[
                    day.date === selectedDate ? 'is-active' : null,
                    day.inCurrentMonth ? null : 'is-outside-month',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelect(day.date)}
                >
                  {day.day}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function moveDateKeyByMonths(value: string, months: -1 | 1) {
  const [year, month, day] = parseDateKey(value)
  const targetMonthStart = new Date(year, month - 1 + months, 1)
  const targetMonthLastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate()
  const targetDay = Math.min(day, targetMonthLastDay)

  return formatDateKey(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    targetDay,
  )
}

function moveDateKeyByYears(value: string, years: -1 | 1) {
  const [year, month, day] = parseDateKey(value)
  const targetYear = year + years
  const targetMonthLastDay = new Date(targetYear, month, 0).getDate()

  return formatDateKey(targetYear, month, Math.min(day, targetMonthLastDay))
}

function moveDateKeyToMonth(value: string, month: number) {
  const [year, , day] = parseDateKey(value)
  const targetMonthLastDay = new Date(year, month, 0).getDate()

  return formatDateKey(year, month, Math.min(day, targetMonthLastDay))
}

function formatDateButtonValue(value: string) {
  const [year, month, day] = parseDateKey(value)

  return `${year}/${padDatePart(month)}/${padDatePart(day)}`
}

function formatPickerMonth(value: string) {
  const [year, month] = parseDateKey(value)

  return `${year}年${month}月`
}

function parseDateKey(value: string): [number, number, number] {
  const [year, month, day] = value.split('-').map(Number)

  return [year, month, day]
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function DayCalendarSection({
  selection,
  calendarMode,
  isCollapsingWeek,
  navigationState,
  onCalendarModeChange,
  onSelectionChange,
  onPeriodNavigate,
}: {
  selection: TimeRangeSelection
  calendarMode: CalendarDisplayMode
  isCollapsingWeek: boolean
  navigationState: TimeNavigationState
  onCalendarModeChange: (mode: CalendarDisplayMode) => void
  onSelectionChange: (selection: TimeRangeSelection) => void
  onPeriodNavigate: (
    direction: TimeNavigationDirection,
    selection: TimeRangeSelection,
  ) => void
}) {
  return (
    <section className="time-calendar-shell" aria-label="日历选择">
      <div className="time-mode-section-head">
        <strong>按日选择</strong>
        <SegmentedControl
          ariaLabel="日历显示方式"
          className="time-calendar-switch"
          options={calendarModeOptions}
          value={calendarMode}
          onChange={(mode) => {
            if (mode !== calendarMode) onCalendarModeChange(mode)
          }}
        />
      </div>
      <div className="time-calendar-bar">
        <button
          type="button"
          aria-label="上一段时间"
          onClick={() =>
            onPeriodNavigate(
              'previous',
              moveDayCalendarPage(selection, -1, calendarMode),
            )
          }
        >
          ‹
        </button>
        <span>{getCalendarLabel(selection, calendarMode)}</span>
        <button
          type="button"
          aria-label="下一段时间"
          onClick={() =>
            onPeriodNavigate(
              'next',
              moveDayCalendarPage(selection, 1, calendarMode),
            )
          }
        >
          ›
        </button>
      </div>
      <AnimatedDayCalendar
        calendarMode={calendarMode}
        isCollapsingWeek={isCollapsingWeek}
        navigationState={navigationState}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />
    </section>
  )
}

function AnimatedDayCalendar({
  calendarMode,
  isCollapsingWeek,
  navigationState,
  selection,
  onSelectionChange,
}: {
  calendarMode: CalendarDisplayMode
  isCollapsingWeek: boolean
  navigationState: TimeNavigationState
  selection: TimeRangeSelection
  onSelectionChange: (selection: TimeRangeSelection) => void
}) {
  const days = getVisibleMonthDays(selection.anchorDate)
  const renderedRows = days.length / 7
  const visibleRows = calendarMode === 'week' ? 1 : renderedRows
  const activeWeekIndex = getVisibleMonthWeekIndex(selection.anchorDate)
  const calendarBodyMode = isCollapsingWeek ? 'collapsing-week' : calendarMode

  return (
    <div
      className={`time-calendar-body time-calendar-body--${calendarBodyMode}`}
      style={
        {
          '--time-calendar-visible-rows': visibleRows,
          '--time-calendar-active-week-index': activeWeekIndex,
        } as CSSProperties
      }
    >
      <div className="time-calendar-weekdays">
        {weekdayLabels.map((label) => (
          <span key={label} className="time-calendar-weekday">
            {label}
          </span>
        ))}
      </div>
      <div className="time-calendar-grid-window">
        <div
          key={navigationState.sequence}
          className={[
            'time-calendar-grid-motion',
            navigationState.direction
              ? `time-range-grid-motion--${navigationState.direction}`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="time-calendar-grid" aria-label="日历日期">
            {days.map((day, index) => (
              <button
                type="button"
                key={day.date}
                className={[
                  selection.start === day.date ? 'is-active' : null,
                  day.inCurrentMonth ? null : 'is-outside-month',
                  calendarBodyMode === 'week' &&
                  Math.floor(index / 7) === activeWeekIndex
                    ? 'is-visible-week'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectionChange(selectDay(day.date))}
              >
                {day.day}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function TimePickerPage({
  page,
  navigationState,
  onMove,
  onSelect,
}: {
  page: PickerPage
  navigationState: TimeNavigationState
  onMove: (direction: -1 | 1) => void
  onSelect: (option: PickerPageOption) => void
}) {
  const gridClassName = ['time-picker-grid', page.gridClassName].join(' ')
  const optionButtons = page.options.map((option) => (
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
  ))

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
      <div className="time-picker-grid-window">
        <div
          key={navigationState.sequence}
          className={[
            'time-picker-grid-motion',
            navigationState.direction
              ? `time-range-grid-motion--${navigationState.direction}`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className={gridClassName}>{optionButtons}</div>
        </div>
      </div>
    </section>
  )
}
