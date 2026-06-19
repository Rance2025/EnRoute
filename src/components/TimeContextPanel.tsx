import {
  useState,
  type CSSProperties,
  type TransitionEvent,
} from 'react'

import type { AppView } from '../App'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import {
  createCurrentSelection,
  formatTimeRangeDate,
  getCalendarLabel,
  getCurrentRangeActionLabel,
  getTimeRangeDisplay,
  getVisibleMonthDays,
  getVisibleWeekDays,
  getWeekOptions,
  isSelectionActive,
  moveTimeSelection,
  selectDay,
  selectMonth,
  selectPresetRange,
  selectWeek,
  selectYear,
  setCustomRangeBoundary,
  type CalendarDisplayMode,
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
const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
const yearOptions = [2022, 2023, 2024, 2025, 2026, 2027]

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

function renderModeContent(
  selection: TimeRangeSelection,
  calendarMode: CalendarDisplayMode,
  setCalendarMode: (mode: CalendarDisplayMode) => void,
  onSelectionChange: (selection: TimeRangeSelection) => void,
) {
  if (selection.mode === 'day') {
    return (
      <DayCalendarSection
        selection={selection}
        calendarMode={calendarMode}
        setCalendarMode={setCalendarMode}
        onSelectionChange={onSelectionChange}
      />
    )
  }

  if (selection.mode === 'week') {
    return (
      <section className="time-selector-shell" aria-label="周聚合选择">
        <div className="time-mode-section-head">
          <strong>按周聚合</strong>
          <span>选择一周</span>
        </div>
        <div className="time-selector-list">
          {getWeekOptions(selection.anchorDate).map((option) => (
            <button
              type="button"
              key={option.label}
              className={
                isSelectionActive(selection, 'week', option.date) ? 'is-active' : undefined
              }
              onClick={() => onSelectionChange(selectWeek(option.date))}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
              <em>{option.value}</em>
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (selection.mode === 'month') {
    const selectedYear = new Date(`${selection.anchorDate}T00:00:00`).getFullYear()

    return (
      <section className="time-selector-shell" aria-label="月份聚合选择">
        <div className="time-mode-section-head">
          <strong>按月聚合</strong>
        </div>
        <div className="time-grid-selector time-grid-selector--months">
          {monthOptions.map((option) => (
            <button
              type="button"
              key={option}
              className={
                isSelectionActive(
                  selection,
                  'month',
                  `${selectedYear}-${String(option).padStart(2, '0')}-01`,
                )
                  ? 'is-active'
                  : undefined
              }
              onClick={() => onSelectionChange(selectMonth(selectedYear, option))}
            >
              {option}月
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (selection.mode === 'year') {
    return (
      <section className="time-selector-shell" aria-label="年份聚合选择">
        <div className="time-mode-section-head">
          <strong>按年聚合</strong>
          <span>选择年份</span>
        </div>
        <div className="time-grid-selector time-grid-selector--years">
          {yearOptions.map((option) => (
            <button
              type="button"
              key={option}
              className={
                isSelectionActive(selection, 'year', `${option}-01-01`)
                  ? 'is-active'
                  : undefined
              }
              onClick={() => onSelectionChange(selectYear(option))}
            >
              {option}
              <span>
                {isSelectionActive(selection, 'year', `${option}-01-01`)
                  ? '当前'
                  : '年度'}
              </span>
            </button>
          ))}
        </div>
      </section>
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
  setCalendarMode,
  onSelectionChange,
}: {
  selection: TimeRangeSelection
  calendarMode: CalendarDisplayMode
  setCalendarMode: (mode: CalendarDisplayMode) => void
  onSelectionChange: (selection: TimeRangeSelection) => void
}) {
  const [renderedMode, setRenderedMode] = useState<CalendarDisplayMode>(calendarMode)

  function handleCalendarModeChange(mode: CalendarDisplayMode) {
    if (mode === 'month') {
      setRenderedMode('month')
    }

    setCalendarMode(mode)
  }

  return (
    <section className="time-calendar-shell" aria-label="日历选择">
      <div className="time-mode-section-head">
        <strong>按日选择</strong>
        <SegmentedControl
          ariaLabel="日历显示方式"
          className="time-calendar-switch"
          options={calendarModeOptions}
          value={calendarMode}
          onChange={handleCalendarModeChange}
        />
      </div>
      <div className="time-calendar-bar">
        <button
          type="button"
          aria-label="上一段时间"
          onClick={() => onSelectionChange(moveTimeSelection(selection, -1, calendarMode))}
        >
          ‹
        </button>
        <span>{getCalendarLabel(selection, calendarMode)}</span>
        <button
          type="button"
          aria-label="下一段时间"
          onClick={() => onSelectionChange(moveTimeSelection(selection, 1, calendarMode))}
        >
          ›
        </button>
      </div>
      <AnimatedDayCalendar
        calendarMode={calendarMode}
        renderedMode={renderedMode}
        setRenderedMode={setRenderedMode}
        selection={selection}
        onSelect={onSelectionChange}
      />
    </section>
  )
}

function AnimatedDayCalendar({
  calendarMode,
  renderedMode,
  setRenderedMode,
  selection,
  onSelect,
}: {
  calendarMode: CalendarDisplayMode
  renderedMode: CalendarDisplayMode
  setRenderedMode: (mode: CalendarDisplayMode) => void
  selection: TimeRangeSelection
  onSelect: (selection: TimeRangeSelection) => void
}) {
  const isCollapsing = renderedMode === 'month' && calendarMode === 'week'
  const renderedRows =
    renderedMode === 'week' ? 1 : getVisibleMonthDays(selection.anchorDate).length / 7
  const visibleRows = calendarMode === 'week' ? 1 : renderedRows

  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.propertyName === 'max-height' && isCollapsing) {
      setRenderedMode('week')
    }
  }

  return (
    <div
      className={[
        'time-calendar-body',
        `time-calendar-body--${calendarMode}`,
        isCollapsing ? 'is-collapsing' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--time-calendar-visible-rows': visibleRows,
        } as CSSProperties
      }
      onTransitionEnd={handleTransitionEnd}
    >
      {renderedMode === 'week' ? (
        <WeekCalendar selection={selection} onSelect={onSelect} />
      ) : (
        <MonthCalendar selection={selection} onSelect={onSelect} />
      )}
    </div>
  )
}

function WeekCalendar({
  selection,
  onSelect,
}: {
  selection: TimeRangeSelection
  onSelect: (selection: TimeRangeSelection) => void
}) {
  return (
    <div className="time-calendar-grid time-calendar-grid--week" aria-label="日历日期">
      {weekdayLabels.map((label) => (
        <span key={label} className="time-calendar-weekday">
          {label}
        </span>
      ))}
      {getVisibleWeekDays(selection.anchorDate).map((date) => (
        <button
          type="button"
          key={date.date}
          className={selection.start === date.date ? 'is-active' : undefined}
          onClick={() => onSelect(selectDay(date.date))}
        >
          {date.day}
        </button>
      ))}
    </div>
  )
}

function MonthCalendar({
  selection,
  onSelect,
}: {
  selection: TimeRangeSelection
  onSelect: (selection: TimeRangeSelection) => void
}) {
  return (
    <div className="time-calendar-grid time-calendar-grid--month" aria-label="日历日期">
      {weekdayLabels.map((label) => (
        <span key={label} className="time-calendar-weekday">
          {label}
        </span>
      ))}
      {getVisibleMonthDays(selection.anchorDate).map((day) => (
        <button
          type="button"
          key={day.date}
          className={[
            selection.start === day.date ? 'is-active' : null,
            day.inCurrentMonth ? null : 'is-outside-month',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(selectDay(day.date))}
        >
          {day.day}
        </button>
      ))}
    </div>
  )
}
