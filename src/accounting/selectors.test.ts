import { describe, expect, it } from 'vitest'

import { ledgerAtlasDataset } from './ledgerAtlasData'
import {
  filterTransactionsByTimeRange,
  getAccountPeriodSummaries,
  getCategoryTreeStats,
  getPeriodMetrics,
  getTagTreeStats,
} from './selectors'
import type { TimeRangeSelection } from '../time/timeRange'

const juneRange: TimeRangeSelection = {
  mode: 'month',
  start: '2026-06-01',
  end: '2026-06-30',
  anchorDate: '2026-06-01',
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
