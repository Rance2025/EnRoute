import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdminRegionMetric, AdminRegionSummary } from '../layers/adminRegionSummaryDataSource'
import type { AdminRegionDepth } from '../layers/adminRegionVectorTileSource'
import type { TimeRangeSelection } from '../time/timeRange'
import type { AdminRegionRankingMetric, AdminRegionRankingRow } from './adminRegionRanking'
import { AdminRegionContextPanel } from './AdminRegionContextPanel'

afterEach(() => {
  cleanup()
})

const cityRegionMetrics: AdminRegionMetric[] = [
  {
    regionId: '440100',
    parentRegionId: '440000',
    name: '广州市',
    footprintCount: 4,
    stayDurationSeconds: 1_800,
    travelDistanceMeters: 1_500,
    bounds: { west: 112.9, south: 22.5, east: 114.1, north: 23.9 },
  },
  {
    regionId: '310100',
    parentRegionId: '310000',
    name: '上海市',
    footprintCount: 12,
    stayDurationSeconds: 3_600,
    travelDistanceMeters: 1_000,
    bounds: { west: 120.8, south: 30.6, east: 122.2, north: 31.9 },
  },
  {
    regionId: '510100',
    parentRegionId: '510000',
    name: '成都市',
    footprintCount: 3,
    stayDurationSeconds: 5_400,
    travelDistanceMeters: 2_000,
    bounds: { west: 103.5, south: 30.1, east: 104.6, north: 31.1 },
  },
  {
    regionId: '330100',
    parentRegionId: '330000',
    name: '杭州市',
    footprintCount: 8,
    stayDurationSeconds: 7_200,
    travelDistanceMeters: 500,
    bounds: { west: 118.3, south: 29.1, east: 120.8, north: 30.6 },
  },
  {
    regionId: '110100',
    parentRegionId: '110000',
    name: '北京市',
    footprintCount: 2,
    stayDurationSeconds: 900,
    travelDistanceMeters: 250,
    bounds: { west: 115.7, south: 39.4, east: 117.4, north: 41.1 },
  },
  {
    regionId: '320500',
    parentRegionId: '320000',
    name: '苏州市',
    footprintCount: 1,
    stayDurationSeconds: 2_700,
    travelDistanceMeters: 0,
    bounds: { west: 119.9, south: 30.8, east: 121.3, north: 32 },
  },
]

const citySummary: AdminRegionSummary = {
  depth: 3,
  visitedRegionIds: ['310100', '330100', '440100'],
  visitedCount: 3,
  totalCount: 12,
  visitedPath: 'M10 10L80 10L80 60L10 60Z',
  regionMetrics: cityRegionMetrics,
}

const provinceSummary: AdminRegionSummary = {
  depth: 2,
  visitedRegionIds: ['320000', '330000'],
  visitedCount: 2,
  totalCount: 34,
  visitedPath: '',
  regionMetrics: [
    {
      regionId: '320000',
      parentRegionId: 'CN',
      name: '江苏',
      footprintCount: 20,
      stayDurationSeconds: 5_400,
      travelDistanceMeters: 300,
      bounds: { west: 116, south: 30, east: 122, north: 35 },
    },
    {
      regionId: '330000',
      parentRegionId: 'CN',
      name: '浙江',
      footprintCount: 10,
      stayDurationSeconds: 3_600,
      travelDistanceMeters: 200,
      bounds: { west: 118, south: 27, east: 123, north: 32 },
    },
  ],
}

const selectedProvinceCitySummary: AdminRegionSummary = {
  depth: 3,
  visitedRegionIds: ['320100', '320500'],
  visitedCount: 2,
  totalCount: 300,
  visitedPath: '',
  regionMetrics: [
    {
      regionId: '320100',
      parentRegionId: '320000',
      name: '南京',
      footprintCount: 12,
      stayDurationSeconds: 3_600,
      travelDistanceMeters: 180,
      bounds: { west: 118, south: 31, east: 119, north: 33 },
    },
    {
      regionId: '320500',
      parentRegionId: '320000',
      name: '苏州',
      footprintCount: 8,
      stayDurationSeconds: 1_800,
      travelDistanceMeters: 120,
      bounds: { west: 120, south: 30, east: 122, north: 32 },
    },
  ],
}

const selectedTimeRange: TimeRangeSelection = {
  mode: 'custom',
  start: '2026-04-01',
  end: '2026-04-30',
  anchorDate: '2026-04-30',
}

