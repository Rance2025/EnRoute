import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./components/MapboxCanvas', async () => {
  const React = await import('react')

  return {
    MapboxCanvas: ({
      adminRegionVisibleIds,
      adminBoundariesVisible,
      adminRegionLinesVisible,
      footprintsVisible,
      selectedAdminRegion,
      placeLabelsVisible,
      projection,
      onFootprintMetricsChange,
      onMapProjectionChange,
    }: {
      adminRegionVisibleIds?: string[] | null
      adminBoundariesVisible?: boolean
      adminRegionLinesVisible?: boolean
      footprintsVisible?: boolean
      selectedAdminRegion?: { regionId: string } | null
      placeLabelsVisible?: boolean
      projection?: string
      onFootprintMetricsChange?: (metrics: {
        selectedCount: number
        totalDistanceMeters: number
        averageDistanceMetersPerDay: number
        distanceSeries: {
          granularity: 'hour' | 'day'
          unit: 'hour' | 'day'
          buckets: Array<{
            key: string
            label: string
            distanceMeters: number
          }>
        }
      }) => void
      onMapProjectionChange?: (projection: string) => void
    }) => {
      React.useEffect(() => {
        onFootprintMetricsChange?.({
          selectedCount: 12486,
          totalDistanceMeters: 18732000,
          averageDistanceMetersPerDay: 624400,
          distanceSeries: {
            granularity: 'hour',
            unit: 'hour',
            buckets: Array.from({ length: 24 }, (_, hour) => ({
              key: `2026-06-19T${hour.toString().padStart(2, '0')}`,
              label: `${hour.toString().padStart(2, '0')}:00`,
              distanceMeters: hour === 10 ? 18732000 : 0,
            })),
          },
        })
      }, [onFootprintMetricsChange])

      return React.createElement(
        'section',
        {
          className: 'map-stage',
          'data-testid': 'mapbox-canvas',
          'data-admin-region-visible-ids': adminRegionVisibleIds === undefined
            ? 'legacy'
            : adminRegionVisibleIds === null
              ? 'all'
              : adminRegionVisibleIds.join(','),
          'data-admin-boundaries-visible': String(adminBoundariesVisible),
          'data-admin-region-lines-visible': String(adminRegionLinesVisible),
          'data-footprints-visible': String(footprintsVisible),
          'data-selected-admin-region-id': selectedAdminRegion?.regionId,
          'data-place-labels-visible': String(placeLabelsVisible),
          'data-projection': projection,
          'aria-label': '在途 EnRoute 地图工作区',
        },
        React.createElement(
          'div',
          {
            className: 'map-message',
            role: 'status',
          },
          React.createElement('h2', null, '需要配置 Mapbox 访问令牌'),
          React.createElement('pre', null, 'VITE_MAPBOX_ACCESS_TOKEN'),
        ),
        React.createElement(
          'div',
          {
            className: 'map-toolbar',
            'aria-label': '地图工具',
          },
          React.createElement('button', { type: 'button' }, '聚焦当前足迹'),
          React.createElement('button', { type: 'button' }, '显示世界地图'),
          React.createElement('button', { type: 'button' }, '定位当前位置'),
          React.createElement('button', { type: 'button' }, '放大地图'),
          React.createElement('button', { type: 'button' }, '缩小地图'),
          React.createElement('button', { type: 'button', onClick: () => onMapProjectionChange?.('mercator') }, '足迹显示设置'),
        ),
      )
    },
  }
})

const adminRegionSummaryFixture = {
  depth: 1 as const,
  visitedRegionIds: ['CN'],
  visitedCount: 1,
  totalCount: 200,
  thumbnail: { viewBox: '0 0 320 150', basePath: 'M0 0Z', visitedPath: 'M1 1Z' },
  rankings: [{
    rank: 1,
    regionId: 'CN',
    name: '中国',
    footprintCount: 120,
    bounds: { west: 73, south: 18, east: 135, north: 54 },
  }],
}

vi.mock('./layers/adminRegionSummaryDataSource', async () => {
  const actual = await vi.importActual<typeof import('./layers/adminRegionSummaryDataSource')>(
    './layers/adminRegionSummaryDataSource',
  )
  return {
    ...actual,
    loadAdminRegionSummary: vi.fn(async () => adminRegionSummaryFixture),
  }
})

import App from './App'
import { loadAdminRegionSummary } from './layers/adminRegionSummaryDataSource'
import {
  SECONDARY_NAV_RAIL_WIDTH,
  calculateAvailableMapShellWidth,
  calculateUnifiedDataPanelWidth,
  calculateUnifiedMapPaneWidth,
} from './appLayout'

const localStorageMock = createLocalStorageMock()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

const missingAmapConfig = {
  key: '',
  securityJsCode: '',
  isConfigured: false,
  missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
  defaultCenter: [104.195397, 35.86166] as [number, number],
  defaultZoom: 4.2,
  defaultBounds: {
    southWest: [73.3, 17.8] as [number, number],
    northEast: [135.1, 53.7] as [number, number],
  },
  themes: [],
  features: ['bg', 'road', 'building'],
  showLabel: false,
} as const

