import { describe, expect, it } from 'vitest'

import { calculateAccountBalances, validateTransaction } from './balances'
import { demoAccounts, demoCategories, demoTags, demoTransactions } from './demoData'
import { ledgerAtlasDataset } from './ledgerAtlasData'
import { formatCnyFromCents, parseCnyToCents } from './money'
import { getCategoryPath, getTagPath } from './trees'
import type { Account, Category, Tag, Transaction } from './types'

const accounts: Account[] = [
  {
    id: 'cash',
    name: '现金',
    nature: 'asset',
    currency: 'CNY',
    openingBalanceInCents: 100_00,
    openingBalanceAt: '2026-06-01T00:00:00+08:00',
    createdAt: '2026-06-18T08:00:00+08:00',
    updatedAt: '2026-06-18T08:00:00+08:00',
  },
  {
    id: 'credit',
    name: '月付',
    nature: 'liability',
    currency: 'CNY',
    openingBalanceInCents: 0,
    openingBalanceAt: '2026-06-01T00:00:00+08:00',
    createdAt: '2026-06-18T08:00:00+08:00',
    updatedAt: '2026-06-18T08:00:00+08:00',
  },
]

const categories: Category[] = [
  { id: 'food', type: 'expense', name: '餐饮', sortOrder: 1 },
  { id: 'dinner', type: 'expense', name: '晚餐', parentId: 'food', sortOrder: 1 },
  { id: 'salary', type: 'income', name: '工资', sortOrder: 1 },
]

const tags: Tag[] = [
  { id: 'life', name: '人生阶段', sortOrder: 1 },
  { id: 'college', name: '大学', parentId: 'life', sortOrder: 1 },
  { id: 'trip', name: '旅行', sortOrder: 2 },
  { id: 'qingdao', name: '青岛之行', parentId: 'trip', sortOrder: 1 },
]

const transactions: Transaction[] = [
  {
    id: 'salary-1',
    type: 'income',
    amountInCents: 500_00,
    accountId: 'cash',
    occurredAt: '2026-06-15T10:00:00+08:00',
    categoryId: 'salary',
    tagIds: ['college'],
    note: '实习工资',
    createdAt: '2026-06-18T08:00:00+08:00',
    updatedAt: '2026-06-18T08:00:00+08:00',
  },
  {
    id: 'dinner-1',
    type: 'expense',
    amountInCents: 45_50,
    accountId: 'credit',
    occurredAt: '2026-06-16T12:00:00+08:00',
    categoryId: 'dinner',
    tagIds: ['qingdao'],
    note: '晚餐',
    createdAt: '2026-06-18T08:00:00+08:00',
    updatedAt: '2026-06-18T08:00:00+08:00',
  },
  {
    id: 'repay-1',
    type: 'transfer',
    amountInCents: 40_00,
    fromAccountId: 'cash',
    toAccountId: 'credit',
    occurredAt: '2026-06-17T12:00:00+08:00',
    tagIds: [],
    createdAt: '2026-06-18T08:00:00+08:00',
    updatedAt: '2026-06-18T08:00:00+08:00',
  },
]

describe('money helpers', () => {
  it('formats integer cents as fixed-width CNY yuan', () => {
    expect(formatCnyFromCents(12_345)).toBe('123.45')
    expect(formatCnyFromCents(5)).toBe('0.05')
    expect(formatCnyFromCents(-12_300)).toBe('-123.00')
  })

  it('parses displayed CNY yuan into integer cents', () => {
    expect(parseCnyToCents('123.45')).toBe(12_345)
    expect(parseCnyToCents('5')).toBe(500)
    expect(parseCnyToCents('0.05')).toBe(5)
  })
})

