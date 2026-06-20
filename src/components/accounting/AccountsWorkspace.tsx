import { Landmark, Route, WalletCards } from 'lucide-react'
import type { ComponentType } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import type { AccountPeriodSummary, AccountingDataset, Transaction } from '../../accounting/types'
import { formatMonthDay, formatSignedCny, getLegacyFundLabel } from './formatting'

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
  return (
    <div className="accounting-workspace accounting-workspace--accounts" aria-label="账户图谱工作区">
      <section className="accounting-panel account-period-panel" aria-label="账户周期卡片">
        <WorkspacePanelHead
          icon={WalletCards}
          title="账户周期卡片"
          detail="期末估算"
        />
        <div className="account-period-list">
          {summaries.map((summary) => (
            <article className="account-period-card" key={summary.account.id}>
              <div className="account-period-card__top">
                <span>{summary.account.sourceFundType ?? 'fund'}</span>
                <strong>{summary.account.name}</strong>
              </div>
              <div className="account-period-card__amount">
                <span>估算余额</span>
                <strong>¥{formatCnyFromCents(summary.closingInCents)}</strong>
              </div>
              <div className="account-period-card__grid">
                <AccountMetric label="收入" value={formatSignedCny(summary.incomeInCents)} />
                <AccountMetric label="支出" value={formatSignedCny(-summary.expenseInCents)} />
                <AccountMetric label="转入" value={formatSignedCny(summary.transferInInCents)} />
                <AccountMetric label="转出" value={formatSignedCny(-summary.transferOutInCents)} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="accounts-side-column">
        <section className="accounting-panel import-fund-panel">
          <WorkspacePanelHead icon={Landmark} title="导入资金映射" detail="external fund.json" />
          <div className="import-fund-list">
            {dataset.accounts.map((account) => (
              <article className="import-fund-row" key={account.id}>
                <div>
                  <strong>{account.name}</strong>
                  <span>{account.sourceFundId}</span>
                </div>
                <em>{account.sourceFundType ?? 'unknown'}</em>
              </article>
            ))}
          </div>
        </section>

        <section className="accounting-panel account-movement-panel">
          <WorkspacePanelHead icon={Route} title="账户流水路径" detail="按当前时间范围" />
          <div className="account-movement-list">
            {transactions.map((transaction) => (
              <article className="account-movement-row" key={transaction.id}>
                <time>{formatMonthDay(transaction.occurredAt)}</time>
                <strong>{transaction.note ?? getLegacyFundLabel(transaction)}</strong>
                <span>{getMovementLabel(dataset, transaction)}</span>
              </article>
            ))}
          </div>
        </section>
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

function AccountMetric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
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
