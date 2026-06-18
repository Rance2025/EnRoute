import type { Account, Transaction } from './types'

export function calculateAccountBalances(accounts: Account[], transactions: Transaction[]) {
  const balances = Object.fromEntries(
    accounts.map((account) => [account.id, account.openingBalanceInCents]),
  )
  const accountById = new Map(accounts.map((account) => [account.id, account]))

  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      if (!isAfterAccountOpening(accountById.get(transaction.accountId), transaction)) continue
      balances[transaction.accountId] += transaction.amountInCents
    } else if (transaction.type === 'expense') {
      if (!isAfterAccountOpening(accountById.get(transaction.accountId), transaction)) continue
      balances[transaction.accountId] -= transaction.amountInCents
    } else {
      if (isAfterAccountOpening(accountById.get(transaction.fromAccountId), transaction)) {
        balances[transaction.fromAccountId] -= transaction.amountInCents
      }
      if (isAfterAccountOpening(accountById.get(transaction.toAccountId), transaction)) {
        balances[transaction.toAccountId] += transaction.amountInCents
      }
    }
  }

  return balances
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
