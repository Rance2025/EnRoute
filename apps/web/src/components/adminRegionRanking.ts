import type { AdminRegionMetric } from '../layers/adminRegionSummaryDataSource'

export type AdminRegionRankingMetric = 'footprint' | 'time' | 'distance'

export type AdminRegionRankingRow = AdminRegionMetric & {
  rank: number
  metricValue: number
  displayValue: string
  ariaValue: string
  ratio: number
}

const INTEGER_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
})

const DECIMAL_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
})

const FULL_VALUE_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 20,
})

const METRIC_VALUE_SELECTORS: Record<
  AdminRegionRankingMetric,
  (metric: AdminRegionMetric) => number
> = {
  footprint: (metric) => metric.footprintCount,
  time: (metric) => metric.stayDurationSeconds,
  distance: (metric) => metric.travelDistanceMeters,
}

export function buildAdminRegionRanking(
  metrics: readonly AdminRegionMetric[],
  metric: AdminRegionRankingMetric,
): AdminRegionRankingRow[] {
  const selectMetricValue = METRIC_VALUE_SELECTORS[metric]
  const rankedMetrics = metrics
    .map((regionMetric) => ({
      regionMetric,
      metricValue: selectMetricValue(regionMetric),
    }))
    .filter(({ metricValue }) => metricValue > 0)
    .sort((left, right) => {
      const valueDifference = right.metricValue - left.metricValue
      if (valueDifference !== 0) return valueDifference

      const nameDifference = left.regionMetric.name.localeCompare(
        right.regionMetric.name,
        'zh-CN',
      )
      if (nameDifference !== 0) return nameDifference

      if (left.regionMetric.regionId < right.regionMetric.regionId) return -1
      if (left.regionMetric.regionId > right.regionMetric.regionId) return 1
      return 0
    })

  const maxValue = rankedMetrics[0]?.metricValue
  if (maxValue === undefined) return []

  return rankedMetrics.map(({ regionMetric, metricValue }, index) => ({
    ...regionMetric,
    rank: index + 1,
    metricValue,
    displayValue: formatAdminRegionRankingValue(metricValue, metric),
    ariaValue: formatAdminRegionRankingAriaValue(metricValue, metric),
    ratio: Math.min(1, Math.max(0.02, metricValue / maxValue)),
  }))
}

export function formatAdminRegionRankingValue(
  value: number,
  metric: AdminRegionRankingMetric,
): string {
  if (metric === 'footprint') {
    return INTEGER_FORMATTER.format(value)
  }

  if (metric === 'time') {
    if (value < 3_600) {
      return `${INTEGER_FORMATTER.format(Math.max(1, Math.round(value / 60)))} 分钟`
    }
    if (value < 86_400) {
      return `${DECIMAL_FORMATTER.format(value / 3_600)} 小时`
    }
    return `${DECIMAL_FORMATTER.format(value / 86_400)} 天`
  }

  if (value < 1_000) {
    return `${INTEGER_FORMATTER.format(value)} 米`
  }
  return `${DECIMAL_FORMATTER.format(value / 1_000)} 公里`
}

export function formatAdminRegionRankingAriaValue(
  value: number,
  metric: AdminRegionRankingMetric,
): string {
  const formattedValue = FULL_VALUE_FORMATTER.format(value)
  if (metric === 'footprint') return `足迹点 ${formattedValue} 个`
  if (metric === 'time') return `累计时间 ${formattedValue} 秒`
  return `移动距离 ${formattedValue} 米`
}
