import type { Account, AccountingDataset, Transaction } from './types'

type RequestOptions = { fetcher?: typeof fetch; signal?: AbortSignal }

export type AccountingAccountPatch = Partial<Pick<
  Account,
  'name' | 'nature' | 'openingBalanceInCents' | 'openingBalanceAt' | 'sourceLabel' | 'hidden' | 'archivedAt'
>> & { brandSlug?: string; brandLabel?: string; brandColor?: string }

export async function loadAccountingDataset({
  fetcher = fetch,
  signal,
}: RequestOptions = {}): Promise<AccountingDataset> {
  const payload = await requestJson('/api/accounting/dataset', { fetcher, signal })
  if (!isAccountingDataset(payload)) throw new Error('记账接口返回了无法识别的数据')
  return payload
}

export async function createAccountingTransaction(
  transaction: Transaction,
  options: RequestOptions = {},
): Promise<Transaction> {
  return requestTransaction('/api/accounting/transactions', 'POST', transaction, options)
}

export async function updateAccountingTransaction(
  transactionId: string,
  transaction: Transaction,
  options: RequestOptions = {},
): Promise<Transaction> {
  return requestTransaction(`/api/accounting/transactions/${encodeURIComponent(transactionId)}`, 'PUT', transaction, options)
}

export async function updateAccountingAccount(
  accountId: string,
  patch: AccountingAccountPatch,
  { fetcher = fetch, signal }: RequestOptions = {},
): Promise<Account> {
  const payload = await requestJson(`/api/accounting/accounts/${encodeURIComponent(accountId)}`, {
    fetcher,
    signal,
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!isAccount(payload)) throw new Error('记账接口返回了无法识别的账户')
  return payload
}

async function requestTransaction(
  url: string,
  method: 'POST' | 'PUT',
  transaction: Transaction,
  { fetcher = fetch, signal }: RequestOptions,
) {
  const payload = await requestJson(url, {
    fetcher,
    signal,
    method,
    body: JSON.stringify(toTransactionWrite(transaction)),
  })
  if (!isTransaction(payload)) throw new Error('记账接口返回了无法识别的流水')
  return payload
}

function toTransactionWrite(transaction: Transaction) {
  const common = {
    type: transaction.type,
    amountInCents: transaction.amountInCents,
    occurredAt: transaction.occurredAt,
    categoryId: transaction.categoryId,
    tagIds: transaction.tagIds,
    note: transaction.note,
  }
  return transaction.type === 'transfer'
    ? { ...common, fromAccountId: transaction.fromAccountId, toAccountId: transaction.toAccountId }
    : { ...common, accountId: transaction.accountId }
}

async function requestJson(
  url: string,
  { fetcher, signal, method, body }: RequestOptions & { method?: string; body?: string },
): Promise<unknown> {
  const response = await fetcher(url, {
    ...(method ? { method } : {}),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
    signal,
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    throw new Error(
      isRecord(payload) && typeof payload.detail === 'string'
        ? payload.detail
        : `记账请求失败 (${response.status})`,
    )
  }
  return payload
}

function isAccountingDataset(value: unknown): value is AccountingDataset {
  return isRecord(value)
    && Array.isArray(value.accounts) && value.accounts.every(isAccount)
    && Array.isArray(value.transactions) && value.transactions.every(isTransaction)
    && Array.isArray(value.categories)
    && Array.isArray(value.tags)
    && Array.isArray(value.imports)
    && Array.isArray(value.legacyCategories)
    && Array.isArray(value.legacyFunds)
}

function isAccount(value: unknown): value is Account {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (value.nature === 'asset' || value.nature === 'liability')
    && value.currency === 'CNY'
    && Number.isInteger(value.openingBalanceInCents)
    && typeof value.openingBalanceAt === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function isTransaction(value: unknown): value is Transaction {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !['income', 'expense', 'transfer'].includes(String(value.type))
    || !Number.isInteger(value.amountInCents)
    || typeof value.occurredAt !== 'string'
    || !Array.isArray(value.tagIds)
    || !value.tagIds.every((tagId) => typeof tagId === 'string')
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string') return false
  return value.type === 'transfer'
    ? typeof value.fromAccountId === 'string' && typeof value.toAccountId === 'string'
    : typeof value.accountId === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
