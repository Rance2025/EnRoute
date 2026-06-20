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

type AccountingView = 'workspace' | 'analytics'

type AccountingPageProps = {
  timeRange: TimeRangeSelection
}

export function AccountingPage({ timeRange }: AccountingPageProps) {
  const [view, setView] = useState<AccountingView>('workspace')
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
      {view === 'workspace' ? (
        <LedgerWorkspace
          dataset={ledgerAtlasDataset}
          summaries={accountSummaries}
          transactions={transactions}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          onSelectTransaction={setActiveTransaction}
          onCreateTransaction={() => setIsNewTransactionOpen(true)}
          onOpenAnalytics={() => setView('analytics')}
        />
      ) : null}

      {view === 'analytics' ? (
        <AnalyticsWorkspace
          dataset={ledgerAtlasDataset}
          metrics={metrics}
          transactions={transactions}
          categoryStats={categoryStats}
          tagStats={tagStats}
          onBackToLedger={() => setView('workspace')}
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
