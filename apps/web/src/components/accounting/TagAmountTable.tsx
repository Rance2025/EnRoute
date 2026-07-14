import type { DirectTagAmount } from '../../accounting/insightSelectors'
import { formatCurrency, formatSignedCurrency } from './formatting'

export function TagAmountTable({ tags }: { tags: DirectTagAmount[] }) {
  return (
    <section className="tag-amount-table" aria-label="高频标签金额">
      <header className="insight-panel-head">
        <div>
          <strong>高频标签</strong>
          <span>按关联收入与支出金额排序；标签可能重叠，不可相加</span>
        </div>
      </header>
      <div className="tag-amount-table__head" aria-hidden="true">
        <span>标签</span><span>净额</span><span>收入</span><span>支出</span>
      </div>
      <div className="tag-amount-table__rows">
        {tags.map((tag) => (
          <div className="tag-amount-table__row" key={tag.id}>
            <strong title={tag.path}>{tag.path}</strong>
            <b>{formatSignedCurrency(tag.netInCents)}</b>
            <span>{formatCurrency(tag.incomeInCents)}</span>
            <span>{formatCurrency(tag.expenseInCents)}</span>
          </div>
        ))}
        {tags.length === 0 ? <p>当前范围内没有直接标签</p> : null}
      </div>
    </section>
  )
}
