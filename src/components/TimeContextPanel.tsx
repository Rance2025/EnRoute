import type { AppView } from '../App'

export type TimeRangeKey = 'all' | 'year' | 'month' | 'week' | 'yesterday' | 'today' | 'custom'

type TimeRangeOption = {
  key: TimeRangeKey
  label: string
  value: string
}

const panelSummaries: Record<AppView, Array<{ label: string; value: string }>> = {
  overview: [
    { label: '今日', value: '概览' },
    { label: '本月', value: '趋势' },
    { label: '全部人生', value: '导入后' },
  ],
  map: [
    { label: '今天', value: '位置 3' },
    { label: '本月', value: '足迹 42' },
    { label: '大学阶段', value: '1,284 天' },
  ],
  schedule: [
    { label: '今天', value: '日程 2' },
    { label: '本周', value: '待办 6' },
    { label: '人生事件', value: '待整理' },
  ],
  accounting: [
    { label: '今天', value: '支出 ¥51' },
    { label: '本月', value: '支出 ¥182' },
    { label: '青岛之行', value: '4 笔' },
  ],
}

const accountingTimeRanges: TimeRangeOption[] = [
  { key: 'all', label: '全部', value: '5 笔 · 收支全量' },
  { key: 'year', label: '本年', value: '2026 · 人民币' },
  { key: 'month', label: '本月', value: '支出 ¥182' },
  { key: 'week', label: '本周', value: '3 笔 · 净入 ¥4,921' },
  { key: 'yesterday', label: '昨天', value: '支出 ¥46' },
  { key: 'today', label: '今天', value: '支出 ¥51' },
  { key: 'custom', label: '自定义', value: '选择起止日期' },
]

const rangeHeadings: Record<TimeRangeKey, string> = {
  all: '全部',
  year: '2026年',
  month: '2026年6月',
  week: '本周',
  yesterday: '6月17日',
  today: '6月18日',
  custom: '自定义',
}

const calendarItems = [
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '日',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
]

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
  const isAccounting = view === 'accounting'

  return (
    <aside className="time-context-panel" aria-label="时间范围面板">
      <div className="time-context-panel__scroll">
        <header className="time-context-panel__head">
          <div>
            <span>当前时间范围</span>
            <h2>{rangeHeadings[selectedRange]}</h2>
          </div>
          <button
            type="button"
            aria-label="回到今天"
            onClick={() => onRangeChange('today')}
          >
            今天
          </button>
        </header>

        <div className="mini-calendar" aria-label="六月日期">
          {calendarItems.map((item, index) => (
            <span key={`${item}-${index}`} className={item === '18' ? 'is-today' : undefined}>
              {item}
            </span>
          ))}
        </div>

        {isAccounting ? (
          <>
            <p className="time-range-caption">按发生时间筛选账目</p>
            <div className="time-scope-list time-scope-list--ranges">
              {accountingTimeRanges.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  aria-label={item.label}
                  aria-pressed={selectedRange === item.key}
                  className={selectedRange === item.key ? 'is-active' : undefined}
                  onClick={() => onRangeChange(item.key)}
                >
                  <span>{item.label}</span>
                  <b>{item.value}</b>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="time-scope-list">
            {panelSummaries[view].map((item, index) => (
              <button
                type="button"
                key={item.label}
                className={index === 0 ? 'is-active' : undefined}
              >
                <span>{item.label}</span>
                <b>{item.value}</b>
              </button>
            ))}
          </div>
        )}

        <div className="time-life-line">
          <article>
            <strong>青岛之行</strong>
            <span>位置 18 · 记账 4 · 日程 2</span>
          </article>
          <article>
            <strong>待导入</strong>
            <span>位置数据仍以导入为主</span>
          </article>
        </div>
      </div>
    </aside>
  )
}
