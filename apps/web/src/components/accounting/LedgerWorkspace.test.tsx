import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { getTopCategoryComposition } from '../../accounting/insightSelectors'
import { realisticAccountingDataset } from '../../accounting/realDataFixtures'
import { getPortfolioPeriodSummary } from '../../accounting/selectors'
import type { TimeRangeSelection } from '../../time/timeRange'
import { LedgerWorkspace } from './LedgerWorkspace'

afterEach(cleanup)

const range: TimeRangeSelection = {
  mode: 'month',
  start: '2026-06-01',
  end: '2026-06-30',
  anchorDate: '2026-06-18',
}

describe('LedgerWorkspace', () => {
  it('keeps the ledger compact and dedicates the wider column to useful insights', () => {
    render(
      <LedgerWorkspace
        dataset={realisticAccountingDataset}
        transactions={realisticAccountingDataset.transactions}
        portfolio={getPortfolioPeriodSummary(realisticAccountingDataset, range)}
        categoryComposition={getTopCategoryComposition(realisticAccountingDataset, realisticAccountingDataset.transactions)}
        topTags={[]}
        onSelectTransaction={() => undefined}
        onCreateTransaction={() => undefined}
      />,
    )

    expect(screen.getByLabelText('账户与流水工作台')).toHaveAttribute('data-ledger-ratio', '41:59')
    expect(screen.getByLabelText('流水列表')).toBeInTheDocument()
    expect(screen.getByLabelText('全部账户净资产')).toBeInTheDocument()
    expect(screen.getByLabelText('收入与支出分类构成')).toBeInTheDocument()
    expect(screen.getByLabelText('期间节奏')).toBeInTheDocument()
    expect(screen.getByLabelText('标签数据说明')).toBeInTheDocument()
  })
})
