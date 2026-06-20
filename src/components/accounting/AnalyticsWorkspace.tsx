import { BarChart3, CircleDollarSign, Network, Tags } from 'lucide-react'
import type { CSSProperties } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import { getCategoryPath, getTagPath } from '../../accounting/trees'
import type {
  AccountingDataset,
  PeriodMetrics,
  TaxonomyNodeStat,
  Transaction,
} from '../../accounting/types'

type AnalyticsWorkspaceProps = {
  dataset: AccountingDataset
  metrics: PeriodMetrics
  transactions: Transaction[]
  categoryStats: TaxonomyNodeStat[]
  tagStats: TaxonomyNodeStat[]
  onBackToLedger: () => void
}

export function AnalyticsWorkspace({
  dataset,
  metrics,
  transactions,
  categoryStats,
  tagStats,
  onBackToLedger,
}: AnalyticsWorkspaceProps) {
  const activeCategoryStats = categoryStats
    .filter((stat) => stat.transactionCount > 0)
    .sort((a, b) => b.amountInCents - a.amountInCents)
  const tagCrossRows = getTagCrossRows(dataset, transactions)
  const totalTrackedInCents = metrics.incomeInCents + metrics.expenseInCents
  const incomeShare =
    totalTrackedInCents === 0 ? 0.5 : metrics.incomeInCents / totalTrackedInCents

  return (
    <div className="accounting-workspace ios-analytics-workspace" aria-label="统计工作区">
      <section className="ios-panel ios-report-overview">
        <header className="ios-panel-head">
          <strong>统计总览</strong>
          <button type="button" className="accounting-action" onClick={onBackToLedger}>
            返回流水
          </button>
        </header>
        <div
          className="ios-chart-ring"
          role="img"
          aria-label="收支环形图"
          style={{ '--income-share': incomeShare } as CSSProperties}
        >
          <div>
            <span>净现金流</span>
            <strong>{formatSigned(metrics.netInCents)}</strong>
          </div>
        </div>
        <div className="ios-report-kpis">
          <Metric icon={CircleDollarSign} label="收入" value={`¥${formatCnyFromCents(metrics.incomeInCents)}`} />
          <Metric icon={BarChart3} label="支出" value={`¥${formatCnyFromCents(metrics.expenseInCents)}`} />
          <Metric icon={Network} label="转账" value={`¥${formatCnyFromCents(metrics.transferInCents)}`} />
        </div>
      </section>

      <section className="ios-panel ios-category-chart">
        <header className="ios-panel-head">
          <strong>分类占比</strong>
          <span>{activeCategoryStats.length} 类</span>
        </header>
        <BarRows
          stats={activeCategoryStats.slice(0, 6)}
          pathFor={(id) => getCategoryPath(dataset.categories, id)}
        />
      </section>

      <section className="ios-panel ios-tag-cross">
        <header className="ios-panel-head">
          <strong>标签关联</strong>
          <span>{tagCrossRows.length} 组</span>
        </header>
        <div className="ios-tag-cross__rows">
          {tagCrossRows.slice(0, 5).map((row) => (
            <article key={`${row.tagPath}-${row.categoryPath}`}>
              <span>
                <Tags size={14} strokeWidth={2} />
                {row.tagPath}
              </span>
              <strong>{row.categoryPath}</strong>
              <em>¥{formatCnyFromCents(row.amountInCents)}</em>
            </article>
          ))}
        </div>
      </section>

      <TreeStatsSection
        title="分类树统计"
        ariaLabel="分类树统计"
        variant="category"
        stats={categoryStats}
        pathFor={(id) => getCategoryPath(dataset.categories, id)}
      />
      <TreeStatsSection
        title="标签树统计"
        ariaLabel="标签树统计"
        variant="tag"
        stats={tagStats}
        pathFor={(id) => getTagPath(dataset.tags, id)}
      />
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleDollarSign
  label: string
  value: string
}) {
  return (
    <article>
      <Icon size={15} strokeWidth={2} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function BarRows({
  stats,
  pathFor,
}: {
  stats: TaxonomyNodeStat[]
  pathFor: (id: string) => string
}) {
  const maxAmount = Math.max(...stats.map((stat) => stat.amountInCents), 1)

  return (
    <div className="ios-bar-rows">
      {stats.map((stat) => (
        <article
          key={stat.id}
          style={{ '--bar-share': stat.amountInCents / maxAmount } as CSSProperties}
        >
          <span>{pathFor(stat.id)}</span>
          <strong>¥{formatCnyFromCents(stat.amountInCents)}</strong>
          <i aria-hidden="true" />
        </article>
      ))}
    </div>
  )
}

function TreeStatsSection({
  title,
  ariaLabel,
  variant,
  stats,
  pathFor,
}: {
  title: string
  ariaLabel: string
  variant: 'category' | 'tag'
  stats: TaxonomyNodeStat[]
  pathFor: (id: string) => string
}) {
  const visibleStats = stats
    .filter((stat) => stat.transactionCount > 0)
    .sort((a, b) => b.amountInCents - a.amountInCents)
    .slice(0, 6)
  const maxAmount = Math.max(...visibleStats.map((stat) => stat.amountInCents), 1)

  return (
    <section className={`ios-panel ios-tree-stats ios-tree-stats--${variant}`} aria-label={ariaLabel}>
      <header className="ios-panel-head">
        <strong>{title}</strong>
        <span>{visibleStats.length} 节点</span>
      </header>
      <div>
        {visibleStats.map((stat) => (
          <article
            key={stat.id}
            style={
              {
                '--tree-depth': stat.depth,
                '--bar-share': stat.amountInCents / maxAmount,
              } as CSSProperties
            }
          >
            <span>{pathFor(stat.id)}</span>
            <strong>{stat.transactionCount} 笔</strong>
            <em>¥{formatCnyFromCents(stat.amountInCents)}</em>
            <i aria-hidden="true" />
          </article>
        ))}
      </div>
    </section>
  )
}

function getTagCrossRows(dataset: AccountingDataset, transactions: Transaction[]) {
  const amountByKey = new Map<string, {
    amountInCents: number
    categoryPath: string
    tagPath: string
  }>()

  for (const transaction of transactions) {
    if (!transaction.categoryId) continue

    for (const tagId of transaction.tagIds) {
      const categoryPath = getCategoryPath(dataset.categories, transaction.categoryId)
      const tagPath = getTagPath(dataset.tags, tagId)
      const key = `${tagPath}|${categoryPath}`
      const current = amountByKey.get(key)

      amountByKey.set(key, {
        amountInCents: (current?.amountInCents ?? 0) + transaction.amountInCents,
        categoryPath,
        tagPath,
      })
    }
  }

  return Array.from(amountByKey.values()).sort(
    (a, b) => b.amountInCents - a.amountInCents,
  )
}

function formatSigned(amountInCents: number) {
  if (amountInCents === 0) return '¥0.00'

  return `${amountInCents > 0 ? '+' : '-'}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}