function renderPanel({
  depth = 3,
  status = 'ready',
  summary = citySummary,
  metric = 'footprint',
  thumbnailBasePath = 'M0 0L320 0L320 180L0 180Z',
  selectedRegionId = null,
  nextSummary = null,
  nextStatus = 'ready',
  timeRange = selectedTimeRange,
  onDepthChange = vi.fn(),
  onMetricChange = vi.fn(),
  onRegionSelect = vi.fn(),
  onRetry = vi.fn(),
  onTreemapRetry = vi.fn(),
}: {
  depth?: AdminRegionDepth
  status?: 'idle' | 'loading' | 'ready' | 'error'
  summary?: AdminRegionSummary | null
  metric?: AdminRegionRankingMetric
  thumbnailBasePath?: string
  selectedRegionId?: string | null
  nextSummary?: AdminRegionSummary | null
  nextStatus?: 'idle' | 'loading' | 'ready' | 'error'
  timeRange?: TimeRangeSelection
  onDepthChange?: (depth: AdminRegionDepth) => void
  onMetricChange?: (metric: AdminRegionRankingMetric) => void
  onRegionSelect?: (ranking: AdminRegionRankingRow) => void
  onRetry?: () => void
  onTreemapRetry?: (depth: AdminRegionDepth) => void
} = {}) {
  render(
    <AdminRegionContextPanel
      depth={depth}
      status={status}
      summary={summary}
      metric={metric}
      thumbnailBasePath={thumbnailBasePath}
      selectedRegionId={selectedRegionId}
      nextSummary={nextSummary}
      nextStatus={nextStatus}
      timeRange={timeRange}
      onDepthChange={onDepthChange}
      onMetricChange={onMetricChange}
      onRegionSelect={onRegionSelect}
      onRetry={onRetry}
      onTreemapRetry={onTreemapRetry}
    />,
  )

  return { onDepthChange, onMetricChange, onRegionSelect, onRetry, onTreemapRetry }
}

