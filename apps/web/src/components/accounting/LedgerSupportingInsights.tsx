import { CalendarRange, CircleCheck, Tags } from 'lucide-react'

import type { DirectTagAmount } from '../../accounting/insightSelectors'
import type { AccountingDataset, Transaction } from '../../accounting/types'
import { formatCurrency } from './formatting'
import { TagAmountTable } from './TagAmountTable'

export function LedgerSupportingInsights({
  dataset,
  transactions,
  topTags,
}: {
  dataset: AccountingDataset
  transactions: Transaction[]
  topTags: DirectTagAmount[]
}) {
  const activeDays = new Set(transactions.map((transaction) => transaction.occurredAt.slice(0, 10))).size
  const expenses = transactions.filter((transaction) => transaction.type === 'expense')
  const expenseTotal = expenses.reduce((total, transaction) => total + transaction.amountInCents, 0)
  const largestExpense = expenses.reduce<Transaction | undefined>(
    (largest, transaction) => !largest || transaction.amountInCents > largest.amountInCents ? transaction : largest,
    undefined,
  )
  const categorizable = transactions.filter((transaction) => transaction.type !== 'transfer')
  const categorized = categorizable.filter((transaction) => Boolean(transaction.categoryId))
  const categoryCoverage = categorizable.length === 0
    ? 0
    : Math.round((categorized.length / categorizable.length) * 100)
  const activeAccountIds = new Set(transactions.flatMap((transaction) => (
    transaction.type === 'transfer'
      ? [transaction.fromAccountId, transaction.toAccountId]
      : [transaction.accountId]
  )))

  return (
    <div className="ledger-supporting-insights">
      <section className="period-pulse-panel" aria-label="期间节奏">
        <header className="insight-panel-head">
          <div>
            <strong>期间节奏</strong>
            <span>用活跃天数和单日支出观察流水密度</span>
          </div>
          <CalendarRange size={16} aria-hidden="true" />
        </header>
        <div className="period-pulse-panel__metrics">
          <div><span>活跃</span><strong>{activeDays} 天</strong></div>
          <div><span>日均支出</span><strong>{formatCurrency(activeDays === 0 ? 0 : Math.round(expenseTotal / activeDays))}</strong></div>
        </div>
        <div className="period-pulse-panel__largest">
          <span>最高单笔支出</span>
          <strong>{largestExpense?.note ?? '暂无支出'}</strong>
          <b>{formatCurrency(largestExpense?.amountInCents ?? 0)}</b>
        </div>
      </section>

      {topTags.length > 0 ? (
        <TagAmountTable tags={topTags} compact />
      ) : (
        <section className="tag-source-notice" aria-label="标签数据说明">
          <header>
            <span className="tag-source-notice__icon"><Tags size={15} aria-hidden="true" /></span>
            <div><strong>原始账单未携带标签</strong><span>标签金额将在新记录建立后自动出现</span></div>
          </header>
          <div className="tag-source-notice__quality">
            <div><CircleCheck size={13} aria-hidden="true" /><span>分类覆盖</span><strong>{categoryCoverage}%</strong></div>
            <div><CircleCheck size={13} aria-hidden="true" /><span>活跃账户</span><strong>{activeAccountIds.size} / {dataset.accounts.length}</strong></div>
          </div>
        </section>
      )}
    </div>
  )
}
