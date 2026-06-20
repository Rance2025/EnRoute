import { Activity, CircleDollarSign, ReceiptText, WalletCards } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ledgerAtlasDataset } from '../accounting/ledgerAtlasData'
import { formatCnyFromCents } from '../accounting/money'
import {
  filterTransactionsByTimeRange,
  getAccountPeriodSummaries,
  getCategoryTreeStats,
  getPeriodMetrics,
  getTagTreeStats,
} from '../accounting/selectors'
import type { Transaction } from '../accounting/types'
import { getTimeRangeDisplay, type TimeRangeSelection } from '../time/timeRange'
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
  const display = getTimeRangeDisplay(timeRange)
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
      <div className="accounting-dock" aria-label="记账控制栏">
        <section className="ios-summary-strip" aria-label="记账概览摘要">
          <SummaryPill
            icon={CircleDollarSign}
            label="净现金流"
            value={formatSignedCurrency(metrics.netInCents)}
            tone={metrics.netInCents >= 0 ? 'income' : 'expense'}
          />
          <SummaryPill
            icon={Activity}
            label="本期支出"
            value={`¥${formatCnyFromCents(metrics.expenseInCents)}`}
            tone="expense"
          />
          <SummaryPill
            icon={ReceiptText}
            label="本期流水"
            value={`${metrics.transactionCount} 笔`}
          />
          <SummaryPill
            icon={WalletCards}
            label="活跃账户"
            value={`${metrics.activeAccountCount} 个`}
            tone="income"
          />
          <div className="ios-summary-scope">
            <span>{display.accountingLabel}</span>
            <strong>{display.title}</strong>
          </div>
        </section>

        <div className="accounting-actions" aria-label="记账快捷操作">
          {view === 'analytics' ? (
            <button type="button" className="accounting-action" onClick={() => setView('workspace')}>
              返回流水
            </button>
          ) : (
            <span>{transactions.length} 笔流水</span>
          )}
        </div>
      </div>

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

function SummaryPill({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof CircleDollarSign
  label: string
  value: string
  tone?: 'income' | 'expense' | 'neutral'
}) {
  return (
    <div className={`ios-summary-pill ios-summary-pill--${tone}`}>
      <Icon size={14} strokeWidth={2} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatSignedCurrency(amountInCents: number) {
  if (amountInCents === 0) return '¥0.00'

  return `${amountInCents > 0 ? '+' : '-'}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}
