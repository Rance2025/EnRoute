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
import type { AccountPeriodSummary, PeriodMetrics, Transaction } from '../accounting/types'
import type { TimeRangeSelection } from '../time/timeRange'
import { AnalyticsWorkspace } from './accounting/AnalyticsWorkspace'
import {
  AccountsWorkspace,
  LedgerDetailDialog,
  LedgerWorkspace,
  NewTransactionDialog,
} from './accounting/LedgerWorkspace'

type AccountingView = 'ledger' | 'accounts' | 'analytics'

const accountingViewOptions: Array<{
  value: AccountingView
  label: string
}> = [
  { value: 'ledger', label: '流水' },
  { value: 'accounts', label: '账户' },
  { value: 'analytics', label: '统计' },
]

type AccountingPageProps = {
  timeRange: TimeRangeSelection
}

export function AccountingPage({ timeRange }: AccountingPageProps) {
  const [view, setView] = useState<AccountingView>('ledger')
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
      <div className="accounting-content-slot">
        {view === 'ledger' ? (
          <LedgerWorkspace
            dataset={ledgerAtlasDataset}
            transactions={transactions}
            onSelectTransaction={setActiveTransaction}
            onCreateTransaction={() => setIsNewTransactionOpen(true)}
          />
        ) : null}

        {view === 'accounts' ? (
          <AccountsWorkspace
            summaries={accountSummaries}
            transactions={transactions}
            selectedAccountId={selectedAccountId}
            onSelectAccount={setSelectedAccountId}
          />
        ) : null}

        {view === 'analytics' ? (
          <AnalyticsWorkspace
            dataset={ledgerAtlasDataset}
            metrics={metrics}
            transactions={transactions}
            categoryStats={categoryStats}
            tagStats={tagStats}
            onBackToLedger={() => setView('ledger')}
          />
        ) : null}
      </div>

      <AccountingSidePanel
        view={view}
        metrics={metrics}
        summaries={accountSummaries}
        transactions={transactions}
        onChangeView={setView}
      />

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

function AccountingSidePanel({
  view,
  metrics,
  summaries,
  transactions,
  onChangeView,
}: {
  view: AccountingView
  metrics: PeriodMetrics
  summaries: AccountPeriodSummary[]
  transactions: Transaction[]
  onChangeView: (view: AccountingView) => void
}) {
  return (
    <aside className="ios-accounting-side-panel" aria-label="记账右侧二级导航栏">
      <nav className="ios-accounting-secondary-tabs" aria-label="记账二级导航">
        {accountingViewOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={view === option.value}
            onClick={() => onChangeView(option.value)}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </nav>

      <div className="ios-accounting-side-tools">
        {view === 'ledger' ? <LedgerSideTools transactions={transactions} /> : null}
        {view === 'accounts' ? (
          <AccountsSideTools summaries={summaries} transactions={transactions} />
        ) : null}
        {view === 'analytics' ? <AnalyticsSideTools metrics={metrics} /> : null}
      </div>

      <div className="ios-accounting-side-dock" aria-hidden="true">
        <span>{view === 'ledger' ? '批量' : view === 'accounts' ? '对账' : '范围'}</span>
        <span className="is-primary">
          {view === 'ledger' ? '新增流水' : view === 'accounts' ? '新账户' : '导出'}
        </span>
      </div>
    </aside>
  )
}

function LedgerSideTools({ transactions }: { transactions: Transaction[] }) {
  const incomeCount = transactions.filter((transaction) => transaction.type === 'income').length
  const expenseCount = transactions.filter((transaction) => transaction.type === 'expense').length
  const transferCount = transactions.filter((transaction) => transaction.type === 'transfer').length
  const untaggedCount = transactions.filter((transaction) => transaction.tagIds.length === 0).length
  const largestExpense = transactions
    .filter((transaction) => transaction.type === 'expense')
    .sort((a, b) => b.amountInCents - a.amountInCents)[0]

  return (
    <section className="ios-ledger-control-panel" aria-label="流水控制面板">
      <div className="ios-side-section">
        <header>
          <span>检索</span>
          <b>⌘K</b>
        </header>
        <div className="ios-ledger-search-line">搜索备注 / 分类 / 标签 / 金额</div>
      </div>

      <div className="ios-side-section">
        <header>
          <span>筛选条件</span>
          <b>{transactions.length} 笔</b>
        </header>
        <div className="ios-ledger-control-chips" aria-label="流水筛选">
          <span className="is-active">全部</span>
          <span>支出 {expenseCount}</span>
          <span>收入 {incomeCount}</span>
          <span>转账 {transferCount}</span>
          <span>待补全 {untaggedCount}</span>
        </div>
      </div>

      <div className="ios-side-section">
        <header>
          <span>处理队列</span>
          <b>{untaggedCount + (largestExpense ? 1 : 0)}</b>
        </header>
        <div className="ios-ledger-queue" aria-label="处理队列">
          <article>
            <strong>待补全标签</strong>
            <span>{untaggedCount} 笔缺少标签</span>
            <b>{untaggedCount}</b>
          </article>
          <article>
            <strong>最大支出</strong>
            <span>{largestExpense?.note ?? '当前范围无支出'}</span>
            <b>{largestExpense ? `-${formatCnyFromCents(largestExpense.amountInCents)}` : '0.00'}</b>
          </article>
          <article>
            <strong>转账闭环</strong>
            <span>还款与账户周转</span>
            <b>{transferCount}</b>
          </article>
        </div>
      </div>

      <div className="ios-side-section">
        <header>
          <span>分组方式</span>
          <b>按日</b>
        </header>
        <div className="ios-ledger-grouping" aria-label="分组方式">
          <span className="is-active">按日</span>
          <span>分类</span>
          <span>金额</span>
        </div>
      </div>
    </section>
  )
}

function AccountsSideTools({
  summaries,
  transactions,
}: {
  summaries: AccountPeriodSummary[]
  transactions: Transaction[]
}) {
  const totalBalanceInCents = summaries.reduce(
    (total, summary) => total + summary.closingInCents,
    0,
  )
  const liabilityCount = summaries.filter((summary) => summary.closingInCents < 0).length

  return (
    <section className="ios-accounts-side-tools" aria-label="账户工具">
      <div className="ios-side-section">
        <header>
          <span>账户范围</span>
          <b>{summaries.length} 个</b>
        </header>
        <div className="ios-ledger-control-chips">
          <span className="is-active">全部</span>
          <span>资产 {summaries.length - liabilityCount}</span>
          <span>负债 {liabilityCount}</span>
        </div>
      </div>

      <div className="ios-side-section">
        <header>
          <span>估算净资产</span>
          <b>¥{formatCnyFromCents(totalBalanceInCents)}</b>
        </header>
        <div className="ios-accounting-mini-list">
          {summaries.slice(0, 4).map((summary) => (
            <article key={summary.account.id}>
              <span>
                <strong>{summary.account.name}</strong>
                <small>{summary.transactionCount} 笔流水</small>
              </span>
              <b>¥{formatCnyFromCents(summary.closingInCents)}</b>
            </article>
          ))}
        </div>
      </div>

      <div className="ios-side-section">
        <header>
          <span>账户动作</span>
          <b>{transactions.length} 笔</b>
        </header>
        <div className="ios-ledger-grouping">
          <span className="is-active">对账</span>
          <span>转账</span>
          <span>归档</span>
        </div>
      </div>
    </section>
  )
}

function AnalyticsSideTools({ metrics }: { metrics: PeriodMetrics }) {
  const totalTrackedInCents = metrics.incomeInCents + metrics.expenseInCents
  const expenseShare = totalTrackedInCents === 0 ? 0 : metrics.expenseInCents / totalTrackedInCents

  return (
    <section className="ios-analytics-side-tools" aria-label="统计工具">
      <div className="ios-side-section">
        <header>
          <span>分析口径</span>
          <b>当前范围</b>
        </header>
        <div className="ios-ledger-control-chips">
          <span className="is-active">收支</span>
          <span>趋势</span>
          <span>分类</span>
        </div>
      </div>

      <div className="ios-side-section">
        <header>
          <span>关键指标</span>
          <b>{formatSigned(metrics.netInCents)}</b>
        </header>
        <div className="ios-accounting-mini-list">
          <article>
            <span>
              <strong>收入</strong>
              <small>当前范围</small>
            </span>
            <b>¥{formatCnyFromCents(metrics.incomeInCents)}</b>
          </article>
          <article>
            <span>
              <strong>支出占比</strong>
              <small>{Math.round(expenseShare * 100)}%</small>
            </span>
            <b>¥{formatCnyFromCents(metrics.expenseInCents)}</b>
          </article>
          <article>
            <span>
              <strong>转账</strong>
              <small>流动规模</small>
            </span>
            <b>¥{formatCnyFromCents(metrics.transferInCents)}</b>
          </article>
        </div>
      </div>

      <div className="ios-side-section">
        <header>
          <span>视图</span>
          <b>趋势</b>
        </header>
        <div className="ios-ledger-grouping">
          <span className="is-active">趋势</span>
          <span>分类</span>
          <span>事件</span>
        </div>
      </div>
    </section>
  )
}

function formatSigned(amountInCents: number) {
  if (amountInCents === 0) return '¥0.00'

  return `${amountInCents > 0 ? '+' : '-'}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}
