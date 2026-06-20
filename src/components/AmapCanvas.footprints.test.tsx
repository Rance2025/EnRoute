import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AmapConfig } from '../config/amap'
import type { FootprintPoint } from '../layers/footprintTypes'
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

const localStorageMock = createLocalStorageMock()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

async function renderFootprintMassMarks({
  containerSize = { width: 1024, height: 768 },
  loadFootprintsPromise,
  mapOverrides,
  onFootprintMetricsChange = vi.fn(),
  timeRange = selectPresetRange('all'),
}: {
  containerSize?: { width: number; height: number }
  loadFootprintsPromise: Promise<FootprintPoint[]>
  mapOverrides?: Partial<MockMap>
  onFootprintMetricsChange?: (metrics: {
    displayedCount: number
    totalCount: number
    activeDayCount: number
  }) => void
  timeRange?: TimeRangeSelection
}) {
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
  const geolocationGetCurrentPosition = vi.fn()
  const geolocationConstructor = vi.fn(function Geolocation(this: {
    getCurrentPosition: typeof geolocationGetCurrentPosition
  }) {
    this.getCurrentPosition = geolocationGetCurrentPosition
  })
  const createMassFootprintLayer = vi.fn(() => {
    const layer = {
      destroy: vi.fn(),
      scheduleStyleUpdate: vi.fn(),
      update: vi.fn(),
    }
    layerRecords.push(layer)

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

    constructor() {
      Object.assign(this, mapOverrides)
    }
  }

  vi.doMock('../layers/footprintDataSource', () => ({
    loadFootprintPoints: vi.fn(() => loadFootprintsPromise),
  }))
  vi.doMock('../layers/massFootprintLayer', () => ({
    createMassFootprintLayer,
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
      plugin: vi.fn((_name: string, callback: () => void) => callback()),
    })),
  }))

  const { AmapCanvas } = await import('./AmapCanvas')
  const renderResult = render(
    <AmapCanvas
      config={configuredAmap}
      timeRange={timeRange}
      onFootprintMetricsChange={onFootprintMetricsChange}
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
    createMassFootprintLayer,
    completeHandlers,
    geolocationConstructor,
    geolocationGetCurrentPosition,
    layerRecords,
    mapMoveHandlers,
    moveEndHandlers,
    renderResult,
    rerenderWithTimeRange(nextTimeRange: TimeRangeSelection) {
      renderResult.rerender(
        <AmapCanvas
          config={configuredAmap}
          timeRange={nextTimeRange}
          onFootprintMetricsChange={onFootprintMetricsChange}
        />,
      )
    },
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
  it('updates the native MassMarks footprint layer with every raw footprint point after data loads', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer, layerRecords, moveEndHandlers } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    expect(createMassFootprintLayer).toHaveBeenCalledWith(
      expect.objectContaining({ MassMarks: expect.any(Function) }),
      expect.any(Object),
      {
        color: '#123f35',
        opacity: 0.82,
        pixelSize: 1.5,
      },
    )
    expect(layerRecords[0].update).toHaveBeenCalledWith(loadedPoints)
    expect(layerRecords[0].update.mock.calls[0]?.[0]).toHaveLength(2)
    expect(layerRecords[0].update.mock.calls[0]?.[0].map((point) => point.id)).toEqual(['1', '2'])

    layerRecords[0].update.mockClear()

    expect(moveEndHandlers).toHaveLength(0)
    expect(layerRecords[0].update).not.toHaveBeenCalled()
  })

  it('filters native MassMarks footprint data by the selected time range without rebuilding the layer', async () => {
    const timedPoints: FootprintPoint[] = [
      { ...loadedPoints[0], id: 'before', timestampSeconds: 1781798399 },
      { ...loadedPoints[0], id: 'selected-a', timestampSeconds: 1781798400 },
      { ...loadedPoints[1], id: 'selected-b', timestampSeconds: 1781884799 },
      { ...loadedPoints[1], id: 'after', timestampSeconds: 1781884800 },
    ]
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer, layerRecords, rerenderWithTimeRange } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
      timeRange: selectDay('2026-06-19'),
    })

    await act(async () => {
      loadFootprints.resolve(timedPoints)
      await Promise.resolve()
    })

    expect(layerRecords[0].update).toHaveBeenLastCalledWith([
      timedPoints[1],
      timedPoints[2],
    ])

    rerenderWithTimeRange(selectPresetRange('all'))

    await waitFor(() => {
      expect(layerRecords[0].update).toHaveBeenLastCalledWith(timedPoints)
    })
    expect(createMassFootprintLayer).toHaveBeenCalledTimes(1)
  })

  it('reports total displayed and active-day footprint metrics for the shared time card', async () => {
    const timedPoints: FootprintPoint[] = [
      { ...loadedPoints[0], id: 'selected-a', timestampSeconds: 1781798400 },
      { ...loadedPoints[1], id: 'selected-b', timestampSeconds: 1781884799 },
      { ...loadedPoints[1], id: 'after', timestampSeconds: 1781884800 },
    ]
    const onFootprintMetricsChange = vi.fn()
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { rerenderWithTimeRange } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
      onFootprintMetricsChange,
      timeRange: selectDay('2026-06-19'),
    })

    await act(async () => {
      loadFootprints.resolve(timedPoints)
      await Promise.resolve()
    })

    expect(onFootprintMetricsChange).toHaveBeenLastCalledWith({
      displayedCount: 2,
      totalCount: 3,
      activeDayCount: 1,
    })

    rerenderWithTimeRange(selectPresetRange('all'))

    await waitFor(() => {
      expect(onFootprintMetricsChange).toHaveBeenLastCalledWith({
        displayedCount: 3,
        totalCount: 3,
        activeDayCount: 2,
      })
    })
  })

  it('fits the map to currently displayed footprint bounds from the toolbar', async () => {
    const timedPoints: FootprintPoint[] = [
      { ...loadedPoints[0], id: 'selected-west', timestampSeconds: 1781798400, longitude: 120, latitude: 30 },
      { ...loadedPoints[1], id: 'selected-east', timestampSeconds: 1781884799, longitude: 123, latitude: 34 },
      { ...loadedPoints[1], id: 'filtered-out', timestampSeconds: 1781884800, longitude: 130, latitude: 40 },
    ]
    const setBounds = vi.fn()
    const loadFootprints = createDeferred<FootprintPoint[]>()
    await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
      mapOverrides: { setBounds },
      timeRange: selectDay('2026-06-19'),
    })

    await act(async () => {
      loadFootprints.resolve(timedPoints)
      await Promise.resolve()
    })

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
    const loadFootprints = createDeferred<FootprintPoint[]>()
    await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
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

  it('keeps the current-location toolbar action wired to AMap Geolocation', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { geolocationConstructor, geolocationGetCurrentPosition } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await waitFor(() => expect(geolocationConstructor).toHaveBeenCalledTimes(1))

    expect(geolocationConstructor).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      timeout: 8000,
      zoomToAccuracy: true,
      position: {
        right: '24px',
        bottom: '136px',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '定位当前位置' }))

    expect(geolocationGetCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('does not reproject footprints after AMap complete because MassMarks follows map motion natively', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { completeHandlers, layerRecords } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    layerRecords[0].update.mockClear()

    expect(completeHandlers).toHaveLength(0)
    expect(layerRecords[0].update).not.toHaveBeenCalled()
  })

  it('does not rebuild footprint data after zoomend because MassMarks follows zoom natively', async () => {
    const setCenter = vi.fn()
    const setZoomAndCenter = vi.fn()
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { layerRecords, zoomEndHandlers } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
      mapOverrides: {
        getZoom: () => 2,
        getCenter: () => ({ getLng: () => 104, getLat: () => 80 }),
        setCenter,
        setZoomAndCenter,
      },
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    layerRecords[0].update.mockClear()
    setCenter.mockClear()
    setZoomAndCenter.mockClear()

    vi.useFakeTimers()
    try {
      await act(async () => {
        zoomEndHandlers[0]()
        zoomEndHandlers[0]()
        await Promise.resolve()
        vi.advanceTimersByTime(720)
        await Promise.resolve()
      })
    } finally {
      vi.useRealTimers()
    }

    expect(layerRecords[0].update).not.toHaveBeenCalled()
    expect(setCenter.mock.calls.length + setZoomAndCenter.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('keeps MassMarks data stable during map move and zoom interactions', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { layerRecords, mapMoveHandlers, moveEndHandlers, zoomChangeHandlers } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    layerRecords[0].update.mockClear()

    expect(mapMoveHandlers).toHaveLength(0)
    expect(zoomChangeHandlers).toHaveLength(0)
    expect(moveEndHandlers).toHaveLength(0)
    expect(layerRecords[0].update).not.toHaveBeenCalled()
  })

  it('resizes the map without refreshing raw MassMarks footprint data', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const resize = vi.fn()
    const { layerRecords } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
      mapOverrides: { resize },
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    layerRecords[0].update.mockClear()

    window.dispatchEvent(new Event('resize'))

    await waitFor(() => expect(resize).toHaveBeenCalledTimes(1))
    expect(layerRecords[0].update).not.toHaveBeenCalled()
  })

  it('destroys the native MassMarks footprint layer on unmount', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { layerRecords, renderResult } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    renderResult.unmount()

    expect(layerRecords[0].destroy).toHaveBeenCalledTimes(1)
  })

  it('schedules native footprint style updates without rebuilding the layer during toolbar edits', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer, layerRecords } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
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
    expect(layerRecords[0].update).toHaveBeenCalledWith(loadedPoints)
  })

  it('skips native footprint layer recreation for equivalent style commits', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
    const { createMassFootprintLayer } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
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
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

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

  it('schedules pending footprint style changes onto the existing native layer', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { layerRecords } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })
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
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

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