function useAccountingFixtureDate() {
  vi.setSystemTime(new Date('2026-06-19T10:20:30+08:00'))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

beforeEach(() => {
  window.localStorage.clear()
})

async function settleLazyImports() {
  await act(async () => {
    await vi.dynamicImportSettled()
  })
}

describe('App', () => {
  it('calculates symmetric side panels and leaves the map workspace between them', () => {
    const dataPanelWidth = calculateUnifiedDataPanelWidth({
      view: 'map',
      viewportSize: { width: 1366, height: 768 },
    })
    const availableMapShellWidth = calculateAvailableMapShellWidth({
      viewportWidth: 1366,
      rightPanelWidth: dataPanelWidth,
    })

    expect(SECONDARY_NAV_RAIL_WIDTH).toBe(300)
    expect(dataPanelWidth).toBe(301)
    expect(availableMapShellWidth).toBe(1065)
    expect(
      calculateUnifiedMapPaneWidth({
        viewportWidth: 1366,
        rightPanelWidth: dataPanelWidth,
        dataPanelWidth,
      }),
    ).toBe(764)

    for (const view of ['map', 'accounting'] as const) {
      expect(
        calculateUnifiedDataPanelWidth({
          view,
          viewportSize: { width: 1366, height: 768 },
        }),
      ).toBe(dataPanelWidth)
    }
  })

  it('keeps the shared left panel wide on taller desktop windows', () => {
    const dataPanelWidth = calculateUnifiedDataPanelWidth({
      view: 'map',
      viewportSize: { width: 2048, height: 1155 },
    })
    const availableMapShellWidth = calculateAvailableMapShellWidth({
      viewportWidth: 2048,
      rightPanelWidth: dataPanelWidth,
    })

    expect(availableMapShellWidth).toBe(1688)
    expect(dataPanelWidth).toBe(360)
    expect(
      calculateUnifiedMapPaneWidth({
        viewportWidth: 2048,
        rightPanelWidth: dataPanelWidth,
        dataPanelWidth,
      }),
    ).toBe(1328)
  })

  it('does not let the 360-degree map width squeeze the shared left panel on compact desktop', () => {
    const dataPanelWidth = calculateUnifiedDataPanelWidth({
      view: 'map',
      viewportSize: { width: 1366, height: 768 },
    })
    const availableMapShellWidth = calculateAvailableMapShellWidth({
      viewportWidth: 1366,
      rightPanelWidth: dataPanelWidth,
    })

    expect(availableMapShellWidth).toBe(1065)
    expect(dataPanelWidth).toBe(301)
    expect(
      calculateUnifiedMapPaneWidth({
        viewportWidth: 1366,
        rightPanelWidth: dataPanelWidth,
        dataPanelWidth,
      }),
    ).toBe(764)
  })

  it('keeps the shared panel and map pane deterministic across desktop windows', () => {
    const desktopWindows: Array<{
      viewportSize: { width: number; height: number }
      dataPanelWidth: number
      mapPaneWidth: number
    }> = [
      { viewportSize: { width: 1280, height: 720 }, dataPanelWidth: 300, mapPaneWidth: 680 },
      { viewportSize: { width: 1366, height: 768 }, dataPanelWidth: 301, mapPaneWidth: 764 },
      { viewportSize: { width: 1440, height: 900 }, dataPanelWidth: 317, mapPaneWidth: 806 },
      { viewportSize: { width: 1536, height: 864 }, dataPanelWidth: 338, mapPaneWidth: 860 },
      { viewportSize: { width: 1728, height: 972 }, dataPanelWidth: 360, mapPaneWidth: 1008 },
      { viewportSize: { width: 1920, height: 1080 }, dataPanelWidth: 360, mapPaneWidth: 1200 },
      { viewportSize: { width: 2048, height: 1155 }, dataPanelWidth: 360, mapPaneWidth: 1328 },
    ]

    for (const { viewportSize, dataPanelWidth, mapPaneWidth } of desktopWindows) {
      const availableMapShellWidth = calculateAvailableMapShellWidth({
        viewportWidth: viewportSize.width,
        rightPanelWidth: dataPanelWidth,
      })
      const actualDataPanelWidth = calculateUnifiedDataPanelWidth({
        view: 'accounting',
        viewportSize,
      })

      expect(actualDataPanelWidth).toBe(dataPanelWidth)
      expect(
        calculateUnifiedMapPaneWidth({
          viewportWidth: viewportSize.width,
          rightPanelWidth: actualDataPanelWidth,
          dataPanelWidth: actualDataPanelWidth,
        }),
      ).toBe(mapPaneWidth)
      expect(actualDataPanelWidth + mapPaneWidth + actualDataPanelWidth).toBe(
        viewportSize.width,
      )
      expect(actualDataPanelWidth + mapPaneWidth).toBe(availableMapShellWidth)
    }
  })

  it('uses the same shared left panel width for map and accounting and hides it on mobile', () => {
    for (const view of ['map', 'accounting'] as const) {
      expect(
        calculateUnifiedDataPanelWidth({
          view,
          viewportSize: { width: 1366, height: 768 },
        }),
      ).toBe(301)

      expect(
        calculateUnifiedDataPanelWidth({
          view,
          viewportSize: { width: 720, height: 900 },
        }),
      ).toBe(0)
    }
  })

  it('places secondary navigation at the top of the right context panel', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1366,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 768,
    })

    render(<App amapConfig={missingAmapConfig} />)

    const shell = screen.getByRole('main')
    const rightPanel = screen.getByRole('complementary', { name: '右侧上下文栏' })
    const secondaryNav = within(rightPanel).getByRole('navigation', { name: '二级导航' })

    expect(shell).toHaveStyle({
      '--data-panel-width': '301px',
      '--right-panel-width': '301px',
    })
    expect(rightPanel).toHaveClass('right-context-panel')
    expect(secondaryNav.parentElement).toBe(rightPanel)
    expect(within(secondaryNav).getByRole('button', { name: '足迹' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('renders four map metrics in the shared left panel', async () => {
    render(<App amapConfig={missingAmapConfig} />)
    await settleLazyImports()

    const timePanel = screen.getByLabelText('时间范围面板')
    const metricStrip = within(timePanel).getByLabelText('全局范围指标')

    expect(metricStrip.children).toHaveLength(4)
    expect(within(metricStrip).getByText('足迹总数')).toBeInTheDocument()
    expect(within(metricStrip).getByText('12,486')).toBeInTheDocument()
    expect(within(metricStrip).getByText('总距离')).toBeInTheDocument()
    expect(within(metricStrip).getByText('18,732')).toBeInTheDocument()
    expect(within(metricStrip).getAllByText('km')).toHaveLength(2)
    expect(within(metricStrip).getByText('日均距离')).toBeInTheDocument()
    expect(within(metricStrip).getByText('624.4')).toBeInTheDocument()
    expect(within(metricStrip).getByText('范围天数')).toBeInTheDocument()
    expect(within(metricStrip).getByText('1')).toBeInTheDocument()
    expect(within(metricStrip).getByText('天')).toBeInTheDocument()
  })

  it('shows range days only through today for current ranges that extend into the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T10:20:30+08:00'))

    render(<App amapConfig={missingAmapConfig} />)
    await settleLazyImports()

    fireEvent.click(screen.getByRole('button', { name: '年' }))

    const timePanel = screen.getByLabelText('时间范围面板')
    const metricStrip = within(timePanel).getByLabelText('全局范围指标')

    expect(within(metricStrip).getByText('范围天数')).toBeInTheDocument()
    expect(within(metricStrip).getByText('171')).toBeInTheDocument()
    expect(within(metricStrip).queryByText('365')).not.toBeInTheDocument()
  })

  it('renders the right rail as separated glass panels on the shared base board', () => {
    render(<App amapConfig={missingAmapConfig} />)

    const rightPanel = screen.getByRole('complementary', { name: '右侧上下文栏' })
    const secondaryNav = within(rightPanel).getByRole('navigation', { name: '二级导航' })
    const stack = within(rightPanel).getByLabelText('右侧信息面板')
    const summary = within(stack).getByLabelText('当前分区摘要')
    const legend = within(stack).getByLabelText('图层与状态')

    expect(Array.from(rightPanel.children)).toEqual([secondaryNav, stack])
    expect(stack).toHaveClass('right-context-panel__stack')
    expect(summary).toHaveClass(
      'glass-panel',
      'glass-panel--solid',
      'glass-panel--card',
      'right-context-panel__glass',
      'right-context-panel__summary',
    )
    expect(legend).toHaveClass(
      'glass-panel',
      'glass-panel--solid',
      'glass-panel--card',
      'right-context-panel__glass',
      'right-context-panel__legend',
    )
    expect(within(summary).getByText('足迹')).toBeInTheDocument()
    expect(within(legend).getByText('WebGL 点层')).toBeInTheDocument()
  })

  it('renders the global layout regions inside one inset app board', () => {
    render(<App amapConfig={missingAmapConfig} />)

    const shell = screen.getByRole('main')
    const board = shell.querySelector('.app-board') as HTMLElement | null

    expect(board).not.toBeNull()
    expect(board?.parentElement).toBe(shell)
    expect(board?.querySelector('.app-nav')).not.toBeNull()
    expect(board?.querySelector('.time-context-panel')).not.toBeNull()
    expect(board?.querySelector('.right-context-panel')).not.toBeNull()
    expect(board?.querySelector('.map-stage')).not.toBeNull()
    expect(shell.querySelector(':scope > .app-nav')).toBeNull()
    expect(shell.querySelector(':scope > .time-context-panel')).toBeNull()
    expect(shell.querySelector(':scope > .right-context-panel')).toBeNull()
  })

  it('shows the region cards and uses visited ids by default in region mode', async () => {
    render(<App amapConfig={missingAmapConfig} />)
    await settleLazyImports()

    fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
      .getByRole('button', { name: '区域' }))

    expect(await screen.findByRole('heading', { name: '足迹版图' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '国家足迹排行' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '仅显示当前时间有足迹的区域' }))
      .not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
      'data-admin-region-visible-ids',
      adminRegionSummaryFixture.visitedRegionIds.join(','),
    ))
    expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute('data-footprints-visible', 'false')
    expect(loadAdminRegionSummary).toHaveBeenCalledWith(expect.objectContaining({ depth: 1 }))
  })

  it('moves region range and footprint switches into map settings', async () => {
    render(<App amapConfig={missingAmapConfig} />)
    await settleLazyImports()

    fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
      .getByRole('button', { name: '区域' }))
    await screen.findByRole('heading', { name: '足迹版图' })

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getByRole('button', { name: '地图' }))

    const showAll = within(dialog).getByRole('switch', { name: '显示全部行政区' })
    const showPoints = within(dialog).getByRole('switch', { name: '在区域页显示足迹点' })

    expect(showAll).toHaveAttribute('aria-checked', 'false')
    expect(showPoints).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(showAll)
    fireEvent.click(showPoints)

    expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
      'data-admin-region-visible-ids',
      'all',
    )
    expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute('data-footprints-visible', 'true')
    expect(window.localStorage.getItem('enroute:show-all-admin-regions')).toBe('true')
    expect(window.localStorage.getItem('enroute:show-footprints-in-region-mode')).toBe('true')
  })

  it('shows a setup message when Mapbox credentials are missing', async () => {
    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveTextContent('EnRoute')
    expect(await screen.findByText('需要配置 Mapbox 访问令牌')).toBeInTheDocument()
    expect(screen.getByText(/VITE_MAPBOX_ACCESS_TOKEN/)).toBeInTheDocument()
  })

  it('defaults to pure icon top navigation with a selectable logo overview segment', () => {
    render(<App amapConfig={missingAmapConfig} />)

    const mainNav = screen.getByRole('navigation', { name: '主导航' })

    expect(within(mainNav).getByRole('button', { name: '在途 EnRoute' })).toBeInTheDocument()
    expect(within(mainNav).getByRole('button', { name: '地图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(mainNav).getByRole('button', { name: '记账' })).toHaveAttribute('title', '记账')
    expect(within(mainNav).queryByText('地图')).not.toBeInTheDocument()
    expect(within(mainNav).queryByText('记账')).not.toBeInTheDocument()
    expect(within(mainNav).queryByText('日程')).not.toBeInTheDocument()

    fireEvent.click(within(mainNav).getByRole('button', { name: '在途 EnRoute' }))

    expect(within(mainNav).getByRole('button', { name: '在途 EnRoute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('main')).toHaveClass('app-shell--overview')
    expect(screen.getByLabelText('在途 EnRoute 概览工作区')).toBeInTheDocument()
  })

  it('switches top navigation pages by dragging the active slider', () => {
    const { container } = render(<App amapConfig={missingAmapConfig} />)

    const mainNav = container.querySelector('.app-nav') as HTMLElement
    const tabs = container.querySelector('.app-nav__tabs') as HTMLElement
    const slider = within(mainNav).getByRole('slider')
    const activeItems = slider.querySelector('.app-nav__active-items')

    Object.assign(tabs, {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => true,
      releasePointerCapture: () => undefined,
    })

    vi.spyOn(tabs, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 400,
      bottom: 52,
      width: 400,
      height: 52,
      toJSON: () => ({}),
    } as DOMRect)
    within(mainNav).getAllByRole('button').forEach((button, index) => {
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        x: index * 100,
        y: 0,
        top: 0,
        left: index * 100,
        right: (index + 1) * 100,
        bottom: 52,
        width: 100,
        height: 52,
        toJSON: () => ({}),
      } as DOMRect)
    })

    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 })
    fireEvent.pointerMove(tabs, { clientX: 225, pointerId: 1 })

    expect(activeItems).toHaveAttribute('aria-hidden', 'true')
    expect(slider.querySelectorAll('.app-nav__active-item')).toHaveLength(4)
    expect(tabs).toHaveClass('is-dragging')
    expect((tabs as HTMLElement).style.getPropertyValue('--top-nav-thumb-preview-left')).toBe(
      '175px',
    )
    expect(within(mainNav).getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true')

    fireEvent.pointerUp(tabs, { clientX: 250, pointerId: 1 })

    expect(within(mainNav).getAllByRole('button')[2]).toHaveAttribute('aria-pressed', 'true')
    expect(tabs).not.toHaveClass('is-dragging')
    expect((tabs as HTMLElement).style.getPropertyValue('--top-nav-thumb-preview-left')).toBe('')
    expect(screen.getByRole('main')).toHaveClass('app-shell--accounting')
  })

  it('smoothly interpolates the top navigation slider width across uneven buttons', () => {
    const { container } = render(<App amapConfig={missingAmapConfig} />)

    const mainNav = container.querySelector('.app-nav') as HTMLElement
    const tabs = container.querySelector('.app-nav__tabs') as HTMLElement
    const slider = within(mainNav).getByRole('slider')
    const buttonRects = [
      { left: 0, width: 132 },
      { left: 134, width: 48 },
      { left: 184, width: 48 },
      { left: 234, width: 48 },
    ]

    Object.assign(tabs, {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => true,
      releasePointerCapture: () => undefined,
    })

    vi.spyOn(tabs, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 282,
      bottom: 52,
      width: 282,
      height: 52,
      toJSON: () => ({}),
    } as DOMRect)
    within(mainNav).getAllByRole('button').forEach((button, index) => {
      const rect = buttonRects[index]

      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        x: rect.left,
        y: 0,
        top: 0,
        left: rect.left,
        right: rect.left + rect.width,
        bottom: 52,
        width: rect.width,
        height: 52,
        toJSON: () => ({}),
      } as DOMRect)
    })

    fireEvent.pointerDown(slider, { clientX: 158, pointerId: 1 })
    fireEvent.pointerMove(tabs, { clientX: 112, pointerId: 1 })

    expect((tabs as HTMLElement).style.getPropertyValue('--top-nav-thumb-preview-left')).toBe(
      '67px',
    )
    expect((tabs as HTMLElement).style.getPropertyValue('--top-nav-thumb-preview-width')).toBe(
      '90px',
    )
    expect(within(mainNav).getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens a paged settings dialog from the right rail header and toggles mixed navigation labels', () => {
    const { container } = render(<App amapConfig={missingAmapConfig} />)

    const leftPanel = container.querySelector('.time-context-panel')
    const settingsButton = container.querySelector('.right-context-settings-button')

    expect(leftPanel?.querySelector('[aria-label="打开设置"]')).toBeNull()
    expect(settingsButton).toBeInstanceOf(HTMLButtonElement)
    expect(settingsButton).toHaveAttribute('aria-label', '打开设置')

    fireEvent.click(settingsButton as HTMLButtonElement)

    const dialog = screen.getByRole('dialog', { name: '设置' })
    const settingsTabs = dialog.querySelectorAll<HTMLButtonElement>('.settings-dialog__tab')
    expect(dialog).toBeInTheDocument()
    expect(settingsTabs[1]).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: '地图' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '记账' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '日程' })).toBeInTheDocument()
    fireEvent.click(settingsTabs[0])
    expect(within(dialog).getByRole('button', { name: '纯 icon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(within(dialog).getByRole('button', { name: '图文混合' }))

    const mainNav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(mainNav).getByRole('button', { name: '地图' })).toHaveTextContent('地图')
    expect(within(mainNav).getByRole('button', { name: '记账' })).toHaveTextContent('记账')
    expect(window.localStorage.getItem('enroute:navigation-style')).toBe('mixed')
  })

  it('opens settings with the page tab that matches the current main navigation view', () => {
    const { container } = render(<App amapConfig={missingAmapConfig} />)
    const navButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.app-nav__button'),
    )
    const settingsButton = container.querySelector<HTMLButtonElement>(
      '.right-context-settings-button',
    )

    expect(settingsButton).not.toBeNull()

    fireEvent.click(settingsButton as HTMLButtonElement)
    let dialog = screen.getByRole('dialog', { name: '设置' })
    let tabs = dialog.querySelectorAll<HTMLButtonElement>('.settings-dialog__tab')
    expect(tabs[1]).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭设置' }))
    fireEvent.click(navButtons[0])
    fireEvent.click(settingsButton as HTMLButtonElement)
    dialog = screen.getByRole('dialog', { name: '设置' })
    tabs = dialog.querySelectorAll<HTMLButtonElement>('.settings-dialog__tab')
    expect(tabs[0]).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭设置' }))
    fireEvent.click(navButtons[2])
    fireEvent.click(settingsButton as HTMLButtonElement)
    dialog = screen.getByRole('dialog', { name: '设置' })
    tabs = dialog.querySelectorAll<HTMLButtonElement>('.settings-dialog__tab')
    expect(tabs[2]).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭设置' }))
    fireEvent.click(navButtons[3])
    fireEvent.click(settingsButton as HTMLButtonElement)
    dialog = screen.getByRole('dialog', { name: '设置' })
    tabs = dialog.querySelectorAll<HTMLButtonElement>('.settings-dialog__tab')
    expect(tabs[3]).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the extracted shell color group as a selectable general theme', () => {
    render(<App amapConfig={missingAmapConfig} />)

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))

    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getByRole('button', { name: '通用' }))
    const themeGroup = within(dialog).getByRole('group', { name: '界面色调' })
    const themeButton = within(themeGroup).getByRole('button', { name: '青瓷灰' })

    expect(themeButton).toHaveAttribute('aria-pressed', 'true')
    expect(themeButton.querySelectorAll('.settings-theme-option__swatch')).toHaveLength(3)
    expect(screen.getByRole('main')).toHaveClass('app-shell--theme-mist')

    fireEvent.click(themeButton)

    expect(window.localStorage.getItem('enroute:app-theme')).toBe('mist')
  })

  it('exposes shared glass panel opacity as a slider-only general setting', () => {
    render(<App amapConfig={missingAmapConfig} />)

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))

    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getByRole('button', { name: '通用' }))
    const opacitySlider = within(dialog).getByLabelText('磨砂玻璃透明程度')

    expect(opacitySlider).toHaveAttribute('type', 'range')
    expect(opacitySlider).toHaveAttribute('min', '0')
    expect(opacitySlider).toHaveAttribute('max', '1')
    expect(opacitySlider).toHaveAttribute('step', '0.01')
    expect(opacitySlider).toHaveValue('0.7')
    expect(within(dialog).getByText('0.7')).toHaveClass('settings-range-row__value')
    expect(within(dialog).queryByLabelText('磨砂玻璃透明程度数值')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveStyle({ '--glass-panel-opacity': '0.7' })

    fireEvent.change(opacitySlider, { target: { value: '0.48' } })

    expect(opacitySlider).toHaveValue('0.48')
    expect(within(dialog).getByText('0.48')).toHaveClass('settings-range-row__value')
    expect(screen.getByRole('main')).toHaveStyle({ '--glass-panel-opacity': '0.48' })
    expect(window.localStorage.getItem('enroute:glass-panel-opacity')).toBe('0.48')
  })

  it('switches settings pages and leaves accounting and schedule pages as empty states', () => {
    render(<App amapConfig={missingAmapConfig} />)

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))

    const dialog = screen.getByRole('dialog', { name: '设置' })

    fireEvent.click(within(dialog).getByRole('button', { name: '记账' }))
    expect(within(dialog).getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(dialog).getByText('记账设置')).toBeInTheDocument()
    expect(within(dialog).getByText('暂无可配置项')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '日程' }))
    expect(within(dialog).getByRole('button', { name: '日程' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(dialog).getByText('日程设置')).toBeInTheDocument()
    expect(within(dialog).getByText('暂无可配置项')).toBeInTheDocument()
  })

  it('defaults the map render statistics panel to hidden and toggles it from map settings', () => {
    render(<App amapConfig={missingAmapConfig} />)

    expect(screen.queryByLabelText('足迹渲染调试')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))

    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getByRole('button', { name: '地图' }))

    const debugSwitch = within(dialog).getByRole('switch', { name: '显示地图统计浮窗' })

    expect(debugSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(debugSwitch)

    expect(debugSwitch).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem('enroute:map-debug-panel-visible')).toBe('true')

    fireEvent.click(debugSwitch)

    expect(debugSwitch).toHaveAttribute('aria-checked', 'false')
    expect(window.localStorage.getItem('enroute:map-debug-panel-visible')).toBe('false')
  })

  it('defaults map labels and administrative boundaries to visible without exposing them in map settings', async () => {
    render(<App amapConfig={missingAmapConfig} />)

    expect(await screen.findByTestId('mapbox-canvas')).toHaveAttribute(
      'data-place-labels-visible',
      'true',
    )
    expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
      'data-admin-boundaries-visible',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getByRole('button', { name: '地图' }))

    expect(within(dialog).queryByRole('switch', { name: '显示地名' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('switch', { name: '显示行政边界' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: '显示地图统计浮窗' })).toBeInTheDocument()
  })

  it('restores the persisted map render statistics preference on reload', () => {
    window.localStorage.setItem('enroute:map-debug-panel-visible', 'true')

    render(<App amapConfig={missingAmapConfig} />)

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '设置' })).getByRole('button', {
      name: '地图',
    }))

    expect(
      within(screen.getByRole('dialog', { name: '设置' })).getByRole('switch', {
        name: '显示地图统计浮窗',
      }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('defaults map projection to globe and no longer exposes the projection toggle in settings', async () => {
    render(<App amapConfig={missingAmapConfig} />)

    expect(await screen.findByTestId('mapbox-canvas')).toHaveAttribute('data-projection', 'globe')

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getByRole('button', { name: '地图' }))

    expect(within(dialog).queryByRole('group', { name: '地图形态' })).not.toBeInTheDocument()
  })

  it('restores the persisted mixed navigation style on reload', () => {
    window.localStorage.setItem('enroute:navigation-style', 'mixed')

    render(<App amapConfig={missingAmapConfig} />)

    const mainNav = screen.getByRole('navigation', { name: '主导航' })

    expect(within(mainNav).getByRole('button', { name: '地图' })).toHaveTextContent('地图')
    expect(within(mainNav).getByRole('button', { name: '记账' })).toHaveTextContent('记账')
  })

  it('renders the global secondary navigation rail inside the shared app shell', () => {
    render(<App amapConfig={missingAmapConfig} />)

    const secondaryNav = screen.getByRole('navigation', { name: '二级导航' })

    expect(secondaryNav).toBeInTheDocument()
    expect(secondaryNav).toHaveClass('secondary-nav-rail')
    expect(within(secondaryNav).getByRole('button', { name: '足迹' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(secondaryNav).getByRole('button', { name: '区域' })).toBeInTheDocument()
    expect(within(secondaryNav).getByRole('button', { name: '统计' })).toBeInTheDocument()
    expect(within(secondaryNav).queryByRole('button', { name: '流水' })).not.toBeInTheDocument()
  })

  it('switches secondary navigation content with the top-level page and drives accounting sections', async () => {
    render(<App amapConfig={missingAmapConfig} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))
    await settleLazyImports()

    const secondaryNav = screen.getByRole('navigation', { name: '二级导航' })

    expect(within(secondaryNav).getByRole('button', { name: '流水' })).toBeInTheDocument()
    expect(within(secondaryNav).getByRole('button', { name: '统计' })).toBeInTheDocument()
    expect(within(secondaryNav).queryByRole('button', { name: '足迹' })).not.toBeInTheDocument()
    expect(within(secondaryNav).getByRole('button', { name: '流水' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await screen.findByLabelText('iOS 记账工作台')).toBeInTheDocument()
    expect(await screen.findByLabelText('账户与流水工作台')).toBeInTheDocument()
    expect(screen.queryByLabelText('统计工作区')).not.toBeInTheDocument()

    fireEvent.click(within(secondaryNav).getByRole('button', { name: '统计' }))

    expect(within(secondaryNav).getByRole('button', { name: '统计' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await screen.findByLabelText('统计工作区')).toBeInTheDocument()
    expect(screen.queryByLabelText('账户与流水工作台')).not.toBeInTheDocument()
  })

  it('does not expose map theme switching in the first version', () => {
    render(
      <App
        amapConfig={{
          key: 'test-key',
          securityJsCode: 'test-security-code',
          isConfigured: true,
          missingKeys: [],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 5.1,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [{ id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' }],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.queryByLabelText(/切换地图主题/)).not.toBeInTheDocument()
  })

  it('uses a text-only brand and a single floating map toolbar', async () => {
    render(
      <App
        amapConfig={{
          key: 'test-key',
          securityJsCode: 'test-security-code',
          isConfigured: true,
          missingKeys: [],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 5.1,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [{ id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' }],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveTextContent('EnRoute')
    expect(screen.getByRole('button', { name: '在途 EnRoute' })).toHaveTextContent('EnRoute')
    expect(screen.queryByText('途')).not.toBeInTheDocument()
    expect(screen.queryByText(/地图已就绪/)).not.toBeInTheDocument()
    expect(screen.queryByText(/远山黛/)).not.toBeInTheDocument()
    const mapToolbar = await screen.findByLabelText('地图工具')
    expect(mapToolbar).toBeInTheDocument()
    expect(mapToolbar.querySelectorAll('button')).toHaveLength(6)
    expect(within(mapToolbar).queryByRole('button', { name: '行政区划解锁程度' })).not.toBeInTheDocument()
    expect(within(mapToolbar).getByRole('button', { name: '足迹显示设置' })).toBeInTheDocument()
    expect(within(mapToolbar).getByRole('button', { name: '定位当前位置' })).toBeInTheDocument()
    expect(screen.queryByLabelText('回到默认中国视角')).not.toBeInTheDocument()
    expect(screen.queryByText('国内地图底座')).not.toBeInTheDocument()
    expect(screen.queryByText('轨迹层与海量点图层预留')).not.toBeInTheDocument()
  })

  it('switches from the map page into the rebuilt iOS accounting workspace', async () => {
    useAccountingFixtureDate()

    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.getByRole('button', { name: '地图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await screen.findByText('需要配置 Mapbox 访问令牌')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--map')
    expect(document.body).toHaveClass('is-map-view')

    fireEvent.click(screen.getByRole('button', { name: '记账' }))
    await settleLazyImports()

    expect(screen.getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await screen.findByLabelText('iOS 记账工作台')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '记账' })).not.toBeInTheDocument()
    expect(screen.queryByText('Money ledger')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--accounting')
    expect(document.body).toHaveClass('is-accounting-view')
    expect(document.body).not.toHaveClass('is-map-view')
    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
    expect(screen.queryByText('Ledger Atlas')).not.toBeInTheDocument()
    expect(screen.queryByText('记账图谱工作台')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前账目范围')).not.toBeInTheDocument()
    const ledgerWorkspace = await screen.findByLabelText('账户与流水工作台')
    expect(ledgerWorkspace).toBeInTheDocument()
    expect(within(ledgerWorkspace).getByRole('button', { name: '新增流水' })).toBeInTheDocument()
    expect(screen.queryByText('查看统计')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '二级导航' })).toBeInTheDocument()
    expect(screen.queryByLabelText('账户筛选卡片')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '记账工作区' })).not.toBeInTheDocument()

    const timePanel = screen.getByLabelText('时间范围面板')
    const timeCardSummary = within(timePanel).getByLabelText('全局范围指标')

    expect(within(timeCardSummary).getByText('收入')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥5172.41')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('支出')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥481.18')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('流水')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('6')).toHaveClass(
      'time-context-metric-strip__number',
    )
    expect(within(timeCardSummary).getByText('笔')).toHaveClass(
      'time-context-metric-strip__unit',
    )
    expect(within(timeCardSummary).queryByText('净流入')).not.toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('账户')).not.toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('¥420')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前范围摘要')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('记账概览摘要')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('记账概览卡片')).not.toBeInTheDocument()
    expect(screen.queryByText('本期流水')).not.toBeInTheDocument()
  })

  it('opens transaction and new-ledger modals from the accounting workspace', async () => {
    useAccountingFixtureDate()

    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '记账' }))
    await settleLazyImports()

    const workspace = await screen.findByLabelText('账户与流水工作台')

    fireEvent.click(within(workspace).getAllByText('NIBU 酸奶')[0])

    const detailDialog = screen.getByRole('dialog', { name: '流水详情' })

    expect(within(detailDialog).getByText('修改流水')).toBeInTheDocument()
    expect(within(detailDialog).getByText('删除流水')).toBeInTheDocument()
    expect(within(detailDialog).getByText('原始分类')).toBeInTheDocument()
    expect(within(detailDialog).getByText('归入分类')).toBeInTheDocument()

    fireEvent.click(within(detailDialog).getByRole('button', { name: '关闭' }))
    fireEvent.click(within(workspace).getByRole('button', { name: '新增流水' }))

    const newDialog = screen.getByRole('dialog', { name: '新增流水' })

    expect(within(newDialog).getByText('记录新流水')).toBeInTheDocument()
    expect(within(newDialog).getByText('保存流水')).toBeInTheDocument()
  })

  it('renders analytics with charts plus category and tag tree statistics', async () => {
    useAccountingFixtureDate()

    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '记账' }))
    await settleLazyImports()
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '二级导航' })).getByRole('button', {
        name: '统计',
      }),
    )

    const reportWorkspace = await screen.findByLabelText('统计工作区')

    expect(within(reportWorkspace).getByText('统计总览')).toBeInTheDocument()
    expect(within(reportWorkspace).getByLabelText('收支环形图')).toBeInTheDocument()
    expect(within(reportWorkspace).getByText('分类占比')).toBeInTheDocument()
    expect(within(reportWorkspace).getByText('标签关联')).toBeInTheDocument()
    expect(within(reportWorkspace).getByLabelText('分类树统计')).toBeInTheDocument()
    expect(within(reportWorkspace).getByLabelText('标签树统计')).toBeInTheDocument()
    expect(within(reportWorkspace).getAllByText('旅行 / 住宿').length).toBeGreaterThan(0)
    expect(within(reportWorkspace).getAllByText('地点旅行 / 青岛之行').length).toBeGreaterThan(0)
    expect(reportWorkspace.querySelector('.ios-chart-ring')).not.toBeNull()
  })

  it('uses a statistics entrance instead of top-level ledger account report tabs', async () => {
    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '记账' }))
    await settleLazyImports()

    expect(screen.queryByRole('group', { name: '记账工作区' })).not.toBeInTheDocument()
    const secondaryNav = screen.getByRole('navigation', { name: '二级导航' })

    expect(within(secondaryNav).getByRole('button', { name: '流水' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(secondaryNav).queryByRole('button', { name: '账户' })).not.toBeInTheDocument()
    expect(within(secondaryNav).getByRole('button', { name: '统计' })).toBeInTheDocument()
    expect(await screen.findByLabelText('账户与流水工作台')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '记账二级导航' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('账户工作台')).not.toBeInTheDocument()

    fireEvent.click(within(secondaryNav).getByRole('button', { name: '统计' }))

    expect(await screen.findByLabelText('统计工作区')).toBeInTheDocument()
    expect(within(secondaryNav).getByRole('button', { name: '统计' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '返回流水' })).toBeInTheDocument()

    fireEvent.click(within(secondaryNav).getByRole('button', { name: '流水' }))

    expect(await screen.findByLabelText('账户与流水工作台')).toBeInTheDocument()
    expect(screen.queryByLabelText('统计工作区')).not.toBeInTheDocument()
  })
})

function createLocalStorageMock() {
  const store = new Map<string, string>()

  return {
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}
