import { describe, expect, it } from 'vitest'

import type { TimeRangeSelection } from '../time/timeRange'
import {
  getAccountBalanceSteps,
  getAccountContributions,
  getCashflowTrend,
  getCategoryTreeStatistics,
  getPreviousPeriodRange,
  getTagTreeStatistics,
  getTaxonomyNodeContext,
  getTopCategoryComposition,
  getTopDirectTagAmounts,
} from './insightSelectors'
import { ledgerAtlasDataset } from './ledgerAtlasData'
import type { AccountingDataset, Category, Transaction } from './types'

const juneRange: TimeRangeSelection = {
  mode: 'month',
  start: '2026-06-01',
  end: '2026-06-30',
  anchorDate: '2026-06-01',
}

describe('accounting insight selectors', () => {
  it('keeps the five largest top-level categories and merges the remainder', () => {
    const dataset = categoryCompositionDataset()
    const result = getTopCategoryComposition(dataset, dataset.transactions)

    expect(result.expense.totalInCents).toBe(210_00)
    expect(result.expense.segments.map((segment) => segment.label)).toEqual([
      '分类 6',
      '分类 5',
      '分类 4',
      '分类 3',
      '分类 2',
      '其他',
    ])
    expect(result.expense.segments.at(-1)).toMatchObject({ amountInCents: 10_00 })
    expect(result.income.segments).toEqual([])
  })

  it('returns direct and descendant category amounts with full paths', () => {
    const stats = getCategoryTreeStatistics(
      ledgerAtlasDataset,
      ledgerAtlasDataset.transactions,
    )

    expect(stats.find((node) => node.id === 'expense-food')).toMatchObject({
      path: '餐饮',
      direct: { expenseInCents: 0 },
      aggregate: { expenseInCents: 19_668, transactionCount: 3 },
    })
    expect(stats.find((node) => node.id === 'expense-dinner')).toMatchObject({
      path: '餐饮 / 正餐',
      direct: { expenseInCents: 13_100, transactionCount: 1 },
    })
  })

  it('ranks direct tags by associated income plus expense without a ratio total', () => {
    const tags = getTopDirectTagAmounts(ledgerAtlasDataset, ledgerAtlasDataset.transactions, 5)

    expect(tags[0]).toMatchObject({
      path: '人生阶段 / 大学',
      incomeInCents: 517_241,
      expenseInCents: 13_100,
      netInCents: 504_141,
    })
    expect(tags[0]).not.toHaveProperty('share')
  })

  it('aggregates tag descendants once per node while preserving direct overlap', () => {
    const stats = getTagTreeStatistics(ledgerAtlasDataset, ledgerAtlasDataset.transactions)

    expect(stats.find((node) => node.id === 'life-stage')).toMatchObject({
      direct: { transactionCount: 0 },
      aggregate: { incomeInCents: 517_241, expenseInCents: 13_100, transactionCount: 2 },
    })
    expect(stats.find((node) => node.id === 'college')).toMatchObject({
      direct: { incomeInCents: 517_241, expenseInCents: 13_100, transactionCount: 2 },
    })
  })

  it('builds account balance steps from opening to closing balance', () => {
    const steps = getAccountBalanceSteps(ledgerAtlasDataset, juneRange, 'fund-wechat')

    expect(steps[0]).toMatchObject({ date: juneRange.start, balanceInCents: 860_050 })
    expect(steps.at(-1)).toMatchObject({ date: juneRange.end, balanceInCents: 797_050 })
    expect(steps.length).toBeGreaterThan(2)
  })

  it('buckets income expense and net on the same daily timeline', () => {
    const buckets = getCashflowTrend(ledgerAtlasDataset, juneRange, 'day', false)
    const june15 = buckets.find((bucket) => bucket.key === '2026-06-15')
    const june18 = buckets.find((bucket) => bucket.key === '2026-06-18')

    expect(june15).toMatchObject({ incomeInCents: 517_241, expenseInCents: 0, netInCents: 517_241 })
    expect(june18).toMatchObject({ incomeInCents: 0, expenseInCents: 540, transferInCents: 0 })
    expect(getCashflowTrend(ledgerAtlasDataset, juneRange, 'day', true)
      .find((bucket) => bucket.key === '2026-06-18')).toMatchObject({ transferInCents: 20_000 })
  })

  it('derives an equal-length previous period', () => {
    expect(getPreviousPeriodRange({
      ...juneRange,
      start: '2026-06-10',
      end: '2026-06-20',
    })).toMatchObject({ start: '2026-05-30', end: '2026-06-09' })
  })

  it('returns cross-account contribution and focused taxonomy context', () => {
    const contributions = getAccountContributions(ledgerAtlasDataset, juneRange)
    const context = getTaxonomyNodeContext(
      ledgerAtlasDataset,
      juneRange,
      'category',
      'expense-food',
    )

    expect(contributions.find((item) => item.accountId === 'fund-bank')).toMatchObject({
      incomeInCents: 517_241,
      expenseInCents: 0,
      netInCents: 517_241,
    })
    expect(context).toMatchObject({
      path: '餐饮',
      aggregate: { expenseInCents: 17_678 },
    })
    expect(context?.relatedAccounts[0]).toHaveProperty('accountId')
  })
})

function categoryCompositionDataset(): AccountingDataset {
  const categories: Category[] = Array.from({ length: 6 }, (_, index) => ({
    id: `expense-${index + 1}`,
    type: 'expense',
    name: `分类 ${index + 1}`,
    sortOrder: index + 1,
  }))
  const transactions: Transaction[] = categories.map((category, index) => ({
    id: `transaction-${index + 1}`,
    type: 'expense',
    amountInCents: (index + 1) * 10_00,
    accountId: 'cash',
    occurredAt: `2026-06-${String(index + 1).padStart(2, '0')}T12:00:00+08:00`,
    categoryId: category.id,
    tagIds: [],
    createdAt: '2026-06-01T00:00:00+08:00',
    updatedAt: '2026-06-01T00:00:00+08:00',
  }))

  return {
    accounts: [{
      id: 'cash',
      name: '现金',
      nature: 'asset',
      currency: 'CNY',
      openingBalanceInCents: 1_000_00,
      openingBalanceAt: '2026-01-01T00:00:00+08:00',
      createdAt: '2026-01-01T00:00:00+08:00',
      updatedAt: '2026-01-01T00:00:00+08:00',
    }],
    categories,
    tags: [],
    transactions,
    legacyCategories: [],
    legacyFunds: [],
  }
}
