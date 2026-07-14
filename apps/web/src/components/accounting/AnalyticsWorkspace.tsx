import { useMemo, useState } from 'react'

import {
  getAccountContributions,
  getCashflowTrend,
  getCategoryTreeStatistics,
  getPreviousPeriodRange,
  getTagTreeStatistics,
  getTaxonomyNodeContext,
  type TaxonomyInsightNode,
  type TaxonomyNodeContext,
} from '../../accounting/insightSelectors'
import { formatCnyFromCents } from '../../accounting/money'
import type { AccountingStatisticsControls } from '../../accounting/shell'
import { filterTransactionsByTimeRange } from '../../accounting/selectors'
import { getCategoryPath, getTagPath } from '../../accounting/trees'
import type { AccountingDataset } from '../../accounting/types'
import type { TimeRangeSelection } from '../../time/timeRange'
import { CashflowTrendChart } from './CashflowTrendChart'
import { TaxonomyTreePanel } from './TaxonomyTreePanel'

export type AnalyticsFocus = TaxonomyNodeContext & {
  previousAggregateInCents: number
  previousChangeLabel: string
}

type AnalyticsWorkspaceProps = {
  dataset: AccountingDataset
  timeRange: TimeRangeSelection
  controls: AccountingStatisticsControls
  onFocusChange: (focus: AnalyticsFocus | null) => void
}

export function AnalyticsWorkspace({ dataset, timeRange, controls, onFocusChange }: AnalyticsWorkspaceProps) {
  const [focus, setFocus] = useState<AnalyticsFocus | null>(null)
  const granularity = resolveGranularity(timeRange, controls.granularity)
  const previousRange = getPreviousPeriodRange(timeRange)
  const transactions = useMemo(
    () => filterTransactionsByTimeRange(dataset.transactions, timeRange)
      .filter((transaction) => controls.includeTransfers || transaction.type !== 'transfer'),
    [controls.includeTransfers, dataset.transactions, timeRange],
  )
  const previousTransactions = useMemo(
    () => filterTransactionsByTimeRange(dataset.transactions, previousRange)
      .filter((transaction) => controls.includeTransfers || transaction.type !== 'transfer'),
    [controls.includeTransfers, dataset.transactions, previousRange],
  )
  const categoryNodes = useMemo(
    () => filterCategoryDepth(getCategoryTreeStatistics(dataset, transactions), controls.categoryDepth),
    [controls.categoryDepth, dataset, transactions],
  )
  const tagNodes = useMemo(() => getTagTreeStatistics(dataset, transactions), [dataset, transactions])
  const previousCategoryNodes = useMemo(
    () => getCategoryTreeStatistics(dataset, previousTransactions),
    [dataset, previousTransactions],
  )
  const previousTagNodes = useMemo(
    () => getTagTreeStatistics(dataset, previousTransactions),
    [dataset, previousTransactions],
  )
  const trend = useMemo(
    () => getCashflowTrend(dataset, timeRange, granularity, controls.includeTransfers),
    [controls.includeTransfers, dataset, granularity, timeRange],
  )
  const previousTrend = useMemo(
    () => controls.comparePrevious
      ? getCashflowTrend(dataset, previousRange, granularity, controls.includeTransfers)
      : [],
    [controls.comparePrevious, controls.includeTransfers, dataset, granularity, previousRange],
  )

  const selectNode = (taxonomy: 'category' | 'tag', node: TaxonomyInsightNode) => {
    const context = getTaxonomyNodeContext(dataset, timeRange, taxonomy, node.id)
    if (!context) return
    const previousNode = (taxonomy === 'category' ? previousCategoryNodes : previousTagNodes)
      .find((candidate) => candidate.id === node.id)
    const currentAmount = totalAmount(context.aggregate)
    const previousAmount = previousNode ? totalAmount(previousNode.aggregate) : 0
    const nextFocus: AnalyticsFocus = {
      ...context,
      previousAggregateInCents: previousAmount,
      previousChangeLabel: formatChange(currentAmount, previousAmount),
    }
    setFocus(nextFocus)
    onFocusChange(nextFocus)
  }

  const clearFocus = () => {
    setFocus(null)
    onFocusChange(null)
  }

  return (
    <div className="accounting-workspace analytics-workspace" aria-label="统计工作区">
      <section className="glass-panel glass-panel--solid accounting-analysis-card analytics-workspace__trend">
        <CashflowTrendChart buckets={trend} previousBuckets={previousTrend} measure={controls.measure} granularity={granularity} />
      </section>
      <div className="analytics-workspace__taxonomy">
        <section className="glass-panel glass-panel--solid accounting-analysis-card">
          <TaxonomyTreePanel taxonomy="category" nodes={categoryNodes} measure={controls.measure} onSelectNode={(node) => selectNode('category', node)} />
        </section>
        <section className="glass-panel glass-panel--solid accounting-analysis-card">
          <TaxonomyTreePanel taxonomy="tag" nodes={tagNodes} measure={controls.measure} onSelectNode={(node) => selectNode('tag', node)} />
        </section>
      </div>
      {focus ? (
        <FocusDetail dataset={dataset} focus={focus} onClear={clearFocus} />
      ) : (
        <AnalyticsGuide dataset={dataset} range={timeRange} />
      )}
    </div>
  )
}

