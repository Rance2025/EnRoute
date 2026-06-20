import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { selectDay, selectMonth, setCustomDateRange } from '../time/timeRange'
import { TimeContextPanel } from './TimeContextPanel'

afterEach(() => {
  cleanup()
})

describe('TimeContextPanel', () => {
  it('renders accounting summary values through the shared metric strip', () => {
    render(
      <TimeContextPanel
        view="accounting"
        selection={selectMonth(2026, 6)}
        onSelectionChange={vi.fn()}
      />,
    )

    const timeCardSummary = screen.getByLabelText('全局范围指标')

    expect(screen.queryByText('全局时间范围')).not.toBeInTheDocument()
    expect(timeCardSummary.children).toHaveLength(3)
    expect(within(timeCardSummary).getByText('收入')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥5172.41')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('支出')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥481.18')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('流水')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('6 笔')).toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('净流入')).not.toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('账户')).not.toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('4 个')).not.toBeInTheDocument()
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

    expect(screen.queryByText('全局时间范围')).not.toBeInTheDocument()
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
