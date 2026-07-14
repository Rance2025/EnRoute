import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

import { ledgerAtlasDataset } from '../accounting/ledgerAtlasData'
import { formatCnyFromCents } from '../accounting/money'
import {
  getTopCategoryComposition,
  getTopDirectTagAmounts,
} from '../accounting/insightSelectors'
import {
  saveTransactionDraft,
  type TransactionDraft,
} from '../accounting/transactionDraft'
import {
  filterTransactionsByTimeRange,
  getCategoryTreeStats,
  getPeriodMetrics,
  getAccountPeriodSummaries,
  getPortfolioPeriodSummary,
  getTagTreeStats,
} from '../accounting/selectors'
import type {
  AccountingSection,
  AccountingShellAction,
  AccountingShellSnapshot,
  AccountingStatisticsControls,
} from '../accounting/shell'
import type { TimeRangeSelection } from '../time/timeRange'
import { AnalyticsWorkspace } from './accounting/AnalyticsWorkspace'
import { AccountsWorkspace, LedgerWorkspace } from './accounting/LedgerWorkspace'
import {
  TransactionDialog,
  type TransactionDialogMode,
} from './accounting/TransactionDialog'

type AccountingPageProps = {
  section: AccountingSection
  timeRange: TimeRangeSelection
  statisticsControls: AccountingStatisticsControls
  shellCommand: AccountingShellAction | null
  onShellCommandHandled: () => void
  onShellSnapshotChange: (snapshot: AccountingShellSnapshot) => void
}

export function AccountingPage({
  section,
  timeRange,
  statisticsControls,
  shellCommand,
  onShellCommandHandled,
  onShellSnapshotChange,
}: AccountingPageProps) {
  const [dataset, setDataset] = useState(() => ({
    ...ledgerAtlasDataset,
    accounts: [...ledgerAtlasDataset.accounts],
    transactions: [...ledgerAtlasDataset.transactions],
    categories: [...ledgerAtlasDataset.categories],
    tags: [...ledgerAtlasDataset.tags],
  }))
  const [dialogMode, setDialogMode] = useState<TransactionDialogMode | null>(null)
  const [dialogReturnFocusTo, setDialogReturnFocusTo] = useState<HTMLElement | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState(
    () => ledgerAtlasDataset.accounts[0]?.id ?? '',
  )
  const transactions = useMemo(
    () => filterTransactionsByTimeRange(dataset.transactions, timeRange),
    [dataset.transactions, timeRange],
  )
  const metrics = useMemo(() => getPeriodMetrics(dataset, timeRange), [dataset, timeRange])
  const summaries = useMemo(() => getAccountPeriodSummaries(dataset, timeRange), [dataset, timeRange])
  const portfolio = useMemo(() => getPortfolioPeriodSummary(dataset, timeRange), [dataset, timeRange])
  const categoryComposition = useMemo(
    () => getTopCategoryComposition(dataset, transactions),
    [dataset, transactions],
  )
  const topTags = useMemo(
    () => getTopDirectTagAmounts(dataset, transactions, 5),
    [dataset, transactions],
  )
  const categoryStats = useMemo(
    () => getCategoryTreeStats(dataset, timeRange),
    [dataset, timeRange],
  )
  const tagStats = useMemo(() => getTagTreeStats(ledgerAtlasDataset, timeRange), [timeRange])
  const selectedSummary = summaries.find((summary) => summary.account.id === selectedAccountId)
  const shellSnapshot = useMemo(
    () => createShellSnapshot(
      section,
      timeRange,
      metrics,
      portfolio,
      selectedSummary,
      statisticsControls,
    ),
    [metrics, portfolio, section, selectedSummary, statisticsControls, timeRange],
  )

  useEffect(() => {
    onShellSnapshotChange(shellSnapshot)
  }, [onShellSnapshotChange, shellSnapshot])

  useEffect(() => {
    if (!shellCommand) return
    onShellCommandHandled()
  }, [onShellCommandHandled, shellCommand])

  return (
    <section className="accounting-page" aria-label="iOS 记账工作台">
      {section === 'ledger' ? (
        <LedgerWorkspace
          dataset={dataset}
          transactions={transactions}
          portfolio={portfolio}
          categoryComposition={categoryComposition}
          topTags={topTags}
          onSelectTransaction={(transaction) => {
            setDialogReturnFocusTo(getActiveElement())
            setDialogMode({ kind: 'detail', transactionId: transaction.id })
          }}
          onCreateTransaction={() => {
            setDialogReturnFocusTo(getActiveElement())
            setDialogMode({ kind: 'create' })
          }}
        />
      ) : null}

      {section === 'accounts' ? (
        <AccountsWorkspace
          summaries={summaries}
          transactions={transactions}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
        />
      ) : null}

      {section === 'analytics' ? (
        <AnalyticsWorkspace
          dataset={dataset}
          metrics={metrics}
          transactions={transactions}
          categoryStats={categoryStats}
          tagStats={tagStats}
        />
      ) : null}

      {dialogMode ? (
        <TransactionDialog
          key={dialogMode.kind === 'create' ? 'create' : `${dialogMode.kind}-${dialogMode.transactionId}`}
          dataset={dataset}
          mode={dialogMode}
          returnFocusTo={dialogReturnFocusTo}
          onModeChange={setDialogMode}
          onSave={(draft) => {
            saveDraft(draft, setDataset)
            setDialogMode(null)
          }}
          onClose={() => setDialogMode(null)}
        />
      ) : null}
    </section>
  )
}

