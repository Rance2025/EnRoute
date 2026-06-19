import type { TimeRangeSelection } from '../time/timeRange'
import type {
  AccountPeriodSummary,
  AccountingDataset,
  Category,
  PeriodMetrics,
  Tag,
  TaxonomyNodeStat,
  Transaction,
} from './types'

type TreeNode = Category | Tag

export function filterTransactionsByTimeRange(
  transactions: Transaction[],
  range: TimeRangeSelection,
) {
  return transactions
    .filter((transaction) => {
      const date = transaction.occurredAt.slice(0, 10)
      return date >= range.start && date <= range.end
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

export function getPeriodMetrics(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
): PeriodMetrics {
  const transactions = filterTransactionsByTimeRange(dataset.transactions, range)
  const activeAccountIds = new Set<string>()
  let incomeInCents = 0
  let expenseInCents = 0
  let transferInCents = 0

  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      incomeInCents += transaction.amountInCents
      activeAccountIds.add(transaction.accountId)
    } else if (transaction.type === 'expense') {
      expenseInCents += transaction.amountInCents
      activeAccountIds.add(transaction.accountId)
    } else {
      transferInCents += transaction.amountInCents
      activeAccountIds.add(transaction.fromAccountId)
      activeAccountIds.add(transaction.toAccountId)
    }
  }

  return {
    incomeInCents,
    expenseInCents,
    transferInCents,
    netInCents: incomeInCents - expenseInCents,
    transactionCount: transactions.length,
    activeAccountCount: activeAccountIds.size,
  }
}

export function getAccountPeriodSummaries(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
): AccountPeriodSummary[] {
  const transactions = filterTransactionsByTimeRange(dataset.transactions, range)

  return dataset.accounts.map((account) => {
    let incomeInCents = 0
    let expenseInCents = 0
    let transferInInCents = 0
    let transferOutInCents = 0
    let transactionCount = 0

    for (const transaction of transactions) {
      if (transaction.type === 'income' && transaction.accountId === account.id) {
        incomeInCents += transaction.amountInCents
        transactionCount += 1
      } else if (transaction.type === 'expense' && transaction.accountId === account.id) {
        expenseInCents += transaction.amountInCents
        transactionCount += 1
      } else if (transaction.type === 'transfer') {
        if (transaction.fromAccountId === account.id) {
          transferOutInCents += transaction.amountInCents
          transactionCount += 1
        }
        if (transaction.toAccountId === account.id) {
          transferInInCents += transaction.amountInCents
          transactionCount += 1
        }
      }
    }

    const closingInCents =
      account.openingBalanceInCents +
      incomeInCents -
      expenseInCents +
      transferInInCents -
      transferOutInCents

    return {
      account,
      openingInCents: account.openingBalanceInCents,
      incomeInCents,
      expenseInCents,
      transferInInCents,
      transferOutInCents,
      closingInCents,
      transactionCount,
    }
  })
}

export function getCategoryTreeStats(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
): TaxonomyNodeStat[] {
  const transactions = filterTransactionsByTimeRange(dataset.transactions, range)
  return getTreeStats(dataset.categories, transactions, (transaction) =>
    transaction.categoryId ? [transaction.categoryId] : [],
  )
}

export function getTagTreeStats(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
): TaxonomyNodeStat[] {
  const transactions = filterTransactionsByTimeRange(dataset.transactions, range)
  return getTreeStats(dataset.tags, transactions, (transaction) => transaction.tagIds)
}

function getTreeStats(
  nodes: TreeNode[],
  transactions: Transaction[],
  getTransactionNodeIds: (transaction: Transaction) => string[],
): TaxonomyNodeStat[] {
  const directAmountById = new Map<string, number>()
  const directCountById = new Map<string, number>()

  for (const transaction of transactions) {
    for (const nodeId of getTransactionNodeIds(transaction)) {
      directAmountById.set(
        nodeId,
        (directAmountById.get(nodeId) ?? 0) + transaction.amountInCents,
      )
      directCountById.set(nodeId, (directCountById.get(nodeId) ?? 0) + 1)
    }
  }

  const descendantsById = new Map(nodes.map((node) => [node.id, getDescendantIds(nodes, node.id)]))
  const totalAmount = transactions.reduce(
    (total, transaction) => total + transaction.amountInCents,
    0,
  )

  return nodes
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((node) => {
      const descendantIds = descendantsById.get(node.id) ?? []
      const relatedIds = [node.id, ...descendantIds]
      const amountInCents = sumByIds(directAmountById, relatedIds)
      const transactionCount = sumByIds(directCountById, relatedIds)

      return {
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        depth: getDepth(nodes, node.id),
        amountInCents,
        directAmountInCents: directAmountById.get(node.id) ?? 0,
        transactionCount,
        directTransactionCount: directCountById.get(node.id) ?? 0,
        share: totalAmount === 0 ? 0 : amountInCents / totalAmount,
      }
    })
}

function getDescendantIds(nodes: TreeNode[], nodeId: string): string[] {
  const childIds = nodes.filter((node) => node.parentId === nodeId).map((node) => node.id)
  return childIds.flatMap((childId) => [childId, ...getDescendantIds(nodes, childId)])
}

function getDepth(nodes: TreeNode[], nodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let depth = 0
  let current = byId.get(nodeId)

  while (current?.parentId && byId.has(current.parentId)) {
    depth += 1
    current = byId.get(current.parentId)
  }

  return depth
}

function sumByIds(values: Map<string, number>, ids: string[]) {
  return ids.reduce((total, id) => total + (values.get(id) ?? 0), 0)
}
