import type { TimeRangeSelection } from '../time/timeRange'
import { getAccountBalanceAt, getSignedAccountMovement } from './balances'
import { filterTransactionsByTimeRange, getAccountPeriodSummaries } from './selectors'
import {
  getCategoryPath,
  getTagPath,
  getTopLevelTreeId,
  getTreeDepth,
  getTreeDescendantIds,
} from './trees'
import type { AccountingDataset, Category, Tag, Transaction } from './types'

export type MoneyBreakdown = {
  incomeInCents: number
  expenseInCents: number
  transferInCents: number
  netInCents: number
  transactionCount: number
}

export type CategoryCompositionSegment = {
  id: string
  label: string
  amountInCents: number
  share: number
}

export type CategoryCompositionBar = {
  totalInCents: number
  segments: CategoryCompositionSegment[]
}

export type TaxonomyInsightNode = {
  id: string
  name: string
  path: string
  parentId?: string
  depth: number
  direct: MoneyBreakdown
  aggregate: MoneyBreakdown
}

export type DirectTagAmount = MoneyBreakdown & {
  id: string
  name: string
  path: string
}

export type AccountBalanceStep = {
  id: string
  date: string
  occurredAt: string
  balanceInCents: number
}

export type CashflowBucket = MoneyBreakdown & {
  key: string
  label: string
}

export type AccountContribution = MoneyBreakdown & {
  accountId: string
  accountName: string
}

export type TaxonomyNodeContext = TaxonomyInsightNode & {
  taxonomy: 'category' | 'tag'
  relatedAccounts: AccountContribution[]
  relatedCategoryIds: string[]
  relatedTagIds: string[]
}

type TaxonomyNode = Category | Tag
type Granularity = 'day' | 'week' | 'month'

const emptyBreakdown = (): MoneyBreakdown => ({
  incomeInCents: 0,
  expenseInCents: 0,
  transferInCents: 0,
  netInCents: 0,
  transactionCount: 0,
})

export function getTopCategoryComposition(
  dataset: AccountingDataset,
  transactions: Transaction[],
) {
  return {
    income: createCategoryCompositionBar(dataset.categories, transactions, 'income'),
    expense: createCategoryCompositionBar(dataset.categories, transactions, 'expense'),
  }
}

function createCategoryCompositionBar(
  categories: Category[],
  transactions: Transaction[],
  type: 'income' | 'expense',
): CategoryCompositionBar {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const totals = new Map<string, number>()

  for (const transaction of transactions) {
    if (transaction.type !== type) continue
    const topId = transaction.categoryId
      ? getTopLevelTreeId(categories, transaction.categoryId)
      : undefined
    const id = topId ?? `${type}-uncategorized`
    totals.set(id, (totals.get(id) ?? 0) + transaction.amountInCents)
  }

  const sorted = [...totals.entries()]
    .map(([id, amountInCents]) => ({
      id,
      label: categoryById.get(id)?.name ?? '未分类',
      amountInCents,
    }))
    .sort((a, b) => b.amountInCents - a.amountInCents || a.label.localeCompare(b.label, 'zh-CN'))
  const totalInCents = sorted.reduce((total, segment) => total + segment.amountInCents, 0)
  const primary = sorted.slice(0, 5)
  const remainder = sorted.slice(5)
  const segments = remainder.length === 0
    ? primary
    : [
        ...primary,
        {
          id: `${type}-other`,
          label: '其他',
          amountInCents: remainder.reduce((total, segment) => total + segment.amountInCents, 0),
        },
      ]

  return {
    totalInCents,
    segments: segments.map((segment) => ({
      ...segment,
      share: totalInCents === 0 ? 0 : segment.amountInCents / totalInCents,
    })),
  }
}

export function getCategoryTreeStatistics(
  dataset: AccountingDataset,
  transactions: Transaction[],
) {
  return getTaxonomyTreeStatistics(
    dataset.categories,
    transactions,
    (transaction) => transaction.categoryId ? [transaction.categoryId] : [],
    (id) => getCategoryPath(dataset.categories, id),
  )
}

export function getTagTreeStatistics(dataset: AccountingDataset, transactions: Transaction[]) {
  return getTaxonomyTreeStatistics(
    dataset.tags,
    transactions,
    (transaction) => transaction.tagIds,
    (id) => getTagPath(dataset.tags, id),
  )
}