function createShellSnapshot(
  section: AccountingSection,
  timeRange: TimeRangeSelection,
  metrics: ReturnType<typeof getPeriodMetrics>,
  portfolio: ReturnType<typeof getPortfolioPeriodSummary>,
  selectedSummary: ReturnType<typeof getAccountPeriodSummaries>[number] | undefined,
  statisticsControls: AccountingStatisticsControls,
): AccountingShellSnapshot {
  if (section === 'accounts' && selectedSummary) {
    return {
      metricItems: [
        { label: '期初', value: formatCurrency(selectedSummary.openingInCents) },
        { label: '期末', value: formatCurrency(selectedSummary.closingInCents) },
        { label: '净变动', value: formatCurrency(selectedSummary.netChangeInCents) },
      ],
      context: {
        eyebrow: '当前账户',
        title: selectedSummary.account.name,
        description: '账户流水、余额和分类洞察跟随前景卡片联动。',
        rows: [
          { label: '性质', value: selectedSummary.account.nature === 'asset' ? '资产' : '负债' },
          { label: '币种', value: selectedSummary.account.currency },
          { label: '数据来源', value: selectedSummary.account.sourceLabel ?? '本地原型' },
        ],
        actions: [
          { id: 'edit-account', label: '编辑账户资料' },
          { id: 'adjust-opening-balance', label: '调整期初余额' },
          { id: 'set-account-brand', label: '设置账户品牌' },
          { id: 'toggle-account-hidden', label: selectedSummary.account.hidden ? '取消隐藏' : '隐藏账户' },
          { id: 'archive-account', label: '归档账户', tone: 'danger' },
        ],
      },
    }
  }

  if (section === 'analytics') {
    return {
      metricItems: [
        { label: '收入', value: formatCurrency(metrics.incomeInCents) },
        { label: '支出', value: formatCurrency(metrics.expenseInCents) },
        { label: metrics.netInCents >= 0 ? '净收入' : '净支出', value: formatCurrency(metrics.netInCents) },
      ],
      context: {
        eyebrow: '当前分区',
        title: '统计',
        description: '全局趋势、完整分类树与标签树在中间联动展开。',
        rows: [
          { label: '统计口径', value: statisticsControls.measure === 'amount' ? '金额' : '笔数' },
          { label: '时间粒度', value: statisticsControls.granularity },
          { label: '范围', value: `${timeRange.start} — ${timeRange.end}` },
        ],
        actions: [],
      },
    }
  }

  return {
    metricItems: [
      { label: '收入', value: formatCurrency(metrics.incomeInCents) },
      { label: '支出', value: formatCurrency(metrics.expenseInCents) },
      { label: '流水', value: `${metrics.transactionCount} 笔` },
    ],
    context: {
      eyebrow: '当前分区',
      title: '流水',
      description: '流水录入、全部账户净资产和轻量洞察在中间展开。',
      rows: [
        { label: '范围', value: `${timeRange.start} — ${timeRange.end}` },
        { label: '账户', value: '全部账户' },
        { label: '期末净资产', value: formatCurrency(portfolio.closingNetWorthInCents) },
        { label: '状态', value: '本地原型' },
      ],
      actions: [],
    },
  }
}

function formatCurrency(amountInCents: number) {
  return `${amountInCents < 0 ? '-' : ''}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}

function getActiveElement() {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function saveDraft(
  draft: TransactionDraft,
  setDataset: Dispatch<SetStateAction<typeof ledgerAtlasDataset>>,
) {
  setDataset((current) => ({
    ...current,
    transactions: saveTransactionDraft(current.transactions, draft, new Date().toISOString()),
  }))
}
