import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminRegionMetric, AdminRegionSummary } from '../layers/adminRegionSummaryDataSource'
import type { AdminRegionRankingMetric } from './adminRegionRanking'
import { buildAdminRegionTreemapModel } from './adminRegionTreemap'
import { AdminRegionTreemapCard } from './AdminRegionTreemapCard'

let observedSize = { width: 320, height: 240 }

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{
      target,
      contentRect: {
        width: observedSize.width,
        height: observedSize.height,
        x: 0,
        y: 0,
        top: 0,
        right: observedSize.width,
        bottom: observedSize.height,
        left: 0,
        toJSON: () => ({}),
      },
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }], this)
  }

  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  observedSize = { width: 320, height: 240 }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function createMetric(
  regionId: string,
  name: string,
  stayDurationSeconds: number,
): AdminRegionMetric {
  return {
    regionId,
    parentRegionId: 'CN',
    name,
    footprintCount: stayDurationSeconds,
    stayDurationSeconds,
    travelDistanceMeters: stayDurationSeconds,
    bounds: { west: 100, south: 20, east: 110, north: 30 },
  }
}

function createSummary(regionMetrics: AdminRegionMetric[]): AdminRegionSummary {
  return {
    depth: 2,
    visitedRegionIds: regionMetrics.map((region) => region.regionId),
    visitedCount: regionMetrics.length,
    totalCount: regionMetrics.length,
    visitedPath: '',
    regionMetrics,
  }
}

function createModel(metric: AdminRegionRankingMetric = 'time') {
  return buildAdminRegionTreemapModel({
    depth: 2,
    currentSummary: createSummary([
      createMetric('310000', '上海', 1_088_640),
      createMetric('330000', '浙江', 613_440),
    ]),
    nextSummary: null,
    selectedRegion: null,
    metric,
  })
}

describe('AdminRegionTreemapCard', () => {
  it('lays out every model item and exposes complete accessible values', () => {
    const model = createModel()

    render(
      <AdminRegionTreemapCard
        model={model}
        status="ready"
        metric="time"
        start="2026-04-01"
        end="2026-04-30"
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: '全国各省' })).toBeInTheDocument()
    expect(screen.getByText('2026-04-01 - 2026-04-30')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '全国各省时间分布' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /上海.*12\.6 天.*64%/ })).toBeInTheDocument()
    expect(document.querySelectorAll('.admin-region-treemap-card__tile')).toHaveLength(2)
    expect(document.querySelector('.admin-region-treemap-card__tile')).toHaveStyle({
      position: 'absolute',
    })
  })

  it('hides visible text in a tiny tile while keeping its accessible label and title', () => {
    observedSize = { width: 120, height: 70 }
    const model = buildAdminRegionTreemapModel({
      depth: 2,
      currentSummary: createSummary([
        createMetric('large', '主要区域', 10_000),
        createMetric('tiny', '微小区域', 1),
      ]),
      nextSummary: null,
      selectedRegion: null,
      metric: 'time',
    })

    render(
      <AdminRegionTreemapCard
        model={model}
        status="ready"
        metric="time"
        start="2026-04-01"
        end="2026-04-30"
        onRetry={vi.fn()}
      />,
    )

    const tinyTile = screen.getByRole('listitem', { name: /微小区域/ })
    expect(tinyTile).toHaveAttribute('title', expect.stringContaining('微小区域'))
    expect(tinyTile).toHaveTextContent('')
  })

  it.each([
    ['footprint', '当前范围暂无足迹数据'],
    ['time', '当前范围暂无时间数据'],
    ['distance', '当前范围暂无距离数据'],
  ] as const)('shows the %s empty state without tiles', (metric, message) => {
    const model = buildAdminRegionTreemapModel({
      depth: 2,
      currentSummary: createSummary([]),
      nextSummary: null,
      selectedRegion: null,
      metric,
    })

    render(
      <AdminRegionTreemapCard
        model={model}
        status="ready"
        metric={metric}
        start="2026-04-01"
        end="2026-04-30"
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(document.querySelector('.admin-region-treemap-card__tile')).toBeNull()
  })

  it('keeps loading and error handling inside the card and reports retry', () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <AdminRegionTreemapCard
        model={null}
        status="loading"
        metric="distance"
        start="2026-04-01"
        end="2026-04-30"
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('加载中')

    rerender(
      <AdminRegionTreemapCard
        model={null}
        status="error"
        metric="distance"
        start="2026-04-01"
        end="2026-04-30"
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('区域拼图加载失败')
    fireEvent.click(screen.getByRole('button', { name: '重新加载区域拼图' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
