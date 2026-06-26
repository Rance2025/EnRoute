import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AmapConfig } from '../config/amap'
import type {
  FootprintSnapshot,
  FootprintSnapshotRequest,
} from '../layers/footprintDataSource'
import type { AdminRegion, AdminRegionRequestInput } from '../layers/adminRegionTypes'
import type { FootprintPoint, FootprintRenderSnapshot } from '../layers/footprintTypes'
import {
  selectDay,
  selectPresetRange,
  type TimeRangeSelection,
} from '../time/timeRange'

const configuredAmap: AmapConfig = {
  key: 'test-key',
  securityJsCode: 'test-security-code',
  isConfigured: true,
  missingKeys: [],
  defaultCenter: [104.195397, 35.86166],
  defaultZoom: 4.2,
  defaultBounds: {
    southWest: [73.3, 17.8],
    northEast: [135.1, 53.7],
  },
  renderBounds: {
    southWest: [-180, -85.05112878],
    northEast: [180, 85.05112878],
  },
  themes: [{ id: 'whitesmoke', name: 'whitesmoke', style: 'amap://styles/whitesmoke' }],
  features: ['bg', 'road', 'building'],
  showLabel: false,
}

const loadedPoints: FootprintPoint[] = [
  {
    id: '1',
    timestampSeconds: 1781798400,
    longitude: 121.5,
    latitude: 31.2,
    accuracy: 5,
    speed: -1,
    distance: 0,
    heading: 0,
    altitude: 0,
    locType: 1,
    isBackForeground: 1,
    stepType: 0,
  },
  {
    id: '2',
    timestampSeconds: 1781884799,
    longitude: 121.500001,
    latitude: 31.200001,
    accuracy: 5,
    speed: -1,
    distance: 0,
    heading: 0,
    altitude: 0,
    locType: 1,
    isBackForeground: 1,
    stepType: 0,
  },
]

const emptyRenderSnapshot: FootprintRenderSnapshot = {
  points: [],
  metrics: {
    selectedCount: 0,
    averageDistanceMetersPerDay: 0,
    totalDistanceMeters: 0,
  },
  selectedBounds: null,
}

const loadedAdminRegions: AdminRegion[] = [
  {
    id: 'sanlin',
    name: '三林镇',
    level: 4,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]],
      ],
    },
    firstSeenTimestamp: 100,
    footprintCount: 2,
    stayDurationSeconds: 30,
    travelDistanceMeters: 40,
  },
]

const localStorageMock = createLocalStorageMock()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

function createResolvablePromise<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

