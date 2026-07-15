import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { realisticAccountingDataset } from '../../accounting/realDataFixtures'
import { LedgerSupportingInsights } from './LedgerSupportingInsights'

afterEach(cleanup)

describe('LedgerSupportingInsights', () => {
  it('uses a compact source notice instead of an empty tag table', () => {
    render(
      <LedgerSupportingInsights
        dataset={realisticAccountingDataset}
        transactions={realisticAccountingDataset.transactions}
        topTags={[]}
      />,
    )

    expect(screen.getByLabelText('期间节奏')).toHaveTextContent(/活跃\s*1 天/)
    expect(screen.getByLabelText('标签数据说明')).toHaveTextContent('原始账单未携带标签')
    expect(screen.getByLabelText('标签数据说明')).toHaveTextContent('分类覆盖')
    expect(screen.queryByLabelText('高频标签金额')).not.toBeInTheDocument()
  })

  it('renders amount columns when direct tags exist', () => {
    render(
      <LedgerSupportingInsights
        dataset={realisticAccountingDataset}
        transactions={realisticAccountingDataset.transactions}
        topTags={[{
          id: 'tag-one',
          name: '工作日',
          path: '场景 / 工作日',
          incomeInCents: 0,
          expenseInCents: 1880,
          transferInCents: 0,
          netInCents: -1880,
          transactionCount: 1,
        }]}
      />,
    )

    expect(screen.getByLabelText('高频标签金额')).toHaveTextContent('场景 / 工作日')
    expect(screen.queryByLabelText('标签数据说明')).not.toBeInTheDocument()
  })
})
