import { describe, expect, it } from 'vitest'

import type { AdminRegionMetric } from '../layers/adminRegionSummaryDataSource'
import {
  buildAdminRegionRanking,
  formatAdminRegionRankingAriaValue,
  formatAdminRegionRankingValue,
} from './adminRegionRanking'

function createMetric(
  regionId: string,
  name: string,
  footprintCount: number,
  stayDurationSeconds: number,
  travelDistanceMeters: number,
): AdminRegionMetric {
  return {
    regionId,
    name,
    footprintCount,
    stayDurationSeconds,
    travelDistanceMeters,
    bounds: {
      west: 120,
      south: 30,
      east: 121,
      north: 31,
    },
  }
}

describe('buildAdminRegionRanking', () => {
  it('builds a different descending order for each metric', () => {
    const metrics = [
      createMetric('a', '甲', 30, 10, 100),
      createMetric('b', '乙', 20, 30, 200),
      createMetric('c', '丙', 10, 20, 300),
    ]

    expect(buildAdminRegionRanking(metrics, 'footprint').map((row) => row.regionId)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(buildAdminRegionRanking(metrics, 'time').map((row) => row.regionId)).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(buildAdminRegionRanking(metrics, 'distance').map((row) => row.regionId)).toEqual([
      'c',
      'b',
      'a',
    ])
  })

  it.each([
    ['footprint', createMetric('zero', '零值', 0, 10, 10)],
    ['time', createMetric('zero', '零值', 10, 0, 10)],
    ['distance', createMetric('zero', '零值', 10, 10, 0)],
  ] as const)('filters zero values only for the %s metric', (metric, zeroMetric) => {
    const positiveMetric = createMetric('positive', '正值', 1, 1, 1)

    expect(buildAdminRegionRanking([zeroMetric, positiveMetric], metric).map((row) => row.regionId))
      .toEqual(['positive'])
  })

  it('breaks ties by zh-CN name and then by ascending region id', () => {
    const metrics = [
      createMetric('440100', '广州', 10, 1, 1),
      createMetric('110101', '北京', 10, 1, 1),
      createMetric('110100', '北京', 10, 1, 1),
    ]

    expect(buildAdminRegionRanking(metrics, 'footprint').map((row) => row.regionId)).toEqual([
      '110100',
      '110101',
      '440100',
    ])
  })

  it('assigns ranks and ratios from raw values with a visible nonzero minimum', () => {
    const rows = buildAdminRegionRanking([
      createMetric('max', '最高', 100, 1, 1),
      createMetric('middle', '中间', 60, 1, 1),
      createMetric('minimum', '最低', 1, 1, 1),
    ], 'footprint')

    expect(rows.map(({ rank, metricValue, ratio }) => ({ rank, metricValue, ratio }))).toEqual([
      { rank: 1, metricValue: 100, ratio: 1 },
      { rank: 2, metricValue: 60, ratio: 0.6 },
      { rank: 3, metricValue: 1, ratio: 0.02 },
    ])
  })

  it('returns an empty ranking when the selected metric has no positive values', () => {
    expect(buildAdminRegionRanking([
      createMetric('zero', '零值', 0, 1, 1),
    ], 'footprint')).toEqual([])
  })

  it('does not modify the input metrics', () => {
    const metrics = [
      createMetric('b', '乙', 20, 1, 1),
      createMetric('a', '甲', 30, 1, 1),
    ]
    const snapshot = structuredClone(metrics)

    buildAdminRegionRanking(metrics, 'footprint')

    expect(metrics).toEqual(snapshot)
  })

  it('sorts and calculates ratios before display rounding', () => {
    const rows = buildAdminRegionRanking([
      createMetric('lower', '较低', 1, 1, 1_250),
      createMetric('higher', '较高', 1, 1, 1_251),
    ], 'distance')

    expect(rows.map(({ regionId, displayValue, ratio }) => ({ regionId, displayValue, ratio })))
      .toEqual([
        { regionId: 'higher', displayValue: '1.3 公里', ratio: 1 },
        { regionId: 'lower', displayValue: '1.3 公里', ratio: 1_250 / 1_251 },
      ])
  })
})

describe('formatAdminRegionRankingValue', () => {
  it('formats footprint counts as zh-CN integers without a suffix', () => {
    expect(formatAdminRegionRankingValue(12_120, 'footprint')).toBe('12,120')
  })

  it.each([
    [1, '1 分钟'],
    [59 * 60, '59 分钟'],
    [60 * 60, '1 小时'],
    [90 * 60, '1.5 小时'],
    [24 * 60 * 60, '1 天'],
    [36 * 60 * 60, '1.5 天'],
  ])('formats %i seconds as %s', (value, expected) => {
    expect(formatAdminRegionRankingValue(value, 'time')).toBe(expected)
  })

  it.each([
    [999, '999 米'],
    [1_000, '1 公里'],
    [1_250, '1.3 公里'],
  ])('formats %i meters as %s', (value, expected) => {
    expect(formatAdminRegionRankingValue(value, 'distance')).toBe(expected)
  })
})

describe('formatAdminRegionRankingAriaValue', () => {
  it.each([
    ['footprint', 12_120, '足迹点 12,120 个'],
    ['time', 5_400, '累计时间 5,400 秒'],
    ['distance', 1_250, '移动距离 1,250 米'],
  ] as const)('formats %s with its full base unit', (metric, value, expected) => {
    expect(formatAdminRegionRankingAriaValue(value, metric)).toBe(expected)
  })
})