async function renderFootprintMassMarks({
  containerSize = { width: 1024, height: 768 },
  mapOverrides,
  onFootprintMetricsChange = vi.fn(),
  snapshot = createDefaultSnapshot(),
  snapshots,
  timeRange = selectPresetRange('all'),
  adminRegionUnlockEnabled = false,
  debugPanelVisible,
}: {
  containerSize?: { width: number; height: number }
  mapOverrides?: object
  onFootprintMetricsChange?: (metrics: {
    selectedCount: number
    averageDistanceMetersPerDay: number
    totalDistanceMeters: number
  }) => void
  snapshot?: FootprintSnapshot
  snapshots?: FootprintSnapshot[]
  timeRange?: TimeRangeSelection
  adminRegionUnlockEnabled?: boolean
  debugPanelVisible?: boolean
} = {}) {
  const mapMoveHandlers: Array<() => void> = []
  const moveEndHandlers: Array<() => void> = []
  const zoomChangeHandlers: Array<() => void> = []
  const zoomEndHandlers: Array<() => void> = []
  const completeHandlers: Array<() => void> = []
  const layerRecords: Array<{
    destroy: ReturnType<typeof vi.fn>
    scheduleStyleUpdate: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }> = []
  const adminRegionLayerRecords: Array<{
    destroy: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }> = []
  const geolocationGetCurrentPosition = vi.fn()
  const geolocationConstructor = vi.fn(function Geolocation(this: {
    getCurrentPosition: typeof geolocationGetCurrentPosition
  }) {
    this.getCurrentPosition = geolocationGetCurrentPosition
  })
  const amapPlugin = vi.fn((_name: string, callback: () => void) => callback())
  const createMassFootprintLayer = vi.fn(() => {
    const layer = {
      destroy: vi.fn(),
      scheduleStyleUpdate: vi.fn(),
      update: vi.fn(),
    }
    layerRecords.push(layer)

    return layer
  })
  const snapshotRequests: FootprintSnapshotRequest[] = []
  const snapshotSignals: AbortSignal[] = []
  const adminRegionRequests: AdminRegionRequestInput[] = []
  const adminRegionSignals: AbortSignal[] = []
  const mapConstructorCalls: Array<unknown> = []
  const loadFootprintSnapshot = vi.fn(
    async (
      _apiUrl: string | undefined,
      input: FootprintSnapshotRequest,
      signal: AbortSignal,
    ) => {
      snapshotRequests.push(input)
      snapshotSignals.push(signal)
      const availableSnapshots = snapshots ?? [snapshot]

      return availableSnapshots[
        Math.min(snapshotRequests.length - 1, availableSnapshots.length - 1)
      ]
    },
  )
  const loadAdminRegions = vi.fn(
    async (
      _apiUrl: string | undefined,
      input: AdminRegionRequestInput,
      signal: AbortSignal,
    ) => {
      adminRegionRequests.push(input)
      adminRegionSignals.push(signal)
      return loadedAdminRegions
    },
  )
  const createAdminRegionLayer = vi.fn(() => {
    const layer = {
      destroy: vi.fn(),
      update: vi.fn(),
    }
    adminRegionLayerRecords.push(layer)

    return layer
  })
  class MockMap {
    addControl = vi.fn()
    destroy = vi.fn()
    resize = vi.fn()
    on = vi.fn((eventName: string, callback: () => void) => {
      if (eventName === 'mapmove') mapMoveHandlers.push(callback)
      if (eventName === 'moveend') moveEndHandlers.push(callback)
      if (eventName === 'zoomchange') zoomChangeHandlers.push(callback)
      if (eventName === 'zoomend') zoomEndHandlers.push(callback)
      if (eventName === 'complete') completeHandlers.push(callback)
    })
    off = vi.fn()
    getZoom = vi.fn(() => 10)
    getCenter = vi.fn(() => ({ getLng: () => 121.5, getLat: () => 31.2 }))
    lnglatToPixel = vi.fn(() => ({ x: 0, y: 0 }))
    lngLatToContainer = vi.fn(() => ({ x: 0, y: 0 }))
    containerToLngLat = vi.fn((point: { x: number; y: number }) => ({
      getLng: () => (point.x === 0 ? 120 : 122),
      getLat: () => (point.y === 0 ? 32 : 30),
    }))
    setCenter = vi.fn()
    setZoomAndCenter = vi.fn()
    setBounds = vi.fn()
    setPitch = vi.fn()
    setRotation = vi.fn()
    setStatus = vi.fn()
    getPitch = vi.fn(() => 0)
    getRotation = vi.fn(() => 0)

    constructor(_container: HTMLElement, options: unknown) {
      mapConstructorCalls.push(options)
      Object.assign(this, mapOverrides)
    }
  }

  vi.doMock('../layers/footprintDataSource', () => ({
    loadFootprintSnapshot,
  }))
  vi.doMock('../layers/massFootprintLayer', () => ({
    createMassFootprintLayer,
  }))
  vi.doMock('../layers/adminRegionDataSource', () => ({
    loadAdminRegions,
  }))
  vi.doMock('../layers/adminRegionLayer', () => ({
    createAdminRegionLayer,
  }))
  vi.doMock('../services/amapLoader', () => ({
    loadAmap: vi.fn(async () => ({
      MassMarks: class MassMarks {},
      Pixel: class Pixel {},
      Size: class Size {},
      Map: MockMap,
      Scale: class Scale {},
      Geolocation: geolocationConstructor,
      Bounds: class Bounds {
        constructor(
          public southWest: [number, number],
          public northEast: [number, number],
        ) {}
      },
      plugin: amapPlugin,
    })),
  }))

  const { AmapCanvas } = await import('./AmapCanvas')
  const renderResult = render(
    <AmapCanvas
      config={configuredAmap}
      timeRange={timeRange}
      onFootprintMetricsChange={onFootprintMetricsChange}
      adminRegionUnlockEnabled={adminRegionUnlockEnabled}
      debugPanelVisible={debugPanelVisible}
    />,
  )
  const mapSurface = renderResult.container.querySelector('.amap-surface') as HTMLElement

  Object.defineProperty(mapSurface, 'clientWidth', {
    configurable: true,
    value: containerSize.width,
  })
  Object.defineProperty(mapSurface, 'clientHeight', {
    configurable: true,
    value: containerSize.height,
  })

  await waitFor(() => expect(createMassFootprintLayer).toHaveBeenCalledTimes(1), {
    timeout: 1000,
  })

  return {
    completeHandlers,
    adminRegionLayerRecords,
    adminRegionRequests,
    adminRegionSignals,
    createMassFootprintLayer,
    createAdminRegionLayer,
    amapPlugin,
    geolocationConstructor,
    geolocationGetCurrentPosition,
    layerRecords,
    loadAdminRegions,
    loadFootprintSnapshot,
    mapConstructorCalls,
    mapMoveHandlers,
    moveEndHandlers,
    renderResult,
    rerenderWithTimeRange(nextTimeRange: TimeRangeSelection) {
      renderResult.rerender(
        <AmapCanvas
          config={configuredAmap}
          timeRange={nextTimeRange}
          onFootprintMetricsChange={onFootprintMetricsChange}
          adminRegionUnlockEnabled={adminRegionUnlockEnabled}
          debugPanelVisible={debugPanelVisible}
        />,
      )
    },
    rerenderWithAdminRegionUnlockEnabled(nextAdminRegionUnlockEnabled: boolean) {
      renderResult.rerender(
        <AmapCanvas
          config={configuredAmap}
          timeRange={timeRange}
          onFootprintMetricsChange={onFootprintMetricsChange}
          adminRegionUnlockEnabled={nextAdminRegionUnlockEnabled}
          debugPanelVisible={debugPanelVisible}
        />,
      )
    },
    snapshotRequests,
    snapshotSignals,
    zoomChangeHandlers,
    zoomEndHandlers,
  }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('AmapCanvas footprint layer wiring', () => {
  it('keeps a light loading underlay until the AMap surface is ready', async () => {
    const loadAmapResult = createResolvablePromise<{
      MassMarks: new () => unknown
      Pixel: new () => unknown
      Size: new () => unknown
      Map: new (container: HTMLElement, options: unknown) => unknown
      Scale: new (options: unknown) => unknown
      Geolocation: new (options: unknown) => unknown
      Bounds: new (southWest: [number, number], northEast: [number, number]) => unknown
      plugin: (name: string, callback: () => void) => void
    }>()
    class MockMap {
      addControl = vi.fn()
      destroy = vi.fn()
      resize = vi.fn()
      on = vi.fn()
      off = vi.fn()
      getZoom = vi.fn(() => 10)
      getCenter = vi.fn(() => ({ getLng: () => 121.5, getLat: () => 31.2 }))
      lnglatToPixel = vi.fn(() => ({ x: 0, y: 0 }))
      lngLatToContainer = vi.fn(() => ({ x: 0, y: 0 }))
      containerToLngLat = vi.fn((point: { x: number; y: number }) => ({
        getLng: () => (point.x === 0 ? 120 : 122),
        getLat: () => (point.y === 0 ? 32 : 30),
      }))
      setCenter = vi.fn()
      setZoomAndCenter = vi.fn()
      setBounds = vi.fn()
      setPitch = vi.fn()
      setRotation = vi.fn()
      setStatus = vi.fn()
      getPitch = vi.fn(() => 0)
      getRotation = vi.fn(() => 0)
    }

    vi.doMock('../services/amapLoader', () => ({
      loadAmap: vi.fn(() => loadAmapResult.promise),
    }))
    vi.doMock('../layers/footprintDataSource', () => ({
      loadFootprintSnapshot: vi.fn(async () => createDefaultSnapshot()),
    }))
    vi.doMock('../layers/massFootprintLayer', () => ({
      createMassFootprintLayer: vi.fn(() => ({
        destroy: vi.fn(),
        scheduleStyleUpdate: vi.fn(),
        update: vi.fn(),
      })),
    }))
    vi.doMock('../layers/adminRegionDataSource', () => ({
      loadAdminRegions: vi.fn(async () => loadedAdminRegions),
    }))
    vi.doMock('../layers/adminRegionLayer', () => ({
      createAdminRegionLayer: vi.fn(() => ({
        destroy: vi.fn(),
        update: vi.fn(),
      })),
    }))

    const { AmapCanvas } = await import('./AmapCanvas')
    const renderResult = render(
      <AmapCanvas config={configuredAmap} timeRange={selectPresetRange('all')} />,
    )
    const mapStage = renderResult.container.querySelector('.map-stage')
    const mapSurface = renderResult.container.querySelector('.amap-surface') as HTMLElement

    Object.defineProperty(mapSurface, 'clientWidth', {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(mapSurface, 'clientHeight', {
      configurable: true,
      value: 768,
    })

    expect(mapStage).toHaveClass('map-stage--loading')
    expect(mapStage).not.toHaveClass('map-stage--ready')

    await act(async () => {
      loadAmapResult.resolve({
        MassMarks: class MassMarks {},
        Pixel: class Pixel {},
        Size: class Size {},
        Map: MockMap,
        Scale: class Scale {},
        Geolocation: class Geolocation {
          getCurrentPosition = vi.fn()
        },
        Bounds: class Bounds {
          constructor(
            public southWest: [number, number],
            public northEast: [number, number],
          ) {}
        },
        plugin: (_name: string, callback: () => void) => callback(),
      })
    })

    await waitFor(() => expect(mapStage).toHaveClass('map-stage--ready'))
    expect(mapStage).not.toHaveClass('map-stage--loading')
  })

  it('starts the map camera on the first full-world coverage threshold', async () => {
    const { mapConstructorCalls } = await renderFootprintMassMarks({
      containerSize: { width: 1432, height: 815 },
    })

    expect(mapConstructorCalls[0]).toEqual(expect.objectContaining({
      center: [0, 0],
      zoom: 2.48,
      zooms: [2, 20],
    }))
  })

  it('requests a database sampled snapshot and updates the native MassMarks footprint layer', async () => {
    const representative = {
      id: 'selected-cell',
      longitude: 121.5000005,
      latitude: 31.2000005,
      count: 2,
      minAccuracy: 5,
      startTimestampSeconds: 1781798400,
      endTimestampSeconds: 1781884799,
    }
    const { createMassFootprintLayer, layerRecords, moveEndHandlers, snapshotRequests } =
      await renderFootprintMassMarks({
        snapshot: withDebug({
          points: [representative],
          metrics: {
            selectedCount: 2,
            totalDistanceMeters: 0,
            averageDistanceMetersPerDay: 0,
          },
          selectedBounds: {
            southWest: [121.5, 31.2],
            northEast: [121.500001, 31.200001],
          },
        }),
      })

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalledWith([representative]))

    expect(createMassFootprintLayer).toHaveBeenCalledWith(
      expect.objectContaining({ MassMarks: expect.any(Function) }),
      expect.any(Object),
      {
        color: '#123f35',
        opacity: 0.82,
        pixelSize: 1.5,
      },
    )
    expect(snapshotRequests[0]).toEqual(expect.objectContaining({
      cellSizePx: 0.5,
      timeRange: {
        startTimestampSeconds: 1646064000,
        endTimestampSeconds: Number.POSITIVE_INFINITY,
        dayCount: expect.any(Number),
      },
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      zoom: 10,
    }))
    expect(layerRecords[0].update.mock.calls[0]?.[0]).toHaveLength(1)
    expect(layerRecords[0].update.mock.calls[0]?.[0].map((point) => point.id)).toEqual([
      'selected-cell',
    ])

    layerRecords[0].update.mockClear()

    expect(moveEndHandlers).toHaveLength(1)
    expect(layerRecords[0].update).not.toHaveBeenCalled()
  })

  it('requests a new sampled snapshot by selected time range without rebuilding the layer', async () => {
    const selectedSnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [createAggregatedPoint('selected-cell', 2)],
      metrics: { selectedCount: 2, averageDistanceMetersPerDay: 2, totalDistanceMeters: 0 },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const allSnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [createAggregatedPoint('all-cell', 4)],
      metrics: { selectedCount: 4, averageDistanceMetersPerDay: 0, totalDistanceMeters: 0 },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const {
      createMassFootprintLayer,
      layerRecords,
      rerenderWithTimeRange,
      snapshotRequests,
    } = await renderFootprintMassMarks({
      timeRange: selectDay('2026-06-19'),
      snapshots: [selectedSnapshot, allSnapshot],
    })

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenLastCalledWith(selectedSnapshot.points))

    rerenderWithTimeRange(selectPresetRange('all'))

    await waitFor(() => {
      expect(layerRecords[0].update).toHaveBeenLastCalledWith(allSnapshot.points)
    })
    expect(snapshotRequests.at(-1)).toEqual(expect.objectContaining({
      timeRange: expect.objectContaining({
        startTimestampSeconds: 1646064000,
        endTimestampSeconds: Number.POSITIVE_INFINITY,
      }),
    }))
    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)
  })

  it('reports exact selected-count distance and daily-distance metrics for the shared time card', async () => {
    const onFootprintMetricsChange = vi.fn()
    const daySnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [createAggregatedPoint('selected-cell', 2)],
      metrics: {
        selectedCount: 2,
        averageDistanceMetersPerDay: 350.5,
        totalDistanceMeters: 350.5,
      },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const allSnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [createAggregatedPoint('all-cell', 3)],
      metrics: { selectedCount: 3, averageDistanceMetersPerDay: 0.86, totalDistanceMeters: 1349.5 },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const { rerenderWithTimeRange } = await renderFootprintMassMarks({
      onFootprintMetricsChange,
      timeRange: selectDay('2026-06-19'),
      snapshots: [daySnapshot, allSnapshot],
    })

    await waitFor(() => {
      expect(onFootprintMetricsChange).toHaveBeenLastCalledWith({
        selectedCount: 2,
        totalDistanceMeters: 350.5,
        averageDistanceMetersPerDay: 350.5,
      })
    })

    rerenderWithTimeRange(selectPresetRange('all'))

    await waitFor(() => {
      expect(onFootprintMetricsChange).toHaveBeenLastCalledWith({
        selectedCount: 3,
        totalDistanceMeters: 1349.5,
        averageDistanceMetersPerDay: 0.86,
      })
    })
  })

  it('hides current footprint rendering counts unless the debug panel is enabled', async () => {
    await renderFootprintMassMarks({
      snapshot: withDebug(
        {
          ...emptyRenderSnapshot,
          points: [createAggregatedPoint('debug-cell', 354)],
          metrics: {
            selectedCount: 40441,
            totalDistanceMeters: 0,
            averageDistanceMetersPerDay: 0,
          },
          selectedBounds: null,
        },
        {
          rawCount: 40441,
          renderedCount: 354,
          renderRatio: 0.00875,
        },
      ),
    })

    await waitFor(() => expect(screen.queryByLabelText('足迹渲染调试')).not.toBeInTheDocument())
  })

  it('shows current footprint rendering counts and ratio when the debug panel is enabled', async () => {
    await renderFootprintMassMarks({
      debugPanelVisible: true,
      snapshot: withDebug(
        {
          ...emptyRenderSnapshot,
          points: [createAggregatedPoint('debug-cell', 354)],
          metrics: {
            selectedCount: 40441,
            totalDistanceMeters: 0,
            averageDistanceMetersPerDay: 0,
          },
          selectedBounds: null,
        },
        {
          rawCount: 40441,
          renderedCount: 354,
          renderRatio: 0.00875,
        },
      ),
    })

    await waitFor(() => expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('0.9%'))
    expect(screen.getByText('渲染点数')).toBeInTheDocument()
    expect(screen.getByText('实际点数')).toBeInTheDocument()
    expect(screen.getByText('渲染比例')).toBeInTheDocument()
    expect(screen.getByText('354')).toBeInTheDocument()
    expect(screen.getByText('40,441')).toBeInTheDocument()
  })

  it('fits the map to currently displayed footprint bounds from the toolbar', async () => {
    const setBounds = vi.fn()
    await renderFootprintMassMarks({
      mapOverrides: { setBounds },
      timeRange: selectDay('2026-06-19'),
      snapshot: withDebug({
        points: [
          {
            id: 'sampled-center',
            longitude: 121.5,
            latitude: 32,
            count: 2,
            minAccuracy: 5,
            startTimestampSeconds: 1781798400,
            endTimestampSeconds: 1781884799,
          },
        ],
        metrics: { selectedCount: 2, averageDistanceMetersPerDay: 2, totalDistanceMeters: 0 },
        selectedBounds: {
          southWest: [120, 30],
          northEast: [123, 34],
        },
      }),
    })

    await waitFor(() => expect(setBounds).not.toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '聚焦当前足迹' }))

    expect(setBounds).toHaveBeenCalledWith(
      expect.objectContaining({
        southWest: [120, 30],
        northEast: [123, 34],
      }),
      false,
      [72, 72, 72, 72],
      900,
    )
  })

  it('restores the minimum world zoom from the toolbar', async () => {
    const setZoomAndCenter = vi.fn()
    await renderFootprintMassMarks({
      mapOverrides: {
        getZoom: () => 6,
        getCenter: () => ({ getLng: () => 120, getLat: () => 31 }),
        setZoomAndCenter,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '显示世界地图' }))

    expect(setZoomAndCenter).toHaveBeenCalledWith(
      expect.any(Number),
      expect.arrayContaining([expect.any(Number), expect.any(Number)]),
      false,
      900,
    )
  })

  it('keeps all longitudes eligible for footprint sampling after the world map camera settles', async () => {
    let isWorldView = false
    const setZoomAndCenter = vi.fn(() => {
      isWorldView = true
    })
    const worldSnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [
        createAggregatedPoint('1', 1, loadedPoints[0].longitude, loadedPoints[0].latitude),
        createAggregatedPoint('2', 1, loadedPoints[1].longitude, loadedPoints[1].latitude),
      ],
      metrics: { selectedCount: 2, averageDistanceMetersPerDay: 2, totalDistanceMeters: 0 },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const { layerRecords, snapshotRequests, zoomEndHandlers } = await renderFootprintMassMarks({
      mapOverrides: {
        getZoom: () => (isWorldView ? 2 : 6),
        lnglatToPixel: ([longitude]: [number, number], zoom: number) => ({
          x: longitude <= -180 ? 0 : 256 * 2 ** zoom,
          y: 0,
        }),
        containerToLngLat: (point: { x: number; y: number }) => ({
          getLng: () => (isWorldView ? -180 : point.x === 0 ? 120 : 122),
          getLat: () => (point.y === 0 ? 85.05112878 : -85.05112878),
        }),
        setZoomAndCenter,
      },
      snapshots: [createDefaultSnapshot(), worldSnapshot],
    })

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalled())
    layerRecords[0].update.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '显示世界地图' }))

    await act(async () => {
      for (const handler of zoomEndHandlers) handler()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(layerRecords[0].update).toHaveBeenCalled()
    })
    expect(snapshotRequests.at(-1)).toEqual(expect.objectContaining({
      viewportBounds: expect.objectContaining({
        west: -180,
        east: 180,
      }),
    }))
    expect(layerRecords[0].update).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ id: '2' }),
    ]))
  })

  it('keeps the current-location toolbar action wired to AMap Geolocation', async () => {
    const {
      amapPlugin,
      geolocationConstructor,
      geolocationGetCurrentPosition,
    } = await renderFootprintMassMarks()

    await waitFor(() => expect(geolocationConstructor).toHaveBeenCalledTimes(1))

    expect(amapPlugin).toHaveBeenCalledWith('AMap.Geolocation', expect.any(Function))
    expect(geolocationConstructor).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      timeout: 8000,
      zoomToAccuracy: true,
    })

    fireEvent.click(screen.getByRole('button', { name: '定位当前位置' }))

    expect(geolocationGetCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('does not refresh sampled footprints after AMap complete without a viewport change', async () => {
    const { completeHandlers, layerRecords } = await renderFootprintMassMarks()

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalled())
    layerRecords[0].update.mockClear()

    expect(completeHandlers).toHaveLength(0)
    expect(layerRecords[0].update).not.toHaveBeenCalled()
  })

  it('refreshes sampled footprint data after zoomend settles without rebuilding the layer', async () => {
    const setCenter = vi.fn()
    const setZoomAndCenter = vi.fn()
    const zoomSnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [createAggregatedPoint('zoomed-cell', 1)],
      metrics: { selectedCount: 2, averageDistanceMetersPerDay: 2, totalDistanceMeters: 0 },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const { createMassFootprintLayer, layerRecords, loadFootprintSnapshot, zoomEndHandlers } =
      await renderFootprintMassMarks({
        mapOverrides: {
          getZoom: () => 2,
          getCenter: () => ({ getLng: () => 104, getLat: () => 80 }),
          setCenter,
          setZoomAndCenter,
        },
        snapshots: [createDefaultSnapshot(), zoomSnapshot],
      })

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalled())
    layerRecords[0].update.mockClear()
    setCenter.mockClear()
    setZoomAndCenter.mockClear()

    vi.useFakeTimers()
    try {
      await act(async () => {
        expect(zoomEndHandlers).toHaveLength(2)
        zoomEndHandlers[1]()
        zoomEndHandlers[0]()
        await Promise.resolve()
        vi.advanceTimersByTime(720)
        await Promise.resolve()
      })
    } finally {
      vi.useRealTimers()
    }

    await waitFor(() => {
      expect(layerRecords[0].update).toHaveBeenLastCalledWith(zoomSnapshot.points)
    })
    expect(loadFootprintSnapshot).toHaveBeenCalledTimes(2)
    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)
    expect(setCenter.mock.calls.length + setZoomAndCenter.mock.calls.length).toBeGreaterThan(0)
  })

  it('keeps MassMarks data stable during map movement and refreshes only after moveend', async () => {
    const moveEndSnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [createAggregatedPoint('moved-cell', 1)],
      metrics: { selectedCount: 2, averageDistanceMetersPerDay: 2, totalDistanceMeters: 0 },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const {
      layerRecords,
      loadFootprintSnapshot,
      mapMoveHandlers,
      moveEndHandlers,
      zoomChangeHandlers,
    } = await renderFootprintMassMarks({
      snapshots: [createDefaultSnapshot(), moveEndSnapshot],
    })

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalled())
    layerRecords[0].update.mockClear()

    expect(mapMoveHandlers).toHaveLength(0)
    expect(zoomChangeHandlers).toHaveLength(0)
    expect(moveEndHandlers).toHaveLength(1)
    expect(layerRecords[0].update).not.toHaveBeenCalled()

    await act(async () => {
      moveEndHandlers[0]()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(layerRecords[0].update).toHaveBeenLastCalledWith(moveEndSnapshot.points)
    })
    expect(loadFootprintSnapshot).toHaveBeenCalledTimes(2)
  })

  it('resizes the map and refreshes sampled MassMarks data for the new viewport', async () => {
    const resize = vi.fn()
    const resizedSnapshot = withDebug({
      ...emptyRenderSnapshot,
      points: [createAggregatedPoint('resized-cell', 1)],
      metrics: { selectedCount: 2, averageDistanceMetersPerDay: 2, totalDistanceMeters: 0 },
      selectedBounds: {
        southWest: [121.5, 31.2],
        northEast: [121.500001, 31.200001],
      },
    })
    const { layerRecords, loadFootprintSnapshot } = await renderFootprintMassMarks({
      mapOverrides: { resize },
      snapshots: [createDefaultSnapshot(), resizedSnapshot],
    })

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalled())
    layerRecords[0].update.mockClear()
    resize.mockClear()

    window.dispatchEvent(new Event('resize'))

    await waitFor(() => expect(resize).toHaveBeenCalled())
    await waitFor(() => expect(layerRecords[0].update).toHaveBeenLastCalledWith(resizedSnapshot.points))
    expect(loadFootprintSnapshot).toHaveBeenCalledTimes(2)
  })

  it('recenters the locked world camera on the full-world center after resizing', async () => {
    const setZoomAndCenter = vi.fn()
    await renderFootprintMassMarks({
      containerSize: { width: 1432, height: 815 },
      mapOverrides: {
        getZoom: () => 6,
        getCenter: () => ({ getLng: () => 120, getLat: () => 31 }),
        setZoomAndCenter,
      },
    })

    await waitFor(() => expect(setZoomAndCenter).toHaveBeenCalled())
    setZoomAndCenter.mockClear()

    window.dispatchEvent(new Event('resize'))

    await waitFor(() => {
      expect(setZoomAndCenter).toHaveBeenCalledWith(2.48, [0, 0], true)
    })
  })

  it('destroys the native MassMarks footprint layer on unmount', async () => {
    const { layerRecords, renderResult } = await renderFootprintMassMarks()

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalled())

    renderResult.unmount()

    expect(layerRecords[0].destroy).toHaveBeenCalledTimes(1)
  })

  it('schedules native footprint style updates without rebuilding the layer during toolbar edits', async () => {
    const { createMassFootprintLayer, layerRecords } = await renderFootprintMassMarks()

    await waitFor(() => expect(layerRecords[0].update).toHaveBeenCalled())
    await waitFor(() => expect(createMassFootprintLayer).toHaveBeenCalledTimes(1))
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))
    const sizeInput = screen.getByLabelText('足迹点大小')
    const opacityInput = screen.getByLabelText('足迹点透明度')
    const colorInput = screen.getByLabelText('足迹点颜色')

    fireEvent.change(sizeInput, {
      target: { value: '2.4' },
    })
    fireEvent.change(opacityInput, {
      target: { value: '0.64' },
    })
    fireEvent.change(colorInput, {
      target: { value: '#4f7cff' },
    })

    expect(sizeInput).toHaveValue('2.4')
    expect(opacityInput).toHaveValue('0.64')
    expect(colorInput).toHaveValue('#4f7cff')
    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(179)
      await Promise.resolve()
    })

    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })

    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)

    expect(layerRecords[0].destroy).not.toHaveBeenCalled()
    expect(layerRecords[0].scheduleStyleUpdate).toHaveBeenCalledWith({
      color: '#4f7cff',
      opacity: 0.64,
      pixelSize: 2.4,
    })
    expect(layerRecords[0].update).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ id: '2' }),
    ]))
  })

  it('skips native footprint layer recreation for equivalent style commits', async () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
    const { createMassFootprintLayer } = await renderFootprintMassMarks()

    await waitFor(() => expect(createMassFootprintLayer).toHaveBeenCalledTimes(1))
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))
    fireEvent.click(screen.getByRole('button', { name: '选择足迹点颜色 #123f35' }))

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })

    expect(setItemSpy).not.toHaveBeenCalled()
    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)
  })

  it('restores valid stored footprint style settings before creating the native layer', async () => {
    window.localStorage.setItem(
      'enroute.footprintStyle',
      JSON.stringify({ color: '#4f7cff', opacity: 0.66, pixelSize: 2.7 }),
    )
    const { createMassFootprintLayer } = await renderFootprintMassMarks()

    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)
    expect(createMassFootprintLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ MassMarks: expect.any(Function) }),
      expect.any(Object),
      {
        color: '#4f7cff',
        opacity: 0.66,
        pixelSize: 2.7,
      },
    )
  })

  it('loads city administrative regions by default after the region mode is enabled', async () => {
    const {
      adminRegionLayerRecords,
      createAdminRegionLayer,
      loadAdminRegions,
      rerenderWithAdminRegionUnlockEnabled,
    } = await renderFootprintMassMarks()

    expect(loadAdminRegions).not.toHaveBeenCalled()
    expect(createAdminRegionLayer).not.toHaveBeenCalled()

    rerenderWithAdminRegionUnlockEnabled(true)

    await waitFor(() => {
      expect(loadAdminRegions).toHaveBeenCalledWith(undefined, {
        level: 3,
        zoom: 10,
        viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      }, expect.any(AbortSignal))
    })
    await waitFor(() => {
      expect(adminRegionLayerRecords[0].update).toHaveBeenCalledWith(loadedAdminRegions)
    })
    expect(createAdminRegionLayer).toHaveBeenCalledTimes(1)
  })

  it('removes footprint points and stops footprint refreshes while region mode is enabled', async () => {
    const {
      layerRecords,
      adminRegionRequests,
      loadAdminRegions,
      loadFootprintSnapshot,
      moveEndHandlers,
      zoomEndHandlers,
      rerenderWithAdminRegionUnlockEnabled,
    } = await renderFootprintMassMarks()

    await waitFor(() => expect(loadFootprintSnapshot).toHaveBeenCalledTimes(1))
    const footprintLayer = layerRecords[0]

    rerenderWithAdminRegionUnlockEnabled(true)

    await waitFor(() => {
      expect(loadAdminRegions).toHaveBeenCalledWith(undefined, {
        level: 3,
        zoom: 10,
        viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      }, expect.any(AbortSignal))
    })
    await waitFor(() => {
      expect(footprintLayer.destroy).toHaveBeenCalledTimes(1)
    })

    const footprintRequestCount = loadFootprintSnapshot.mock.calls.length
    act(() => {
      moveEndHandlers[0]?.()
    })

    expect(loadFootprintSnapshot).toHaveBeenCalledTimes(footprintRequestCount)
    await waitFor(() => expect(adminRegionRequests.length).toBeGreaterThanOrEqual(2))

    act(() => {
      zoomEndHandlers.at(-1)?.()
    })

    await waitFor(() => expect(adminRegionRequests.length).toBeGreaterThanOrEqual(3))
  })

  it('keeps district selection at city detail until the viewport is zoomed in enough', async () => {
    const {
      adminRegionRequests,
      loadAdminRegions,
      rerenderWithAdminRegionUnlockEnabled,
    } = await renderFootprintMassMarks({
      mapOverrides: {
        containerToLngLat: (point: { x: number; y: number }) => ({
          getLng: () => (point.x === 0 ? 70 : 140),
          getLat: () => (point.y === 0 ? 60 : 0),
        }),
        getZoom: () => 4,
      },
    })

    rerenderWithAdminRegionUnlockEnabled(true)
    await waitFor(() => expect(loadAdminRegions).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '区县' }))

    await waitFor(() => expect(adminRegionRequests.length).toBeGreaterThanOrEqual(2))
    expect(adminRegionRequests.at(-1)).toMatchObject({
      level: 3,
      zoom: 4,
      viewportBounds: { west: 70, south: 0, east: 140, north: 60 },
    })
    expect(screen.getByRole('button', { name: '区县' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('loads district administrative regions after the selected viewport is detailed enough', async () => {
    const {
      adminRegionRequests,
      loadAdminRegions,
      rerenderWithAdminRegionUnlockEnabled,
    } = await renderFootprintMassMarks({
      mapOverrides: {
        containerToLngLat: (point: { x: number; y: number }) => ({
          getLng: () => (point.x === 0 ? 120 : 122),
          getLat: () => (point.y === 0 ? 32 : 30),
        }),
        getZoom: () => 8,
      },
    })

    rerenderWithAdminRegionUnlockEnabled(true)
    await waitFor(() => expect(loadAdminRegions).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '区县' }))

    await waitFor(() => expect(adminRegionRequests.length).toBeGreaterThanOrEqual(2))
    expect(adminRegionRequests.at(-1)).toMatchObject({
      level: 4,
      zoom: 8,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
    })
  })

  it('schedules pending footprint style changes onto the existing native layer', async () => {
    const { layerRecords } = await renderFootprintMassMarks()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))
    fireEvent.change(screen.getByLabelText('足迹点大小'), {
      target: { value: '2.2' },
    })

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })

    expect(layerRecords[0].scheduleStyleUpdate).toHaveBeenCalledWith({
      color: '#123f35',
      opacity: 0.82,
      pixelSize: 2.2,
    })
  })

  it('normalizes invalid stored footprint style settings before creating the native layer', async () => {
    window.localStorage.setItem(
      'enroute.footprintStyle',
      JSON.stringify({ color: 'javascript:alert(1)', opacity: 0.1, pixelSize: 9 }),
    )
    const { createMassFootprintLayer } = await renderFootprintMassMarks()

    expect(createMassFootprintLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ MassMarks: expect.any(Function) }),
      expect.any(Object),
      {
        color: '#123f35',
        opacity: 0.3,
        pixelSize: 3.5,
      },
    )
  })
})

