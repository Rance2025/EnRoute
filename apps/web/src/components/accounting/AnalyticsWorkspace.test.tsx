import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ledgerAtlasDataset } from '../../accounting/ledgerAtlasData'
import { defaultAccountingStatisticsControls } from '../../accounting/shell'
import type { TimeRangeSelection } from '../../time/timeRange'
import { AnalyticsWorkspace } from './AnalyticsWorkspace'

afterEach(cleanup)

const range: TimeRangeSelection = {
  mode: 'custom', start: '2026-06-01', end: '2026-06-18', anchorDate: '2026-06-01', isOpenEnded: false,
}

describe('AnalyticsWorkspace', () => {
  it('uses one control contract for trend, category hierarchy, and tag hierarchy', () => {
    render(
      <AnalyticsWorkspace
        dataset={ledgerAtlasDataset}
        timeRange={range}
        controls={{ ...defaultAccountingStatisticsControls, granularity: 'auto', comparePrevious: true }}
        onFocusChange={() => undefined}
      />,
    )

    expect(screen.getByLabelText('统计工作区')).toBeInTheDocument()
    expect(screen.getByText('最终粒度：日')).toBeInTheDocument()
    expect(screen.getByLabelText('分类层级分析')).toBeInTheDocument()
    expect(screen.getByLabelText('标签层级分析')).toBeInTheDocument()
    expect(screen.queryByText('标签 × 分类')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /三级/ })).not.toBeInTheDocument()
  })

  it('publishes a rich node focus and can clear it', () => {
    const onFocusChange = vi.fn()
    render(
      <AnalyticsWorkspace
        dataset={ledgerAtlasDataset}
        timeRange={range}
        controls={defaultAccountingStatisticsControls}
        onFocusChange={onFocusChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /餐饮/ }))
    expect(screen.getByLabelText('统计焦点详情')).toHaveTextContent('直接金额')
    expect(screen.getByLabelText('统计焦点详情')).toHaveTextContent('聚合金额')
    expect(screen.getByLabelText('统计焦点详情')).toHaveTextContent('主要账户')
    expect(screen.getByLabelText('统计焦点详情')).toHaveTextContent('关联标签')
    expect(screen.getByLabelText('统计焦点详情')).toHaveTextContent('上周期')
    expect(onFocusChange).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '清除焦点' }))
    expect(screen.queryByLabelText('统计焦点详情')).not.toBeInTheDocument()
    expect(screen.getByLabelText('统计分析说明')).toHaveTextContent('账户贡献')
  })
})
