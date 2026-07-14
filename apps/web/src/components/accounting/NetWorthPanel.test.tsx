import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { PortfolioPeriodSummary } from '../../accounting/types'
import { NetWorthPanel } from './NetWorthPanel'

afterEach(cleanup)

const summary: PortfolioPeriodSummary = {
  openingAssetsInCents: 40_000_00,
  openingLiabilitiesInCents: 10_000_00,
  openingNetWorthInCents: 30_000_00,
  incomeInCents: 5_000_00,
  expenseInCents: 1_000_00,
  transferInCents: 2_000_00,
  netChangeInCents: 4_000_00,
  closingAssetsInCents: 44_000_00,
  closingLiabilitiesInCents: 10_000_00,
  closingNetWorthInCents: 34_000_00,
  transactionCount: 8,
}

describe('NetWorthPanel', () => {
  it('shows closing net worth, opposed assets and liabilities, and a four-part bridge', () => {
    render(<NetWorthPanel summary={summary} />)

    const panel = screen.getByLabelText('全部账户净资产')
    expect(within(panel).getByText('¥34,000.00')).toBeInTheDocument()
    expect(within(panel).getByLabelText('资产与负债对向图')).toHaveTextContent('资产¥44,000.00')
    expect(within(panel).getByLabelText('资产与负债对向图')).toHaveTextContent('负债¥10,000.00')
    expect(within(panel).getByLabelText('净资产桥接图').children).toHaveLength(4)
    expect(within(panel).getByLabelText('净资产桥接图')).toHaveTextContent('期初净资产')
    expect(within(panel).getByLabelText('净资产桥接图')).toHaveTextContent('收入')
    expect(within(panel).getByLabelText('净资产桥接图')).toHaveTextContent('支出')
    expect(within(panel).getByLabelText('净资产桥接图')).toHaveTextContent('期末净资产')
    expect(within(panel).queryByText('转账')).not.toBeInTheDocument()
  })

  it('uses a cool negative tone rather than danger red for negative net worth', () => {
    render(<NetWorthPanel summary={{ ...summary, closingNetWorthInCents: -500_00 }} />)
    const panel = screen.getByLabelText('全部账户净资产')
    expect(panel).toHaveClass('is-negative')
    expect(panel).not.toHaveClass('is-danger')
    expect(within(panel).getAllByText('-¥500.00')).toHaveLength(2)
  })
})
