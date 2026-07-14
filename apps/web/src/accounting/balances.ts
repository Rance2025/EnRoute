import type { Account, AccountingDataset, Transaction } from './types'

export function calculateAccountBalances(accounts: Account[], transactions: Transaction[]) {
  const balances = Object.fromEntries(
    accounts.map((account) => [account.id, account.openingBalanceInCents]),
  )
  const accountById = new Map(accounts.map((account) => [account.id, account]))

  for (const transaction of transactions) {
    for (const account of accounts) {
      if (!isAfterAccountOpening(accountById.get(account.id), transaction)) continue
      balances[account.id] += getSignedAccountMovement(transaction, account.id)
    }
  }

  return balances
}

export function getSignedAccountMovement(transaction: Transaction, accountId: string) {
  if (transaction.type === 'income') {
    return transaction.accountId === accountId ? transaction.amountInCents : 0
  }
  if (transaction.type === 'expense') {
    return transaction.accountId === accountId ? -transaction.amountInCents : 0
  }
  if (transaction.fromAccountId === accountId) return -transaction.amountInCents
  if (transaction.toAccountId === accountId) return transaction.amountInCents
  return 0
}

export function getAccountBalanceAt(
  dataset: AccountingDataset,
  accountId: string,
  exclusiveEndDate: string,
) {
  const account = dataset.accounts.find((candidate) => candidate.id === accountId)
  if (!account) return 0

  return dataset.transactions.reduce((balance, transaction) => {
    if (transaction.occurredAt.slice(0, 10) >= exclusiveEndDate) return balance
    if (!isAfterAccountOpening(account, transaction)) return balance
    return balance + getSignedAccountMovement(transaction, accountId)
  }, account.openingBalanceInCents)
}

export function validateTransaction(transaction: Transaction) {
  const errors: string[] = []

  if (transaction.amountInCents <= 0) {
    errors.push('金额必须大于 0')
  }

  if (
    transaction.type === 'transfer' &&
    transaction.fromAccountId === transaction.toAccountId
  ) {
    errors.push('转账的转出账户和转入账户不能相同')
  }

  return errors
}

function isAfterAccountOpening(account: Account | undefined, transaction: Transaction) {
  if (!account) return false
  return new Date(transaction.occurredAt).getTime() >= new Date(account.openingBalanceAt).getTime()
}
