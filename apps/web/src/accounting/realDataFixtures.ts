import type { AccountingDataset } from './types'


export const emptyAccountingDataset: AccountingDataset = {
  accounts: [],
  transactions: [],
  categories: [],
  tags: [],
  imports: [],
  legacyCategories: [],
  legacyFunds: [],
}

export const realisticAccountingDataset: AccountingDataset = {
  accounts: [
    {
      id: 'account-wechat-daily',
      name: '微信 - 日常',
      nature: 'asset',
      currency: 'CNY',
      openingBalanceInCents: 0,
      openingBalanceAt: '2025-09-01T00:00:00',
      openingBalanceSource: 'import-zero-baseline',
      sourceLabel: '记账助手导入',
      createdAt: '2026-07-15T00:00:00Z',
      updatedAt: '2026-07-15T00:00:00Z',
    },
  ],
  categories: [
    { id: 'category-expense-food', type: 'expense', name: '餐饮', sortOrder: 0 },
    {
      id: 'category-expense-lunch',
      type: 'expense',
      name: '午餐',
      parentId: 'category-expense-food',
      sortOrder: 1,
    },
  ],
  tags: [],
  transactions: [
    {
      id: 'transaction-import-1',
      type: 'expense',
      amountInCents: 1880,
      occurredAt: '2026-06-18T12:30:00',
      accountId: 'account-wechat-daily',
      categoryId: 'category-expense-lunch',
      tagIds: [],
      note: '午餐',
      origin: 'import',
      createdAt: '2026-07-15T00:00:00Z',
      updatedAt: '2026-07-15T00:00:00Z',
    },
  ],
  imports: [
    {
      sourceKey: 'biff:账单@日常-全部-1349.csv',
      sourcePath: 'external/账单@日常-全部-1349.csv',
      sourceSha256: 'fixture',
      importedAt: '2026-07-15T00:00:00Z',
      rowCount: 1349,
      earliestOccurredAt: '2025-09-01T00:00:00',
      latestOccurredAt: '2026-06-18T14:10:00',
    },
  ],
  legacyCategories: [],
  legacyFunds: [],
}

