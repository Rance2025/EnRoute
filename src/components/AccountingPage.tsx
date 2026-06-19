import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CircleDollarSign,
  Landmark,
  Tags,
} from 'lucide-react'
import { useMemo, useState, type ComponentType, type CSSProperties } from 'react'

import { calculateAccountBalances } from '../accounting/balances'
import {
  demoAccounts,
  demoCategories,
  demoTags,
  demoTransactions,
} from '../accounting/demoData'
import { formatCnyFromCents } from '../accounting/money'
import { getCategoryPath, getTagPath } from '../accounting/trees'
import type { Account, Category, Tag, Transaction, TransactionType } from '../accounting/types'
import type { TimeRangeKey } from './TimeContextPanel'

const typeLabels: Record<TransactionType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
}

const typeIcons = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowRightLeft,
}

type Draft = {
  type: TransactionType
  amount: string
  accountId: string
  fromAccountId: string
  toAccountId: string
  occurredAt: string
  categoryId: string
  tagIds: string[]
  note: string
}

type AccountingMode = 'accounts' | 'ledger' | 'report'

type DraftUpdater = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void

const accountingModes: Array<{ key: AccountingMode; label: string }> = [
  { key: 'accounts', label: '账户' },
  { key: 'ledger', label: '流水' },
  { key: 'report', label: '统计' },
]

const timeRangeLabels: Record<TimeRangeKey, string> = {
  all: '全部',
  year: '本年',
  month: '本月',
  week: '本周',
  yesterday: '昨天',
  today: '今天',
  custom: '自定义',
}

type AccountingPageProps = {
  timeRange: TimeRangeKey
}

