import { useMemo, useState } from 'react'

import { ledgerAtlasDataset } from '../accounting/ledgerAtlasData'
import {
  filterTransactionsByTimeRange,
  getAccountPeriodSummaries,
  getCategoryTreeStats,
  getPeriodMetrics,
  getTagTreeStats,
} from '../accounting/selectors'
import type { Transaction } from '../accounting/types'
import type { TimeRangeSelection } from '../time/timeRange'
import { AnalyticsWorkspace } from './accounting/AnalyticsWorkspace'
import {
  LedgerDetailDialog,
  LedgerWorkspace,
  NewTransactionDialog,
} from './accounting/LedgerWorkspace'

export type AccountingSection = 'workspace' | 'analytics'

type AccountingPageProps = {
  section: AccountingSection
  timeRange: TimeRangeSelection
  onSectionChange: (section: AccountingSection) => void
}

export function AccountingPage({
  section,
  timeRange,
  onSectionChange,
}: AccountingPageProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [activeTransaction, setActiveTransaction] = useState<Transaction | null>(null)
  const [isNewTransactionOpen, setIsNewTransactionOpen] = useState(false)
  const transactions = useMemo(
    () => filterTransactionsByTimeRange(ledgerAtlasDataset.transactions, timeRange),
    [timeRange],
  )
  const metrics = useMemo(() => getPeriodMetrics(ledgerAtlasDataset, timeRange), [timeRange])
  const accountSummaries = useMemo(
    () => getAccountPeriodSummaries(ledgerAtlasDataset, timeRange),
    [timeRange],
  )
  const categoryStats = useMemo(
    () => getCategoryTreeStats(ledgerAtlasDataset, timeRange),
    [timeRange],
  )
  const tagStats = useMemo(() => getTagTreeStats(ledgerAtlasDataset, timeRange), [timeRange])

  return (
    <section className="accounting-page" aria-label="iOS 记账工作台">
      {section === 'workspace' ? (
        <LedgerWorkspace
          dataset={ledgerAtlasDataset}
          summaries={accountSummaries}
          transactions={transactions}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          onSelectTransaction={setActiveTransaction}
          onCreateTransaction={() => setIsNewTransactionOpen(true)}
          onOpenAnalytics={() => onSectionChange('analytics')}
        />
      ) : null}

      {section === 'analytics' ? (
        <AnalyticsWorkspace
          dataset={ledgerAtlasDataset}
          metrics={metrics}
          transactions={transactions}
          categoryStats={categoryStats}
          tagStats={tagStats}
          onBackToLedger={() => onSectionChange('workspace')}
        />
      ) : null}

      {activeTransaction ? (
        <LedgerDetailDialog
          dataset={ledgerAtlasDataset}
          transaction={activeTransaction}
          onClose={() => setActiveTransaction(null)}
        />
      ) : null}

      {isNewTransactionOpen ? (
        <NewTransactionDialog onClose={() => setIsNewTransactionOpen(false)} />
      ) : null}
    </section>
  )
}