function getTaxonomyTreeStatistics(
  nodes: TaxonomyNode[],
  transactions: Transaction[],
  getNodeIds: (transaction: Transaction) => string[],
  getPath: (id: string) => string,
): TaxonomyInsightNode[] {
  return nodes
    .slice()
    .sort((a, b) => getTreeDepth(nodes, a.id) - getTreeDepth(nodes, b.id) || a.sortOrder - b.sortOrder)
    .map((node) => {
      const relatedIds = new Set([node.id, ...getTreeDescendantIds(nodes, node.id)])
      const directTransactions = transactions.filter((transaction) => getNodeIds(transaction).includes(node.id))
      const aggregateTransactions = transactions.filter((transaction) =>
        getNodeIds(transaction).some((id) => relatedIds.has(id)),
      )

      return {
        id: node.id,
        name: node.name,
        path: getPath(node.id),
        parentId: node.parentId,
        depth: getTreeDepth(nodes, node.id),
        direct: summarizeTransactions(directTransactions),
        aggregate: summarizeTransactions(aggregateTransactions),
      }
    })
}

export function getTopDirectTagAmounts(
  dataset: AccountingDataset,
  transactions: Transaction[],
  limit = 5,
): DirectTagAmount[] {
  return dataset.tags
    .map((tag) => {
      const summary = summarizeTransactions(
        transactions.filter((transaction) => transaction.tagIds.includes(tag.id)),
      )
      return {
        id: tag.id,
        name: tag.name,
        path: getTagPath(dataset.tags, tag.id),
        ...summary,
      }
    })
    .filter((tag) => tag.transactionCount > 0)
    .sort((a, b) =>
      b.incomeInCents + b.expenseInCents - (a.incomeInCents + a.expenseInCents)
      || a.path.localeCompare(b.path, 'zh-CN'),
    )
    .slice(0, limit)
}

export function getAccountBalanceSteps(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
  accountId: string,
): AccountBalanceStep[] {
  let balanceInCents = getAccountBalanceAt(dataset, accountId, range.start)
  const steps: AccountBalanceStep[] = [{
    id: 'opening',
    date: range.start,
    occurredAt: `${range.start}T00:00:00`,
    balanceInCents,
  }]
  const transactions = filterTransactionsByTimeRange(dataset.transactions, range)
    .filter((transaction) => getSignedAccountMovement(transaction, accountId) !== 0)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  for (const transaction of transactions) {
    balanceInCents += getSignedAccountMovement(transaction, accountId)
    steps.push({
      id: transaction.id,
      date: transaction.occurredAt.slice(0, 10),
      occurredAt: transaction.occurredAt,
      balanceInCents,
    })
  }

  steps.push({
    id: 'closing',
    date: range.end,
    occurredAt: `${range.end}T23:59:59`,
    balanceInCents,
  })
  return steps
}

export function getCashflowTrend(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
  granularity: Granularity,
  includeTransfers: boolean,
): CashflowBucket[] {
  const buckets = new Map<string, Transaction[]>()
  for (const key of getBucketKeys(range, granularity)) buckets.set(key, [])

  for (const transaction of filterTransactionsByTimeRange(dataset.transactions, range)) {
    const key = getBucketKey(transaction.occurredAt.slice(0, 10), granularity)
    const bucket = buckets.get(key) ?? []
    bucket.push(transaction)
    buckets.set(key, bucket)
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, transactions]) => ({
      key,
      label: key,
      ...summarizeTransactions(transactions, includeTransfers),
    }))
}

export function getAccountContributions(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
): AccountContribution[] {
  return getAccountPeriodSummaries(dataset, range)
    .map((summary) => ({
      accountId: summary.account.id,
      accountName: summary.account.name,
      incomeInCents: summary.incomeInCents,
      expenseInCents: summary.expenseInCents,
      transferInCents: summary.transferInInCents + summary.transferOutInCents,
      netInCents: summary.incomeInCents - summary.expenseInCents,
      transactionCount: summary.transactionCount,
    }))
    .sort((a, b) => Math.abs(b.netInCents) - Math.abs(a.netInCents))
}