export function AccountingPage({ timeRange }: AccountingPageProps) {
  const [mode, setMode] = useState<AccountingMode>('ledger')
  const [draft, setDraft] = useState<Draft>({
    type: 'expense',
    amount: '45.78',
    accountId: demoAccounts[0].id,
    fromAccountId: demoAccounts[0].id,
    toAccountId: demoAccounts[1].id,
    occurredAt: '2026-06-18T18:30',
    categoryId: 'expense-dinner',
    tagIds: ['qingdao', 'college'],
    note: '晚餐记录示例',
  })

  const balances = useMemo(
    () => calculateAccountBalances(demoAccounts, demoTransactions),
    [],
  )
  const monthIncome = sumTransactions('income', demoTransactions)
  const monthExpense = sumTransactions('expense', demoTransactions)
  const totalBalance = Object.values(balances).reduce((total, balance) => total + balance, 0)

  const categoriesForType = demoCategories.filter((category) => category.type === draft.type)
  const selectedCategoryBelongsToType = categoriesForType.some(
    (category) => category.id === draft.categoryId,
  )

  function updateDraft<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === 'type' ? { categoryId: '' } : null),
    }))
  }

  function toggleTag(tagId: string) {
    setDraft((current) => ({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((selectedId) => selectedId !== tagId)
        : [...current.tagIds, tagId],
    }))
  }

  return (
    <section className="accounting-page" aria-labelledby="accounting-title">
      <header className="accounting-heading">
        <div>
          <p>Money ledger</p>
          <h1 id="accounting-title">记账</h1>
        </div>
        <div className="accounting-heading__actions">
          <span>{timeRangeLabels[timeRange]} · 人民币</span>
          <div className="accounting-mode-tabs" role="group" aria-label="记账工作区">
            {accountingModes.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={mode === item.key}
                onClick={() => setMode(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="accounting-overview" aria-label="记账概览">
        <Metric label="总余额" value={`¥${formatCnyFromCents(totalBalance)}`} />
        <Metric label="本月收入" value={`¥${formatCnyFromCents(monthIncome)}`} />
        <Metric label="本月支出" value={`¥${formatCnyFromCents(monthExpense)}`} />
        <Metric label="账户数" value={String(demoAccounts.length)} />
      </section>

      {mode === 'ledger' ? (
        <LedgerWorkspace
          draft={draft}
          balances={balances}
          categoriesForType={categoriesForType}
          selectedCategoryBelongsToType={selectedCategoryBelongsToType}
          updateDraft={updateDraft}
          toggleTag={toggleTag}
        />
      ) : null}

      {mode === 'accounts' ? <AccountsWorkspace balances={balances} /> : null}

      {mode === 'report' ? (
        <ReportWorkspace
          totalBalance={totalBalance}
          monthIncome={monthIncome}
          monthExpense={monthExpense}
        />
      ) : null}
    </section>
  )
}

function LedgerWorkspace({
  draft,
  balances,
  categoriesForType,
  selectedCategoryBelongsToType,
  updateDraft,
  toggleTag,
}: {
  draft: Draft
  balances: Record<string, number>
  categoriesForType: Category[]
  selectedCategoryBelongsToType: boolean
  updateDraft: DraftUpdater
  toggleTag: (tagId: string) => void
}) {
  return (
    <div className="accounting-workspace accounting-workspace--ledger" aria-label="交易流水工作区">
      <section className="ledger-panel ledger-panel--accounts" aria-labelledby="accounts-title">
        <PanelTitle icon={Landmark} title="账户" />
        <h2 id="accounts-title" className="sr-only">
          账户
        </h2>
        <div className="account-list">
          {demoAccounts.map((account) => (
            <AccountRow key={account.id} account={account} balance={balances[account.id]} />
          ))}
        </div>
      </section>

      <section className="ledger-panel ledger-panel--transactions" aria-labelledby="tx-title">
        <PanelTitle icon={BookOpen} title="交易流水" />
        <h2 id="tx-title" className="sr-only">
          交易流水
        </h2>
        <div className="transaction-list">
          {demoTransactions.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </div>
      </section>

      <section className="ledger-panel ledger-panel--editor" aria-labelledby="editor-title">
        <PanelTitle icon={CircleDollarSign} title="新增记录" />
        <h2 id="editor-title" className="sr-only">
          新增记录
        </h2>
        <TransactionEditor
          draft={draft}
          categoriesForType={categoriesForType}
          selectedCategoryBelongsToType={selectedCategoryBelongsToType}
          updateDraft={updateDraft}
          toggleTag={toggleTag}
        />
      </section>

      <section className="ledger-panel ledger-panel--trees" aria-labelledby="trees-title">
        <PanelTitle icon={Tags} title="分类与标签" />
        <h2 id="trees-title" className="sr-only">
          分类与标签
        </h2>
        <TreeGroup title="收入分类" items={demoCategories.filter((item) => item.type === 'income')} />
        <TreeGroup title="支出分类" items={demoCategories.filter((item) => item.type === 'expense')} />
        <TreeGroup title="转账分类" items={demoCategories.filter((item) => item.type === 'transfer')} />
        <TreeGroup title="全局标签" items={demoTags} />
      </section>
    </div>
  )
}

function AccountsWorkspace({ balances }: { balances: Record<string, number> }) {
  return (
    <div
      className="accounting-workspace accounting-workspace--accounts"
      aria-label="账户管理工作区"
    >
      <section className="ledger-panel account-management-panel">
        <PanelTitle icon={Landmark} title="账户管理" />
        <div className="account-management-list">
          {demoAccounts.map((account) => (
            <AccountManagementRow key={account.id} account={account} balance={balances[account.id]} />
          ))}
        </div>
      </section>

      <section className="ledger-panel account-settings-panel">
        <PanelTitle icon={CircleDollarSign} title="账户规则" />
        <div className="account-settings-grid">
          <SettingNote title="初始余额" value="跟随开账时间，用于承接无法追溯的历史余额" />
          <SettingNote title="归档与隐藏" value="账户可归档、可隐藏，但 MVP 不做删除" />
          <SettingNote title="余额范围" value="所有账户允许负值，不区分资产或负债类型" />
          <SettingNote title="转账约束" value="转出和转入账户必须不同" />
        </div>
      </section>
    </div>
  )
}

function ReportWorkspace({
  totalBalance,
  monthIncome,
  monthExpense,
}: {
  totalBalance: number
  monthIncome: number
  monthExpense: number
}) {
  const expenseByCategory = demoCategories
    .filter((category) => category.type === 'expense')
    .map((category) => ({
      category,
      amount: demoTransactions
        .filter((transaction) => transaction.categoryId === category.id)
        .reduce((total, transaction) => total + transaction.amountInCents, 0),
    }))
    .filter((item) => item.amount > 0)

  const maxExpense = Math.max(...expenseByCategory.map((item) => item.amount), 1)

  return (
    <div className="accounting-workspace accounting-workspace--report" aria-label="统计报告工作区">
      <section className="ledger-panel report-summary-panel">
        <PanelTitle icon={BarChart3} title="统计报告" />
        <div className="report-metrics">
          <Metric label="总余额" value={`¥${formatCnyFromCents(totalBalance)}`} />
          <Metric label="收入" value={`¥${formatCnyFromCents(monthIncome)}`} />
          <Metric label="支出" value={`¥${formatCnyFromCents(monthExpense)}`} />
          <Metric label="净流入" value={`¥${formatCnyFromCents(monthIncome - monthExpense)}`} />
        </div>
      </section>

      <section className="ledger-panel report-category-panel">
        <PanelTitle icon={Tags} title="支出分类" />
        <div className="report-bar-list">
          {expenseByCategory.map((item) => (
            <div className="report-bar-row" key={item.category.id}>
              <span>{getCategoryPath(demoCategories, item.category.id)}</span>
              <div>
                <i style={{ '--bar-size': item.amount / maxExpense } as CSSProperties} />
              </div>
              <b>¥{formatCnyFromCents(item.amount)}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function TransactionEditor({
  draft,
  categoriesForType,
  selectedCategoryBelongsToType,
  updateDraft,
  toggleTag,
}: {
  draft: Draft
  categoriesForType: Category[]
  selectedCategoryBelongsToType: boolean
  updateDraft: DraftUpdater
  toggleTag: (tagId: string) => void
}) {
  return (
    <form className="transaction-editor">
      <label>
        <span>交易类型</span>
        <select
          aria-label="交易类型"
          value={draft.type}
          onChange={(event) => updateDraft('type', event.currentTarget.value as TransactionType)}
        >
          <option value="expense">支出</option>
          <option value="income">收入</option>
          <option value="transfer">转账</option>
        </select>
      </label>

      <label>
        <span>金额</span>
        <input
          aria-label="金额"
          value={draft.amount}
          inputMode="decimal"
          onChange={(event) => updateDraft('amount', event.currentTarget.value)}
        />
      </label>

      {draft.type === 'transfer' ? (
        <div className="editor-grid">
          <label>
            <span>转出账户</span>
            <select
              aria-label="转出账户"
              value={draft.fromAccountId}
              onChange={(event) => updateDraft('fromAccountId', event.currentTarget.value)}
            >
              {demoAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>转入账户</span>
            <select
              aria-label="转入账户"
              value={draft.toAccountId}
              onChange={(event) => updateDraft('toAccountId', event.currentTarget.value)}
            >
              {demoAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <label>
          <span>账户</span>
          <select
            aria-label="账户"
            value={draft.accountId}
            onChange={(event) => updateDraft('accountId', event.currentTarget.value)}
          >
            {demoAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        <span>发生时间</span>
        <input
          aria-label="发生时间"
          type="datetime-local"
          value={draft.occurredAt}
          onChange={(event) => updateDraft('occurredAt', event.currentTarget.value)}
        />
      </label>

      <label>
        <span>分类</span>
        <select
          aria-label="分类"
          value={selectedCategoryBelongsToType ? draft.categoryId : ''}
          onChange={(event) => updateDraft('categoryId', event.currentTarget.value)}
        >
          <option value="">无分类</option>
          {categoriesForType.map((category) => (
            <option key={category.id} value={category.id}>
              {getCategoryPath(demoCategories, category.id)}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>标签</legend>
        <div className="tag-picker">
          {demoTags.map((tag) => (
            <button
              type="button"
              key={tag.id}
              aria-pressed={draft.tagIds.includes(tag.id)}
              onClick={() => toggleTag(tag.id)}
            >
              {getTagPath(demoTags, tag.id)}
            </button>
          ))}
        </div>
      </fieldset>

      <label>
        <span>备注</span>
        <textarea
          aria-label="备注"
          value={draft.note}
          onChange={(event) => updateDraft('note', event.currentTarget.value)}
        />
      </label>
    </form>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PanelTitle({
  icon: Icon,
  title,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  title: string
}) {
  return (
    <div className="panel-title">
      <Icon size={17} strokeWidth={1.9} />
      <span>{title}</span>
    </div>
  )
}

function AccountRow({ account, balance }: { account: Account; balance: number }) {
  return (
    <article className="account-row">
      <div>
        <strong>{account.name}</strong>
        <span>开账 {formatDateTime(account.openingBalanceAt)}</span>
      </div>
      <b className={balance < 0 ? 'is-negative' : ''}>¥{formatCnyFromCents(balance)}</b>
    </article>
  )
}

function AccountManagementRow({ account, balance }: { account: Account; balance: number }) {
  return (
    <article className="account-management-row">
      <div>
        <strong>{account.name}</strong>
        <span>开账余额 ¥{formatCnyFromCents(account.openingBalanceInCents)}</span>
      </div>
      <div>
        <b className={balance < 0 ? 'is-negative' : ''}>¥{formatCnyFromCents(balance)}</b>
        <span>{account.hidden ? '隐藏' : account.archivedAt ? '归档' : '启用'}</span>
      </div>
    </article>
  )
}

function SettingNote({ title, value }: { title: string; value: string }) {
  return (
    <article className="setting-note">
      <strong>{title}</strong>
      <span>{value}</span>
    </article>
  )
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const Icon = typeIcons[transaction.type]
  const category = transaction.categoryId
    ? getCategoryPath(demoCategories, transaction.categoryId)
    : '其他'
  const tagPaths = transaction.tagIds.map((tagId) => getTagPath(demoTags, tagId))

  return (
    <article className={`transaction-row transaction-row--${transaction.type}`}>
      <div className="transaction-row__type">
        <Icon size={16} strokeWidth={2} />
        <span>{typeLabels[transaction.type]}</span>
      </div>
      <div className="transaction-row__main">
        <strong>{transaction.note || category}</strong>
        <span>{getTransactionAccountLabel(transaction)}</span>
      </div>
      <div className="transaction-row__meta">
        <span>{category}</span>
        {tagPaths.length ? <span>{tagPaths.join(' · ')}</span> : null}
      </div>
      <time>{formatDateTime(transaction.occurredAt)}</time>
      <b>{formatTransactionAmount(transaction)}</b>
    </article>
  )
}

function TreeGroup({ title, items }: { title: string; items: Array<Category | Tag> }) {
  return (
    <div className="tree-group">
      <h3>{title}</h3>
      <ul>
        {items
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => (
            <li key={item.id} style={{ '--depth': getDepth(items, item.id) } as CSSProperties}>
              {isCategory(item)
                ? getCategoryPath(demoCategories, item.id)
                : getTagPath(demoTags, item.id)}
            </li>
          ))}
      </ul>
    </div>
  )
}

function getDepth(items: Array<Category | Tag>, itemId: string) {
  const byId = new Map(items.map((item) => [item.id, item]))
  let depth = 0
  let current = byId.get(itemId)
  while (current?.parentId && byId.has(current.parentId)) {
    depth += 1
    current = byId.get(current.parentId)
  }
  return depth
}

function isCategory(item: Category | Tag): item is Category {
  return 'type' in item
}

function sumTransactions(type: 'income' | 'expense', transactions: Transaction[]) {
  return transactions
    .filter((transaction) => transaction.type === type)
    .reduce((total, transaction) => total + transaction.amountInCents, 0)
}

function getTransactionAccountLabel(transaction: Transaction) {
  const accountById = new Map(demoAccounts.map((account) => [account.id, account.name]))
  if (transaction.type === 'transfer') {
    return `${accountById.get(transaction.fromAccountId)} → ${accountById.get(transaction.toAccountId)}`
  }
  return accountById.get(transaction.accountId) ?? '未知账户'
}

function formatTransactionAmount(transaction: Transaction) {
  const prefix = transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''
  return `${prefix}¥${formatCnyFromCents(transaction.amountInCents)}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
