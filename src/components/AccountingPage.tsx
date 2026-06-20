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
import { getTimeRangeDisplay, type TimeRangeSelection } from '../time/timeRange'
import { AccountsWorkspace } from './accounting/AccountsWorkspace'
import { AnalyticsWorkspace } from './accounting/AnalyticsWorkspace'
import { LedgerWorkspace } from './accounting/LedgerWorkspace'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

type AccountingMode = 'ledger' | 'accounts' | 'report'

type AccountingPageProps = {
  timeRange: TimeRangeSelection
}

const accountingModes: Array<SegmentedOption<AccountingMode>> = [
  { value: 'ledger', label: '流水' },
  { value: 'accounts', label: '账户' },
  { value: 'report', label: '统计' },
]

export function AccountingPage({ timeRange }: AccountingPageProps) {
  const [mode, setMode] = useState<AccountingMode>('ledger')
  const [selectedTransactionId, setSelectedTransactionId] = useState('tx-yogurt')
  const [selectedCategoryId, setSelectedCategoryId] = useState('expense-drink')
  const [selectedTagId, setSelectedTagId] = useState('qingdao-trip')
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
  const selectedTransaction =
    transactions.find((transaction) => transaction.id === selectedTransactionId) ??
    transactions[0] ??
    ledgerAtlasDataset.transactions[0]

  function handleSelectTransaction(transactionId: string) {
    setSelectedTransactionId(transactionId)
    const transaction = transactions.find((item) => item.id === transactionId)

    if (transaction?.categoryId) setSelectedCategoryId(transaction.categoryId)
    if (transaction?.tagIds[0]) setSelectedTagId(transaction.tagIds[0])
  }

  return (
    <section className="accounting-page" aria-label="iOS 记账工作台">
      <div className="accounting-dock" aria-label="记账控制栏">
        <section className="ios-summary-strip" aria-label="当前范围摘要">
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

        <SegmentedControl
          ariaLabel="记账工作区"
          className="accounting-mode-tabs"
          options={accountingModes}
          value={mode}
          onChange={setMode}
        />
      </div>

      {mode === 'ledger' ? (
        <LedgerWorkspace
          dataset={ledgerAtlasDataset}
          transactions={transactions}
          selectedTransaction={selectedTransaction}
          selectedCategoryId={selectedCategoryId}
          selectedTagId={selectedTagId}
          categoryStats={categoryStats}
          tagStats={tagStats}
          onSelectTransaction={handleSelectTransaction}
          onSelectCategory={setSelectedCategoryId}
          onSelectTag={setSelectedTagId}
        />
      ) : null}

      {mode === 'accounts' ? (
        <AccountsWorkspace
          dataset={ledgerAtlasDataset}
          summaries={accountSummaries}
          transactions={transactions}
        />
      ) : null}

      {mode === 'report' ? (
        <AnalyticsWorkspace
          dataset={ledgerAtlasDataset}
          metrics={metrics}
          transactions={transactions}
          categoryStats={categoryStats}
          tagStats={tagStats}
        />
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
