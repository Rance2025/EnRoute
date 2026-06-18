import type { AppView } from '../App'

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

export function TimeContextPanel({ view }: { view: AppView }) {
  return (
    <aside className="time-context-panel" aria-label="时间范围面板">
      <div className="time-context-panel__scroll">
        <header className="time-context-panel__head">
          <div>
            <span>当前时间范围</span>
            <h2>6月18日</h2>
          </div>
          <button type="button">今天</button>
        </header>

        <div className="mini-calendar" aria-label="六月日期">
          {calendarItems.map((item, index) => (
            <span key={`${item}-${index}`} className={item === '18' ? 'is-today' : undefined}>
              {item}
            </span>
          ))}
        </div>

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
