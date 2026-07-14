import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdminRegionSummary } from '../layers/adminRegionSummaryDataSource'
import type { AdminRegionDepth } from '../layers/adminRegionVectorTileSource'
import { AdminRegionContextPanel } from './AdminRegionContextPanel'

afterEach(() => {
  cleanup()
})

const citySummary: AdminRegionSummary = {
  depth: 3,
  visitedRegionIds: ['310100', '330100', '440100'],
  visitedCount: 3,
  totalCount: 12,
  thumbnail: {
    viewBox: '0 0 320 150',
    basePath: 'M0 0L320 0L320 150L0 150Z',
    visitedPath: 'M10 10L80 10L80 60L10 60Z',
  },
  rankings: [
    {
      rank: 1,
      regionId: '310100',
      name: '上海市',
      footprintCount: 12,
      bounds: { west: 120.8, south: 30.6, east: 122.2, north: 31.9 },
    },
    {
      rank: 2,
      regionId: '330100',
      name: '杭州市',
      footprintCount: 8,
      bounds: { west: 118.3, south: 29.1, east: 120.8, north: 30.6 },
    },
    {
      rank: 3,
      regionId: '440100',
      name: '广州市',
      footprintCount: 4,
      bounds: { west: 112.9, south: 22.5, east: 114.1, north: 23.9 },
    },
    {
      rank: 4,
      regionId: '510100',
      name: '成都市',
      footprintCount: 3,
      bounds: { west: 103.5, south: 30.1, east: 104.6, north: 31.1 },
    },
    {
      rank: 5,
      regionId: '110100',
      name: '北京市',
      footprintCount: 2,
      bounds: { west: 115.7, south: 39.4, east: 117.4, north: 41.1 },
    },
    {
      rank: 6,
      regionId: '320500',
      name: '苏州市',
      footprintCount: 1,
      bounds: { west: 119.9, south: 30.8, east: 121.3, north: 32.0 },
    },
  ],
}

function renderPanel({
  depth = 3,
  status = 'ready',
  summary = citySummary,
  onDepthChange = vi.fn(),
  onRegionSelect = vi.fn(),
  onRetry = vi.fn(),
}: {
  depth?: AdminRegionDepth
  status?: 'idle' | 'loading' | 'ready' | 'error'
  summary?: AdminRegionSummary | null
  onDepthChange?: (depth: AdminRegionDepth) => void
  onRegionSelect?: (ranking: AdminRegionSummary['rankings'][number]) => void
  onRetry?: () => void
} = {}) {
  render(
    <AdminRegionContextPanel
      depth={depth}
      status={status}
      summary={summary}
      onDepthChange={onDepthChange}
      onRegionSelect={onRegionSelect}
      onRetry={onRetry}
    />,
  )

  return { onDepthChange, onRegionSelect, onRetry }
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
    expect(screen.queryByText('当前层级')).not.toBeInTheDocument()
    expect(screen.queryByText('累计距离')).not.toBeInTheDocument()

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
    expect(thumbnail).toHaveAttribute('viewBox', citySummary.thumbnail.viewBox)
    expect(thumbnail).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
    expect(thumbnail.querySelector('.admin-region-atlas-card__base')).toHaveAttribute(
      'd',
      citySummary.thumbnail.basePath,
    )
    expect(thumbnail.querySelector('.admin-region-atlas-card__visited')).toHaveAttribute(
      'd',
      citySummary.thumbnail.visitedPath,
    )

    fireEvent.click(within(depthControl).getByRole('button', { name: '区' }))
    expect(onDepthChange).toHaveBeenCalledWith(4)
  })

  it('changes the count unit with the selected administrative depth', () => {
    const countrySummary = { ...citySummary, depth: 1 as const, visitedCount: 2, totalCount: 200 }
    const provinceSummary = { ...citySummary, depth: 2 as const, visitedCount: 4, totalCount: 34 }
    const districtSummary = { ...citySummary, depth: 4 as const, visitedCount: 5, totalCount: 90 }

    const { rerender } = render(
      <AdminRegionContextPanel
        depth={1}
        status="ready"
        summary={countrySummary}
        onDepthChange={vi.fn()}
        onRegionSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('2 / 200 国家')).toBeInTheDocument()

    rerender(
      <AdminRegionContextPanel
        depth={2}
        status="ready"
        summary={provinceSummary}
        onDepthChange={vi.fn()}
        onRegionSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('4 / 34 省级行政区')).toBeInTheDocument()

    rerender(
      <AdminRegionContextPanel
        depth={4}
        status="ready"
        summary={districtSummary}
        onDepthChange={vi.fn()}
        onRegionSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('5 / 90 区县')).toBeInTheDocument()
  })

  it('renders a scrollable ranking card and selects ranking rows', () => {
    const { onRegionSelect } = renderPanel()

    expect(screen.getByRole('heading', { name: '城市足迹排行' })).toBeInTheDocument()
    const rankingList = screen.getByRole('list', { name: '城市足迹排行' })
    expect(rankingList).toHaveClass('admin-region-ranking-card__list')
    expect(within(rankingList).getAllByRole('listitem')).toHaveLength(6)

    fireEvent.click(within(rankingList).getByRole('button', { name: /第 2 名 杭州市/ }))

    expect(onRegionSelect).toHaveBeenCalledWith(citySummary.rankings[1])
  })

  it('shows empty, loading, and error states without replacing depth controls', () => {
    const { onRetry } = renderPanel({
      status: 'error',
      summary: null,
    })

    expect(screen.getByRole('group', { name: '行政区层级' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载区域摘要' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    cleanup()
    renderPanel({ status: 'loading', summary: null })
    const loadingDepthControl = screen.getByRole('group', { name: '行政区层级' })
    const loadingStatus = screen.getByRole('status')

    expect(loadingStatus).toHaveTextContent('加载中')
    expect(screen.getByText('-- / -- 城市')).toBeInTheDocument()
    expectElementsInDocumentOrder(loadingDepthControl, loadingStatus)

    cleanup()
    renderPanel({ summary: { ...citySummary, visitedCount: 0, rankings: [], visitedRegionIds: [] } })
    expect(screen.getByText('暂无到访区域')).toBeInTheDocument()
  })
})
