import type { AdminRegionSummary } from '../layers/adminRegionSummaryDataSource'
import type { AdminRegionDepth } from '../layers/adminRegionVectorTileSource'
import type { TimeRangeSelection } from '../time/timeRange'
import { AdminRegionTreemapCard } from './AdminRegionTreemapCard'
import {
  buildAdminRegionRanking,
  type AdminRegionRankingMetric,
  type AdminRegionRankingRow,
} from './adminRegionRanking'
import {
  buildAdminRegionTreemapModel,
  resolveAdminRegionTreemapDataDepth,
} from './adminRegionTreemap'

type AdminRegionSummaryStatus = 'idle' | 'loading' | 'ready' | 'error'

type AdminRegionContextPanelProps = {
  depth: AdminRegionDepth
  summary: AdminRegionSummary | null
  metric: AdminRegionRankingMetric
  thumbnailBasePath: string
  status: AdminRegionSummaryStatus
  selectedRegionId?: string | null
  nextSummary: AdminRegionSummary | null
  nextStatus: AdminRegionSummaryStatus
  timeRange: TimeRangeSelection
  onDepthChange: (depth: AdminRegionDepth) => void
  onMetricChange: (metric: AdminRegionRankingMetric) => void
  onRegionSelect: (ranking: AdminRegionRankingRow) => void
  onRetry: () => void
  onTreemapRetry: (depth: AdminRegionDepth) => void
}

const DEPTH_OPTIONS: Array<{ value: AdminRegionDepth, label: string }> = [
  { value: 1, label: '国' },
  { value: 2, label: '省' },
  { value: 3, label: '市' },
  { value: 4, label: '区' },
]

const DEPTH_UNITS: Record<AdminRegionDepth, string> = {
  1: '国家',
  2: '省级行政区',
  3: '城市',
  4: '区县',
}

const RANKING_METRIC_OPTIONS: Array<{
  value: AdminRegionRankingMetric
  label: string
}> = [
  { value: 'footprint', label: '足迹' },
  { value: 'time', label: '时间' },
  { value: 'distance', label: '距离' },
]

const RANKING_EMPTY_MESSAGES: Record<AdminRegionRankingMetric, string> = {
  footprint: '本期暂无足迹数据',
  time: '本期暂无时间数据',
  distance: '本期暂无距离数据',
}

