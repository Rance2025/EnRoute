import type {
  AccountingDataset,
  Category,
  Tag,
  Transaction,
} from '../../accounting/types'
import { getCategoryPath, getTagPath } from '../../accounting/trees'

export function formatMonthDay(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function getTransactionAccountLabel(
  dataset: AccountingDataset,
  transaction: Transaction,
) {
  const accountById = new Map(dataset.accounts.map((account) => [account.id, account.name]))

  if (transaction.type === 'transfer') {
    return `${accountById.get(transaction.fromAccountId) ?? '未知账户'} -> ${
      accountById.get(transaction.toAccountId) ?? '未知账户'
    }`
  }

  return accountById.get(transaction.accountId) ?? '未知账户'
}

export function getTransactionCategoryPath(
  categories: Category[],
  transaction: Transaction,
) {
  return transaction.categoryId ? getCategoryPath(categories, transaction.categoryId) : '未分类'
}

export function getTransactionTagPaths(tags: Tag[], transaction: Transaction) {
  return transaction.tagIds.map((tagId) => getTagPath(tags, tagId))
}

export function getLegacyCategoryLabel(transaction: Transaction) {
  return transaction.source?.legacyCategoryName ?? transaction.source?.legacyCategoryId ?? '未映射'
}

export function getLegacyFundLabel(transaction: Transaction) {
  return transaction.source?.legacyFundName ?? transaction.source?.legacyFundId ?? '未映射'
}
