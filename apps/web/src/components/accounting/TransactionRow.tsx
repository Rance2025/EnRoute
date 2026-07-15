import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react'

import type { AccountingDataset, Transaction } from '../../accounting/types'
import {
  formatMonthDay,
  getTransactionAccountLabel,
  getTransactionCategoryPath,
  getTransactionTagPaths,
} from './formatting'

const typePresentation = {
  income: { icon: ArrowDownLeft, label: '收入', sign: '+' },
  expense: { icon: ArrowUpRight, label: '支出', sign: '-' },
  transfer: { icon: ArrowLeftRight, label: '转账', sign: '' },
} as const

export function TransactionRow({
  dataset,
  transaction,
  onSelect,
}: {
  dataset: AccountingDataset
  transaction: Transaction
  onSelect: () => void
}) {
  const presentation = typePresentation[transaction.type]
  const Icon = presentation.icon
  const categoryPath = getTransactionCategoryPath(dataset.categories, transaction)
  const tagPaths = getTransactionTagPaths(dataset.tags, transaction)
  const accountLabel = getTransactionAccountLabel(dataset, transaction)

  return (
    <button
      type="button"
      className={`ios-transaction-row ios-transaction-row--${transaction.type}`}
      aria-label={`查看流水 ${transaction.note ?? categoryPath}`}
      onClick={onSelect}
    >
      <span className="ios-transaction-row__icon" aria-label={presentation.label}>
        <Icon size={17} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="ios-transaction-row__body">
        <strong title={transaction.note ?? categoryPath}>{transaction.note ?? categoryPath}</strong>
        <em title={accountLabel}>{accountLabel}</em>
        <small title={categoryPath}>{categoryPath}</small>
      </span>
      <span className={`ios-transaction-row__tags${tagPaths.length === 0 ? ' is-empty' : ''}`} title={tagPaths.join('、')}>
        {tagPaths.slice(0, 2).map((tagPath) => <i key={tagPath}>{tagPath}</i>)}
        {tagPaths.length > 2 ? <i>+{tagPaths.length - 2}</i> : null}
        {tagPaths.length === 0 ? <i>无标签</i> : null}
      </span>
      <span className="ios-transaction-row__side">
        <b>{presentation.sign}¥{(transaction.amountInCents / 100).toFixed(2)}</b>
        <span className="ios-transaction-row__meta">
          <time dateTime={transaction.occurredAt}>{formatMonthDay(transaction.occurredAt)}</time>
          <small>{presentation.label}</small>
        </span>
      </span>
    </button>
  )
}
