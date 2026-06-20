import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  GitBranch,
  ReceiptText,
} from 'lucide-react'
import type { ComponentType } from 'react'

import type {
  AccountingDataset,
  TaxonomyNodeStat,
  Transaction,
  TransactionType,
} from '../../accounting/types'
import {
  formatMonthDay,
  formatSignedCny,
  formatTransactionAmount,
  getLegacyCategoryLabel,
  getLegacyFundLabel,
  getTransactionAccountLabel,
  getTransactionCategoryPath,
  getTransactionTagPaths,
  transactionTypeLabels,
} from './formatting'
import { TaxonomyTreePanel } from './TaxonomyTreePanel'

const typeIcons: Record<
  TransactionType,
  ComponentType<{ size?: number; strokeWidth?: number }>
> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowRightLeft,
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
  return (
    <div className="accounting-workspace accounting-workspace--ledger" aria-label="流水图谱工作区">
      <section className="accounting-panel ledger-atlas-flow">
        <WorkspacePanelHead
          icon={ReceiptText}
          title="交易流水"
          detail={`${transactions.length} 笔 · 按发生时间`}
        />
        <div className="ledger-flow-list">
          {transactions.map((transaction) => (
            <TransactionFlowRow
              key={transaction.id}
              dataset={dataset}
              transaction={transaction}
              selected={transaction.id === selectedTransaction.id}
              onSelect={() => onSelectTransaction(transaction.id)}
            />
          ))}
        </div>
      </section>

      <section className="ledger-atlas-side">
        <section className="accounting-panel transaction-inspector" aria-label="交易详情">
          <WorkspacePanelHead icon={GitBranch} title="交易详情" detail="导入映射与语义层" />
          <div className="transaction-inspector__amount">
            <span>{transactionTypeLabels[selectedTransaction.type]}</span>
            <strong>{formatTransactionAmount(selectedTransaction)}</strong>
            <em>{formatMonthDay(selectedTransaction.occurredAt)}</em>
          </div>
          <div className="transaction-inspector__title">
            <strong>{selectedTransaction.note ?? '未命名流水'}</strong>
            <span>{getTransactionAccountLabel(dataset, selectedTransaction)}</span>
          </div>
          <dl className="transaction-mapping-grid">
            <div>
              <dt>旧分类</dt>
              <dd>{getLegacyCategoryLabel(selectedTransaction)}</dd>
            </div>
            <div>
              <dt>EnRoute 分类</dt>
              <dd>{getTransactionCategoryPath(dataset.categories, selectedTransaction)}</dd>
            </div>
            <div>
              <dt>旧资金</dt>
              <dd>{getLegacyFundLabel(selectedTransaction)}</dd>
            </div>
            <div>
              <dt>标签</dt>
              <dd>
                {getTransactionTagPaths(dataset.tags, selectedTransaction).join(' · ') || '无标签'}
              </dd>
            </div>
          </dl>
          <div className="transaction-inspector__status">
            <span>映射状态</span>
            <strong>{selectedTransaction.importStatus ?? 'mapped'}</strong>
            <em>{formatSignedCny(getSignedNet(selectedTransaction))}</em>
          </div>
        </section>

        <div className="taxonomy-twin">
          <TaxonomyTreePanel
            ariaLabel="分类树"
            title="分类树"
            stats={categoryStats}
            selectedId={selectedCategoryId}
            onSelect={onSelectCategory}
            compact
          />
          <TaxonomyTreePanel
            ariaLabel="标签树"
            title="标签树"
            stats={tagStats}
            selectedId={selectedTagId}
            onSelect={onSelectTag}
            compact
          />
        </div>
      </section>
    </div>
  )
}

function TransactionFlowRow({
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
  const tagPaths = getTransactionTagPaths(dataset.tags, transaction)

  return (
    <button
      type="button"
      className={[
        'ledger-flow-row',
        `ledger-flow-row--${transaction.type}`,
        selected ? 'is-selected' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelect}
    >
      <span className="ledger-flow-row__type">
        <Icon size={16} strokeWidth={2} />
        {transactionTypeLabels[transaction.type]}
      </span>
      <span className="ledger-flow-row__main">
        <strong>{transaction.note ?? getTransactionCategoryPath(dataset.categories, transaction)}</strong>
        <em>{getTransactionAccountLabel(dataset, transaction)}</em>
      </span>
      <span className="ledger-flow-row__taxonomy">
        <strong>{getTransactionCategoryPath(dataset.categories, transaction)}</strong>
        <em>{tagPaths.join(' · ') || '无标签'}</em>
      </span>
      <time>{formatMonthDay(transaction.occurredAt)}</time>
      <b>{formatTransactionAmount(transaction)}</b>
    </button>
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

function getSignedNet(transaction: Transaction) {
  if (transaction.type === 'income') return transaction.amountInCents
  if (transaction.type === 'expense') return -transaction.amountInCents
  return 0
}