describe('balance helpers', () => {
  it('calculates account balances from opening balances and transaction direction', () => {
    expect(calculateAccountBalances(accounts, transactions)).toEqual({
      cash: 560_00,
      credit: -5_50,
    })
  })

  it('ignores transactions that occurred before the account opening balance point', () => {
    expect(
      calculateAccountBalances(accounts, [
        ...transactions,
        {
          id: 'old-expense',
          type: 'expense',
          amountInCents: 99_00,
          accountId: 'cash',
          occurredAt: '2026-05-31T23:59:00+08:00',
          tagIds: [],
          createdAt: '2026-06-18T08:00:00+08:00',
          updatedAt: '2026-06-18T08:00:00+08:00',
        },
      ]),
    ).toEqual({
      cash: 560_00,
      credit: -5_50,
    })
  })

  it('rejects transfers between the same account', () => {
    expect(
      validateTransaction({
        id: 'bad-transfer',
        type: 'transfer',
        amountInCents: 100,
        fromAccountId: 'cash',
        toAccountId: 'cash',
        occurredAt: '2026-06-18T08:00:00+08:00',
        tagIds: [],
        createdAt: '2026-06-18T08:00:00+08:00',
        updatedAt: '2026-06-18T08:00:00+08:00',
      }),
    ).toEqual(['转账的转出账户和转入账户不能相同'])
  })
})

describe('tree helpers', () => {
  it('builds category paths inside a type-specific category tree', () => {
    expect(getCategoryPath(categories, 'dinner')).toBe('餐饮 / 晚餐')
    expect(getCategoryPath(categories, 'salary')).toBe('工资')
  })

  it('builds global tag paths and allows same-name tags through stable ids', () => {
    expect(getTagPath(tags, 'qingdao')).toBe('旅行 / 青岛之行')
    expect(getTagPath(tags, 'college')).toBe('人生阶段 / 大学')
  })
})

describe('demo data integrity', () => {
  it('uses existing accounts, matching category types, and existing tags', () => {
    const accountIds = new Set(demoAccounts.map((account) => account.id))
    const categoryById = new Map(demoCategories.map((category) => [category.id, category]))
    const tagIds = new Set(demoTags.map((tag) => tag.id))

    for (const transaction of demoTransactions) {
      if (transaction.type === 'transfer') {
        expect(accountIds.has(transaction.fromAccountId)).toBe(true)
        expect(accountIds.has(transaction.toAccountId)).toBe(true)
        expect(transaction.fromAccountId).not.toBe(transaction.toAccountId)
      } else {
        expect(accountIds.has(transaction.accountId)).toBe(true)
      }

      if (transaction.categoryId) {
        expect(categoryById.get(transaction.categoryId)?.type).toBe(transaction.type)
      }

      for (const tagId of transaction.tagIds) {
        expect(tagIds.has(tagId)).toBe(true)
      }
    }
  })
})

describe('ledger atlas analysis fixture', () => {
  it('contains explicit asset and liability accounts in CNY', () => {
    expect(new Set(ledgerAtlasDataset.accounts.map((account) => account.nature))).toEqual(
      new Set(['asset', 'liability']),
    )
    expect(ledgerAtlasDataset.accounts.filter((account) => account.nature === 'asset').length).toBeGreaterThanOrEqual(4)
    expect(ledgerAtlasDataset.accounts.every((account) => account.currency === 'CNY')).toBe(true)
    expect(
      ledgerAtlasDataset.accounts.some(
        (account) => account.nature === 'liability' && account.openingBalanceInCents < 0,
      ),
    ).toBe(true)
  })

  it('keeps transaction categories type-compatible and tags referentially valid', () => {
    const categoryById = new Map(
      ledgerAtlasDataset.categories.map((category) => [category.id, category]),
    )
    const tagIds = new Set(ledgerAtlasDataset.tags.map((tag) => tag.id))

    for (const transaction of ledgerAtlasDataset.transactions) {
      if (transaction.categoryId) {
        expect(categoryById.get(transaction.categoryId)?.type).toBe(transaction.type)
      }
      expect(transaction.tagIds.every((tagId) => tagIds.has(tagId))).toBe(true)
    }

    expect(ledgerAtlasDataset.transactions.some((transaction) => transaction.tagIds.length > 1)).toBe(true)
  })
})
