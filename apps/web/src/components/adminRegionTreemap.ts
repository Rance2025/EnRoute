import type {
  AdminRegionMetric,
  AdminRegionSummary,
} from '../layers/adminRegionSummaryDataSource'
import type { AdminRegionDepth } from '../layers/adminRegionVectorTileSource'
import {
  formatAdminRegionRankingValue,
  type AdminRegionRankingMetric,
} from './adminRegionRanking'

export type AdminRegionTreemapItem = {
  region: AdminRegionMetric
  metricValue: number
  share: number
  fill: string
  textColor: string
  displayValue: string
  ariaLabel: string
}

export type AdminRegionTreemapModel = {
  dataDepth: AdminRegionDepth
  title: string
  metricLabel: string
  totalValue: number
  selectedRegionId: string | null
  items: AdminRegionTreemapItem[]
}

type BuildAdminRegionTreemapModelOptions = {
  depth: AdminRegionDepth
  currentSummary: AdminRegionSummary
  nextSummary: AdminRegionSummary | null
  selectedRegion: AdminRegionMetric | null
  metric: AdminRegionRankingMetric
}

const CHINA_COUNTRY_IDS = new Set(['cn', 'chn', '156'])
const CHINA_COUNTRY_NAMES = new Set([
  '中国',
  '中华人民共和国',
  'china',
  "people's republic of china",
])

const BASE_TITLES: Record<AdminRegionDepth, string> = {
  1: '各国',
  2: '全国各省',
  3: '全国各市',
  4: '全部区县',
}

const CHILD_TITLE_SUFFIX: Partial<Record<AdminRegionDepth, string>> = {
  2: '各省',
  3: '各市',
  4: '各区县',
}

const METRIC_LABELS: Record<AdminRegionRankingMetric, string> = {
  footprint: '足迹',
  time: '时间',
  distance: '距离',
}

const METRIC_VALUE_SELECTORS: Record<
  AdminRegionRankingMetric,
  (metric: AdminRegionMetric) => number
> = {
  footprint: (metric) => metric.footprintCount,
  time: (metric) => metric.stayDurationSeconds,
  distance: (metric) => metric.travelDistanceMeters,
}

const COLOR_STOPS = [
  { minRatio: 0.72, fill: '#1d594c', textColor: '#f8fbfa' },
  { minRatio: 0.48, fill: '#4c897b', textColor: '#f8fbfa' },
  { minRatio: 0.30, fill: '#75a79b', textColor: '#17231f' },
  { minRatio: 0.16, fill: '#93b4ab', textColor: '#17231f' },
  { minRatio: 0.08, fill: '#abc8c0', textColor: '#17231f' },
  { minRatio: 0.04, fill: '#b8d1ca', textColor: '#17231f' },
  { minRatio: 0.015, fill: '#c5d7d2', textColor: '#17231f' },
  { minRatio: 0, fill: '#d3e1dd', textColor: '#17231f' },
] as const

const PERCENT_FORMATTER = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  maximumFractionDigits: 1,
})

export function buildAdminRegionTreemapModel({
  depth,
  currentSummary,
  nextSummary,
  selectedRegion,
  metric,
}: BuildAdminRegionTreemapModelOptions): AdminRegionTreemapModel {
  const scope = resolveTreemapScope({
    depth,
    currentSummary,
    nextSummary,
    selectedRegion,
  })
  const selectMetricValue = METRIC_VALUE_SELECTORS[metric]
  const valuedRegions = scope.regions
    .map((region) => ({ region, metricValue: selectMetricValue(region) }))
    .filter(({ metricValue }) => metricValue > 0)
    .sort(compareValuedRegions)
  const totalValue = valuedRegions.reduce((total, item) => total + item.metricValue, 0)
  const maxMetricValue = valuedRegions[0]?.metricValue ?? 0
  const metricLabel = METRIC_LABELS[metric]

  return {
    dataDepth: scope.dataDepth,
    title: scope.title,
    metricLabel,
    totalValue,
    selectedRegionId: scope.focused ? null : selectedRegion?.regionId ?? null,
    items: valuedRegions.map(({ region, metricValue }) => {
      const share = totalValue > 0 ? metricValue / totalValue : 0
      const color = selectColor(maxMetricValue > 0 ? metricValue / maxMetricValue : 0)
      const displayValue = formatAdminRegionRankingValue(metric, metricValue)

      return {
        region,
        metricValue,
        share,
        fill: color.fill,
        textColor: color.textColor,
        displayValue,
        ariaLabel: `${region.name}，${metricLabel} ${displayValue}，占比 ${PERCENT_FORMATTER.format(share)}`,
      }
    }),
  }
}

export function resolveAdminRegionTreemapDataDepth(
  depth: AdminRegionDepth,
  selectedRegion: AdminRegionMetric | null,
): AdminRegionDepth {
  if (!selectedRegion || depth === 4) return depth
  if (depth === 1 && !isChinaCountry(selectedRegion)) return depth
  return (depth + 1) as AdminRegionDepth
}

function resolveTreemapScope({
  depth,
  currentSummary,
  nextSummary,
  selectedRegion,
}: Omit<BuildAdminRegionTreemapModelOptions, 'metric'>): {
  dataDepth: AdminRegionDepth
  title: string
  regions: AdminRegionMetric[]
  focused: boolean
} {
  const dataDepth = resolveAdminRegionTreemapDataDepth(depth, selectedRegion)
  const canFocus = dataDepth !== depth && nextSummary !== null
  if (!canFocus || selectedRegion === null || nextSummary === null) {
    return {
      dataDepth: depth,
      title: BASE_TITLES[depth],
      regions: currentSummary.regionMetrics,
      focused: false,
    }
  }

  const childDepth = nextSummary.depth
  return {
    dataDepth: childDepth,
    title: `${selectedRegion.name}${CHILD_TITLE_SUFFIX[childDepth] ?? ''}`,
    regions: nextSummary.regionMetrics.filter(
      (region) => region.parentRegionId === selectedRegion.regionId,
    ),
    focused: true,
  }
}

function isChinaCountry(region: AdminRegionMetric): boolean {
  return CHINA_COUNTRY_IDS.has(region.regionId.toLowerCase())
    || CHINA_COUNTRY_NAMES.has(region.name.trim().toLowerCase())
}

function compareValuedRegions(
  left: { region: AdminRegionMetric, metricValue: number },
  right: { region: AdminRegionMetric, metricValue: number },
): number {
  const valueDifference = right.metricValue - left.metricValue
  if (valueDifference !== 0) return valueDifference

  const nameDifference = left.region.name.localeCompare(right.region.name, 'zh-CN')
  if (nameDifference !== 0) return nameDifference

  return left.region.regionId.localeCompare(right.region.regionId)
}

function selectColor(ratio: number): (typeof COLOR_STOPS)[number] {
  return COLOR_STOPS.find((stop) => ratio >= stop.minRatio) ?? COLOR_STOPS.at(-1)!
}
