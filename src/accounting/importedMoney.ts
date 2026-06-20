import type {
  AccountingDataset,
  Account,
  Category,
  ImportedMoneyBackup,
  ImportedMoneyCategory,
  ImportedMoneyFund,
  ImportedMoneySourceRecord,
  Tag,
  Transaction,
} from './types'

const importedEpoch = '2025-09-01T00:00:00.000Z'

export function formatImportedMoneyTime(value: number | string) {
  return new Date(Number(value)).toISOString()
}

export function convertImportedMoneySourceRecord(
  record: ImportedMoneySourceRecord,
  categories: ImportedMoneyCategory[],
  funds: ImportedMoneyFund[],
): Transaction {
  const category = categories.find((item) => item.uuid === record.category)
  const fund = funds.find((item) => item.uuid === record.fund)
  const importStatus = getImportStatus(Boolean(category), Boolean(fund))

  return {
    id: record.uuid,
    sourceId: record.uuid,
    type: 'expense',
    amountInCents: toCents(record.amount),
    accountId: record.fund ?? '',
    occurredAt: formatImportedMoneyTime(record.recordTime),
    categoryId: undefined,
    tagIds: [],
    note: record.remark,
    createdAt: formatImportedMoneyTime(record.createTime),
    updatedAt: formatImportedMoneyTime(record.createTime),
    importStatus,
    source: {
      legacyCategoryId: record.category,
      legacyCategoryName: category?.name,
      legacyFundId: record.fund,
      legacyFundName: fund?.name,
      recordTime: Number(record.recordTime),
      createTime: Number(record.createTime),
    },
  }
}

export function convertImportedMoneyBackup(
  backup: ImportedMoneyBackup,
  categories: Category[] = [],
  tags: Tag[] = [],
): AccountingDataset {
  return {
    accounts: backup.funds.map(convertImportedFundToAccount),
    transactions: backup.source.map((record) =>
      convertImportedMoneySourceRecord(record, backup.categories, backup.funds),
    ),
    categories,
    tags,
    legacyCategories: backup.categories,
    legacyFunds: backup.funds,
  }
}

function convertImportedFundToAccount(fund: ImportedMoneyFund): Account {
  return {
    id: fund.uuid,
    name: fund.name,
    openingBalanceInCents: 0,
    openingBalanceAt: importedEpoch,
    createdAt: formatImportedMoneyTime(fund.createTime),
    updatedAt: formatImportedMoneyTime(fund.updateTime),
    sourceFundId: fund.uuid,
    sourceFundType: fund.type,
  }
}

function toCents(value: number | string) {
  return Math.round(Number(value) * 100)
}

function getImportStatus(hasCategory: boolean, hasFund: boolean) {
  if (hasCategory && hasFund) return 'mapped'
  if (hasCategory || hasFund) return 'partial'
  return 'unmapped'
}
