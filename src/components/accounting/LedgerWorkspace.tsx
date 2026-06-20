import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  CreditCard,
  Pencil,
  Plus,
  Tags,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import type {
  AccountPeriodSummary,
  AccountingDataset,
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
  summaries: AccountPeriodSummary[]
  transactions: Transaction[]
  selectedAccountId: string
  onSelectAccount: (accountId: string) => void
  onSelectTransaction: (transaction: Transaction) => void
  onCreateTransaction: () => void
  onOpenAnalytics: () => void
}

export function LedgerWorkspace({
  dataset,
  summaries,
  transactions,
  selectedAccountId,
  onSelectAccount,
  onSelectTransaction,
  onCreateTransaction,
  onOpenAnalytics,
}: LedgerWorkspaceProps) {
  const totalBalanceInCents = summaries.reduce(
    (total, summary) => total + summary.closingInCents,
    0,
  )
  const filteredTransactions =
    selectedAccountId === 'all'
      ? transactions
      : transactions.filter((transaction) => transactionBelongsToAccount(transaction, selectedAccountId))
  const accountTransactionCount = filteredTransactions.length
  const selectedSummary = summaries.find((summary) => summary.account.id === selectedAccountId)
  const activeAccountName = selectedSummary?.account.name ?? '全部账户'

  return (
    <div
      className="accounting-workspace ios-account-ledger-workspace"
      aria-label="账户与流水工作台"
    >
      <section className="ios-panel ios-account-filter-panel" aria-label="账户筛选卡片">
        <header className="ios-panel-head">
          <strong>账户卡片</strong>
          <span>{summaries.length} 个账户</span>
        </header>
        <div className="ios-account-stack-summary">
          <span>估算净资产</span>
          <strong>¥{formatCnyFromCents(totalBalanceInCents)}</strong>
        </div>
        <div className="ios-account-filter-stack">
          <AccountFilterCard
            variant={0}
            title="全部账户"
            detail={`${transactions.length} 笔流水`}
            balance={`¥${formatCnyFromCents(totalBalanceInCents)}`}
            movement={formatSigned(
              summaries.reduce(
                (total, summary) =>
                  total +
                  summary.incomeInCents -
                  summary.expenseInCents +
                  summary.transferInInCents -
                  summary.transferOutInCents,
                0,
              ),
            )}
            active={selectedAccountId === 'all'}
            onSelect={() => onSelectAccount('all')}
          />
          {summaries.map((summary, index) => (
            <AccountFilterCard
              key={summary.account.id}
              variant={(index % 4) + 1}
              title={summary.account.name}
              detail={`${summary.transactionCount} 笔 · ${summary.account.sourceFundType ?? 'fund'}`}
              balance={`¥${formatCnyFromCents(summary.closingInCents)}`}
              movement={formatSigned(
                summary.incomeInCents -
                  summary.expenseInCents +
                  summary.transferInInCents -
                  summary.transferOutInCents,
              )}
              active={selectedAccountId === summary.account.id}
              onSelect={() => onSelectAccount(summary.account.id)}
            />
          ))}
        </div>
      </section>

      <section className="ios-panel ios-ledger-main">
        <header className="ios-ledger-toolbar">
          <div>
            <strong>流水明细</strong>
            <span>{selectedAccountId === 'all' ? '全部流水' : '筛选后流水'}</span>
          </div>
          <div className="ios-ledger-toolbar__meta">
            <span>{activeAccountName}</span>
            <b>{accountTransactionCount} 笔</b>
          </div>
          <div className="ios-ledger-toolbar__actions">
            <button type="button" onClick={onCreateTransaction}>
              <Plus size={15} strokeWidth={2.2} />
              新增流水
            </button>
            <button type="button" onClick={onOpenAnalytics}>
              <CircleDollarSign size={15} strokeWidth={2.2} />
              查看统计
            </button>
          </div>
        </header>

        <div className="accounting-scroll--ledger" aria-label="流水列表">
          {filteredTransactions.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              dataset={dataset}
              transaction={transaction}
              onSelect={() => onSelectTransaction(transaction)}
            />
          ))}
          {filteredTransactions.length === 0 ? (
            <div className="ios-empty-ledger">当前账户在这个时间范围内没有流水</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function AccountFilterCard({
  variant,
  title,
  detail,
  balance,
  movement,
  active,
  onSelect,
}: {
  variant: number
  title: string
  detail: string
  balance: string
  movement: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'ios-account-filter-card',
        `ios-account-filter-card--${variant}`,
        active ? 'is-active' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="ios-account-filter-card__check" aria-hidden="true">
        {active ? <Check size={14} strokeWidth={2.4} /> : <WalletCards size={14} strokeWidth={2.2} />}
      </span>
      <span className="ios-account-filter-card__body">
        <strong>{title}</strong>
        <em>{detail}</em>
      </span>
      <span className="ios-account-filter-card__side">
        <b>{balance}</b>
        <small>{movement}</small>
      </span>
    </button>
  )
}

function TransactionRow({
  dataset,
  transaction,
  onSelect,
}: {
  dataset: AccountingDataset
  transaction: Transaction
  onSelect: () => void
}) {
  const Icon = typeIcons[transaction.type]
  const categoryPath = getTransactionCategoryPath(dataset.categories, transaction)
  const tagPaths = getTransactionTagPaths(dataset.tags, transaction)
  const accountLabel = getTransactionAccountLabel(dataset, transaction)
  const note = transaction.note ?? categoryPath

  return (
    <button
      type="button"
      className={`ios-transaction-row ios-transaction-row--${transaction.type}`}
      onClick={onSelect}
    >
      <span className="ios-transaction-row__icon">
        <Icon size={17} strokeWidth={2} />
      </span>
      <span className="ios-transaction-row__body">
        <strong>{note}</strong>
        <em>{accountLabel}</em>
        <small>{categoryPath}</small>
      </span>
      <span className="ios-transaction-row__tags">
        {tagPaths.map((tagPath) => (
          <i key={tagPath}>{tagPath}</i>
        ))}
        {tagPaths.length === 0 ? <i>无标签</i> : null}
      </span>
      <span className="ios-transaction-row__side">
        <b>{formatTransactionAmount(transaction)}</b>
        <time>{formatMonthDay(transaction.occurredAt)}</time>
        <small>{typeLabels[transaction.type]}</small>
      </span>
    </button>
  )
}

export function LedgerDetailDialog({
  dataset,
  transaction,
  onClose,
}: {
  dataset: AccountingDataset
  transaction: Transaction
  onClose: () => void
}) {
  const categoryPath = getTransactionCategoryPath(dataset.categories, transaction)
  const tagPaths = getTransactionTagPaths(dataset.tags, transaction)

  return (
    <div className="accounting-modal-backdrop">
      <section
        className="accounting-modal-card accounting-modal-card--detail"
        role="dialog"
        aria-modal="true"
        aria-label="流水详情"
      >
        <header className="accounting-modal-head">
          <div>
            <span>{typeLabels[transaction.type]}</span>
            <strong>{transaction.note ?? categoryPath}</strong>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>
        <div className={`ios-amount-card ios-amount-card--${transaction.type}`}>
          <span>{formatMonthDay(transaction.occurredAt)}</span>
          <strong>{formatTransactionAmount(transaction)}</strong>
          <em>{getTransactionAccountLabel(dataset, transaction)}</em>
        </div>
        <div className="ios-detail-list">
          <DetailLine icon={CreditCard} label="账户" value={getTransactionAccountLabel(dataset, transaction)} />
          <DetailLine icon={CalendarDays} label="发生时间" value={formatMonthDay(transaction.occurredAt)} />
          <DetailLine icon={Tags} label="标签" value={tagPaths.join(' / ') || '无标签'} />
          <DetailLine label="原始分类" value={getLegacyCategoryLabel(transaction)} />
          <DetailLine label="归入分类" value={categoryPath} />
          <DetailLine label="原始资金" value={getLegacyFundLabel(transaction)} />
        </div>
        <footer className="accounting-modal-actions">
          <button type="button">
            <Pencil size={15} strokeWidth={2.2} />
            修改流水
          </button>
          <button type="button" className="is-danger">
            <Trash2 size={15} strokeWidth={2.2} />
            删除流水
          </button>
        </footer>
      </section>
    </div>
  )
}

export function NewTransactionDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="accounting-modal-backdrop">
      <section
        className="accounting-modal-card accounting-modal-card--new"
        role="dialog"
        aria-modal="true"
        aria-label="新增流水"
      >
        <header className="accounting-modal-head">
          <div>
            <span>新增流水</span>
            <strong>记录新流水</strong>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>
        <div className="ios-new-transaction-form">
          <label>
            <span>类型</span>
            <div className="ios-form-chip-row" aria-label="流水类型">
              <button type="button" className="is-active">支出</button>
              <button type="button">收入</button>
              <button type="button">转账</button>
            </div>
          </label>
          <label>
            <span>金额</span>
            <input type="text" inputMode="decimal" placeholder="0.00" />
          </label>
          <label>
            <span>备注</span>
            <input type="text" placeholder="写下这笔钱发生了什么" />
          </label>
        </div>
        <footer className="accounting-modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="is-primary">保存流水</button>
        </footer>
      </section>
    </div>
  )
}

function DetailLine({
  icon: Icon,
  label,
  value,
}: {
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  value: string
}) {
  return (
    <div>
      <span>
        {Icon ? <Icon size={13} strokeWidth={2.2} /> : null}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  )
}

function transactionBelongsToAccount(transaction: Transaction, accountId: string) {
  if (transaction.type === 'transfer') {
    return transaction.fromAccountId === accountId || transaction.toAccountId === accountId
  }

  return transaction.accountId === accountId
}

function formatTransactionAmount(transaction: Transaction) {
  if (transaction.type === 'income') return `+¥${formatCnyFromCents(transaction.amountInCents)}`
  if (transaction.type === 'expense') return `-¥${formatCnyFromCents(transaction.amountInCents)}`

  return `¥${formatCnyFromCents(transaction.amountInCents)}`
}

function formatSigned(amountInCents: number) {
  if (amountInCents === 0) return '¥0.00'

  return `${amountInCents > 0 ? '+' : '-'}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}
