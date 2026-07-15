import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

import './accounting/accounting.css'

import { loadAccountingDataset } from '../accounting/accountingDataSource'
import { formatCnyFromCents } from '../accounting/money'
import type { AccountingDataset } from '../accounting/types'
import {
  getTopCategoryComposition,
  getTopDirectTagAmounts,
  getAccountBalanceSteps,
} from '../accounting/insightSelectors'
import {
  saveTransactionDraft,
  type TransactionDraft,
} from '../accounting/transactionDraft'
import {
  filterTransactionsByTimeRange,
  getPeriodMetrics,
  getAccountPeriodSummaries,
  getPortfolioPeriodSummary,
} from '../accounting/selectors'
import type {
  AccountingSection,
  AccountingShellAction,
  AccountingShellSnapshot,
  AccountingStatisticsControls,
} from '../accounting/shell'
import type { TimeRangeSelection } from '../time/timeRange'
import { AnalyticsWorkspace, type AnalyticsFocus } from './accounting/AnalyticsWorkspace'
import { LedgerWorkspace } from './accounting/LedgerWorkspace'
import { AccountsWorkspace } from './accounting/AccountsWorkspace'
import { AccountManagementDialog } from './accounting/AccountManagementDialog'
import {
  TransactionDialog,
  type TransactionDialogMode,
} from './accounting/TransactionDialog'
import { AccountingLoadState } from './accounting/AccountingLoadState'

