import type { CSSProperties } from 'react'

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
  setCustomRangeBoundary,
  type CalendarDisplayMode,
  type PickerPage,
  type PickerPageOption,
  type TimeRangeMode,
  type TimeRangeSelection,
} from '../time/timeRange'

export type TimeRangeKey = TimeRangeMode

const timeModeOptions: Array<SegmentedOption<TimeRangeMode>> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
]

const calendarModeOptions: Array<SegmentedOption<CalendarDisplayMode>> = [
  { value: 'week', label: '周历' },
  { value: 'month', label: '月历' },
]

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']

const moduleSummaries: Record<
  AppView,
  Array<{ label: string; value: string }>
> = {
  overview: [
    { label: '位置', value: '待汇总' },
    { label: '金钱', value: '待汇总' },
    { label: '时间', value: '待汇总' },
  ],
  map: [
    { label: '地图', value: '足迹 18' },
    { label: '记账', value: '账目 3' },
    { label: '日程', value: '事件 2' },
  ],
  schedule: [
    { label: '日程', value: '2' },
    { label: '待办', value: '6' },
    { label: '事件', value: '待整理' },
  ],
  accounting: [
    { label: '流水', value: '3' },
    { label: '支出', value: '¥420' },
    { label: '净入', value: '¥4,921' },
  ],
}

type TimeContextPanelProps = {
  view: AppView
  selection: TimeRangeSelection
  calendarMode: CalendarDisplayMode
  onCalendarModeChange: (mode: CalendarDisplayMode) => void
  onSelectionChange: (selection: TimeRangeSelection) => void
}

