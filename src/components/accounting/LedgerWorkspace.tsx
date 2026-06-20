import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  CircleDot,
  Hash,
} from 'lucide-react'
import type { ComponentType, CSSProperties } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import { getCategoryPath } from '../../accounting/trees'
import type {
  AccountingDataset,
  TaxonomyNodeStat,
  Transaction,
  TransactionType,
} from '../../accounting/types'
import {
  formatMonthDay,
  getLegacyCategoryLabel,
  getLegacyFundLabel,
  getTransactionAccountLabel,
  getTransactionCategoryPath,
  getTransactionTagPaths,
} from './formatting'

const typeIcons: Record<
  TransactionType,
  ComponentType<{ size?: number; strokeWidth?: number }>
> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowRightLeft,
}

const typeLabels: Record<TransactionType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
}

type LedgerWorkspaceProps = {
  dataset: AccountingDataset
  transactions: Transaction[]
  selectedTransaction: Transaction
  selectedCategoryId?: string
  selectedTagId?: string
  categoryStats: TaxonomyNodeStat[]
  tagStats: TaxonomyNodeStat[]
  onSelectTransaction: (transactionId: string) => void
  onSelectCategory: (categoryId: string) => void
  onSelectTag: (tagId: string) => void
}

export function LedgerWorkspace({
  dataset,
  transactions,
  selectedTransaction,
  selectedCategoryId,
  selectedTagId,
  categoryStats,
  tagStats,
  onSelectTransaction,
  onSelectCategory,
  onSelectTag,
}: LedgerWorkspaceProps) {
  const categoryPath = getTransactionCategoryPath(dataset.categories, selectedTransaction)
  const tagPaths = getTransactionTagPaths(dataset.tags, selectedTransaction)

  return (
    <div className="accounting-workspace ios-ledger-workspace" aria-label="流水工作区">
      <section className="ios-panel ios-ledger-flow">
        <PanelHead title="流水明细" detail={`${transactions.length} 笔`} />
        <div className="accounting-scroll--ledger" aria-label="流水列表">
          {transactions.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              dataset={dataset}
              transaction={transaction}
              selected={transaction.id === selectedTransaction.id}
              onSelect={() => onSelectTransaction(transaction.id)}
            />
          ))}
        </div>
      </section>

      <section className="ios-panel ios-ledger-detail" aria-label="流水详情">
        <PanelHead title="选中流水" detail={typeLabels[selectedTransaction.type]} />
        <div className={`ios-amount-card ios-amount-card--${selectedTransaction.type}`}>
          <span>{formatMonthDay(selectedTransaction.occurredAt)}</span>
          <strong>{formatTransactionAmount(selectedTransaction)}</strong>
          <em>{selectedTransaction.note ?? categoryPath}</em>
        </div>

        <div className="ios-detail-list">
          <DetailLine label="账户" value={getTransactionAccountLabel(dataset, selectedTransaction)} />
          <DetailLine label="原始分类" value={getLegacyCategoryLabel(selectedTransaction)} />
          <DetailLine label="归入分类" value={categoryPath} />
          <DetailLine label="原始资金" value={getLegacyFundLabel(selectedTransaction)} />
          <DetailLine label="标签" value={tagPaths.join(' · ') || '无标签'} />
          <DetailLine label="映射状态" value={selectedTransaction.importStatus ?? 'mapped'} />
        </div>
      </section>

      <section className="ios-ledger-insight">
        <TaxonomyPreview
          icon={CircleDot}
          title="分类线索"
          stats={categoryStats}
          selectedId={selectedCategoryId}
          onSelect={onSelectCategory}
          pathFor={(id) => getCategoryPath(dataset.categories, id)}
        />
        <TaxonomyPreview
          icon={Hash}
          title="标签线索"
          stats={tagStats}
          selectedId={selectedTagId}
          onSelect={onSelectTag}
          pathFor={(id) => getTagPathById(dataset, id)}
        />
      </section>
    </div>
  )
}

function TransactionRow({
  dataset,
  transaction,
  selected,
  onSelect,
}: {
  dataset: AccountingDataset
  transaction: Transaction
  selected: boolean
  onSelect: () => void
}) {
  const Icon = typeIcons[transaction.type]
  const categoryPath = getTransactionCategoryPath(dataset.categories, transaction)
  const tagPaths = getTransactionTagPaths(dataset.tags, transaction)

  return (
    <button
      type="button"
      className={[
        'ios-transaction-row',
        `ios-transaction-row--${transaction.type}`,
        selected ? 'is-selected' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelect}
    >
      <span className="ios-transaction-row__icon">
        <Icon size={17} strokeWidth={2} />
      </span>
      <span className="ios-transaction-row__body">
        <strong>{transaction.note ?? categoryPath}</strong>
        <em>{categoryPath}</em>
        <small>{tagPaths.join(' · ') || getTransactionAccountLabel(dataset, transaction)}</small>
      </span>
      <span className="ios-transaction-row__side">
        <b>{formatTransactionAmount(transaction)}</b>
        <time>{formatMonthDay(transaction.occurredAt)}</time>
      </span>
    </button>
  )
}

function TaxonomyPreview({
  icon: Icon,
  title,
  stats,
  selectedId,
  onSelect,
  pathFor,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  title: string
  stats: TaxonomyNodeStat[]
  selectedId?: string
  onSelect: (id: string) => void
  pathFor: (id: string) => string
}) {
  const visibleStats = stats
    .filter((stat) => stat.transactionCount > 0)
    .sort((a, b) => b.amountInCents - a.amountInCents)
    .slice(0, 5)
  const maxAmount = Math.max(...visibleStats.map((stat) => stat.amountInCents), 1)

  return (
    <section className="ios-panel ios-taxonomy-preview">
      <header>
        <span>
          <Icon size={15} strokeWidth={2} />
          {title}
        </span>
        <em>{visibleStats.length} 项</em>
      </header>
      <div className="ios-taxonomy-preview__rows">
        {visibleStats.map((stat) => (
          <button
            type="button"
            key={stat.id}
            className={selectedId === stat.id ? 'is-selected' : undefined}
            style={{ '--bar-share': stat.amountInCents / maxAmount } as CSSProperties}
            onClick={() => onSelect(stat.id)}
          >
            <span>{pathFor(stat.id)}</span>
            <strong>¥{formatCnyFromCents(stat.amountInCents)}</strong>
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PanelHead({ title, detail }: { title: string; detail: string }) {
  return (
    <header className="ios-panel-head">
      <strong>{title}</strong>
      <span>{detail}</span>
    </header>
  )
}

function formatTransactionAmount(transaction: Transaction) {
  if (transaction.type === 'income') return `+¥${formatCnyFromCents(transaction.amountInCents)}`
  if (transaction.type === 'expense') return `-¥${formatCnyFromCents(transaction.amountInCents)}`

  return `¥${formatCnyFromCents(transaction.amountInCents)}`
}

function getTagPathById(dataset: AccountingDataset, tagId: string) {
  const byId = new Map(dataset.tags.map((tag) => [tag.id, tag]))
  const names: string[] = []
  let current = byId.get(tagId)

  while (current) {
    names.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return names.join(' / ')
}
