import { convertImportedMoneyBackup } from './importedMoney'
import type {
  AccountingDataset,
  Category,
  ImportedMoneyBackup,
  ImportedMoneyCategory,
  ImportedMoneyFund,
  ImportedMoneySourceRecord,
  Tag,
  Transaction,
} from './types'

const legacyCategories: ImportedMoneyCategory[] = [
  legacyCategory('legacy-salary', '工资', 1),
  legacyCategory('legacy-food', '餐饮', 2),
  legacyCategory('legacy-transport', '交通', 3),
  legacyCategory('legacy-housing', '住宿', 4),
  legacyCategory('legacy-transfer', '账户周转', 5),
]

const legacyFunds: ImportedMoneyFund[] = [
  legacyFund('fund-wechat', '微信 - 日常', 1, 'cash'),
  legacyFund('fund-huabei', '花呗', 2, 'credit'),
  legacyFund('fund-meituan', '美团月付', 3, 'credit'),
  legacyFund('fund-bank', '银行卡', 4, 'bank'),
]

const importedSource: ImportedMoneySourceRecord[] = [
  sourceRecord('tx-salary-june', 5172.41, 'legacy-salary', 'fund-bank', '2026-06-15T02:56:00.000Z', '实习工资', 0),
  sourceRecord('tx-dinner-qingdao', 131, 'legacy-food', 'fund-wechat', '2026-06-14T09:16:00.000Z', '鲜嗨发牛肉火锅', 1),
  sourceRecord('tx-yogurt', 45.78, 'legacy-food', 'fund-meituan', '2026-06-17T10:56:00.000Z', 'NIBU 酸奶', 2),
  sourceRecord('tx-metro', 5.4, 'legacy-transport', 'fund-huabei', '2026-06-18T03:15:00.000Z', '地铁', 3),
  sourceRecord('tx-hotel', 299, 'legacy-housing', 'fund-wechat', '2026-06-16T14:45:00.000Z', '青岛住宿', 4),
  sourceRecord('tx-repay', 200, 'legacy-transfer', 'fund-wechat', '2026-06-18T04:20:00.000Z', '还款示例', 5),
  sourceRecord('tx-coffee', 19.9, 'legacy-food', 'fund-wechat', '2026-05-28T01:30:00.000Z', '咖啡', 6),
]

export const ledgerAtlasCategories: Category[] = [
  { id: 'income-work', type: 'income', name: '工作收入', sortOrder: 1 },
  { id: 'expense-food', type: 'expense', name: '餐饮', sortOrder: 1 },
  { id: 'expense-dinner', type: 'expense', name: '正餐', parentId: 'expense-food', sortOrder: 1 },
  { id: 'expense-drink', type: 'expense', name: '饮品', parentId: 'expense-food', sortOrder: 2 },
  { id: 'expense-travel', type: 'expense', name: '旅行', sortOrder: 2 },
  { id: 'expense-hotel', type: 'expense', name: '住宿', parentId: 'expense-travel', sortOrder: 1 },
  { id: 'expense-transport', type: 'expense', name: '交通', sortOrder: 3 },
  { id: 'transfer-repay', type: 'transfer', name: '还款', sortOrder: 1 },
]

export const ledgerAtlasTags: Tag[] = [
  { id: 'life-stage', name: '人生阶段', sortOrder: 1 },
  { id: 'college', name: '大学', parentId: 'life-stage', sortOrder: 1 },
  { id: 'place', name: '地点旅行', sortOrder: 2 },
  { id: 'qingdao-trip', name: '青岛之行', parentId: 'place', sortOrder: 1 },
  { id: 'topic', name: '主题', sortOrder: 3 },
  { id: 'daily-routine', name: '日常节律', parentId: 'topic', sortOrder: 1 },
]

const backup: ImportedMoneyBackup = {
  source: importedSource,
  categories: legacyCategories,
  funds: legacyFunds,
}

export const ledgerAtlasDataset: AccountingDataset = enrichDataset(
  convertImportedMoneyBackup(backup, ledgerAtlasCategories, ledgerAtlasTags),
)

function enrichDataset(dataset: AccountingDataset): AccountingDataset {
  return {
    ...dataset,
    transactions: dataset.transactions.map((transaction) => {
      if (transaction.id === 'tx-salary-june') {
        return toIncomeTransaction(transaction, 'income-work', ['college'])
      }
      if (transaction.id === 'tx-dinner-qingdao') {
        return toExpenseTransaction(transaction, 'expense-dinner', ['qingdao-trip'])
      }
      if (transaction.id === 'tx-yogurt') {
        return toExpenseTransaction(transaction, 'expense-drink', ['daily-routine'])
      }
      if (transaction.id === 'tx-metro') {
        return toExpenseTransaction(transaction, 'expense-transport', ['daily-routine'])
      }
      if (transaction.id === 'tx-hotel') {
        return toExpenseTransaction(transaction, 'expense-hotel', ['qingdao-trip'])
      }
      if (transaction.id === 'tx-repay') {
        return toTransferTransaction(transaction, 'transfer-repay', 'fund-wechat', 'fund-huabei')
      }
      return toExpenseTransaction(transaction, 'expense-drink', ['daily-routine'])
    }),
  }
}

function toIncomeTransaction(
  transaction: Transaction,
  categoryId: string,
  tagIds: string[],
): Transaction {
  return {
    ...getCommonTransactionFields(transaction),
    type: 'income',
    accountId: getPrimaryAccountId(transaction),
    categoryId,
    tagIds,
  }
}

function toExpenseTransaction(
  transaction: Transaction,
  categoryId: string,
  tagIds: string[],
): Transaction {
  return {
    ...getCommonTransactionFields(transaction),
    type: 'expense',
    accountId: getPrimaryAccountId(transaction),
    categoryId,
    tagIds,
  }
}

function toTransferTransaction(
  transaction: Transaction,
  categoryId: string,
  fromAccountId: string,
  toAccountId: string,
): Transaction {
  return {
    ...getCommonTransactionFields(transaction),
    type: 'transfer',
    categoryId,
    tagIds: [],
    fromAccountId,
    toAccountId,
  }
}

function getCommonTransactionFields(transaction: Transaction) {
  return {
    id: transaction.id,
    amountInCents: transaction.amountInCents,
    occurredAt: transaction.occurredAt,
    note: transaction.note,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    sourceId: transaction.sourceId,
    source: transaction.source,
    importStatus: transaction.importStatus,
  }
}

function getPrimaryAccountId(transaction: Transaction) {
  return transaction.type === 'transfer' ? transaction.fromAccountId : transaction.accountId
}

function legacyCategory(uuid: string, name: string, order: number): ImportedMoneyCategory {
  return {
    uuid,
    name,
    order,
    createTime: Date.parse('2025-09-03T00:00:00.000Z'),
    updateTime: Date.parse('2026-06-18T00:00:00.000Z'),
  }
}

function legacyFund(
  uuid: string,
  name: string,
  order: number,
  type: string,
): ImportedMoneyFund {
  return {
    uuid,
    name,
    order,
    type,
    limit: 0,
    createTime: Date.parse('2025-09-03T00:00:00.000Z'),
    updateTime: Date.parse('2026-06-18T00:00:00.000Z'),
  }
}

function sourceRecord(
  uuid: string,
  amount: number,
  category: string,
  fund: string,
  recordTime: string,
  remark: string,
  createOffset: number,
): ImportedMoneySourceRecord {
  return {
    uuid,
    amount,
    category,
    fund,
    recordTime: Date.parse(recordTime),
    createTime: Date.parse(recordTime) + createOffset * 60_000,
    remark,
  }
}
