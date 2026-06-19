import type { CSSProperties } from 'react'

import type { AppView } from '../App'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import {
  createCurrentSelection,
  formatTimeRangeDate,
  getCurrentRangeActionLabel,
  getPickerPage,
  getTimeRangeDisplay,
  movePickerPage,
  selectDay,
  selectMonth,
  selectPresetRange,
  selectWeek,
  selectYear,
  setCustomRangeBoundary,
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
  onSelectionChange: (selection: TimeRangeSelection) => void
}

export function TimeContextPanel({
  view,
  selection,
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
          {renderModeContent(selection, onSelectionChange)}
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
  onSelectionChange: (selection: TimeRangeSelection) => void,
) {
  if (
    selection.mode === 'day' ||
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

function TimePickerPage({
  page,
  onMove,
  onSelect,
}: {
  page: PickerPage
  onMove: (direction: -1 | 1) => void
  onSelect: (option: PickerPageOption) => void
}) {
  const isCalendarGrid = page.mode === 'day' || page.mode === 'week'
  const gridClassName = [
    'time-picker-grid',
    page.gridClassName,
    isCalendarGrid ? 'time-picker-grid--calendar' : null,
  ]
    .filter(Boolean)
    .join(' ')
  const calendarFrameStyle = isCalendarGrid
    ? ({
        '--time-picker-visible-rows': page.visibleRows,
        '--time-picker-active-week-index': page.activeWeekIndex,
        '--time-picker-grid-offset': page.mode === 'week' ? page.activeWeekIndex * -1 : 0,
      } as CSSProperties)
    : undefined
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
      {isCalendarGrid ? (
        <div className="time-picker-calendar-frame" style={calendarFrameStyle}>
          <div className="time-picker-calendar-weekdays">
            {weekdayLabels.map((label) => (
              <span key={label} className="time-calendar-weekday">
                {label}
              </span>
            ))}
          </div>
          <div className={gridClassName}>{optionButtons}</div>
        </div>
      ) : (
        <div className={gridClassName}>{optionButtons}</div>
      )}
    </section>
  )
}
