import { useState } from 'react'

import type { AppView } from '../App'

export type TimeRangeKey = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom'

type TimeModeOption = {
  key: TimeRangeKey
  label: string
}

type CalendarMode = 'week' | 'month'

const timeModeOptions: TimeModeOption[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
  { key: 'all', label: '全部' },
  { key: 'custom', label: '自定义' },
]

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']
const selectedDate = new Date(2026, 5, 19)
const weekStart = new Date(2026, 5, 15)
const weekDays = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(weekStart)
  date.setDate(weekStart.getDate() + index)
  return date
})
const monthCalendarDays = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 27, 28, 29, 30,
]

const modeHeadings: Record<TimeRangeKey, { title: string; detail: string }> = {
  day: { title: '今天', detail: '2026年6月19日 · 发生时间' },
  week: { title: '第25周', detail: '6月15日 - 6月21日 · 按周聚合' },
  month: { title: '6月', detail: '2026年6月 · 按月聚合' },
  year: { title: '2026年', detail: '年度聚合 · 1月-12月' },
  all: { title: '全部', detail: '不限定发生时间 · 全量汇总' },
  custom: { title: '自定义', detail: '2026年5月1日 - 2026年6月19日' },
}

const weekOptions = [
  { label: '6月第3周', detail: '6.08 - 6.14 · 按周聚合', value: '1周前' },
  { label: '6月第4周', detail: '6.15 - 6.21 · 按周聚合', value: '当前' },
  { label: '6月第5周', detail: '6.22 - 6.28 · 按周聚合', value: '1周后' },
]

const monthOptions = [
  { label: '1月', value: '聚合' },
  { label: '2月', value: '聚合' },
  { label: '3月', value: '聚合' },
  { label: '4月', value: '聚合' },
  { label: '5月', value: '聚合' },
  { label: '6月', value: '当前' },
  { label: '7月', value: '聚合' },
  { label: '8月', value: '聚合' },
  { label: '9月', value: '聚合' },
  { label: '10月', value: '聚合' },
  { label: '11月', value: '聚合' },
  { label: '12月', value: '聚合' },
]

const yearOptions = [
  { label: '2022', value: '年度' },
  { label: '2023', value: '年度' },
  { label: '2024', value: '年度' },
  { label: '2025', value: '年度' },
  { label: '2026', value: '当前' },
  { label: '2027', value: '年度' },
]

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
  selectedRange: TimeRangeKey
  onRangeChange: (range: TimeRangeKey) => void
}

export function TimeContextPanel({
  view,
  selectedRange,
  onRangeChange,
}: TimeContextPanelProps) {
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('week')
  const heading = modeHeadings[selectedRange]

  function handleModeChange(range: TimeRangeKey) {
    onRangeChange(range)
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
              aria-label="回到今天"
              onClick={() => handleModeChange('day')}
            >
              回到今天
            </button>
          </div>

          <div className="time-mode-tabs" role="group" aria-label="时间模式">
            {timeModeOptions.map((option) => (
              <button
                type="button"
                key={option.key}
                aria-pressed={selectedRange === option.key}
                onClick={() => handleModeChange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        <div className="time-panel-content">
          {renderModeContent(selectedRange, calendarMode, setCalendarMode)}
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
  selectedRange: TimeRangeKey,
  calendarMode: CalendarMode,
  setCalendarMode: (mode: CalendarMode) => void,
) {
  if (selectedRange === 'day') {
    return (
      <section className="time-calendar-shell" aria-label="日历选择">
        <div className="time-mode-section-head">
          <strong>按日选择</strong>
          <div
            className="time-calendar-switch"
            role="group"
            aria-label="日历显示方式"
          >
            <button
              type="button"
              aria-pressed={calendarMode === 'week'}
              onClick={() => setCalendarMode('week')}
            >
              周历
            </button>
            <button
              type="button"
              aria-pressed={calendarMode === 'month'}
              onClick={() => setCalendarMode('month')}
            >
              月历
            </button>
          </div>
        </div>
        <div className="time-calendar-bar">
          <button type="button" aria-label="上一段时间">
            ‹
          </button>
          <span>2026年6月 · {calendarMode === 'week' ? '本周' : '本月'}</span>
          <button type="button" aria-label="下一段时间">
            ›
          </button>
        </div>
        {calendarMode === 'week' ? <WeekCalendar /> : <MonthCalendar />}
      </section>
    )
  }

  if (selectedRange === 'week') {
    return (
      <section className="time-selector-shell" aria-label="周聚合选择">
        <div className="time-mode-section-head">
          <strong>按周聚合</strong>
          <span>选择一周</span>
        </div>
        <div className="time-selector-list">
          {weekOptions.map((option) => (
            <button
              type="button"
              key={option.label}
              className={option.value === '当前' ? 'is-active' : undefined}
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

  if (selectedRange === 'month') {
    return (
      <section className="time-selector-shell" aria-label="月份聚合选择">
        <div className="time-mode-section-head">
          <strong>按月聚合</strong>
          <span>选择月份</span>
        </div>
        <div className="time-grid-selector">
          {monthOptions.map((option) => (
            <button
              type="button"
              key={option.label}
              className={option.value === '当前' ? 'is-active' : undefined}
            >
              {option.label}
              <span>{option.value}</span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (selectedRange === 'year') {
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
              key={option.label}
              className={option.value === '当前' ? 'is-active' : undefined}
            >
              {option.label}
              <span>{option.value}</span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (selectedRange === 'all') {
    return (
      <section className="time-all-shell" aria-label="全部时间摘要">
        <div className="time-all-total">
          <strong>4年3个月</strong>
          <span>2022.03 至今</span>
        </div>
        <div className="time-selector-list">
          <button type="button" className="is-active">
            <span>
              <strong>完整人生数据</strong>
              <small>位置、时间、金钱统一按全量统计</small>
            </span>
            <em>全局</em>
          </button>
          <button type="button">
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
        <button type="button">
          <span>开始</span>
          <strong>2026年5月1日</strong>
        </button>
        <button type="button">
          <span>结束</span>
          <strong>2026年6月19日</strong>
        </button>
      </div>
      <div className="time-range-rail" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="time-preset-grid">
        <button type="button">近30天</button>
        <button type="button">青岛之行</button>
        <button type="button">本季度</button>
        <button type="button">手动选择</button>
      </div>
    </section>
  )
}

function WeekCalendar() {
  return (
    <div className="time-calendar-grid time-calendar-grid--week">
      {weekdayLabels.map((label) => (
        <span key={label} className="time-calendar-weekday">
          {label}
        </span>
      ))}
      {weekDays.map((date) => (
        <button
          type="button"
          key={date.toISOString()}
          className={
            date.getDate() === selectedDate.getDate() ? 'is-active' : undefined
          }
        >
          {date.getDate()}
        </button>
      ))}
    </div>
  )
}

function MonthCalendar() {
  return (
    <div className="time-calendar-grid time-calendar-grid--month">
      {weekdayLabels.map((label) => (
        <span key={label} className="time-calendar-weekday">
          {label}
        </span>
      ))}
      {monthCalendarDays.map((day) => (
        <button
          type="button"
          key={day}
          className={day === selectedDate.getDate() ? 'is-active' : undefined}
        >
          {day}
        </button>
      ))}
    </div>
  )
}
