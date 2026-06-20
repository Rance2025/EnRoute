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

const DAY_CALENDAR_TRANSITION_MS = 260

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
  onSelectionChange: (selection: TimeRangeSelection) => void
}

type TimeNavigationDirection = 'previous' | 'next'

type TimeNavigationState = {
  direction: TimeNavigationDirection | null
  sequence: number
}

export function TimeContextPanel({
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
  const accountingSummary = view === 'accounting'
    ? getAccountingSummary(selection)
    : null

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
    if (range === 'custom') handleSelectionChange(selectPresetRange('all'))
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
              onClick={() => handleSelectionChange(createCurrentSelection(selection.mode))}
            >
              {resetLabel}
            </button>
          </div>

          {accountingSummary ? (
            <section
              className="time-context-accounting-summary"
              aria-label="记账概览卡片"
            >
              {accountingSummary.map((item) => (
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
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

function getAccountingSummary(selection: TimeRangeSelection) {
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
  if (mode === 'week') return selectWeek(option.start)
  if (mode === 'month') {
    const date = new Date(`${option.start}T00:00:00`)
    return selectMonth(date.getFullYear(), date.getMonth() + 1)
  }

  return selectYear(new Date(`${option.start}T00:00:00`).getFullYear())
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
            onClick={() => onSelectionChange(selectPresetRange(preset.value))}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="time-range-fields">
        <label>
          <span>开始</span>
          <input
            aria-label="开始日期"
            type="date"
            value={selection.start}
            onChange={(event) =>
              onSelectionChange(updateCustomDateBoundary(selection, 'start', event.target.value))
            }
          />
          <strong>{formatTimeRangeDate(selection.start)}</strong>
        </label>
        <label>
          <span>结束</span>
          <input
            aria-label="结束日期"
            type="date"
            value={selection.end}
            onChange={(event) =>
              onSelectionChange(updateCustomDateBoundary(selection, 'end', event.target.value))
            }
          />
          <strong>{formatTimeRangeDate(selection.end)}</strong>
        </label>
      </div>
    </section>
  )
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
