import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AmapConfig } from '../config/amap'
import type { AggregatedFootprintPoint, FootprintPoint } from '../layers/footprintTypes'

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
    timestampSeconds: 1,
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
]

const aggregatedPoints: AggregatedFootprintPoint[] = [
  {
    id: 'bucket-1',
    longitude: 121.5,
    latitude: 31.2,
    count: 1,
    minAccuracy: 5,
    startTimestampSeconds: 1,
    endTimestampSeconds: 1,
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
  aggregateResult = aggregatedPoints,
  aggregateImplementation,
}: {
  containerSize?: { width: number; height: number }
  loadFootprintsPromise: Promise<FootprintPoint[]>
  mapOverrides?: Partial<MockMap>
  aggregateResult?: AggregatedFootprintPoint[]
  aggregateImplementation?: () => Promise<AggregatedFootprintPoint[]>
}) {
  const mapMoveHandlers: Array<() => void> = []
  const moveEndHandlers: Array<() => void> = []
  const zoomChangeHandlers: Array<() => void> = []
  const zoomEndHandlers: Array<() => void> = []
  const completeHandlers: Array<() => void> = []
  const layerRecords: Array<{
    destroy: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }> = []
  const createMassFootprintLayer = vi.fn(() => {
    const layer = {
      destroy: vi.fn(),
      update: vi.fn(),
    }
    layerRecords.push(layer)

    return layer
  })
  const aggregateFootprints = vi.fn(aggregateImplementation ?? (async () => aggregateResult))
  const setWorkerPoints = vi.fn()
  const disposeFootprintWorker = vi.fn()

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
  vi.doMock('../layers/footprintWorkerClient', () => ({
    FootprintWorkerClient: vi.fn(function FootprintWorkerClient() {
      return {
        aggregate: aggregateFootprints,
        setPoints: setWorkerPoints,
        dispose: disposeFootprintWorker,
      }
    }),
  }))
  vi.doMock('../services/amapLoader', () => ({
    loadAmap: vi.fn(async () => ({
      MassMarks: class MassMarks {},
      Pixel: class Pixel {},
      Size: class Size {},
      Map: MockMap,
      Scale: class Scale {},
      Geolocation: class Geolocation {},
      Bounds: class Bounds {},
      plugin: vi.fn((_name: string, callback: () => void) => callback()),
    })),
  }))

  const { AmapCanvas } = await import('./AmapCanvas')
  const renderResult = render(<AmapCanvas config={configuredAmap} />)
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
    aggregateFootprints,
    createMassFootprintLayer,
    completeHandlers,
    disposeFootprintWorker,
    layerRecords,
    mapMoveHandlers,
    moveEndHandlers,
    renderResult,
    setWorkerPoints,
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
  it('updates the native MassMarks footprint layer with aggregated viewport representatives after data loads', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { aggregateFootprints, createMassFootprintLayer, layerRecords, moveEndHandlers, setWorkerPoints } = await renderFootprintMassMarks({
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
        pixelSize: 1.5,
      },
    )
    await waitFor(() => expect(aggregateFootprints).toHaveBeenCalledWith(
      expect.objectContaining({
        zoom: 10,
        cellSizePx: 1,
        viewportBounds: {
          west: 120,
          south: 30,
          east: 122,
          north: 32,
        },
        viewportNorthWestWorldPixel: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      }),
    ))
    expect(setWorkerPoints).toHaveBeenCalledWith(loadedPoints)
    expect(layerRecords[0].update).toHaveBeenCalledWith(aggregatedPoints)

    layerRecords[0].update.mockClear()

    expect(moveEndHandlers).toHaveLength(1)
    expect(layerRecords[0].update).not.toHaveBeenCalled()
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

  it('re-aggregates footprints after zoomend while MassMarks keeps following zoom natively', async () => {
    const setCenter = vi.fn()
    const setZoomAndCenter = vi.fn()
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { aggregateFootprints, layerRecords, zoomEndHandlers } = await renderFootprintMassMarks({
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
    await waitFor(() => expect(aggregateFootprints).toHaveBeenCalledTimes(1))
    layerRecords[0].update.mockClear()
    aggregateFootprints.mockClear()
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

    expect(aggregateFootprints).toHaveBeenCalledTimes(2)
    expect(layerRecords[0].update).toHaveBeenCalledWith(aggregatedPoints)
    expect(setCenter.mock.calls.length + setZoomAndCenter.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('re-aggregates footprints during map move and zoom changes instead of waiting for interaction end', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { aggregateFootprints, layerRecords, mapMoveHandlers, zoomChangeHandlers } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    await waitFor(() => expect(aggregateFootprints).toHaveBeenCalledTimes(1))
    layerRecords[0].update.mockClear()
    aggregateFootprints.mockClear()

    expect(mapMoveHandlers).toHaveLength(1)
    expect(zoomChangeHandlers).toHaveLength(1)

    await act(async () => {
      mapMoveHandlers[0]()
      zoomChangeHandlers[0]()
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    expect(aggregateFootprints).toHaveBeenCalledTimes(1)
    expect(layerRecords[0].update).toHaveBeenCalledWith(aggregatedPoints)
  })

  it('re-aggregates footprints after a window resize because the viewport changed', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const resize = vi.fn()
    const { aggregateFootprints, layerRecords } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
      mapOverrides: { resize },
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    await waitFor(() => expect(aggregateFootprints).toHaveBeenCalledTimes(1))
    layerRecords[0].update.mockClear()
    aggregateFootprints.mockClear()

    window.dispatchEvent(new Event('resize'))

    await waitFor(() => expect(resize).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(aggregateFootprints).toHaveBeenCalledTimes(1))
    expect(resize.mock.invocationCallOrder[0]).toBeLessThan(
      aggregateFootprints.mock.invocationCallOrder[0],
    )
    expect(layerRecords[0].update).toHaveBeenCalledWith(aggregatedPoints)
  })

  it('ignores stale aggregation results when a newer viewport request finishes first', async () => {
    const firstAggregation = createDeferred<AggregatedFootprintPoint[]>()
    const secondAggregation = createDeferred<AggregatedFootprintPoint[]>()
    const latestPoints: AggregatedFootprintPoint[] = [
      {
        ...aggregatedPoints[0],
        id: 'latest-bucket',
        longitude: 122,
      },
    ]
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { layerRecords, moveEndHandlers } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
      aggregateImplementation: vi
        .fn()
        .mockReturnValueOnce(firstAggregation.promise)
        .mockReturnValueOnce(secondAggregation.promise),
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    expect(moveEndHandlers).toHaveLength(1)

    await act(async () => {
      moveEndHandlers[0]()
      await Promise.resolve()
    })

    await act(async () => {
      secondAggregation.resolve(latestPoints)
      await Promise.resolve()
    })

    expect(layerRecords[0].update).toHaveBeenLastCalledWith(latestPoints)

    await act(async () => {
      firstAggregation.resolve(aggregatedPoints)
      await Promise.resolve()
    })

    expect(layerRecords[0].update).toHaveBeenLastCalledWith(latestPoints)
  })

  it('destroys the native MassMarks footprint layer on unmount', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { disposeFootprintWorker, layerRecords, renderResult } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    renderResult.unmount()

    expect(layerRecords[0].destroy).toHaveBeenCalledTimes(1)
    expect(disposeFootprintWorker).toHaveBeenCalledTimes(1)
  })

  it('recreates the native footprint layer with loaded points when toolbar style settings change', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer, layerRecords } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))
    fireEvent.change(screen.getByLabelText('足迹点大小'), {
      target: { value: '2.4' },
    })
    fireEvent.change(screen.getByLabelText('足迹点颜色'), {
      target: { value: '#4f7cff' },
    })

    await waitFor(() => expect(createMassFootprintLayer).toHaveBeenCalledTimes(3))

    expect(layerRecords[0].destroy).toHaveBeenCalled()
    expect(layerRecords[1].destroy).toHaveBeenCalled()
    expect(createMassFootprintLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ MassMarks: expect.any(Function) }),
      expect.any(Object),
      {
        color: '#4f7cff',
        pixelSize: 2.4,
      },
    )
    expect(layerRecords[2].update).toHaveBeenCalledWith(aggregatedPoints)
  })

  it('restores valid stored footprint style settings before creating the native layer', async () => {
    window.localStorage.setItem(
      'enroute.footprintStyle',
      JSON.stringify({ color: '#4f7cff', pixelSize: 2.7 }),
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
        pixelSize: 2.7,
      },
    )
  })

  it('normalizes invalid stored footprint style settings before creating the native layer', async () => {
    window.localStorage.setItem(
      'enroute.footprintStyle',
      JSON.stringify({ color: 'javascript:alert(1)', pixelSize: 9 }),
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