export function getPreviousPeriodRange(range: TimeRangeSelection): TimeRangeSelection {
  const start = parseDateKey(range.start)
  const end = parseDateKey(range.end)
  const durationInDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const previousEnd = addDays(start, -1)
  const previousStart = addDays(previousEnd, -(durationInDays - 1))

  return {
    ...range,
    start: formatDateKey(previousStart),
    end: formatDateKey(previousEnd),
    anchorDate: formatDateKey(previousStart),
    isOpenEnded: false,
    label: undefined,
  }
}

export function getTaxonomyNodeContext(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
  taxonomy: 'category' | 'tag',
  nodeId: string,
): TaxonomyNodeContext | undefined {
  const transactions = filterTransactionsByTimeRange(dataset.transactions, range)
  const nodes = taxonomy === 'category' ? dataset.categories : dataset.tags
  const relatedIds = new Set([nodeId, ...getTreeDescendantIds(nodes, nodeId)])
  const relatedTransactions = transactions.filter((transaction) => taxonomy === 'category'
    ? Boolean(transaction.categoryId && relatedIds.has(transaction.categoryId))
    : transaction.tagIds.some((tagId) => relatedIds.has(tagId)))
  const statistics = taxonomy === 'category'
    ? getCategoryTreeStatistics(dataset, transactions)
    : getTagTreeStatistics(dataset, transactions)
  const node = statistics.find((candidate) => candidate.id === nodeId)
  if (!node) return undefined

  return {
    ...node,
    taxonomy,
    relatedAccounts: getContributionsForTransactions(dataset, relatedTransactions),
    relatedCategoryIds: [...new Set(relatedTransactions.flatMap((transaction) =>
      transaction.categoryId ? [transaction.categoryId] : []))],
    relatedTagIds: [...new Set(relatedTransactions.flatMap((transaction) => transaction.tagIds))],
  }
}

function getContributionsForTransactions(
  dataset: AccountingDataset,
  transactions: Transaction[],
): AccountContribution[] {
  return dataset.accounts
    .map((account) => {
      const related = transactions.filter((transaction) =>
        getSignedAccountMovement(transaction, account.id) !== 0,
      )
      const summary = summarizeTransactionsForAccount(related, account.id)
      return { accountId: account.id, accountName: account.name, ...summary }
    })
    .filter((contribution) => contribution.transactionCount > 0)
    .sort((a, b) =>
      b.incomeInCents + b.expenseInCents - (a.incomeInCents + a.expenseInCents),
    )
}

function summarizeTransactions(transactions: Transaction[], includeTransfers = true): MoneyBreakdown {
  const summary = emptyBreakdown()
  for (const transaction of transactions) {
    summary.transactionCount += 1
    if (transaction.type === 'income') summary.incomeInCents += transaction.amountInCents
    if (transaction.type === 'expense') summary.expenseInCents += transaction.amountInCents
    if (transaction.type === 'transfer' && includeTransfers) {
      summary.transferInCents += transaction.amountInCents
    }
  }
  summary.netInCents = summary.incomeInCents - summary.expenseInCents
  return summary
}

function summarizeTransactionsForAccount(
  transactions: Transaction[],
  accountId: string,
): MoneyBreakdown {
  const summary = emptyBreakdown()
  for (const transaction of transactions) {
    const movement = getSignedAccountMovement(transaction, accountId)
    if (movement === 0) continue
    summary.transactionCount += 1
    if (transaction.type === 'income') summary.incomeInCents += transaction.amountInCents
    if (transaction.type === 'expense') summary.expenseInCents += transaction.amountInCents
    if (transaction.type === 'transfer') summary.transferInCents += Math.abs(movement)
  }
  summary.netInCents = summary.incomeInCents - summary.expenseInCents
  return summary
}

function getBucketKeys(range: TimeRangeSelection, granularity: Granularity) {
  const keys: string[] = []
  let cursor = parseDateKey(range.start)
  const end = parseDateKey(range.end)
  while (cursor <= end) {
    const key = getBucketKey(formatDateKey(cursor), granularity)
    if (keys.at(-1) !== key) keys.push(key)
    cursor = addDays(cursor, 1)
  }
  return keys
}

function getBucketKey(dateKey: string, granularity: Granularity) {
  if (granularity === 'day') return dateKey
  if (granularity === 'month') return `${dateKey.slice(0, 7)}-01`
  const date = parseDateKey(dateKey)
  const day = date.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return formatDateKey(addDays(date, mondayOffset))
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function formatDateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}
