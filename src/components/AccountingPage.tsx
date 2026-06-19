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
import { formatSignedCny } from './accounting/formatting'
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
    <section className="accounting-page" aria-label="记账图谱工作台">
      <header className="accounting-topbar">
        <div className="accounting-title-lockup">
          <span>Ledger Atlas</span>
          <strong>记账图谱工作台</strong>
        </div>
        <div className="accounting-scope-chip" aria-label="当前账目范围">
          <span>{display.accountingLabel}</span>
          <strong>人民币 · {display.detail}</strong>
        </div>
        <SegmentedControl
          ariaLabel="记账工作区"
          className="accounting-mode-tabs"
          options={accountingModes}
          value={mode}
          onChange={setMode}
        />
      </header>

      <section className="accounting-overview" aria-label="记账概览">
        <Metric
          icon={CircleDollarSign}
          label="净流入"
          value={formatSignedCny(metrics.netInCents)}
          tone="balance"
        />
        <Metric
          icon={Activity}
          label="支出"
          value={`¥${formatCnyFromCents(metrics.expenseInCents)}`}
          tone="expense"
        />
        <Metric
          icon={ReceiptText}
          label="流水"
          value={String(metrics.transactionCount)}
          tone="neutral"
        />
        <Metric
          icon={WalletCards}
          label="活跃账户"
          value={String(metrics.activeAccountCount)}
          tone="income"
        />
      </section>

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
          transactions={transactions}
          categoryStats={categoryStats}
          tagStats={tagStats}
        />
      ) : null}
    </section>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof CircleDollarSign
  label: string
  value: string
  tone?: 'balance' | 'income' | 'expense' | 'neutral'
}) {
  return (
    <div className={`metric metric--${tone}`}>
      <span>
        <Icon size={15} strokeWidth={2} />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  )
}