function FocusDetail({ dataset, focus, onClear }: { dataset: AccountingDataset; focus: AnalyticsFocus; onClear: () => void }) {
  const relatedNames = focus.taxonomy === 'category'
    ? focus.relatedTagIds.map((id) => getTagPath(dataset.tags, id))
    : focus.relatedCategoryIds.map((id) => getCategoryPath(dataset.categories, id))
  return (
    <aside className="glass-panel glass-panel--solid analytics-focus" aria-label="统计焦点详情">
      <header><div><span>{focus.taxonomy === 'category' ? '分类焦点' : '标签焦点'}</span><strong>{focus.path}</strong></div><button type="button" onClick={onClear}>清除焦点</button></header>
      <dl>
        <div><dt>直接金额</dt><dd>¥{formatCnyFromCents(totalAmount(focus.direct))}</dd></div>
        <div><dt>聚合金额</dt><dd>¥{formatCnyFromCents(totalAmount(focus.aggregate))}</dd></div>
        <div><dt>笔数</dt><dd>{focus.aggregate.transactionCount} 笔</dd></div>
        <div><dt>上周期</dt><dd>{focus.previousChangeLabel}</dd></div>
      </dl>
      <div><strong>主要账户</strong><p>{focus.relatedAccounts.slice(0, 3).map((account) => account.accountName).join('、') || '暂无'}</p></div>
      <div><strong>{focus.taxonomy === 'category' ? '关联标签' : '关联分类'}</strong><p>{relatedNames.slice(0, 4).join('、') || '暂无'}</p></div>
    </aside>
  )
}

function AnalyticsGuide({ dataset, range }: { dataset: AccountingDataset; range: TimeRangeSelection }) {
  const contributions = getAccountContributions(dataset, range).slice(0, 4)
  return (
    <aside className="glass-panel glass-panel--solid analytics-guide" aria-label="统计分析说明">
      <header><span>联动说明</span><strong>账户贡献与图例</strong></header>
      <div className="analytics-guide__accounts"><strong>账户贡献</strong>{contributions.map((item) => <p key={item.accountId}><span>{item.accountName}</span><b>{signedMoney(item.netInCents)}</b></p>)}</div>
      <p>选择分类或标签节点，可查看直接值、后代聚合、上周期变化和主要关联。</p>
    </aside>
  )
}

function resolveGranularity(range: TimeRangeSelection, requested: AccountingStatisticsControls['granularity']): 'day' | 'week' | 'month' {
  if (requested !== 'auto') return requested
  const days = Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000) + 1
  if (days <= 31) return 'day'
  if (days <= 180) return 'week'
  return 'month'
}

function filterCategoryDepth(nodes: TaxonomyInsightNode[], depth: AccountingStatisticsControls['categoryDepth']) {
  if (depth === 'top') return nodes.filter((node) => node.depth === 0)
  if (depth === 'second') return nodes.filter((node) => node.depth <= 1)
  return nodes
}

function totalAmount(summary: TaxonomyInsightNode['aggregate']) {
  return summary.incomeInCents + summary.expenseInCents
}

function formatChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? '持平' : '无可比基数'
  const change = (current - previous) / previous
  return `${change >= 0 ? '+' : ''}${Math.round(change * 100)}%`
}

function signedMoney(value: number) {
  return `${value < 0 ? '-' : value > 0 ? '+' : ''}¥${formatCnyFromCents(Math.abs(value))}`
}
