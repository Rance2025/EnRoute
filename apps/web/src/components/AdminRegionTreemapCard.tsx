import { hierarchy, treemap } from 'd3-hierarchy'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { AdminRegionRankingMetric } from './adminRegionRanking'
import type {
  AdminRegionTreemapItem,
  AdminRegionTreemapModel,
} from './adminRegionTreemap'

type AdminRegionTreemapStatus = 'idle' | 'loading' | 'ready' | 'error'

type AdminRegionTreemapCardProps = {
  model: AdminRegionTreemapModel | null
  status: AdminRegionTreemapStatus
  metric: AdminRegionRankingMetric
  start: string
  end: string
  onRetry: () => void
}

type TreemapDatum = {
  item?: AdminRegionTreemapItem
  children?: TreemapDatum[]
}

const METRIC_LABELS: Record<AdminRegionRankingMetric, string> = {
  footprint: '足迹',
  time: '时间',
  distance: '距离',
}

const EMPTY_MESSAGES: Record<AdminRegionRankingMetric, string> = {
  footprint: '当前范围暂无足迹数据',
  time: '当前范围暂无时间数据',
  distance: '当前范围暂无距离数据',
}

const PERCENT_FORMATTER = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  maximumFractionDigits: 1,
})

export function AdminRegionTreemapCard({
  model,
  status,
  metric,
  start,
  end,
  onRetry,
}: AdminRegionTreemapCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const metricLabel = model?.metricLabel ?? METRIC_LABELS[metric]
  const title = model?.title ?? '区域拼图'
  const tiles = useMemo(() => layoutTreemap(model, size), [model, size])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({
        width: Math.max(0, entry.contentRect.width),
        height: Math.max(0, entry.contentRect.height),
      })
    })
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass admin-region-treemap-card"
      aria-label="行政区域指标拼图"
    >
      <div className="admin-region-treemap-card__head">
        <div className="admin-region-treemap-card__title">
          <span className="right-context-panel__eyebrow">本期{metricLabel}分布</span>
          <h2>{title}</h2>
        </div>
        <span className="admin-region-treemap-card__range">{start} - {end}</span>
      </div>
      <div className="admin-region-treemap-card__body" ref={bodyRef}>
        {status === 'loading' || status === 'idle' ? (
          <p className="admin-region-treemap-card__message" role="status">加载中</p>
        ) : null}
        {status === 'error' ? (
          <div className="admin-region-treemap-card__message" role="alert">
            <span>区域拼图加载失败</span>
            <button type="button" onClick={onRetry}>重新加载区域拼图</button>
          </div>
        ) : null}
        {status === 'ready' && model?.items.length === 0 ? (
          <p className="admin-region-treemap-card__message">{EMPTY_MESSAGES[metric]}</p>
        ) : null}
        {status === 'ready' && model && model.items.length > 0 ? (
          <div
            className="admin-region-treemap-card__tiles"
            role="list"
            aria-label={`${model.title}${model.metricLabel}分布`}
          >
            {tiles.map(({ item, x, y, width, height }) => {
              const showDetails = width >= 92 && height >= 48
              const showName = width >= 52 && height >= 24
              const isSelected = item.region.regionId === model.selectedRegionId

              return (
                <div
                  className={`admin-region-treemap-card__tile${isSelected ? ' is-selected' : ''}`}
                  key={item.region.regionId}
                  role="listitem"
                  aria-label={item.ariaLabel}
                  title={item.ariaLabel}
                  style={{
                    position: 'absolute',
                    left: x,
                    top: y,
                    width,
                    height,
                    color: item.textColor,
                    background: item.fill,
                  }}
                >
                  {showName ? <strong>{item.region.name}</strong> : null}
                  {showDetails ? (
                    <span>{PERCENT_FORMATTER.format(item.share)} · {item.displayValue}</span>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      <div className="admin-region-treemap-card__footer">
        <span>全部正值区域</span>
        <strong>面积 = {metricLabel}占比</strong>
      </div>
    </section>
  )
}

function layoutTreemap(
  model: AdminRegionTreemapModel | null,
  size: { width: number, height: number },
): Array<{
  item: AdminRegionTreemapItem
  x: number
  y: number
  width: number
  height: number
}> {
  if (!model || size.width <= 0 || size.height <= 0 || model.items.length === 0) return []

  const root = hierarchy<TreemapDatum>({
    children: model.items.map((item) => ({ item })),
  })
    .sum((node) => node.item?.metricValue ?? 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))

  const rectangularRoot = treemap<TreemapDatum>()
    .size([size.width, size.height])
    .paddingInner(3)
    .round(true)(root)

  return rectangularRoot.leaves().flatMap((leaf) => {
    if (!leaf.data.item) return []
    return [{
      item: leaf.data.item,
      x: leaf.x0,
      y: leaf.y0,
      width: Math.max(0, leaf.x1 - leaf.x0),
      height: Math.max(0, leaf.y1 - leaf.y0),
    }]
  })
}
