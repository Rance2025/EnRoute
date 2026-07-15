import { formatCnyFromCents, parseCnyToCents } from './money'
import type { AccountingDataset, Transaction, TransactionType } from './types'

export type TransactionDraft = {
  transactionId?: string
  createdAt?: string
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

export type TransactionDraftErrors = Partial<Record<keyof TransactionDraft, string>>

export function createTransactionDraft(now: string): TransactionDraft {
  return {
    type: 'expense',
    amount: '',
    accountId: '',
    fromAccountId: '',
    toAccountId: '',
    occurredAt: now,
    categoryId: '',
    tagIds: [],
    note: '',
  }
}

export function createTransactionDraftFromTransaction(transaction: Transaction): TransactionDraft {
  return {
    transactionId: transaction.id,
    createdAt: transaction.createdAt,
    type: transaction.type,
    amount: formatCnyFromCents(transaction.amountInCents),
    accountId: transaction.type === 'transfer' ? '' : transaction.accountId,
    fromAccountId: transaction.type === 'transfer' ? transaction.fromAccountId : '',
    toAccountId: transaction.type === 'transfer' ? transaction.toAccountId : '',
    occurredAt: transaction.occurredAt,
    categoryId: transaction.categoryId ?? '',
    tagIds: [...transaction.tagIds],
    note: transaction.note ?? '',
  }
}

export function changeDraftType(
  draft: TransactionDraft,
  nextType: TransactionType,
  dataset: AccountingDataset,
): TransactionDraft {
  const category = dataset.categories.find((candidate) => candidate.id === draft.categoryId)
  return {
    ...draft,
    type: nextType,
    categoryId: category && category.type !== nextType ? '' : draft.categoryId,
  }
}

export function validateTransactionDraft(
  draft: TransactionDraft,
  dataset: AccountingDataset,
): TransactionDraftErrors {
  const errors: TransactionDraftErrors = {}
  const amountInCents = parseDraftAmount(draft.amount)
  if (amountInCents === undefined) errors.amount = '请输入有效金额'
  else if (amountInCents <= 0) errors.amount = '金额必须大于 0'

  const accountIds = new Set(dataset.accounts.map((account) => account.id))
  if (draft.type === 'transfer') {
    if (!draft.fromAccountId || !accountIds.has(draft.fromAccountId)) {
      errors.fromAccountId = '请选择转出账户'
    }
    if (!draft.toAccountId || !accountIds.has(draft.toAccountId)) {
      errors.toAccountId = '请选择转入账户'
    } else if (draft.fromAccountId === draft.toAccountId) {
      errors.toAccountId = '转入账户不能与转出账户相同'
    }
  } else if (!draft.accountId || !accountIds.has(draft.accountId)) {
    errors.accountId = '请选择账户'
  }

  if (draft.categoryId) {
    const category = dataset.categories.find((candidate) => candidate.id === draft.categoryId)
    if (!category || category.type !== draft.type) {
      errors.categoryId = '所选分类与流水类型不匹配'
    }
  }

  const tagIds = new Set(dataset.tags.map((tag) => tag.id))
  if (draft.tagIds.some((tagId) => !tagIds.has(tagId))) {
    errors.tagIds = '存在无效标签'
  }
  if (!draft.occurredAt || Number.isNaN(Date.parse(draft.occurredAt))) {
    errors.occurredAt = '请选择有效的发生时间'
  }
  return errors
}

export function saveTransactionDraft(
  transactions: Transaction[],
  draft: TransactionDraft,
  now: string,
): Transaction[] {
  const amountInCents = parseDraftAmount(draft.amount)
  if (amountInCents === undefined || amountInCents <= 0) {
    throw new Error('流水草稿未通过金额校验')
  }

  const common = {
    id: draft.transactionId ?? createSessionTransactionId(transactions, now),
    amountInCents,
    occurredAt: draft.occurredAt,
    categoryId: draft.categoryId || undefined,
    tagIds: [...draft.tagIds],
    note: draft.note.trim() || undefined,
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
  }
  const transaction: Transaction = draft.type === 'transfer'
    ? {
        ...common,
        type: 'transfer',
        fromAccountId: draft.fromAccountId,
        toAccountId: draft.toAccountId,
      }
    : {
        ...common,
        type: draft.type,
        accountId: draft.accountId,
      }

  if (!draft.transactionId) return [...transactions, transaction]
  return transactions.map((candidate) => candidate.id === draft.transactionId ? transaction : candidate)
}

function parseDraftAmount(value: string) {
  try {
    return parseCnyToCents(value)
  } catch {
    return undefined
  }
}

function createSessionTransactionId(transactions: Transaction[], now: string) {
  const timestamp = Number.isNaN(Date.parse(now)) ? now.replace(/\W/g, '') : Date.parse(now)
  let suffix = transactions.length + 1
  let id = `session-${timestamp}-${suffix}`
  const existingIds = new Set(transactions.map((transaction) => transaction.id))
  while (existingIds.has(id)) {
    suffix += 1
    id = `session-${timestamp}-${suffix}`
  }
  return id
}
