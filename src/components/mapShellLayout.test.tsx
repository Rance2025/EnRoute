import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import App from '../App'

afterEach(() => {
  cleanup()
})

const configuredAmap = {
  key: 'test-key',
  securityJsCode: 'test-security-code',
  isConfigured: true,
  missingKeys: [],
  defaultCenter: [104.195397, 35.86166] as [number, number],
  defaultZoom: 5.1,
  defaultBounds: {
    southWest: [73.3, 17.8] as [number, number],
    northEast: [135.1, 53.7] as [number, number],
  },
  renderBounds: {
    southWest: [-180, -85.05112878] as [number, number],
    northEast: [180, 85.05112878] as [number, number],
  },
  themes: [
    { id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' },
  ],
  features: ['bg', 'road', 'building'] as Array<'bg' | 'road' | 'building'>,
  showLabel: false,
}

describe('unified shell layout', () => {
  it('renders a shared time panel beside the map workspace', () => {
    render(<App amapConfig={configuredAmap} />)

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '时间模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('日历选择')).toBeInTheDocument()
    expect(screen.getByText('2026年6月')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '日历显示方式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '周历' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '月历' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('slider', { name: '页面滑块' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '时间模式滑块' })).toHaveAttribute(
      'aria-valuetext',
      '日',
    )
    expect(screen.getByRole('button', { name: '回到今天' })).toHaveTextContent(
      '回到今天',
    )
    expect(screen.getByText('足迹 18')).toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 地图工作区')).toBeInTheDocument()
  })

  it('uses project-facing time panel copy without implementation notes', () => {
    render(<App amapConfig={configuredAmap} />)

    const pickerHead = screen.getByLabelText('日历选择').querySelector('.time-mode-section-head')

    expect(pickerHead).not.toBeNull()
    expect(within(pickerHead as HTMLElement).queryByText('只在日模式显示日历')).not.toBeInTheDocument()
    expect(screen.queryByText('只在日模式显示日历')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    expect(screen.getByText('按周聚合')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /第25周/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '日历显示方式' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '周历' })).not.toBeInTheDocument()
    expect(screen.queryByText('选择一周')).not.toBeInTheDocument()
    expect(screen.queryByText('选择一整周')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(screen.queryByText('和日周月年同级')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))

    expect(screen.getByText('按年聚合')).toBeInTheDocument()
    expect(screen.queryByText('选择年份')).not.toBeInTheDocument()
    expect(screen.queryByText('年度级别')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '全部' }))

    expect(screen.queryByText(/后续/)).not.toBeInTheDocument()
    expect(screen.queryByText('预留')).not.toBeInTheDocument()
  })

  it('keeps the shared time panel when switching to accounting', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    const shell = screen.getByRole('main')
    const accountingScope = screen.getByLabelText('当前账目范围')

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(accountingScope).toHaveTextContent('日')
    expect(accountingScope).toHaveTextContent('人民币')
    expect(shell).toHaveClass('app-shell--accounting')
    expect(shell).toHaveClass('has-data-panel')
    expect(shell).not.toHaveStyle({ '--data-panel-width': '0px' })
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '记账工作区滑块' })).toHaveAttribute(
      'aria-valuetext',
      '流水',
    )
    expect(screen.getByRole('slider', { name: '交易类型选择滑块' })).toHaveAttribute(
      'aria-valuetext',
      '支出',
    )
  })

  it('switches the shared time panel between top-level range modes', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    for (const range of ['日', '周', '月', '年', '全部', '自定义']) {
      expect(screen.getByRole('button', { name: range })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('heading', { name: '第25周' })).toBeInTheDocument()
    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '日历显示方式' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('当前账目范围')).toHaveTextContent('周')

    fireEvent.click(screen.getByRole('button', { name: '月' }))

    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))

    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '全部' }))

    expect(screen.getByLabelText('全部时间摘要')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(screen.getByLabelText('自定义时间范围')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
  })

  it('uses the current range granularity for the reset action', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    expect(screen.getByRole('button', { name: '回到本周' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月' }))

    expect(screen.getByRole('button', { name: '回到本月' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /7月/ }))

    expect(screen.getByRole('heading', { name: '7月' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '回到本月' }))

    expect(screen.getByRole('heading', { name: '6月' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))

    expect(screen.getByRole('button', { name: '回到今年' })).toBeInTheDocument()
  })

  it('moves day week month and year ranges through the same directional navigator', () => {
    render(<App amapConfig={configuredAmap} />)
    const getActiveGridMotion = () =>
      document.querySelector('.time-calendar-grid-motion, .time-picker-grid-motion')

    expect(screen.getByLabelText('时间范围内容')).not.toHaveClass(
      'time-panel-content__stage--previous',
    )
    expect(screen.getByLabelText('时间范围内容')).not.toHaveClass(
      'time-panel-content__stage--next',
    )

    fireEvent.click(screen.getByRole('button', { name: '上一段时间' }))

    let stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '6月12日' })).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--previous')

    fireEvent.click(screen.getByRole('button', { name: '下一段时间' }))

    stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '今天' })).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--next')

    fireEvent.click(screen.getByRole('button', { name: '周' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '第29周' })).toBeInTheDocument()
    expect(screen.getByText('7月13日 - 7月19日 · 按周聚合')).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--next')

    fireEvent.click(screen.getByRole('button', { name: '月' }))
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))

    stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '7月' })).toBeInTheDocument()
    expect(screen.getByText('2025年7月 · 按月聚合')).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--previous')

    fireEvent.click(screen.getByRole('button', { name: '年' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '2035年' })).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--next')

    fireEvent.click(screen.getByRole('button', { name: '全部' }))

    expect(screen.queryByRole('button', { name: '上一段时间' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一段时间' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '上一页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
  })

  it('renders month aggregation as a compact two-row picker without helper copy', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '月' }))

    const monthSelector = screen.getByLabelText('时间选择页')

    expect(within(monthSelector).getByText('按月聚合')).toBeInTheDocument()
    expect(within(monthSelector).getAllByRole('button')).toHaveLength(14)
    expect(within(monthSelector).queryByText('选择月份')).not.toBeInTheDocument()
    expect(within(monthSelector).queryByText('选择')).not.toBeInTheDocument()
    expect(within(monthSelector).queryByText('当前')).not.toBeInTheDocument()
  })

  it('keeps day calendar week and month displays on the same date grid', () => {
    render(<App amapConfig={configuredAmap} />)

    const weekCalendar = screen.getByLabelText('日历选择')
    const weekBody = screen.getByLabelText('日历日期').closest('.time-calendar-body')
    const weekGrid = screen.getByLabelText('日历日期')
    const weekButtons = within(weekGrid).getAllByRole('button')

    expect(within(weekCalendar).getByText('按日选择')).toBeInTheDocument()
    expect(within(weekCalendar).getByText('2026年6月')).toBeInTheDocument()
    expect(within(weekCalendar).getByLabelText('上一段时间')).toBeInTheDocument()
    expect(within(weekCalendar).getByLabelText('下一段时间')).toBeInTheDocument()
    expect(weekBody).toHaveClass('time-calendar-body--week')
    expect(weekBody).toHaveStyle({ '--time-calendar-visible-rows': '1' })
    expect(weekBody).toHaveStyle({ '--time-calendar-active-week-index': '2' })
    expect(weekBody?.querySelector('.time-calendar-weekdays')).not.toBeNull()
    expect(weekBody?.querySelector('.time-calendar-grid-window')).not.toBeNull()
    expect(weekBody?.querySelector('.time-calendar-grid-window .time-calendar-grid')).toBe(
      weekGrid,
    )
    expect(weekBody?.querySelector('.time-calendar-grid-window .time-calendar-weekdays')).toBeNull()
    expect(weekButtons).toHaveLength(35)
    expect(weekButtons.slice(14, 21).map((button) => button.textContent)).toEqual([
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
    ])
    expect(within(weekGrid).getByRole('button', { name: '19' })).toHaveClass('is-active')

    fireEvent.click(screen.getByRole('button', { name: '月历' }))

    const monthBody = screen.getByLabelText('日历日期').closest('.time-calendar-body')
    const monthGrid = screen.getByLabelText('日历日期')
    const monthButtons = within(monthGrid).getAllByRole('button')

    expect(monthBody).toBe(weekBody)
    expect(monthGrid).toBe(weekGrid)
    expect(monthBody).toHaveClass('time-calendar-body--month')
    expect(monthBody).toHaveStyle({ '--time-calendar-visible-rows': '5' })
    expect(monthBody).toHaveStyle({ '--time-calendar-active-week-index': '2' })
    expect(monthButtons).toHaveLength(35)
    expect(monthButtons[14]).toBe(weekButtons[14])
    expect(monthButtons[20]).toBe(weekButtons[20])

    fireEvent.click(screen.getByRole('button', { name: '周历' }))

    expect(screen.getByLabelText('日历日期').closest('.time-calendar-body')).toBe(weekBody)
    expect(screen.getByLabelText('日历日期').closest('.time-calendar-body')).toHaveClass(
      'time-calendar-body--week',
    )
  })

  it('renders top-level week, month, and year with paged aggregation grids', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    const weekPicker = screen.getByLabelText('时间选择页')

    expect(within(weekPicker).getByText('按周聚合')).toBeInTheDocument()
    expect(within(weekPicker).getByText('2026年6月')).toBeInTheDocument()
    expect(within(weekPicker).getByLabelText('上一页')).toBeInTheDocument()
    expect(within(weekPicker).getByLabelText('下一页')).toBeInTheDocument()
    expect(within(weekPicker).getByRole('button', { name: /第25周/ })).toBeInTheDocument()
    expect(weekPicker.querySelector('.time-picker-grid')).toHaveClass('time-picker-grid--weeks')
    expect(weekPicker.querySelector('.time-picker-calendar-frame')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '日历显示方式' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('日历日期')).not.toBeInTheDocument()

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

  it('moves the day calendar active week into the month grid without replacing cells', () => {
    render(<App amapConfig={configuredAmap} />)

    const weekBody = screen.getByLabelText('日历日期').closest('.time-calendar-body')
    const weekGrid = screen.getByLabelText('日历日期')
    const weekButtons = within(weekGrid).getAllByRole('button')

    expect(weekBody).toHaveStyle({ '--time-calendar-visible-rows': '1' })
    expect(weekBody).toHaveStyle({ '--time-calendar-active-week-index': '2' })
    expect(weekButtons.slice(14, 21).map((button) => button.textContent)).toEqual([
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
    ])

    fireEvent.click(screen.getByRole('button', { name: '月历' }))

    const monthBody = screen.getByLabelText('日历日期').closest('.time-calendar-body')
    const monthGrid = screen.getByLabelText('日历日期')
    const monthButtons = within(monthGrid).getAllByRole('button')

    expect(monthBody).toBe(weekBody)
    expect(monthGrid).toBe(weekGrid)
    expect(monthBody).toHaveStyle({ '--time-calendar-visible-rows': '5' })
    expect(monthButtons[14]).toBe(weekButtons[14])
    expect(monthButtons[20]).toBe(weekButtons[20])

    fireEvent.click(screen.getByRole('button', { name: '周历' }))

    const collapsedButtons = within(screen.getByLabelText('日历日期')).getAllByRole('button')

    expect(screen.getByLabelText('日历日期').closest('.time-calendar-body')).toBe(weekBody)
    expect(collapsedButtons[14]).toBe(weekButtons[14])
    expect(collapsedButtons[20]).toBe(weekButtons[20])
  })

  it('applies concrete selections from every time panel button group', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '21' }))

    expect(screen.getByRole('heading', { name: '6月21日' })).toBeInTheDocument()
    expect(screen.getByText('2026年6月21日 · 发生时间')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一段时间' }))

    expect(screen.getByRole('heading', { name: '6月14日' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一段时间' }))

    expect(screen.getByRole('heading', { name: '6月21日' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月历' }))
    fireEvent.click(screen.getByRole('button', { name: '下一段时间' }))

    expect(screen.getByRole('heading', { name: '7月21日' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '周' }))
    fireEvent.click(screen.getByRole('button', { name: /第30周/ }))

    expect(screen.getByRole('heading', { name: '第30周' })).toBeInTheDocument()
    expect(screen.getByText('7月20日 - 7月26日 · 按周聚合')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月' }))
    fireEvent.click(screen.getByRole('button', { name: /7月/ }))

    expect(screen.getByRole('heading', { name: '7月' })).toBeInTheDocument()
    expect(screen.getByText('2026年7月 · 按月聚合')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))
    fireEvent.click(screen.getByRole('button', { name: /2025/ }))

    expect(screen.getByRole('heading', { name: '2025年' })).toBeInTheDocument()
    expect(screen.getByText('2025年 · 年度聚合')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))
    fireEvent.click(screen.getByRole('button', { name: '近30天' }))

    expect(screen.getByRole('heading', { name: '近30天' })).toBeInTheDocument()
    expect(screen.getByText('2026年5月21日 - 2026年6月19日')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    const accountingScope = screen.getByLabelText('当前账目范围')

    expect(accountingScope).toHaveTextContent('自定义')
    expect(accountingScope).toHaveTextContent('人民币')
  })
})
