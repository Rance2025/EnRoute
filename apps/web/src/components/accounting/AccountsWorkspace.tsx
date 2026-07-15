import type {
  CategoryCompositionBar,
  DirectTagAmount,
  AccountBalanceStep,
} from '../../accounting/insightSelectors'
import type {
  AccountPeriodSummary,
  AccountingDataset,
  Transaction,
} from '../../accounting/types'
import { AccountBalanceStepChart } from './AccountBalanceStepChart'
import { AccountCardCarousel } from './AccountCardCarousel'
import { AccountingMetric } from './AccountingMetric'
import { CategoryStackedColumns } from './CategoryStackedColumns'
import { formatCurrency, formatSignedCurrency } from './formatting'
import { TagAmountTable } from './TagAmountTable'
import { TransactionRow } from './TransactionRow'

export function AccountsWorkspace({
  dataset,
  summaries,
  transactions,
  selectedAccountId,
  balanceSteps,
  categoryComposition,
  topTags,
  onSelectAccount,
  onSelectTransaction,
}: {
  dataset: AccountingDataset
  summaries: AccountPeriodSummary[]
  transactions: Transaction[]
  selectedAccountId: string
  balanceSteps: AccountBalanceStep[]
  categoryComposition: { income: CategoryCompositionBar; expense: CategoryCompositionBar }
  topTags: DirectTagAmount[]
  onSelectAccount: (accountId: string) => void
  onSelectTransaction: (transaction: Transaction) => void
}) {
  const summary = summaries.find((candidate) => candidate.account.id === selectedAccountId)
  if (!summary) {
    return (
      <section className="accounting-workspace accounts-workspace glass-panel glass-panel--solid" aria-label="账户工作台">
        <div className="accounting-empty-state"><strong>还没有可用账户</strong><p>创建流水前需要先建立账户。</p></div>
      </section>
    )
  }

  return (
    <section className="accounting-workspace accounts-workspace glass-panel glass-panel--solid" aria-label="账户工作台">
      <div className="accounts-workspace__left">
        <header className="accounts-workspace__title">
          <div><span>当前账户</span><h2>{summary.account.name}</h2></div>
          <strong>{summary.account.nature === 'liability'
            ? formatCurrency(Math.abs(summary.closingInCents))
            : formatCurrency(summary.closingInCents)}</strong>
        </header>
        <AccountCardCarousel
          summaries={summaries}
          selectedAccountId={selectedAccountId}
          onSelectAccount={onSelectAccount}
        />
        <section className="account-transactions" aria-label="账户流水列表">
          <header className="insight-panel-head"><div><strong>账户流水</strong><span>{transactions.length} 笔</span></div></header>
          <div className="accounting-scroll--ledger">
            {transactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                dataset={dataset}
                transaction={transaction}
                onSelect={() => onSelectTransaction(transaction)}
              />
            ))}
            {transactions.length === 0 ? <p>当前范围没有账户流水</p> : null}
          </div>
        </section>
      </div>
      <div className="accounts-workspace__right">
        <div className="accounts-workspace__metrics">
          <AccountingMetric label="期初" value={formatCurrency(summary.openingInCents)} />
          <AccountingMetric label="期末" value={formatCurrency(summary.closingInCents)} />
          <AccountingMetric label="净变动" value={formatSignedCurrency(summary.netChangeInCents)} tone={summary.netChangeInCents >= 0 ? 'positive' : 'negative'} />
          <AccountingMetric label="收入" value={formatCurrency(summary.incomeInCents)} tone="positive" />
          <AccountingMetric label="支出" value={formatCurrency(summary.expenseInCents)} tone="negative" />
          <AccountingMetric label="转入 / 转出" value={`${formatCurrency(summary.transferInInCents)} / ${formatCurrency(summary.transferOutInCents)}`} />
        </div>
        <AccountBalanceStepChart steps={balanceSteps} nature={summary.account.nature} />
        <div className="accounts-workspace__lower">
          <CategoryStackedColumns
            title="账户分类构成"
            income={categoryComposition.income}
            expense={categoryComposition.expense}
          />
          <TagAmountTable tags={topTags} />
        </div>
      </div>
    </section>
  )
}