export function TimeContextPanel({
  view,
  selection,
  calendarMode,
  onCalendarModeChange,
  onSelectionChange,
}: TimeContextPanelProps) {
  const heading = getTimeRangeDisplay(selection)
  const resetLabel = getCurrentRangeActionLabel(selection.mode)

  function handleModeChange(range: TimeRangeMode) {
    if (range === 'day') onSelectionChange(selectDay(selection.anchorDate))
    if (range === 'week') onSelectionChange(selectWeek(selection.anchorDate))
    if (range === 'month') {
      const anchor = new Date(`${selection.anchorDate}T00:00:00`)
      onSelectionChange(selectMonth(anchor.getFullYear(), anchor.getMonth() + 1))
    }
    if (range === 'year') {
      onSelectionChange(selectYear(new Date(`${selection.anchorDate}T00:00:00`).getFullYear()))
    }
    if (range === 'all') onSelectionChange(selectPresetRange('all'))
    if (range === 'custom') onSelectionChange(selectPresetRange('recent30'))
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
              onClick={() => onSelectionChange(createCurrentSelection(selection.mode))}
            >
              {resetLabel}
            </button>
          </div>

          <SegmentedControl
            ariaLabel="时间模式"
            className="time-mode-tabs"
            options={timeModeOptions}
            value={selection.mode}
            onChange={handleModeChange}
          />
        </header>

        <div className="time-panel-content">
          {renderModeContent(
            selection,
            calendarMode,
            onCalendarModeChange,
            onSelectionChange,
          )}
        </div>

        <footer className="time-context-summary" aria-label="当前范围摘要">
          {moduleSummaries[view].map((item) => (
            <div key={item.label}>
              <b>{item.label}</b>
              <span>{item.value}</span>
            </div>
          ))}
        </footer>
      </div>
    </aside>
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
  onCalendarModeChange: (mode: CalendarDisplayMode) => void,
  onSelectionChange: (selection: TimeRangeSelection) => void,
) {
  if (selection.mode === 'day') {
    return (
      <DayCalendarSection
        selection={selection}
        calendarMode={calendarMode}
        onCalendarModeChange={onCalendarModeChange}
        onSelectionChange={onSelectionChange}
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
        onMove={(direction) => onSelectionChange(movePickerPage(selection, direction))}
        onSelect={(option) =>
          onSelectionChange(createSelectionFromPickerOption(page.mode, option))
        }
      />
    )
  }

  if (selection.mode === 'all') {
    return (
      <section className="time-all-shell" aria-label="全部时间摘要">
        <div className="time-all-total">
          <strong>4年3个月</strong>
          <span>2022.03 至今</span>
        </div>
        <div className="time-selector-list">
          <button
            type="button"
            className={selection.label !== '导入数据' ? 'is-active' : undefined}
            onClick={() => onSelectionChange(selectPresetRange('all'))}
          >
            <span>
              <strong>完整人生数据</strong>
              <small>位置、时间、金钱统一按全量统计</small>
            </span>
            <em>全局</em>
          </button>
          <button
            type="button"
            className={selection.label === '导入数据' ? 'is-active' : undefined}
            onClick={() => onSelectionChange(selectPresetRange('imported'))}
          >
            <span>
              <strong>导入数据</strong>
              <small>外部位置、日程和账目数据</small>
            </span>
            <em>待导入</em>
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="time-custom-shell" aria-label="自定义时间范围">
      <div className="time-mode-section-head">
        <strong>自定义范围</strong>
      </div>
      <div className="time-range-fields">
        <button
          type="button"
          onClick={() => onSelectionChange(setCustomRangeBoundary(selection, 'start'))}
        >
          <span>开始</span>
          <strong>{formatTimeRangeDate(selection.start)}</strong>
        </button>
        <button
          type="button"
          onClick={() => onSelectionChange(setCustomRangeBoundary(selection, 'end'))}
        >
          <span>结束</span>
          <strong>{formatTimeRangeDate(selection.end)}</strong>
        </button>
      </div>
      <div className="time-range-rail" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="time-preset-grid">
        <button type="button" onClick={() => onSelectionChange(selectPresetRange('recent30'))}>
          近30天
        </button>
        <button type="button" onClick={() => onSelectionChange(selectPresetRange('qingdao'))}>
          青岛之行
        </button>
        <button type="button" onClick={() => onSelectionChange(selectPresetRange('quarter'))}>
          本季度
        </button>
        <button
          type="button"
          onClick={() => onSelectionChange(setCustomRangeBoundary(selection, 'start'))}
        >
          手动选择
        </button>
      </div>
    </section>
  )
}

function DayCalendarSection({
  selection,
  calendarMode,
  onCalendarModeChange,
  onSelectionChange,
}: {
  selection: TimeRangeSelection
  calendarMode: CalendarDisplayMode
  onCalendarModeChange: (mode: CalendarDisplayMode) => void
  onSelectionChange: (selection: TimeRangeSelection) => void
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
          onChange={onCalendarModeChange}
        />
      </div>
      <div className="time-calendar-bar">
        <button
          type="button"
          aria-label="上一段时间"
          onClick={() =>
            onSelectionChange(moveDayCalendarPage(selection, -1, calendarMode))
          }
        >
          ‹
        </button>
        <span>{getCalendarLabel(selection, calendarMode)}</span>
        <button
          type="button"
          aria-label="下一段时间"
          onClick={() =>
            onSelectionChange(moveDayCalendarPage(selection, 1, calendarMode))
          }
        >
          ›
        </button>
      </div>
      <AnimatedDayCalendar
        calendarMode={calendarMode}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />
    </section>
  )
}

function AnimatedDayCalendar({
  calendarMode,
  selection,
  onSelectionChange,
}: {
  calendarMode: CalendarDisplayMode
  selection: TimeRangeSelection
  onSelectionChange: (selection: TimeRangeSelection) => void
}) {
  const days = getVisibleMonthDays(selection.anchorDate)
  const renderedRows = days.length / 7
  const visibleRows = calendarMode === 'week' ? 1 : renderedRows
  const activeWeekIndex = getVisibleMonthWeekIndex(selection.anchorDate)

  return (
    <div
      className={`time-calendar-body time-calendar-body--${calendarMode}`}
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
      <div className="time-calendar-grid" aria-label="日历日期">
        {days.map((day) => (
          <button
            type="button"
            key={day.date}
            className={[
              selection.start === day.date ? 'is-active' : null,
              day.inCurrentMonth ? null : 'is-outside-month',
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
  )
}

function TimePickerPage({
  page,
  onMove,
  onSelect,
}: {
  page: PickerPage
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
      <div className={gridClassName}>{optionButtons}</div>
    </section>
  )
}
