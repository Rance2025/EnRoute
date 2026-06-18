export type TransactionType = 'income' | 'expense' | 'transfer'

export type Account = {
  id: string
  name: string
  openingBalanceInCents: number
  openingBalanceAt: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
  hidden?: boolean
}

export type Category = {
  id: string
  type: TransactionType
  name: string
  parentId?: string
  sortOrder: number
  archivedAt?: string
}

export type Tag = {
  id: string
  name: string
  parentId?: string
  sortOrder: number
  archivedAt?: string
}

type TransactionBase = {
  id: string
  amountInCents: number
  occurredAt: string
  categoryId?: string
  tagIds: string[]
  note?: string
  createdAt: string
  updatedAt: string
}

export type IncomeTransaction = TransactionBase & {
  type: 'income'
  accountId: string
}

export type ExpenseTransaction = TransactionBase & {
  type: 'expense'
  accountId: string
}

export type TransferTransaction = TransactionBase & {
  type: 'transfer'
  fromAccountId: string
  toAccountId: string
}

export type Transaction = IncomeTransaction | ExpenseTransaction | TransferTransaction
