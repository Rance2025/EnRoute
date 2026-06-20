import type { CSSProperties } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import type { TaxonomyNodeStat } from '../../accounting/types'

type TaxonomyTreePanelProps = {
  title: string
  ariaLabel: string
  stats: TaxonomyNodeStat[]
  selectedId?: string
  onSelect?: (id: string) => void
  compact?: boolean
}

export function TaxonomyTreePanel({
  title,
  ariaLabel,
  stats,
  selectedId,
  onSelect,
  compact = false,
}: TaxonomyTreePanelProps) {
  const maxAmount = Math.max(...stats.map((stat) => stat.amountInCents), 1)

  return (
    <section
      className={`taxonomy-tree-panel${compact ? ' taxonomy-tree-panel--compact' : ''}`}
      aria-label={ariaLabel}
    >
      <header className="taxonomy-tree-panel__head">
        <strong>{title}</strong>
        <span>{stats.filter((stat) => stat.transactionCount > 0).length} 个节点</span>
      </header>
      <div className="taxonomy-tree-panel__body">
        {stats.map((stat) => (
          <button
            type="button"
            key={stat.id}
            className={[
              'taxonomy-node',
              selectedId === stat.id ? 'is-selected' : null,
              stat.transactionCount === 0 ? 'is-empty' : null,
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              {
                '--taxonomy-depth': stat.depth,
                '--taxonomy-share': stat.amountInCents / maxAmount,
              } as CSSProperties
            }
            onClick={() => onSelect?.(stat.id)}
          >
            <span className="taxonomy-node__rail" aria-hidden="true" />
            <span className="taxonomy-node__main">
              <strong>{stat.name}</strong>
              <em>{stat.transactionCount} 笔</em>
            </span>
            <span className="taxonomy-node__amount">
              ¥{formatCnyFromCents(stat.amountInCents)}
            </span>
            <span className="taxonomy-node__bar" aria-hidden="true">
              <i />
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
