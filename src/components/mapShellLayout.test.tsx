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
    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.getByText('2026年6月')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '日历显示方式' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '周历' })).not.toBeInTheDocument()
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

    const pickerHead = screen.getByLabelText('时间选择页').querySelector('.time-mode-section-head')

    expect(pickerHead).not.toBeNull()
    expect(within(pickerHead as HTMLElement).queryByText('只在日模式显示日历')).not.toBeInTheDocument()
    expect(screen.queryByText('只在日模式显示日历')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    expect(screen.getByText('按周聚合')).toBeInTheDocument()
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

  it('applies concrete selections from every time panel button group', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '21' }))

    expect(screen.getByRole('heading', { name: '6月21日' })).toBeInTheDocument()
    expect(screen.getByText('2026年6月21日 · 发生时间')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))

    expect(screen.getByRole('heading', { name: '5月21日' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByRole('heading', { name: '6月21日' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

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