function expectElementsInDocumentOrder(...elements: Element[]) {
  elements.slice(1).forEach((element, index) => {
    expect(
      elements[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
}

describe('AdminRegionContextPanel', () => {
  it('renders the atlas card with one-row depth controls and dynamic city count', () => {
    const { onDepthChange } = renderPanel()

    const heading = screen.getByRole('heading', { name: '足迹版图' })
    const count = screen.getByText('3 / 12 城市')
    const atlasHead = heading.closest('.admin-region-atlas-card__head')

    expect(atlasHead).not.toBeNull()
    expect(atlasHead).toContainElement(heading)
    expect(atlasHead).toContainElement(count)

    const depthControl = screen.getByRole('group', { name: '行政区层级' })
    expect(within(depthControl).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '国',
      '省',
      '市',
      '区',
    ])
    expect(within(depthControl).getByRole('button', { name: '市' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const thumbnail = screen.getByLabelText('城市足迹缩略图')
    expectElementsInDocumentOrder(atlasHead as Element, thumbnail, depthControl)
    expect(thumbnail).toHaveAttribute('viewBox', '0 0 320 180')
    expect(thumbnail.querySelector('.admin-region-atlas-card__base')).toHaveAttribute(
      'd',
      'M0 0L320 0L320 180L0 180Z',
    )
    expect(thumbnail.querySelector('.admin-region-atlas-card__visited')).toHaveAttribute(
      'd',
      citySummary.visitedPath,
    )

    fireEvent.click(within(depthControl).getByRole('button', { name: '区' }))
    expect(onDepthChange).toHaveBeenCalledWith(4)
  })

  it('renders footprint as the selected metric and reports metric changes', () => {
    const { onMetricChange } = renderPanel()
    const metricControl = screen.getByRole('group', { name: '排行依据' })
    const buttons = within(metricControl).getAllByRole('button')

    expect(screen.getByText('排行依据', { selector: '.right-context-panel__eyebrow' }))
      .toBeInTheDocument()
    expect(buttons.map((button) => button.textContent)).toEqual(['足迹', '时间', '距离'])
    expect(buttons.map((button) => button.getAttribute('type'))).toEqual([
      'button',
      'button',
      'button',
    ])
    expect(within(metricControl).getByRole('button', { name: '足迹' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(within(metricControl).getByRole('button', { name: '时间' }))
      .toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(within(metricControl).getByRole('button', { name: '距离' }))
    expect(onMetricChange).toHaveBeenCalledWith('distance')
  })

  it.each([
    {
      metric: 'footprint' as const,
      orderedNames: ['上海市', '杭州市', '广州市', '成都市', '北京市', '苏州市'],
      firstAria: '第 1 名，上海市，足迹点 12 个',
      firstDisplay: '12',
      secondRatio: 'scaleX(0.6666666666666666)',
    },
    {
      metric: 'time' as const,
      orderedNames: ['杭州市', '成都市', '上海市', '苏州市', '广州市', '北京市'],
      firstAria: '第 1 名，杭州市，累计时间 7,200 秒',
      firstDisplay: '2 小时',
      secondRatio: 'scaleX(0.75)',
    },
    {
      metric: 'distance' as const,
      orderedNames: ['成都市', '广州市', '上海市', '杭州市', '北京市'],
      firstAria: '第 1 名，成都市，移动距离 2,000 米',
      firstDisplay: '2 公里',
      secondRatio: 'scaleX(0.75)',
    },
  ])('builds the $metric ranking order, bars, values, and accessible labels', ({
    metric,
    orderedNames,
    firstAria,
    firstDisplay,
    secondRatio,
  }) => {
    renderPanel({ metric })

    const rankingList = screen.getByRole('list', { name: '城市足迹排行' })
    const rows = within(rankingList).getAllByRole('button')

    expect(rows.map((row) => row.querySelector('.admin-region-ranking-card__name')?.textContent))
      .toEqual(orderedNames)
    expect(rows[0]).toHaveAccessibleName(firstAria)
    expect(within(rows[0]).getByText(firstDisplay)).toHaveAttribute(
      'title',
      firstAria.split('，').at(-1),
    )
    expect(rows[0].querySelector('.admin-region-ranking-card__bar span'))
      .toHaveStyle({ transform: 'scaleX(1)' })
    expect(rows[1].querySelector('.admin-region-ranking-card__bar span'))
      .toHaveStyle({ transform: secondRatio })
  })

  it('passes the computed ranking row with region bounds when selected', () => {
    const { onRegionSelect } = renderPanel({ metric: 'time' })

    fireEvent.click(screen.getByRole('button', {
      name: '第 1 名，杭州市，累计时间 7,200 秒',
    }))

    expect(onRegionSelect).toHaveBeenCalledWith(expect.objectContaining({
      regionId: '330100',
      rank: 1,
      ratio: 1,
      displayValue: '2 小时',
      ariaValue: '累计时间 7,200 秒',
      bounds: cityRegionMetrics[3].bounds,
    }))
  })

  it('marks only the selected ranking as the current location', () => {
    renderPanel({ selectedRegionId: '330100' })

    const selectedRow = screen.getByRole('button', { name: /杭州市/ })
    const otherRow = screen.getByRole('button', { name: /上海市/ })

    expect(selectedRow).toHaveClass('is-selected')
    expect(selectedRow).toHaveAttribute('aria-current', 'location')
    expect(otherRow).not.toHaveClass('is-selected')
  })

  it.each([
    ['footprint', '本期暂无足迹数据'],
    ['time', '本期暂无时间数据'],
    ['distance', '本期暂无距离数据'],
  ] as const)('shows the %s empty message', (metric, emptyMessage) => {
    renderPanel({ metric, summary: { ...citySummary, regionMetrics: [] } })

    expect(screen.getByText(emptyMessage)).toBeInTheDocument()
  })

  it('keeps metric tabs and retry together when loading fails', () => {
    const { onRetry } = renderPanel({ status: 'error', summary: null, metric: 'time' })

    const actions = document.querySelector('.admin-region-ranking-card__actions')
    const metricControl = screen.getByRole('group', { name: '排行依据' })
    const retry = screen.getByRole('button', { name: '重新加载区域摘要' })

    expect(actions).toContainElement(metricControl)
    expect(actions).toContainElement(retry)
    expect(within(metricControl).getByRole('button', { name: '时间' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByLabelText('城市足迹排行')).getByRole('alert'))
      .toHaveTextContent('区域摘要加载失败')

    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps the static atlas and depth controls while loading', () => {
    renderPanel({ status: 'loading', summary: null })

    expect(screen.getByRole('group', { name: '行政区层级' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('足迹版图')).getByRole('status'))
      .toHaveTextContent('加载中')
    expect(screen.getByText('-- / -- 城市')).toBeInTheDocument()
    expect(screen.getByLabelText('城市足迹缩略图')
      .querySelector('.admin-region-atlas-card__visited')).toHaveAttribute('d', '')
  })

  it('places a current-range treemap after the atlas and ranking cards', () => {
    renderPanel()

    const atlas = document.querySelector('.admin-region-atlas-card')
    const ranking = document.querySelector('.admin-region-ranking-card')
    const treemapHeading = screen.getByRole('heading', { name: '全国各市' })
    const treemap = treemapHeading.closest('.admin-region-treemap-card')

    expect(atlas).not.toBeNull()
    expect(ranking).not.toBeNull()
    expect(treemap).not.toBeNull()
    expectElementsInDocumentOrder(atlas as Element, ranking as Element, treemap as Element)
    expect(screen.getByText('2026-04-01 - 2026-04-30')).toBeInTheDocument()
  })

  it('focuses a selected province into cached cities without changing the depth control', () => {
    renderPanel({
      depth: 2,
      summary: provinceSummary,
      nextSummary: selectedProvinceCitySummary,
      selectedRegionId: '320000',
      metric: 'time',
    })

    expect(screen.getByRole('heading', { name: '江苏各市' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /行政区层级/ })
      .querySelectorAll('button')[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('retries only the child depth when focused treemap data fails', () => {
    const { onTreemapRetry } = renderPanel({
      depth: 2,
      summary: provinceSummary,
      nextSummary: null,
      nextStatus: 'error',
      selectedRegionId: '320000',
    })

    fireEvent.click(screen.getByRole('button', { name: '重新加载区域拼图' }))
    expect(onTreemapRetry).toHaveBeenCalledWith(3)
  })
})
