import { describe, expect, it } from 'vitest'

import {
  convertImportedMoneyBackup,
  convertImportedMoneySourceRecord,
  formatImportedMoneyTime,
} from './importedMoney'
import type {
  ImportedMoneyCategory,
  ImportedMoneyFund,
  ImportedMoneySourceRecord,
} from './types'

const sourceRecord: ImportedMoneySourceRecord = {
  uuid: 'source-1',
  amount: 45.78,
  category: 'legacy-food',
  fund: 'fund-wallet',
  recordTime: 1_781_763_000_000,
  createTime: 1_781_770_214_463,
  remark: 'sample remark',
}

const categories: ImportedMoneyCategory[] = [
  {
    uuid: 'legacy-food',
    name: '餐饮',
    order: 1,
    createTime: 1_756_887_333_709,
    updateTime: 1_756_887_333_709,
  },
]

const funds: ImportedMoneyFund[] = [
  {
    uuid: 'fund-wallet',
    name: '微信 - 日常',
    order: 1,
    type: 'asset',
    limit: 0,
    createTime: 1_756_887_333_709,
    updateTime: 1_756_887_333_709,
  },
]

describe('imported money backup adapter', () => {
  it('formats epoch milliseconds as stable ISO timestamps', () => {
    expect(formatImportedMoneyTime(1_781_763_000_000)).toBe('2026-06-18T06:10:00.000Z')
  })

  it('converts a source transaction into a standard transaction with source mapping', () => {
    expect(convertImportedMoneySourceRecord(sourceRecord, categories, funds)).toMatchObject({
      id: 'source-1',
      sourceId: 'source-1',
      type: 'expense',
      amountInCents: 4_578,
      accountId: 'fund-wallet',
      occurredAt: '2026-06-18T06:10:00.000Z',
      createdAt: '2026-06-18T08:10:14.463Z',
      importStatus: 'mapped',
      source: {
        legacyCategoryId: 'legacy-food',
        legacyCategoryName: '餐饮',
        legacyFundId: 'fund-wallet',
        legacyFundName: '微信 - 日常',
        recordTime: 1_781_763_000_000,
        createTime: 1_781_770_214_463,
      },
    })
  })

  it('marks records with missing legacy mappings as unmapped instead of inventing labels', () => {
    expect(
      convertImportedMoneySourceRecord(
        {
          ...sourceRecord,
          category: 'missing-category',
          fund: 'missing-fund',
        },
        categories,
        funds,
      ),
    ).toMatchObject({
      accountId: 'missing-fund',
      importStatus: 'unmapped',
      source: {
        legacyCategoryId: 'missing-category',
        legacyCategoryName: undefined,
        legacyFundId: 'missing-fund',
        legacyFundName: undefined,
      },
    })
  })

  it('converts a backup into accounts, transactions, and legacy categories', () => {
    const dataset = convertImportedMoneyBackup({
      source: [sourceRecord],
      categories,
      funds,
    })

    expect(dataset.accounts).toEqual([
      expect.objectContaining({
        id: 'fund-wallet',
        name: '微信 - 日常',
        sourceFundId: 'fund-wallet',
      }),
    ])
    expect(dataset.transactions).toHaveLength(1)
    expect(dataset.legacyCategories).toEqual(categories)
  })
})
