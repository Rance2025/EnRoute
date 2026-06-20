import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectDay, selectMonth, setCustomDateRange } from '../time/timeRange'
import { TimeContextPanel } from './TimeContextPanel'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-20T10:20:30+08:00'))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('TimeContextPanel', () => {
  it('uses the map-only all-time start date when entering custom ranges', () => {
    const mapSelectionChange = vi.fn()
    render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-20')}
        onSelectionChange={mapSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(mapSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'custom',
        start: '2026-01-11',
        end: '2026-06-20',
        label: '全部',
        isOpenEnded: true,
      }),
    )

    cleanup()

    const accountingSelectionChange = vi.fn()
    render(
      <TimeContextPanel
        view="accounting"
        selection={selectDay('2026-06-20')}
        onSelectionChange={accountingSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(accountingSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'custom',
        start: '2022-03-01',
        end: '2026-06-20',
        label: '全部',
        isOpenEnded: true,
      }),
    )
  })

  it('lets the custom date picker title switch into month selection by year', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2022-03-01', '2026-06-20')}
        onSelectionChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /打开开始日期选择器/ }))

    const picker = screen.getByRole('dialog', { name: '开始日期选择' })
    fireEvent.click(within(picker).getByRole('button', { name: /2022年3月/ }))

    expect(within(picker).getByLabelText('月份选择')).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: /2022年/ })).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: '上一年' })).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: '下一年' })).toBeInTheDocument()
    expect(within(picker).queryByLabelText('日期选择')).not.toBeInTheDocument()

    fireEvent.click(within(picker).getByRole('button', { name: '下一年' }))

    expect(within(picker).getByRole('button', { name: /2023年/ })).toBeInTheDocument()
    expect(picker.querySelector('.time-date-picker__grid-motion')).toHaveClass(
      'time-range-grid-motion--next',
    )

    fireEvent.click(within(picker).getByRole('button', { name: '1月' }))

    expect(within(picker).getByRole('button', { name: /2023年1月/ })).toBeInTheDocument()
    expect(within(picker).getByLabelText('日期选择')).toBeInTheDocument()
    expect(within(picker).queryByLabelText('月份选择')).not.toBeInTheDocument()
  })

  it('animates custom date picker month and year navigation with the shared direction classes', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2022-03-01', '2026-06-20')}
        onSelectionChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /打开开始日期选择器/ }))

    const picker = screen.getByRole('dialog', { name: '开始日期选择' })
    const getMotion = () => picker.querySelector('.time-date-picker__grid-motion')

    expect(getMotion()).not.toHaveClass('time-range-grid-motion--previous')
    expect(getMotion()).not.toHaveClass('time-range-grid-motion--next')

    fireEvent.click(within(picker).getByRole('button', { name: '下个月' }))

    expect(within(picker).getByRole('button', { name: /2022年4月/ })).toBeInTheDocument()
    expect(getMotion()).toHaveClass('time-range-grid-motion--next')

    fireEvent.click(within(picker).getByRole('button', { name: /2022年4月/ }))
    fireEvent.click(within(picker).getByRole('button', { name: '上一年' }))

    expect(within(picker).getByRole('button', { name: /2021年/ })).toBeInTheDocument()
    expect(getMotion()).toHaveClass('time-range-grid-motion--previous')
  })

  it('renders accounting summary values through the shared metric strip', () => {
    render(
      <TimeContextPanel
        view="accounting"
        selection={selectMonth(2026, 6)}
        onSelectionChange={vi.fn()}
      />,
    )

    const timeCardSummary = screen.getByLabelText('全局范围指标')

    expect(within(timeCardSummary).getByText('净流入')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('+¥4691.23')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('支出')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥481.18')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('流水')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('6 笔')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('账户')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('4 个')).toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('¥420')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前范围摘要')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('记账概览卡片')).not.toBeInTheDocument()
  })

  it('renders map metrics in the same global metric strip with map-specific content', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-15')}
        onSelectionChange={vi.fn()}
        metricItems={[
          { label: '当前足迹', value: '12' },
          { label: '全部足迹', value: '40441' },
          { label: '覆盖城市', value: '8' },
        ]}
      />,
    )

    const metricStrip = screen.getByLabelText('全局范围指标')

    expect(within(metricStrip).getByText('当前足迹')).toBeInTheDocument()
    expect(within(metricStrip).getByText('12')).toBeInTheDocument()
    expect(within(metricStrip).getByText('全部足迹')).toBeInTheDocument()
    expect(within(metricStrip).getByText('40441')).toBeInTheDocument()
    expect(within(metricStrip).getByText('覆盖城市')).toBeInTheDocument()
    expect(within(metricStrip).getByText('8')).toBeInTheDocument()
    expect(within(metricStrip).queryByText('净流入')).not.toBeInTheDocument()
    expect(within(metricStrip).queryByText('账户')).not.toBeInTheDocument()
  })

  it('does not duplicate selected dates below native custom date controls', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2026-06-10', '2026-06-12')}
        onSelectionChange={vi.fn()}
      />,
    )

    const customPanel = screen.getByLabelText('自定义时间范围')
    const dateFields = within(customPanel).getByLabelText('自定义日期字段')

    expect(within(dateFields).getByLabelText('开始日期')).toHaveValue('2026-06-10')
    expect(within(dateFields).getByLabelText('结束日期')).toHaveValue('2026-06-12')
    expect(within(dateFields).queryByText('2026年6月10日')).not.toBeInTheDocument()
    expect(within(dateFields).queryByText('2026年6月12日')).not.toBeInTheDocument()
  })
})
