import type { Account, Category, Tag, Transaction } from './types'

const now = '2026-06-18T10:00:00+08:00'

export const demoAccounts: Account[] = [
  {
    id: 'wechat-daily',
    name: '微信 - 日常',
    openingBalanceInCents: 638_42,
    openingBalanceAt: '2026-06-01T00:00:00+08:00',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'huabei',
    name: '花呗',
    openingBalanceInCents: 0,
    openingBalanceAt: '2026-06-01T00:00:00+08:00',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'meituan-monthly',
    name: '美团月付',
    openingBalanceInCents: 0,
    openingBalanceAt: '2026-06-01T00:00:00+08:00',
    createdAt: now,
    updatedAt: now,
  },
]

export const demoCategories: Category[] = [
  { id: 'expense-food', type: 'expense', name: '餐饮', sortOrder: 1 },
  {
    id: 'expense-dinner',
    type: 'expense',
    name: '晚餐',
    parentId: 'expense-food',
    sortOrder: 1,
  },
  {
    id: 'expense-drink',
    type: 'expense',
    name: '饮料',
    parentId: 'expense-food',
    sortOrder: 2,
  },
  { id: 'expense-transport', type: 'expense', name: '交通', sortOrder: 2 },
  { id: 'income-work', type: 'income', name: '工资', sortOrder: 1 },
  { id: 'income-refund', type: 'income', name: '退款', sortOrder: 2 },
  { id: 'transfer-repay', type: 'transfer', name: '还款', sortOrder: 1 },
  { id: 'transfer-shift', type: 'transfer', name: '账户周转', sortOrder: 2 },
]

export const demoTags: Tag[] = [
  { id: 'stage', name: '人生阶段', sortOrder: 1 },
  { id: 'college', name: '大学', parentId: 'stage', sortOrder: 1 },
  { id: 'travel', name: '旅行', sortOrder: 2 },
  { id: 'qingdao', name: '青岛之行', parentId: 'travel', sortOrder: 1 },
  { id: 'topic', name: '主题', sortOrder: 3 },
  { id: 'cat', name: '猫', parentId: 'topic', sortOrder: 1 },
]

export const demoTransactions: Transaction[] = [
  {
    id: 'tx-1',
    type: 'income',
    amountInCents: 5172_41,
    accountId: 'wechat-daily',
    occurredAt: '2026-06-15T10:56:00+08:00',
    categoryId: 'income-work',
    tagIds: ['college'],
    note: '秒思 5月实习',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'tx-2',
    type: 'expense',
    amountInCents: 131_00,
    accountId: 'wechat-daily',
    occurredAt: '2026-06-14T17:16:00+08:00',
    categoryId: 'expense-dinner',
    tagIds: ['qingdao'],
    note: '鲜旺发牛肉火锅',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'tx-3',
    type: 'expense',
    amountInCents: 45_78,
    accountId: 'meituan-monthly',
    occurredAt: '2026-06-17T18:56:00+08:00',
    categoryId: 'expense-dinner',
    tagIds: ['cat'],
    note: 'NIBU酸奶',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'tx-4',
    type: 'expense',
    amountInCents: 5_40,
    accountId: 'huabei',
    occurredAt: '2026-06-18T11:15:00+08:00',
    categoryId: 'expense-transport',
    tagIds: [],
    note: '交通',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'tx-5',
    type: 'transfer',
    amountInCents: 200_00,
    fromAccountId: 'wechat-daily',
    toAccountId: 'huabei',
    occurredAt: '2026-06-18T12:20:00+08:00',
    categoryId: 'transfer-repay',
    tagIds: [],
    note: '还款示例',
    createdAt: now,
    updatedAt: now,
  },
]
