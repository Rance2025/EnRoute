import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { CashflowBucket } from '../../accounting/insightSelectors'
import { CashflowTrendChart } from './CashflowTrendChart'

afterEach(cleanup)

const buckets: CashflowBucket[] = [
  { key: '2026-06-01', label: '06/01', incomeInCents: 120_000, expenseInCents: 45_000, transferInCents: 0, netInCents: 75_000, transactionCount: 3, incomeCount: 1, expenseCount: 2, transferCount: 0 },
  { key: '2026-06-02', label: '06/02', incomeInCents: 60_000, expenseInCents: 90_000, transferInCents: 0, netInCents: -30_000, transactionCount: 4, incomeCount: 2, expenseCount: 2, transferCount: 0 },
]

describe('CashflowTrendChart', () => {
  it('shares one scale for clustered income and expense bars plus the net line', () => {
    render(
      <CashflowTrendChart
        buckets={buckets}
        previousBuckets={buckets.map((bucket) => ({ ...bucket, netInCents: bucket.netInCents / 2 }))}
        measure="amount"
        granularity="day"
      />,
    )

    expect(screen.getByRole('img', { name: '收支趋势图' })).toBeInTheDocument()
    expect(screen.getAllByTestId('trend-income-bar')).toHaveLength(2)
    expect(screen.getAllByTestId('trend-expense-bar')).toHaveLength(2)
    expect(screen.getByTestId('trend-net-line')).toHaveAttribute('data-scale', 'shared')
    expect(screen.getByTestId('trend-previous-line')).toHaveAttribute('stroke-dasharray')
    expect(screen.getByText('最终粒度：日')).toBeInTheDocument()
  })

  it('renders count semantics and an honest empty comparison state', () => {
    render(
      <CashflowTrendChart
        buckets={buckets}
        previousBuckets={[]}
        measure="count"
        granularity="week"
      />,
    )

    expect(screen.getByText('笔数')).toBeInTheDocument()
    expect(screen.getByText('无可比数据')).toBeInTheDocument()
    expect(screen.getByText('最终粒度：周')).toBeInTheDocument()
  })
})