const EMPTY_ACCOUNTING_DATASET: AccountingDataset = {
  accounts: [],
  transactions: [],
  categories: [],
  tags: [],
  imports: [],
  legacyCategories: [],
  legacyFunds: [],
}

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
  const [dataset, setDataset] = useState<AccountingDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [dialogMode, setDialogMode] = useState<TransactionDialogMode | null>(null)
  const [dialogReturnFocusTo, setDialogReturnFocusTo] = useState<HTMLElement | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [analyticsFocus, setAnalyticsFocus] = useState<AnalyticsFocus | null>(null)
  const activeDataset = dataset ?? EMPTY_ACCOUNTING_DATASET

  useEffect(() => {
    const controller = new AbortController()
    setLoadError(null)
    loadAccountingDataset({ signal: controller.signal })
      .then((nextDataset) => {
        setDataset(nextDataset)
        setSelectedAccountId((current) => (
          nextDataset.accounts.some((account) => account.id === current)
            ? current
            : nextDataset.accounts[0]?.id ?? ''
        ))
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(error instanceof Error ? error.message : '无法读取记账数据')
      })
    return () => controller.abort()
  }, [loadAttempt])
  const transactions = useMemo(
    () => filterTransactionsByTimeRange(activeDataset.transactions, timeRange),
    [activeDataset.transactions, timeRange],
  )
  const metrics = useMemo(() => getPeriodMetrics(activeDataset, timeRange), [activeDataset, timeRange])
  const summaries = useMemo(() => getAccountPeriodSummaries(activeDataset, timeRange), [activeDataset, timeRange])
  const portfolio = useMemo(() => getPortfolioPeriodSummary(activeDataset, timeRange), [activeDataset, timeRange])
  const categoryComposition = useMemo(
    () => getTopCategoryComposition(activeDataset, transactions),
    [activeDataset, transactions],
  )
  const topTags = useMemo(
    () => getTopDirectTagAmounts(activeDataset, transactions, 5),
    [activeDataset, transactions],
  )
  const selectedSummary = summaries.find((summary) => summary.account.id === selectedAccountId)
  const activeSummaries = summaries.filter((summary) => !summary.account.archivedAt)
  const selectedAccountTransactions = useMemo(
    () => transactions.filter((transaction) => transactionBelongsToAccount(transaction, selectedAccountId)),
    [selectedAccountId, transactions],
  )
  const selectedAccountBalanceSteps = useMemo(
    () => getAccountBalanceSteps(activeDataset, timeRange, selectedAccountId),
    [activeDataset, selectedAccountId, timeRange],
  )
  const selectedAccountCategoryComposition = useMemo(
    () => getTopCategoryComposition(activeDataset, selectedAccountTransactions),
    [activeDataset, selectedAccountTransactions],
  )
  const selectedAccountTopTags = useMemo(
    () => getTopDirectTagAmounts(activeDataset, selectedAccountTransactions, 5),
    [activeDataset, selectedAccountTransactions],
  )
  const shellSnapshot = useMemo(
    () => createShellSnapshot(
      section,
      timeRange,
      metrics,
      portfolio,
      selectedSummary,
      statisticsControls,
      analyticsFocus,
    ),
    [analyticsFocus, metrics, portfolio, section, selectedSummary, statisticsControls, timeRange],
  )

  useEffect(() => {
    if (dataset) onShellSnapshotChange(shellSnapshot)
  }, [dataset, onShellSnapshotChange, shellSnapshot])

  if (!dataset) {
    return (
      <section className="accounting-page" aria-label="iOS 记账工作台">
        {loadError ? (
          <AccountingLoadState
            kind="error"
            message={loadError}
            onRetry={() => setLoadAttempt((value) => value + 1)}
          />
        ) : (
          <AccountingLoadState kind="loading" />
        )}
      </section>
    )
  }

  if (dataset.accounts.length === 0 && dataset.transactions.length === 0) {
    return (
      <section className="accounting-page" aria-label="iOS 记账工作台">
        <AccountingLoadState kind="empty" />
      </section>
    )
  }

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
          dataset={dataset}
          summaries={activeSummaries}
          transactions={selectedAccountTransactions}
          selectedAccountId={selectedAccountId}
          balanceSteps={selectedAccountBalanceSteps}
          categoryComposition={selectedAccountCategoryComposition}
          topTags={selectedAccountTopTags}
          onSelectAccount={setSelectedAccountId}
          onSelectTransaction={(transaction) => {
            setDialogReturnFocusTo(getActiveElement())
            setDialogMode({ kind: 'detail', transactionId: transaction.id })
          }}
        />
      ) : null}

      {section === 'analytics' ? (
        <AnalyticsWorkspace
          dataset={dataset}
          timeRange={timeRange}
          controls={statisticsControls}
          onFocusChange={setAnalyticsFocus}
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
      {shellCommand && selectedSummary ? (
        <AccountManagementDialog
          key={`${shellCommand}-${selectedSummary.account.id}`}
          action={shellCommand}
          account={selectedSummary.account}
          onSave={(account) => {
            setDataset((current) => ({
              ...current,
              accounts: current.accounts.map((candidate) => candidate.id === account.id ? account : candidate),
            }))
            if (account.archivedAt) {
              const nextAccount = activeSummaries.find((summary) => summary.account.id !== account.id)
              if (nextAccount) setSelectedAccountId(nextAccount.account.id)
            }
            onShellCommandHandled()
          }}
          onClose={onShellCommandHandled}
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
  analyticsFocus: AnalyticsFocus | null,
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
    if (analyticsFocus) {
      return {
        metricItems: [
          { label: '收入', value: formatCurrency(metrics.incomeInCents) },
          { label: '支出', value: formatCurrency(metrics.expenseInCents) },
          { label: metrics.netInCents >= 0 ? '净收入' : '净支出', value: formatCurrency(metrics.netInCents) },
        ],
        context: {
          eyebrow: analyticsFocus.taxonomy === 'category' ? '分类焦点' : '标签焦点',
          title: analyticsFocus.path,
          description: '直接值与后代聚合分开计算，便于辨认树状口径。',
          rows: [
            { label: '直接金额', value: formatCurrency(analyticsFocus.direct.incomeInCents + analyticsFocus.direct.expenseInCents) },
            { label: '聚合金额', value: formatCurrency(analyticsFocus.aggregate.incomeInCents + analyticsFocus.aggregate.expenseInCents) },
            { label: '笔数', value: `${analyticsFocus.aggregate.transactionCount} 笔` },
            { label: '上周期', value: analyticsFocus.previousChangeLabel },
          ],
          actions: [],
        },
      }
    }
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
  setDataset: Dispatch<SetStateAction<AccountingDataset | null>>,
) {
  setDataset((current) => current ? ({
    ...current,
    transactions: saveTransactionDraft(current.transactions, draft, new Date().toISOString()),
  }) : current)
}

function transactionBelongsToAccount(
  transaction: AccountingDataset['transactions'][number],
  accountId: string,
) {
  return transaction.type === 'transfer'
    ? transaction.fromAccountId === accountId || transaction.toAccountId === accountId
    : transaction.accountId === accountId
}