function createDefaultSnapshot() {
  return withDebug({
    ...emptyRenderSnapshot,
    points: [
      createAggregatedPoint('1', 1, loadedPoints[0].longitude, loadedPoints[0].latitude),
      createAggregatedPoint('2', 1, loadedPoints[1].longitude, loadedPoints[1].latitude),
    ],
    metrics: {
      selectedCount: loadedPoints.length,
      totalDistanceMeters: 0,
      averageDistanceMetersPerDay: 0,
    },
    selectedBounds: {
      southWest: [loadedPoints[0].longitude, loadedPoints[0].latitude],
      northEast: [loadedPoints[1].longitude, loadedPoints[1].latitude],
    },
  })
}

function createAggregatedPoint(
  id: string,
  count: number,
  longitude = 121.5,
  latitude = 31.2,
) {
  return {
    id,
    longitude,
    latitude,
    count,
    minAccuracy: 5,
    startTimestampSeconds: 1781798400,
    endTimestampSeconds: 1781884799,
  }
}

function withDebug(
  snapshot: FootprintRenderSnapshot,
  debug?: Partial<FootprintSnapshot['debug']>,
): FootprintSnapshot {
  const rawCount = debug?.rawCount ?? snapshot.metrics.selectedCount
  const renderedCount = debug?.renderedCount ?? snapshot.points.length

  return {
    ...snapshot,
    debug: {
      rawCount,
      renderedCount,
      renderRatio: debug?.renderRatio ?? (rawCount === 0 ? 0 : renderedCount / rawCount),
    },
  }
}

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
