import { BarChart3, Network } from 'lucide-react'
import type { ComponentType, CSSProperties } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import { getCategoryPath, getTagPath } from '../../accounting/trees'
import type { AccountingDataset, TaxonomyNodeStat, Transaction } from '../../accounting/types'
import { TaxonomyTreePanel } from './TaxonomyTreePanel'

type AnalyticsWorkspaceProps = {
  dataset: AccountingDataset
  transactions: Transaction[]
  categoryStats: TaxonomyNodeStat[]
  tagStats: TaxonomyNodeStat[]
}

export function AnalyticsWorkspace({
  dataset,
  transactions,
  categoryStats,
  tagStats,
}: AnalyticsWorkspaceProps) {
  const activeCategoryStats = categoryStats.filter((stat) => stat.transactionCount > 0)
  const maxCategoryAmount = Math.max(
    ...activeCategoryStats.map((stat) => stat.amountInCents),
    1,
  )
  const tagCrossRows = getTagCrossRows(dataset, transactions)

  return (
    <div className="accounting-workspace accounting-workspace--report" aria-label="统计图谱工作区">
      <section className="accounting-panel analytics-composition-panel">
        <WorkspacePanelHead
          icon={BarChart3}
          title="分类构成"
          detail={`${activeCategoryStats.length} 个有效分类`}
        />
        <div className="analytics-bar-list">
          {activeCategoryStats.map((stat) => (
            <article className="analytics-bar-row" key={stat.id}>
              <span>{getCategoryPath(dataset.categories, stat.id)}</span>
              <div aria-hidden="true">
                <i
                  style={
                    { '--analytics-share': stat.amountInCents / maxCategoryAmount } as CSSProperties
                  }
                />
              </div>
              <strong>¥{formatCnyFromCents(stat.amountInCents)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="analytics-right-column">
        <section className="accounting-panel tag-cross-panel">
          <WorkspacePanelHead icon={Network} title="标签交叉" detail="标签与分类的共同出现" />
          <div className="tag-cross-list">
            {tagCrossRows.map((row) => (
              <article className="tag-cross-row" key={`${row.tagPath}-${row.categoryPath}`}>
                <span>{row.tagPath}</span>
                <strong>{row.categoryPath}</strong>
                <em>¥{formatCnyFromCents(row.amountInCents)}</em>
              </article>
            ))}
          </div>
        </section>

        <div className="analytics-tree-grid">
          <TaxonomyTreePanel
            ariaLabel="统计分类树"
            title="统计分类树"
            stats={categoryStats}
            compact
          />
          <TaxonomyTreePanel
            ariaLabel="统计标签树"
            title="统计标签树"
            stats={tagStats}
            compact
          />
        </div>
      </section>
    </div>
  )
}

function WorkspacePanelHead({
  icon: Icon,
  title,
  detail,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  title: string
  detail: string
}) {
  return (
    <div className="workspace-panel-head">
      <div className="panel-title">
        <Icon size={17} strokeWidth={1.9} />
        <span>{title}</span>
      </div>
      <span>{detail}</span>
    </div>
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
