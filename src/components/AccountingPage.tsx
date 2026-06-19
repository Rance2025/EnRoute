import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CircleDollarSign,
  Pencil,
  Plus,
  ReceiptText,
  Settings2,
  Tags,
  WalletCards,
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
import { getTimeRangeDisplay, type TimeRangeSelection } from '../time/timeRange'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

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

const accountingModes: Array<SegmentedOption<AccountingMode>> = [
  { value: 'accounts', label: '账户' },
  { value: 'ledger', label: '流水' },
  { value: 'report', label: '统计' },
]

const transactionTypeOptions: Array<SegmentedOption<TransactionType>> = [
  { value: 'expense', label: typeLabels.expense },
  { value: 'income', label: typeLabels.income },
  { value: 'transfer', label: typeLabels.transfer },
]

type AccountingPageProps = {
  timeRange: TimeRangeSelection
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
    <section className="accounting-page" aria-label="记账页面">
      <header className="accounting-topbar">
        <div className="accounting-scope-chip" aria-label="当前账目范围">
          <span>{getTimeRangeDisplay(timeRange).accountingLabel}</span>
          <strong>人民币</strong>
        </div>
        <SegmentedControl
          ariaLabel="记账工作区"
          className="accounting-mode-tabs"
          options={accountingModes}
          value={mode}
          onChange={setMode}
        />
      </header>

      <section className="accounting-overview" aria-label="记账概览">
        <Metric label="总余额" value={`¥${formatCnyFromCents(totalBalance)}`} tone="balance" />
        <Metric label="本月收入" value={`¥${formatCnyFromCents(monthIncome)}`} tone="income" />
        <Metric label="本月支出" value={`¥${formatCnyFromCents(monthExpense)}`} tone="expense" />
        <Metric label="账户数" value={String(demoAccounts.length)} tone="neutral" />
      </section>

      {mode === 'ledger' ? (
        <LedgerWorkspace
          draft={draft}
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
    <div className="accounting-workspace accounting-workspace--ledger" aria-label="交易流水工作区">
      <section className="accounting-panel ledger-feed-panel" aria-labelledby="tx-title">
        <WorkspacePanelHead
          icon={BookOpen}
          title="交易流水"
          detail={`${demoTransactions.length} 笔 · 按发生时间`}
        />
        <h2 id="tx-title" className="sr-only">
          交易流水
        </h2>
        <div className="ledger-mini-summary" aria-label="流水摘要">
          <MiniStat label="最近收入" value="秒思 5月实习" />
          <MiniStat label="最大支出" value="鲜旺发牛肉火锅" />
          <MiniStat label="标签样本" value="旅行 / 青岛之行" />
        </div>
        <div className="transaction-list">
          {demoTransactions.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </div>
      </section>

      <section
        className="accounting-panel quick-record-panel ledger-record-panel"
        aria-label="快速记录"
      >
        <WorkspacePanelHead icon={CircleDollarSign} title="快速记录" detail="MVP 表单" />
        <h2 id="quick-record-title" className="sr-only">
          快速记录
        </h2>
        <TransactionEditor
          draft={draft}
          categoriesForType={categoriesForType}
          selectedCategoryBelongsToType={selectedCategoryBelongsToType}
          updateDraft={updateDraft}
          toggleTag={toggleTag}
        />
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
      <section className="accounting-panel account-stack-panel">
        <WorkspacePanelHead icon={WalletCards} title="账户" detail="余额由流水自动计算" />
        <div className="account-card-stack" aria-label="账户堆叠卡片">
          {demoAccounts.map((account, index) => (
            <AccountStackCard
              key={account.id}
              account={account}
              balance={balances[account.id]}
              index={index}
            />
          ))}
        </div>
      </section>

      <section className="accounting-panel account-rules-panel">
        <WorkspacePanelHead icon={Settings2} title="账户规则" detail="创建后可归档、隐藏" />
        <div className="account-rules-grid">
          <SettingNote
            title="开账余额"
            value="跟随开账时间，用于承接无法追溯到最初的历史余额。"
          />
          <SettingNote
            title="开账时间"
            value="导入历史流水后，可以调整到最早一笔可追溯交易的发生时间。"
          />
          <SettingNote
            title="允许负值"
            value="不区分资产类和负债类账户，所有账户余额都允许低于 0。"
          />
          <SettingNote title="转账约束" value="转账必须选择两个不同账户，分类可以为空。" />
        </div>
        <div className="account-activity-list" aria-label="账户近期活动">
          {demoAccounts.map((account) => (
            <AccountActivityRow
              key={account.id}
              account={account}
              balance={balances[account.id]}
            />
          ))}
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
      <section className="accounting-panel report-dashboard-panel">
        <WorkspacePanelHead icon={BarChart3} title="统计报告" detail="按当前左侧时间范围聚合" />
        <div className="report-focus">
          <div>
            <span>净流入</span>
            <strong>¥{formatCnyFromCents(monthIncome - monthExpense)}</strong>
          </div>
          <div className="report-focus__track" aria-hidden="true">
            <i style={{ '--report-fill': 0.74 } as CSSProperties} />
          </div>
        </div>
        <div className="report-metrics">
          <Metric label="总余额" value={`¥${formatCnyFromCents(totalBalance)}`} tone="balance" />
          <Metric label="收入" value={`¥${formatCnyFromCents(monthIncome)}`} tone="income" />
          <Metric label="支出" value={`¥${formatCnyFromCents(monthExpense)}`} tone="expense" />
        </div>
        <section className="report-category-panel" aria-label="支出分类统计">
          <PanelTitle icon={ReceiptText} title="支出分类" />
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
      </section>

      <div className="report-management-column">
        <section className="accounting-panel category-management-panel" aria-label="分类管理">
          <div className="taxonomy-management-head">
            <PanelTitle icon={ReceiptText} title="分类管理" />
            <button type="button">
              <Plus size={14} strokeWidth={2.2} />
              新建分类
            </button>
          </div>
          <div className="taxonomy-scroll taxonomy-scroll--category">
            <TreeGroup title="收入分类" items={demoCategories.filter((item) => item.type === 'income')} />
            <TreeGroup title="支出分类" items={demoCategories.filter((item) => item.type === 'expense')} />
            <TreeGroup title="转账分类" items={demoCategories.filter((item) => item.type === 'transfer')} />
          </div>
          <section className="category-rules" aria-label="分类树规则">
            <strong>分类树规则</strong>
            <div>
              <CategoryRule label="三棵树" value="收入、支出、转账分别维护" />
              <CategoryRule label="单分类" value="一笔交易只选择一个分类" />
              <CategoryRule label="其他" value="未细分时落入对应类型的其他" />
            </div>
          </section>
        </section>

        <section className="accounting-panel tag-management-panel" aria-label="标签管理">
          <div className="taxonomy-management-head taxonomy-management-head--compact">
            <PanelTitle icon={Tags} title="标签管理" />
            <button type="button">
              <Pencil size={14} strokeWidth={2.1} />
              编辑标签
            </button>
          </div>
          <div className="taxonomy-scroll taxonomy-scroll--tag">
            <TreeGroup title="全局标签" items={demoTags} />
          </div>
        </section>
      </div>
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
    <form className="transaction-editor" onSubmit={(event) => event.preventDefault()}>
      <SegmentedControl
        ariaLabel="交易类型选择"
        className="transaction-type-switch"
        options={transactionTypeOptions}
        value={draft.type}
        onChange={(type) => updateDraft('type', type)}
      />

      <label className="sr-only">
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

      <label className="amount-field">
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
          {demoTags.slice(0, 4).map((tag) => (
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

      <button className="transaction-submit" type="submit">
        保存记录
      </button>
    </form>
  )
}

function WorkspacePanelHead({
  icon,
  title,
  detail,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  title: string
  detail: string
}) {
  return (
    <div className="workspace-panel-head">
      <PanelTitle icon={icon} title={title} />
      <span>{detail}</span>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'balance' | 'income' | 'expense' | 'neutral'
}) {
  return (
    <div className={`metric metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CategoryRule({ label, value }: { label: string; value: string }) {
  return (
    <article className="category-rule">
      <span>{label}</span>
      <em>{value}</em>
    </article>
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

function AccountStackCard({
  account,
  balance,
  index,
}: {
  account: Account
  balance: number
  index: number
}) {
  return (
    <article
      className={`account-stack-card account-stack-card--${index + 1}`}
      style={{ '--stack-index': index } as CSSProperties}
    >
      <div className="account-stack-card__top">
        <span>{getAccountStateLabel(account)}</span>
        <b>{formatDate(account.openingBalanceAt)}</b>
      </div>
      <div className="account-stack-card__main">
        <strong>{account.name}</strong>
        <span className={balance < 0 ? 'is-negative' : ''}>
          ¥{formatCnyFromCents(balance)}
        </span>
      </div>
      <div className="account-stack-card__bottom">
        <span>开账余额 ¥{formatCnyFromCents(account.openingBalanceInCents)}</span>
        <span>{getAccountTransactionCount(account.id)} 笔流水</span>
      </div>
    </article>
  )
}

function AccountActivityRow({ account, balance }: { account: Account; balance: number }) {
  return (
    <article className="account-activity-row">
      <div>
        <strong>{account.name}</strong>
        <span>开账 {formatDate(account.openingBalanceAt)}</span>
      </div>
      <b className={balance < 0 ? 'is-negative' : ''}>¥{formatCnyFromCents(balance)}</b>
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

function getAccountTransactionCount(accountId: string) {
  return demoTransactions.filter((transaction) => {
    if (transaction.type === 'transfer') {
      return transaction.fromAccountId === accountId || transaction.toAccountId === accountId
    }
    return transaction.accountId === accountId
  }).length
}

function getAccountStateLabel(account: Account) {
  if (account.hidden) return '隐藏'
  if (account.archivedAt) return '归档'
  return '启用'
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}
