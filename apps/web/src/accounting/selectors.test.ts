import { describe, expect, it } from 'vitest'

import { ledgerAtlasDataset } from './ledgerAtlasData'
import {
  filterTransactionsByTimeRange,
  getAccountPeriodSummaries,
  getCategoryTreeStats,
  getPeriodMetrics,
  getPortfolioPeriodSummary,
  getTagTreeStats,
} from './selectors'
import type { AccountingDataset } from './types'
import type { TimeRangeSelection } from '../time/timeRange'

const juneRange: TimeRangeSelection = {
  mode: 'month',
  start: '2026-06-01',
  end: '2026-06-30',
  anchorDate: '2026-06-01',
}

const historicalRange: TimeRangeSelection = {
  mode: 'custom',
  start: '2026-06-10',
  end: '2026-06-20',
  anchorDate: '2026-06-10',
}

const balanceDataset: AccountingDataset = {
  accounts: [
    {
      id: 'asset',
      name: '资产账户',
      nature: 'asset',
      currency: 'CNY',
      openingBalanceInCents: 1_000_00,
      openingBalanceAt: '2026-06-01T00:00:00+08:00',
      createdAt: '2026-06-01T00:00:00+08:00',
      updatedAt: '2026-06-01T00:00:00+08:00',
    },
    {
      id: 'liability',
      name: '负债账户',
      nature: 'liability',
      currency: 'CNY',
      openingBalanceInCents: -500_00,
      openingBalanceAt: '2026-06-01T00:00:00+08:00',
      createdAt: '2026-06-01T00:00:00+08:00',
      updatedAt: '2026-06-01T00:00:00+08:00',
    },
  ],
  transactions: [
    transaction('before-opening', 'expense', 900_00, '2026-05-31T12:00:00+08:00', 'asset'),
    transaction('before-range', 'income', 200_00, '2026-06-02T12:00:00+08:00', 'asset'),
    transaction('range-income', 'income', 300_00, '2026-06-11T12:00:00+08:00', 'asset'),
    transaction('range-expense', 'expense', 50_00, '2026-06-12T12:00:00+08:00', 'asset'),
    {
      id: 'range-transfer',
      type: 'transfer',
      amountInCents: 100_00,
      fromAccountId: 'asset',
      toAccountId: 'liability',
      occurredAt: '2026-06-13T12:00:00+08:00',
      tagIds: [],
      createdAt: '2026-06-13T12:00:00+08:00',
      updatedAt: '2026-06-13T12:00:00+08:00',
    },
  ],
  categories: [],
  tags: [],
  legacyCategories: [],
  legacyFunds: [],
}

describe('accounting selectors', () => {
  it('filters transactions by the shared date range using occurredAt', () => {
    const filtered = filterTransactionsByTimeRange(ledgerAtlasDataset.transactions, juneRange)

    expect(filtered.map((transaction) => transaction.id)).toEqual([
      'tx-repay',
      'tx-metro',
      'tx-yogurt',
      'tx-hotel',
      'tx-salary-june',
      'tx-dinner-qingdao',
    ])
  })

  it('does not cap open-ended shared ranges at the visible end date', () => {
    const range: TimeRangeSelection = {
      mode: 'custom',
      start: '2026-06-01',
      end: '2026-06-19',
      anchorDate: '2026-06-19',
      isOpenEnded: true,
    }
    const transactions = [
      {
        ...ledgerAtlasDataset.transactions[0],
        id: 'before-start',
        occurredAt: '2026-05-31T23:59:59+08:00',
      },
      {
        ...ledgerAtlasDataset.transactions[0],
        id: 'visible-end',
        occurredAt: '2026-06-19T23:59:59+08:00',
      },
      {
        ...ledgerAtlasDataset.transactions[0],
        id: 'future-imported',
        occurredAt: '2026-06-20T00:00:00+08:00',
      },
    ]

    expect(filterTransactionsByTimeRange(transactions, range).map((transaction) => transaction.id)).toEqual([
      'future-imported',
      'visible-end',
    ])
  })

  it('derives period metrics from the filtered transactions', () => {
    expect(getPeriodMetrics(ledgerAtlasDataset, juneRange)).toMatchObject({
      transactionCount: 6,
      incomeInCents: 517_241,
      expenseInCents: 48_118,
      transferInCents: 20_000,
      netInCents: 469_123,
      activeAccountCount: 4,
    })
  })

  it('summarizes per-account movement for the current period', () => {
    const summaries = getAccountPeriodSummaries(ledgerAtlasDataset, juneRange)

    expect(summaries.find((summary) => summary.account.id === 'fund-wechat')).toMatchObject({
      expenseInCents: 43_000,
      transferOutInCents: 20_000,
      transactionCount: 3,
    })
    expect(summaries.find((summary) => summary.account.id === 'fund-bank')).toMatchObject({
      incomeInCents: 517_241,
      transactionCount: 1,
    })
    expect(summaries.find((summary) => summary.account.id === 'fund-huabei')).toMatchObject({
      expenseInCents: 540,
      transferInInCents: 20_000,
    })
  })

  it('derives opening balances from all post-opening movement before the selected range', () => {
    const summaries = getAccountPeriodSummaries(balanceDataset, historicalRange)

    expect(summaries.find((summary) => summary.account.id === 'asset')).toMatchObject({
      openingInCents: 1_200_00,
      incomeInCents: 300_00,
      expenseInCents: 50_00,
      transferOutInCents: 100_00,
      netChangeInCents: 150_00,
      closingInCents: 1_350_00,
    })
    expect(summaries.find((summary) => summary.account.id === 'liability')).toMatchObject({
      openingInCents: -500_00,
      transferInInCents: 100_00,
      netChangeInCents: 100_00,
      closingInCents: -400_00,
    })
  })

  it('calculates portfolio net worth while cancelling internal transfers globally', () => {
    expect(getPortfolioPeriodSummary(balanceDataset, historicalRange)).toMatchObject({
      openingAssetsInCents: 1_200_00,
      openingLiabilitiesInCents: 500_00,
      openingNetWorthInCents: 700_00,
      incomeInCents: 300_00,
      expenseInCents: 50_00,
      netChangeInCents: 250_00,
      closingAssetsInCents: 1_350_00,
      closingLiabilitiesInCents: 400_00,
      closingNetWorthInCents: 950_00,
    })
  })

  it('aggregates category tree totals through descendants', () => {
    const stats = getCategoryTreeStats(ledgerAtlasDataset, juneRange)

    expect(stats.find((node) => node.id === 'expense-food')).toMatchObject({
      amountInCents: 17_678,
      transactionCount: 2,
    })
    expect(stats.find((node) => node.id === 'expense-dinner')).toMatchObject({
      amountInCents: 13_100,
      transactionCount: 1,
    })
  })

  it('aggregates tag tree totals through descendants', () => {
    const stats = getTagTreeStats(ledgerAtlasDataset, juneRange)

    expect(stats.find((node) => node.id === 'place')).toMatchObject({
      amountInCents: 43_000,
      transactionCount: 2,
    })
    expect(stats.find((node) => node.id === 'daily-routine')).toMatchObject({
      amountInCents: 5_118,
      transactionCount: 2,
    })
  })
})

function transaction(
  id: string,
  type: 'income' | 'expense',
  amountInCents: number,
  occurredAt: string,
  accountId: string,
) {
  return {
    id,
    type,
    amountInCents,
    occurredAt,
    accountId,
    tagIds: [],
    createdAt: occurredAt,
    updatedAt: occurredAt,
  } as const
}