export function AdminRegionContextPanel({
  depth,
  summary,
  metric,
  thumbnailBasePath,
  status,
  selectedRegionId = null,
  nextSummary,
  nextStatus,
  timeRange,
  onDepthChange,
  onMetricChange,
  onRegionSelect,
  onRetry,
  onTreemapRetry,
}: AdminRegionContextPanelProps) {
  const unit = DEPTH_UNITS[depth]
  const visitedCount = summary?.visitedCount
  const totalCount = summary?.totalCount
  const countLabel = status === 'loading' && !summary
    ? `-- / -- ${unit}`
    : `${visitedCount ?? 0} / ${totalCount ?? 0} ${unit}`
  const rankingTitle = `${unit}足迹排行`
  const thumbnailLabel = `${unit}足迹缩略图`
  const rankings = buildAdminRegionRanking(summary?.regionMetrics ?? [], metric)
  const selectedRegion = summary?.regionMetrics.find(
    (region) => region.regionId === selectedRegionId,
  ) ?? null
  const treemapDataDepth = resolveAdminRegionTreemapDataDepth(depth, selectedRegion)
  const treemapStatus = treemapDataDepth === depth ? status : nextStatus
  const treemapModel = treemapStatus === 'ready' && summary
    ? buildAdminRegionTreemapModel({
        depth,
        currentSummary: summary,
        nextSummary,
        selectedRegion,
        metric,
      })
    : null

  return (
    <div className="admin-region-context-panel">
      <section
        className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass admin-region-atlas-card"
        aria-label="足迹版图"
      >
        <div className="admin-region-atlas-card__head">
          <div className="admin-region-atlas-card__title">
            <span className="right-context-panel__eyebrow">到访区域</span>
            <h2>足迹版图</h2>
          </div>
          <strong className="admin-region-atlas-card__count">{countLabel}</strong>
        </div>
        <svg
          className="admin-region-atlas-card__thumbnail"
          viewBox="0 0 320 180"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={thumbnailLabel}
          focusable="false"
        >
          <path className="admin-region-atlas-card__base" d={thumbnailBasePath} />
          <path className="admin-region-atlas-card__visited" d={summary?.visitedPath ?? ''} />
        </svg>
        <DepthControl depth={depth} onDepthChange={onDepthChange} />
        {status === 'loading' ? (
          <span className="admin-region-context-panel__status" role="status">加载中</span>
        ) : null}
      </section>

      <section
        className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass admin-region-ranking-card"
        aria-label={rankingTitle}
      >
        <div className="admin-region-ranking-card__head">
          <div className="admin-region-ranking-card__title">
            <span className="right-context-panel__eyebrow">排行依据</span>
            <h2>{rankingTitle}</h2>
          </div>
          <div className="admin-region-ranking-card__actions">
            <MetricControl metric={metric} onMetricChange={onMetricChange} />
            {status === 'error' ? (
              <button
                type="button"
                className="admin-region-ranking-card__retry"
                onClick={onRetry}
              >
                重新加载区域摘要
              </button>
            ) : null}
          </div>
        </div>
        {status === 'error' ? (
          <p className="admin-region-ranking-card__message" role="alert">
            区域摘要加载失败
          </p>
        ) : null}
        {status !== 'error' && summary && rankings.length === 0 ? (
          <p className="admin-region-ranking-card__message">{RANKING_EMPTY_MESSAGES[metric]}</p>
        ) : null}
        {status !== 'error' && rankings.length ? (
          <ol className="admin-region-ranking-card__list" aria-label={rankingTitle}>
            {rankings.map((ranking) => (
              <RankingRow
                key={ranking.regionId}
                ranking={ranking}
                isSelected={ranking.regionId === selectedRegionId}
                onRegionSelect={onRegionSelect}
              />
            ))}
          </ol>
        ) : null}
      </section>

      <AdminRegionTreemapCard
        model={treemapModel}
        status={treemapStatus}
        metric={metric}
        start={timeRange.start}
        end={timeRange.end}
        onRetry={() => onTreemapRetry(treemapDataDepth)}
      />
    </div>
  )
}

function MetricControl({
  metric,
  onMetricChange,
}: {
  metric: AdminRegionRankingMetric
  onMetricChange: (metric: AdminRegionRankingMetric) => void
}) {
  return (
    <div className="admin-region-ranking-card__metric-control" role="group" aria-label="排行依据">
      {RANKING_METRIC_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === metric}
          onClick={() => onMetricChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function DepthControl({
  depth,
  onDepthChange,
}: {
  depth: AdminRegionDepth
  onDepthChange: (depth: AdminRegionDepth) => void
}) {
  return (
    <div className="admin-region-atlas-card__depth-control" role="group" aria-label="行政区层级">
      {DEPTH_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === depth}
          onClick={() => onDepthChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function RankingRow({
  ranking,
  isSelected,
  onRegionSelect,
}: {
  ranking: AdminRegionRankingRow
  isSelected: boolean
  onRegionSelect: (ranking: AdminRegionRankingRow) => void
}) {
  return (
    <li className="admin-region-ranking-card__item">
      <button
        type="button"
        className={`admin-region-ranking-card__row${isSelected ? ' is-selected' : ''}`}
        aria-label={`第 ${ranking.rank} 名，${ranking.name}，${ranking.ariaValue}`}
        aria-current={isSelected ? 'location' : undefined}
        onClick={() => onRegionSelect(ranking)}
      >
        <span className="admin-region-ranking-card__rank">{ranking.rank}</span>
        <span className="admin-region-ranking-card__name" title={ranking.name}>
          {ranking.name}
        </span>
        <span className="admin-region-ranking-card__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${ranking.ratio})` }} />
        </span>
        <strong title={ranking.ariaValue}>{ranking.displayValue}</strong>
      </button>
    </li>
  )
}
