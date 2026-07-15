export type TransactionType = 'income' | 'expense' | 'transfer'

export type AccountNature = 'asset' | 'liability'

export type AccountBrand = {
  slug: string
  label: string
  color: string
}

export type Account = {
  id: string
  name: string
  nature: AccountNature
  currency: 'CNY'
  openingBalanceInCents: number
  openingBalanceAt: string
  openingBalanceSource?: 'import-zero-baseline' | 'manual'
  brand?: AccountBrand
  sourceLabel?: string
  createdAt: string
  updatedAt: string
  origin?: 'import' | 'manual'
  archivedAt?: string
  hidden?: boolean
  sourceFundId?: string
  sourceFundType?: string
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
  sourceId?: string
  origin?: 'import' | 'manual'
  source?: AccountingTransactionSource
  importStatus?: AccountingImportStatus
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

export type ImportedMoneySourceRecord = {
  uuid: string
  amount: number | string
  category?: string
  fund?: string
  recordTime: number | string
  createTime: number | string
  remark?: string
}

export type ImportedMoneyCategory = {
  uuid: string
  name: string
  order: number
  createTime: number | string
  updateTime: number | string
  hideTime?: number | string
}

export type ImportedMoneyFund = {
  uuid: string
  name: string
  order: number
  type: string
  limit: number | string
  createTime: number | string
  updateTime: number | string
}

export type ImportedMoneyBackup = {
  source: ImportedMoneySourceRecord[]
  categories: ImportedMoneyCategory[]
  funds: ImportedMoneyFund[]
}

export type AccountingImportStatus = 'mapped' | 'partial' | 'unmapped'

export type AccountingTransactionSource = {
  legacyCategoryId?: string
  legacyCategoryName?: string
  legacyFundId?: string
  legacyFundName?: string
  recordTime: number
  createTime: number
}

export type AccountingDataset = {
  accounts: Account[]
  transactions: Transaction[]
  categories: Category[]
  tags: Tag[]
  imports?: AccountingImportMetadata[]
  legacyCategories: ImportedMoneyCategory[]
  legacyFunds: ImportedMoneyFund[]
}

export type AccountingImportMetadata = {
  sourceKey: string
  sourcePath: string
  sourceSha256: string
  importedAt: string
  rowCount: number
  earliestOccurredAt: string
  latestOccurredAt: string
}

export type PeriodMetrics = {
  incomeInCents: number
  expenseInCents: number
  transferInCents: number
  netInCents: number
  transactionCount: number
  activeAccountCount: number
}

export type AccountPeriodSummary = {
  account: Account
  openingInCents: number
  incomeInCents: number
  expenseInCents: number
  transferInInCents: number
  transferOutInCents: number
  netChangeInCents: number
  closingInCents: number
  transactionCount: number
}

export type PortfolioPeriodSummary = {
  openingAssetsInCents: number
  openingLiabilitiesInCents: number
  openingNetWorthInCents: number
  incomeInCents: number
  expenseInCents: number
  transferInCents: number
  netChangeInCents: number
  closingAssetsInCents: number
  closingLiabilitiesInCents: number
  closingNetWorthInCents: number
  transactionCount: number
}

export type TaxonomyNodeStat = {
  id: string
  name: string
  parentId?: string
  depth: number
  amountInCents: number
  directAmountInCents: number
  transactionCount: number
  directTransactionCount: number
  share: number
}
