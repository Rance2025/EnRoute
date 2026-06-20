import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Landmark } from 'lucide-react'
import type { CSSProperties } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import type { AccountPeriodSummary, AccountingDataset, Transaction } from '../../accounting/types'
import { formatMonthDay, getLegacyFundLabel } from './formatting'

type AccountsWorkspaceProps = {
  dataset: AccountingDataset
  summaries: AccountPeriodSummary[]
  transactions: Transaction[]
}

export function AccountsWorkspace({
  dataset,
  summaries,
  transactions,
}: AccountsWorkspaceProps) {
  const visibleSummaries = summaries.slice(0, 4)
  const totalBalanceInCents = summaries.reduce(
    (total, summary) => total + summary.closingInCents,
    0,
  )

  return (
    <div className="accounting-workspace ios-accounts-workspace" aria-label="账户工作区">
      <section className="ios-panel ios-account-stack-panel" aria-label="账户卡片栈">
        <header className="ios-panel-head">
          <strong>账户卡片</strong>
          <span>{summaries.length} 个账户</span>
        </header>
        <div className="ios-account-total">
          <span>估算净资产</span>
          <strong>¥{formatCnyFromCents(totalBalanceInCents)}</strong>
        </div>
        <div className="ios-account-card-stack">
          {visibleSummaries.map((summary, index) => (
            <article
              className={`ios-account-card ios-account-card--${(index % 4) + 1}`}
              key={summary.account.id}
              style={{ '--stack-index': index } as CSSProperties}
            >
              <div>
                <span>{summary.account.sourceFundType ?? 'fund'}</span>
                <strong>{summary.account.name}</strong>
              </div>
              <b>¥{formatCnyFromCents(summary.closingInCents)}</b>
              <footer>
                <span>{summary.transactionCount} 笔</span>
                <span>{formatSigned(summary.incomeInCents - summary.expenseInCents)}</span>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <section className="ios-panel ios-account-structure">
        <header className="ios-panel-head">
          <strong>资金结构</strong>
          <span>导入账户</span>
        </header>
        <div className="ios-fund-map">
          {dataset.accounts.map((account) => (
            <article key={account.id}>
              <span>
                <Landmark size={15} strokeWidth={2} />
                {account.sourceFundType ?? 'unknown'}
              </span>
              <strong>{account.name}</strong>
              <em>{account.sourceFundId}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="ios-panel ios-account-movement">
        <header className="ios-panel-head">
          <strong>本期账户流向</strong>
          <span>{transactions.length} 笔</span>
        </header>
        <div className="ios-account-movement__rows">
          {transactions.slice(0, 6).map((transaction) => (
            <MovementRow dataset={dataset} transaction={transaction} key={transaction.id} />
          ))}
        </div>
      </section>
    </div>
  )
}

function MovementRow({
  dataset,
  transaction,
}: {
  dataset: AccountingDataset
  transaction: Transaction
}) {
  const Icon =
    transaction.type === 'income'
      ? ArrowDownLeft
      : transaction.type === 'expense'
        ? ArrowUpRight
        : ArrowRightLeft

  return (
    <article className={`ios-movement-row ios-movement-row--${transaction.type}`}>
      <span>
        <Icon size={16} strokeWidth={2} />
      </span>
      <div>
        <strong>{transaction.note ?? getLegacyFundLabel(transaction)}</strong>
        <em>{getMovementLabel(dataset, transaction)}</em>
      </div>
      <time>{formatMonthDay(transaction.occurredAt)}</time>
    </article>
  )
}

function getMovementLabel(dataset: AccountingDataset, transaction: Transaction) {
  const accountById = new Map(dataset.accounts.map((account) => [account.id, account.name]))

  if (transaction.type === 'transfer') {
    return `${accountById.get(transaction.fromAccountId) ?? '未知账户'} -> ${
      accountById.get(transaction.toAccountId) ?? '未知账户'
    }`
  }

  return accountById.get(transaction.accountId) ?? '未知账户'
}

function formatSigned(amountInCents: number) {
  if (amountInCents === 0) return '¥0.00'

  return `${amountInCents > 0 ? '+' : '-'}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}
