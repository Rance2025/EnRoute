import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'

const localStorageMock = createLocalStorageMock()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-19T10:20:30+08:00'))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
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
    expect(screen.getByText('2026年6月19日')).toBeInTheDocument()
    expect(screen.queryByText('全局时间范围')).not.toBeInTheDocument()
    expect(screen.queryByText(/发生时间|按周聚合|按月聚合|年度聚合/)).not.toBeInTheDocument()
    const mapMetricStrip = screen.getByLabelText('全局范围指标')
    expect(within(mapMetricStrip).getByText('足迹总数')).toBeInTheDocument()
    expect(within(mapMetricStrip).getByText('总距离')).toBeInTheDocument()
    expect(within(mapMetricStrip).getByText('日均距离')).toBeInTheDocument()
    expect(within(mapMetricStrip).queryByText('当前足迹')).not.toBeInTheDocument()
    expect(within(mapMetricStrip).queryByText('全部足迹')).not.toBeInTheDocument()
    expect(within(mapMetricStrip).queryByText('活跃天数')).not.toBeInTheDocument()
    expect(within(mapMetricStrip).queryByText('日均足迹')).not.toBeInTheDocument()
    expect(within(mapMetricStrip).queryByText('净流入')).not.toBeInTheDocument()
    expect(screen.queryByText('足迹 18')).not.toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 地图工作区')).toBeInTheDocument()
  })

  it('opens compact footprint style controls from the map toolbar', () => {
    render(<App amapConfig={configuredAmap} />)

    expect(screen.queryByRole('dialog', { name: '足迹显示设置' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    const popover = screen.getByRole('dialog', { name: '足迹显示设置' })
    const sizeInput = within(popover).getByLabelText('足迹点大小')
    const opacityInput = within(popover).getByLabelText('足迹点透明度')
    const colorInput = within(popover).getByLabelText('足迹点颜色')
    const sizeValue = within(popover).getByText('1.5')
    const opacityValue = within(popover).getByText('0.82')

    expect(sizeInput).toHaveAttribute('type', 'range')
    expect(sizeInput).toHaveAttribute('min', '0.8')
    expect(sizeInput).toHaveAttribute('max', '3.5')
    expect(sizeInput).toHaveAttribute('step', '0.1')
    expect(sizeInput).toHaveValue('1.5')
    expect(sizeValue).toHaveClass('footprint-style-popover__value')
    expect(within(popover).queryByLabelText('足迹点大小数值')).not.toBeInTheDocument()
    expect(within(popover).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(opacityInput).toHaveAttribute('type', 'range')
    expect(opacityInput).toHaveAttribute('min', '0.3')
    expect(opacityInput).toHaveAttribute('max', '1')
    expect(opacityInput).toHaveAttribute('step', '0.01')
    expect(opacityInput).toHaveValue('0.82')
    expect(opacityValue).toHaveClass('footprint-style-popover__value')
    expect(within(popover).queryByLabelText('足迹点透明度数值')).not.toBeInTheDocument()
    expect(colorInput).toHaveAttribute('type', 'color')
    expect(colorInput).toHaveValue('#123f35')

    fireEvent.change(sizeInput, { target: { value: '2.4' } })
    fireEvent.change(opacityInput, { target: { value: '0.64' } })
    fireEvent.change(colorInput, { target: { value: '#4f7cff' } })

    expect(sizeInput).toHaveValue('2.4')
    expect(within(popover).getByText('2.4')).toHaveClass('footprint-style-popover__value')
    expect(opacityInput).toHaveValue('0.64')
    expect(within(popover).getByText('0.64')).toHaveClass('footprint-style-popover__value')
    expect(colorInput).toHaveValue('#4f7cff')
  })

  it('rounds footprint point opacity controls to 0.01 precision through the slider', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    const popover = screen.getByRole('dialog', { name: '足迹显示设置' })
    const opacityInput = within(popover).getByLabelText('足迹点透明度')

    fireEvent.change(opacityInput, { target: { value: '0.736' } })

    expect(opacityInput).toHaveValue('0.74')
    expect(within(popover).getByText('0.74')).toHaveClass('footprint-style-popover__value')
  })

  it('rounds footprint point size controls to 0.1 precision through the slider', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    const popover = screen.getByRole('dialog', { name: '足迹显示设置' })
    const sizeInput = within(popover).getByLabelText('足迹点大小')

    fireEvent.change(sizeInput, { target: { value: '1.23' } })

    expect(sizeInput).toHaveValue('1.2')
    expect(within(popover).getByText('1.2')).toHaveClass('footprint-style-popover__value')
  })

  it('persists footprint style settings after toolbar edits settle', () => {
    vi.useFakeTimers()
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
    const { unmount } = render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    let popover = screen.getByRole('dialog', { name: '足迹显示设置' })
    fireEvent.change(within(popover).getByLabelText('足迹点大小'), {
      target: { value: '2.7' },
    })
    fireEvent.change(within(popover).getByLabelText('足迹点透明度'), {
      target: { value: '0.64' },
    })
    fireEvent.change(within(popover).getByLabelText('足迹点颜色'), {
      target: { value: '#4f7cff' },
    })

    expect(within(popover).getByLabelText('足迹点大小')).toHaveValue('2.7')
    expect(within(popover).getByLabelText('足迹点透明度')).toHaveValue('0.64')
    expect(within(popover).getByLabelText('足迹点颜色')).toHaveValue('#4f7cff')
    expect(window.localStorage.getItem('enroute.footprintStyle')).toBeNull()
    expect(setItemSpy).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(180)
    })

    expect(setItemSpy).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('enroute.footprintStyle')).toBe(
      JSON.stringify({ pixelSize: 2.7, color: '#4f7cff', opacity: 0.64 }),
    )

    unmount()
    render(<App amapConfig={configuredAmap} />)
    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    popover = screen.getByRole('dialog', { name: '足迹显示设置' })
    expect(within(popover).getByLabelText('足迹点大小')).toHaveValue('2.7')
    expect(within(popover).getByText('2.7')).toHaveClass('footprint-style-popover__value')
    expect(within(popover).getByLabelText('足迹点透明度')).toHaveValue('0.64')
    expect(within(popover).getByText('0.64')).toHaveClass('footprint-style-popover__value')
    expect(within(popover).getByLabelText('足迹点颜色')).toHaveValue('#4f7cff')
  })

  it('commits pending footprint style edits when closing the popover', () => {
    vi.useFakeTimers()
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    const popover = screen.getByRole('dialog', { name: '足迹显示设置' })
    fireEvent.change(within(popover).getByLabelText('足迹点大小'), {
      target: { value: '2.3' },
    })
    fireEvent.change(within(popover).getByLabelText('足迹点透明度'), {
      target: { value: '0.7' },
    })

    expect(window.localStorage.getItem('enroute.footprintStyle')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    expect(screen.queryByRole('dialog', { name: '足迹显示设置' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('enroute.footprintStyle')).toBe(
      JSON.stringify({ pixelSize: 2.3, color: '#123f35', opacity: 0.7 }),
    )
  })

  it('persists pending footprint style edits when leaving the map view', () => {
    vi.useFakeTimers()
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

    const popover = screen.getByRole('dialog', { name: '足迹显示设置' })
    fireEvent.change(within(popover).getByLabelText('足迹点大小'), {
      target: { value: '2.1' },
    })
    fireEvent.change(within(popover).getByLabelText('足迹点颜色'), {
      target: { value: '#4f7cff' },
    })

    expect(window.localStorage.getItem('enroute.footprintStyle')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    expect(screen.queryByRole('dialog', { name: '足迹显示设置' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('enroute.footprintStyle')).toBe(
      JSON.stringify({ pixelSize: 2.1, color: '#4f7cff', opacity: 0.82 }),
    )
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

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))
    fireEvent.click(within(screen.getByLabelText('常用自定义范围')).getByRole('button', { name: '全部' }))

    expect(screen.queryByText(/后续/)).not.toBeInTheDocument()
    expect(screen.queryByText('预留')).not.toBeInTheDocument()
  })

  it('keeps the shared time panel when switching to accounting', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    const shell = screen.getByRole('main')
    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByLabelText('iOS 记账工作台')).toBeInTheDocument()
    expect(screen.queryByLabelText('当前账目范围')).not.toBeInTheDocument()
    expect(shell).toHaveClass('app-shell--accounting')
    expect(shell).toHaveClass('has-data-panel')
    expect(shell).not.toHaveStyle({ '--data-panel-width': '0px' })
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '记账工作区' })).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '记账工作区滑块' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('账户与流水工作台')).toBeInTheDocument()
    const accountingMetricStrip = screen.getByLabelText('全局范围指标')
    expect(within(accountingMetricStrip).getByText('净流入')).toBeInTheDocument()
    expect(within(accountingMetricStrip).getByText('支出')).toBeInTheDocument()
    expect(within(accountingMetricStrip).getByText('流水')).toBeInTheDocument()
    expect(within(accountingMetricStrip).getByText('账户')).toBeInTheDocument()
    expect(within(accountingMetricStrip).queryByText('足迹总数')).not.toBeInTheDocument()
  })

  it('switches the shared time panel between top-level range modes', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    for (const range of ['日', '周', '月', '年', '自定义']) {
      expect(screen.getByRole('button', { name: range })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: '全部' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('heading', { name: '第25周' })).toBeInTheDocument()
    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '日历显示方式' })).not.toBeInTheDocument()
    expect(
      within(screen.getByLabelText('iOS 记账工作台')).getByText('第25周'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月' }))

    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))

    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(screen.getByLabelText('自定义时间范围')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
  })

  it('keeps all-time inside custom presets and supports real editable custom dates', () => {
    render(<App amapConfig={configuredAmap} />)

    expect(screen.getByRole('group', { name: '时间模式' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全部' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    const customPanel = screen.getByLabelText('自定义时间范围')

    for (const preset of ['全部', '最近一年', '最近一月', '最近一周']) {
      expect(within(customPanel).getByRole('button', { name: preset })).toBeInTheDocument()
    }
    expect(customPanel.querySelector('.time-range-rail')).toBeNull()

    fireEvent.click(within(customPanel).getByRole('button', { name: '全部' }))

    expect(screen.getByRole('heading', { name: '全部' })).toBeInTheDocument()
    expect(within(customPanel).getByLabelText('开始日期')).toHaveValue('2022-03-01')
    expect(within(customPanel).getByLabelText('结束日期')).toHaveValue('2026-06-19')

    fireEvent.click(within(customPanel).getByRole('button', { name: '最近一年' }))

    expect(screen.getByRole('heading', { name: '最近一年' })).toBeInTheDocument()
    expect(within(customPanel).getByLabelText('开始日期')).toHaveValue('2025-06-20')
    expect(within(customPanel).getByLabelText('结束日期')).toHaveValue('2026-06-19')

    fireEvent.change(within(customPanel).getByLabelText('开始日期'), {
      target: { value: '2026-06-10' },
    })
    fireEvent.change(within(customPanel).getByLabelText('结束日期'), {
      target: { value: '2026-06-12' },
    })

    expect(screen.getByRole('heading', { name: '自定义' })).toBeInTheDocument()
    expect(screen.getByText('2026年6月10日 - 2026年6月12日')).toBeInTheDocument()
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

    expect(screen.getByRole('heading', { name: '第25周' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '第25周' })).toBeInTheDocument()
    expect(screen.getByText('2026年7月')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /第29周/ })).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--next')

    fireEvent.click(screen.getByRole('button', { name: /第29周/ }))

    expect(screen.getByRole('heading', { name: '第29周' })).toBeInTheDocument()
    const timeCardTop = screen.getByRole('heading', { name: '第29周' }).closest('.time-context-card__top')
    expect(timeCardTop).not.toBeNull()
    expect(within(timeCardTop as HTMLElement).getByText('2026年7月13日 - 2026年7月19日')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月' }))
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))

    stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '7月' })).toBeInTheDocument()
    expect(screen.getByText('2026年7月')).toBeInTheDocument()
    expect(screen.getByText('2025年')).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--previous')

    fireEvent.click(screen.getByRole('button', { name: '年' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    stage = screen.getByLabelText('时间范围内容')
    expect(screen.getByRole('heading', { name: '2026年' })).toBeInTheDocument()
    expect(screen.getAllByText('2026年').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('2030 - 2039')).toBeInTheDocument()
    expect(stage).not.toHaveClass('time-panel-content__stage--previous')
    expect(stage).not.toHaveClass('time-panel-content__stage--next')
    expect(getActiveGridMotion()).toHaveClass('time-range-grid-motion--next')

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

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
    expect(weekButtons.slice(14, 21).every((button) => button.classList.contains('is-visible-week'))).toBe(
      true,
    )
    expect(weekButtons[13]).not.toHaveClass('is-visible-week')
    expect(weekButtons[21]).not.toHaveClass('is-visible-week')
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
      'time-calendar-body--collapsing-week',
    )
  })

  it('keeps the expanded month rows during the day calendar collapse animation', () => {
    vi.useFakeTimers()
    render(<App amapConfig={configuredAmap} />)

    const weekBody = screen.getByLabelText('日历日期').closest('.time-calendar-body')

    fireEvent.click(screen.getByRole('button', { name: '月历' }))
    expect(weekBody).toHaveClass('time-calendar-body--month')
    expect(weekBody).toHaveStyle({ '--time-calendar-visible-rows': '5' })

    fireEvent.click(screen.getByRole('button', { name: '周历' }))

    expect(weekBody).toHaveClass('time-calendar-body--collapsing-week')
    expect(weekBody).not.toHaveClass('time-calendar-body--week')
    expect(weekBody).toHaveStyle({ '--time-calendar-visible-rows': '1' })

    act(() => {
      vi.advanceTimersByTime(259)
    })

    expect(weekBody).toHaveClass('time-calendar-body--collapsing-week')

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(weekBody).toHaveClass('time-calendar-body--week')
    expect(weekBody).not.toHaveClass('time-calendar-body--collapsing-week')
    expect(weekBody).toHaveStyle({ '--time-calendar-visible-rows': '1' })
  })

  it('keeps calendar display mode local across parent rerenders', () => {
    const { rerender } = render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '月历' }))

    expect(screen.getByLabelText('日历日期').closest('.time-calendar-body')).toHaveClass(
      'time-calendar-body--month',
    )

    rerender(<App amapConfig={configuredAmap} />)

    expect(screen.getByLabelText('日历日期').closest('.time-calendar-body')).toHaveClass(
      'time-calendar-body--month',
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

  it('keeps the same week row steady when selecting adjacent days across month end', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '月历' }))
    fireEvent.click(screen.getByRole('button', { name: '下一段时间' }))
    fireEvent.click(screen.getByRole('button', { name: '31' }))
    fireEvent.click(screen.getByRole('button', { name: '周历' }))

    const julyWeekGrid = screen.getByLabelText('日历日期')
    const julyWeekBody = julyWeekGrid.closest('.time-calendar-body')
    const julyWeekButtons = within(julyWeekGrid).getAllByRole('button')

    expect(screen.getByRole('heading', { name: '7月31日' })).toBeInTheDocument()
    expect(julyWeekBody).toHaveStyle({ '--time-calendar-visible-rows': '1' })
    expect(julyWeekBody).toHaveStyle({ '--time-calendar-active-week-index': '4' })
    expect(julyWeekButtons.slice(28, 35).map((button) => button.textContent)).toEqual([
      '27',
      '28',
      '29',
      '30',
      '31',
      '1',
      '2',
    ])

    fireEvent.click(julyWeekButtons[33])

    const augustWeekGrid = screen.getByLabelText('日历日期')
    const augustWeekBody = augustWeekGrid.closest('.time-calendar-body')
    const augustWeekButtons = within(augustWeekGrid).getAllByRole('button')

    expect(screen.getByRole('heading', { name: '8月1日' })).toBeInTheDocument()
    expect(augustWeekBody).toHaveStyle({ '--time-calendar-visible-rows': '1' })
    expect(augustWeekBody).toHaveStyle({ '--time-calendar-active-week-index': '0' })
    expect(augustWeekButtons.slice(0, 7).map((button) => button.textContent)).toEqual([
      '27',
      '28',
      '29',
      '30',
      '31',
      '1',
      '2',
    ])
  })

  it('applies concrete selections from every time panel button group', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '21' }))

    expect(screen.getByRole('heading', { name: '6月21日' })).toBeInTheDocument()
    expect(screen.getByText('2026年6月21日')).toBeInTheDocument()

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
    const selectedWeekCardTop = screen.getByRole('heading', { name: '第30周' }).closest('.time-context-card__top')
    expect(selectedWeekCardTop).not.toBeNull()
    expect(within(selectedWeekCardTop as HTMLElement).getByText('2026年7月20日 - 2026年7月26日')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月' }))
    fireEvent.click(screen.getByRole('button', { name: /7月/ }))

    expect(screen.getByRole('heading', { name: '7月' })).toBeInTheDocument()
    expect(screen.getByText('2026年7月')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))
    fireEvent.click(screen.getByRole('button', { name: /2025/ }))

    expect(screen.getByRole('heading', { name: '2025年' })).toBeInTheDocument()
    expect(screen.getAllByText('2025年').length).toBeGreaterThanOrEqual(2)

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))
    fireEvent.click(screen.getByRole('button', { name: '最近一月' }))

    expect(screen.getByRole('heading', { name: '最近一月' })).toBeInTheDocument()
    expect(screen.getByText('2026年5月21日 - 2026年6月19日')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    expect(screen.getByLabelText('iOS 记账工作台')).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('iOS 记账工作台')).getByText('最近一月'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('当前账目范围')).not.toBeInTheDocument()
  })
})

function createLocalStorageMock() {
  const store = new Map<string, string>()

  return {
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}
