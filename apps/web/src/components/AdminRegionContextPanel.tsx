import type { AdminRegionRanking, AdminRegionSummary } from '../layers/adminRegionSummaryDataSource'
import type { AdminRegionDepth } from '../layers/adminRegionVectorTileSource'

type AdminRegionSummaryStatus = 'idle' | 'loading' | 'ready' | 'error'

type AdminRegionContextPanelProps = {
  depth: AdminRegionDepth
  summary: AdminRegionSummary | null
  status: AdminRegionSummaryStatus
  onDepthChange: (depth: AdminRegionDepth) => void
  onRegionSelect: (ranking: AdminRegionRanking) => void
  onRetry: () => void
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

export function AdminRegionContextPanel({
  depth,
  summary,
  status,
  onDepthChange,
  onRegionSelect,
  onRetry,
}: AdminRegionContextPanelProps) {
  const unit = DEPTH_UNITS[depth]
  const visitedCount = summary?.visitedCount
  const totalCount = summary?.totalCount
  const countLabel = status === 'loading' && !summary
    ? `-- / -- ${unit}`
    : `${visitedCount ?? 0} / ${totalCount ?? 0} ${unit}`
  const rankingTitle = `${unit}足迹排行`
  const thumbnailLabel = `${unit}足迹缩略图`

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
        <DepthControl depth={depth} onDepthChange={onDepthChange} />
        <svg
          className="admin-region-atlas-card__thumbnail"
          viewBox={summary?.thumbnail.viewBox ?? '0 0 320 150'}
          role="img"
          aria-label={thumbnailLabel}
          focusable="false"
        >
          <path className="admin-region-atlas-card__base" d={summary?.thumbnail.basePath ?? ''} />
          <path className="admin-region-atlas-card__visited" d={summary?.thumbnail.visitedPath ?? ''} />
        </svg>
        {status === 'loading' ? (
          <span className="admin-region-context-panel__status" role="status">加载中</span>
        ) : null}
      </section>

      <section
        className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass admin-region-ranking-card"
        aria-label={rankingTitle}
      >
        <div className="admin-region-ranking-card__head">
          <div>
            <span className="right-context-panel__eyebrow">足迹点数量</span>
            <h2>{rankingTitle}</h2>
          </div>
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
        {status === 'error' ? (
          <p className="admin-region-ranking-card__message" role="alert">
            区域摘要加载失败
          </p>
        ) : null}
        {status !== 'error' && summary?.rankings.length === 0 ? (
          <p className="admin-region-ranking-card__message">暂无到访区域</p>
        ) : null}
        {status !== 'error' && summary?.rankings.length ? (
          <ol className="admin-region-ranking-card__list" aria-label={rankingTitle}>
            {summary.rankings.map((ranking) => (
              <RankingRow
                key={ranking.regionId}
                ranking={ranking}
                maxFootprintCount={summary.rankings[0]?.footprintCount ?? ranking.footprintCount}
                onRegionSelect={onRegionSelect}
              />
            ))}
          </ol>
        ) : null}
      </section>
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
  maxFootprintCount,
  onRegionSelect,
}: {
  ranking: AdminRegionRanking
  maxFootprintCount: number
  onRegionSelect: (ranking: AdminRegionRanking) => void
}) {
  const ratio = maxFootprintCount > 0
    ? Math.max(0.08, Math.min(1, ranking.footprintCount / maxFootprintCount))
    : 0

  return (
    <li className="admin-region-ranking-card__item">
      <button
        type="button"
        className="admin-region-ranking-card__row"
        aria-label={`第 ${ranking.rank} 名 ${ranking.name}，${ranking.footprintCount} 个足迹点`}
        onClick={() => onRegionSelect(ranking)}
      >
        <span className="admin-region-ranking-card__rank">{ranking.rank}</span>
        <span className="admin-region-ranking-card__main">
          <span className="admin-region-ranking-card__name">{ranking.name}</span>
          <span className="admin-region-ranking-card__bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${ratio})` }} />
          </span>
        </span>
        <strong>{ranking.footprintCount}</strong>
      </button>
    </li>
  )
}
