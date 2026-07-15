import { useState, type CSSProperties } from 'react'

import type {
  CategoryCompositionBar,
  CategoryCompositionSegment,
} from '../../accounting/insightSelectors'
import { formatCurrency } from './formatting'

const segmentColors = ['#155b4d', '#2f8876', '#65a99a', '#91b9b0', '#708c91', '#a5b4b5']

export function CategoryStackedColumns({
  income,
  expense,
  title = '交易类型构成',
}: {
  income: CategoryCompositionBar
  expense: CategoryCompositionBar
  title?: string
}) {
  const [mode, setMode] = useState<'amount' | 'composition'>('amount')
  const maximum = mode === 'amount' ? Math.max(income.totalInCents, expense.totalInCents, 1) : 1
  return (
    <section className="category-stacked-columns" aria-label="收入与支出分类构成" data-mode={mode}>
      <header className="insight-panel-head">
        <div>
          <strong>{title}</strong>
          <span>金额最高的 5 个顶层分类，其余合并为其他</span>
        </div>
        <div className="insight-panel-head__switch" aria-label="分类图显示方式">
          <button type="button" aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>金额总量</button>
          <button type="button" aria-pressed={mode === 'composition'} onClick={() => setMode('composition')}>构成占比</button>
        </div>
      </header>
      <div className="category-columns__plot">
        <CategoryColumn label="收入" bar={income} maximum={maximum} mode={mode} />
        <CategoryColumn label="支出" bar={expense} maximum={maximum} mode={mode} />
      </div>
      <div className="category-columns__legend" aria-label="分类金额图例">
        {[...income.segments, ...expense.segments].map((segment, index) => (
          <div key={`${index}-${segment.id}`}>
            <i style={{ background: segmentColors[index % segmentColors.length] }} />
            <span>{segment.label}</span>
            <strong>{formatCurrency(segment.amountInCents)} · {Math.round(segment.share * 100)}%</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function CategoryColumn({
  label,
  bar,
  maximum,
  mode,
}: {
  label: '收入' | '支出'
  bar: CategoryCompositionBar
  maximum: number
  mode: 'amount' | 'composition'
}) {
  const height = mode === 'composition'
    ? bar.totalInCents > 0 ? 1 : 0
    : bar.totalInCents / maximum
  return (
    <div className={`category-column category-column--${label === '收入' ? 'income' : 'expense'}`}>
      <strong>{formatCurrency(bar.totalInCents)}</strong>
      <div
        className="category-column__track"
        aria-label={`${label}分类柱`}
        data-scale-maximum={maximum}
      >
        <div className="category-column__bar" style={{ '--column-height': height } as CSSProperties}>
          {bar.segments.map((segment, index) => (
            <CategorySegment key={segment.id} segment={segment} color={segmentColors[index % segmentColors.length]} />
          ))}
        </div>
      </div>
      <span>{label}</span>
    </div>
  )
}

function CategorySegment({ segment, color }: { segment: CategoryCompositionSegment; color: string }) {
  return (
    <i
      title={`${segment.label} ${formatCurrency(segment.amountInCents)} ${Math.round(segment.share * 100)}%`}
      style={{ '--segment-share': segment.share, background: color } as CSSProperties}
    />
  )
}
