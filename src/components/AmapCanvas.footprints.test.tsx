import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
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
    id: 'bucket',
    longitude: 121.5,
    latitude: 31.2,
    count: 1,
    minAccuracy: 5,
    startTimestampSeconds: 1,
    endTimestampSeconds: 1,
  },
]

const newerAggregatedPoints: AggregatedFootprintPoint[] = [
  {
    id: 'newer-bucket',
    longitude: 122.5,
    latitude: 32.2,
    count: 2,
    minAccuracy: 4,
    startTimestampSeconds: 2,
    endTimestampSeconds: 3,
  },
]

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

async function renderFootprintCanvas({
  aggregate = vi.fn(async () => aggregatedPoints),
  containerSize = { width: 1024, height: 768 },
  dispose = vi.fn(),
  loadFootprintsPromise,
  mapZoom = 10,
  containerToLngLat = ({ x, y }: { x: number; y: number }) => ({
    getLng: () => 121 + x / 1000,
    getLat: () => 31 - y / 1000,
  }),
}: {
  aggregate?: (input: unknown) => Promise<AggregatedFootprintPoint[]>
  containerSize?: { width: number; height: number }
  dispose?: () => void
  loadFootprintsPromise: Promise<FootprintPoint[]>
  mapZoom?: number
  containerToLngLat?: (point: { x: number; y: number }) => { getLng: () => number; getLat: () => number }
}) {
  const moveEndHandlers: Array<() => void> = []
  const zoomEndHandlers: Array<() => void> = []
  const update = vi.fn()

  class MockFootprintWorkerClient {
    aggregate = aggregate
    dispose = dispose
  }

  class MockMap {
    addControl = vi.fn()
    destroy = vi.fn()
    resize = vi.fn()
    on = vi.fn((eventName: string, callback: () => void) => {
      if (eventName === 'moveend') moveEndHandlers.push(callback)
      if (eventName === 'zoomend') zoomEndHandlers.push(callback)
    })
    off = vi.fn()
    getZoom = vi.fn(() => mapZoom)
    getCenter = vi.fn(() => ({ getLng: () => 121.5, getLat: () => 31.2 }))
    lnglatToPixel = vi.fn(() => ({ x: 0, y: 0 }))
    lngLatToContainer = vi.fn(() => ({ x: 0, y: 0 }))
    containerToLngLat = vi.fn(containerToLngLat)
    setCenter = vi.fn()
    setZoomAndCenter = vi.fn()
    setPitch = vi.fn()
    setRotation = vi.fn()
    setStatus = vi.fn()
    getPitch = vi.fn(() => 0)
    getRotation = vi.fn(() => 0)
  }

  window.Loca = {} as typeof Loca

  vi.doMock('../layers/footprintDataSource', () => ({
    loadFootprintPoints: vi.fn(() => loadFootprintsPromise),
  }))
  vi.doMock('../layers/footprintWorkerClient', () => ({
    FootprintWorkerClient: MockFootprintWorkerClient,
  }))
  vi.doMock('../layers/locaFootprintLayer', () => ({
    createLocaFootprintLayer: vi.fn(() => ({
      update,
      destroy: vi.fn(),
    })),
  }))
  vi.doMock('../services/amapLoader', () => ({
    loadAmap: vi.fn(async () => ({
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

  await waitFor(() => expect(moveEndHandlers).toHaveLength(1), { timeout: 1000 })
  await waitFor(() => expect(aggregate).not.toHaveBeenCalled())

  return {
    aggregate,
    moveEndHandlers,
    renderResult,
    update,
    zoomEndHandlers,
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  delete window.Loca
})

describe('AmapCanvas footprint layer wiring', () => {
  it('updates footprint points after a map settle event', async () => {
    const aggregate = vi.fn(async () => aggregatedPoints)
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { moveEndHandlers, update } = await renderFootprintCanvas({
      aggregate,
      loadFootprintsPromise: loadFootprints.promise,
    })

    vi.useFakeTimers()
    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    moveEndHandlers[0]()
    await vi.advanceTimersByTimeAsync(159)

    expect(update).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()

    expect(aggregate).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(aggregatedPoints)
    expect(aggregate).toHaveBeenCalledWith({
      points: loadedPoints,
      zoom: 10,
      cellSizePx: 1,
      viewportBounds: expect.objectContaining({
        east: expect.any(Number),
        north: expect.any(Number),
        south: expect.any(Number),
        west: expect.any(Number),
      }),
    })
  })

  it('requests a full-world longitude viewport when the padded map spans one wrapped world', async () => {
    const aggregate = vi.fn(async () => aggregatedPoints)
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { moveEndHandlers } = await renderFootprintCanvas({
      aggregate,
      containerSize: { width: 1024, height: 768 },
      containerToLngLat: ({ y }) => ({
        getLng: () => -75.804603,
        getLat: () => (y < 0 ? 84.453846 : -68.986288),
      }),
      loadFootprintsPromise: loadFootprints.promise,
      mapZoom: 2,
    })

    vi.useFakeTimers()
    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    moveEndHandlers[0]()
    await vi.advanceTimersByTimeAsync(160)

    expect(aggregate).toHaveBeenCalledWith({
      points: loadedPoints,
      zoom: 2,
      cellSizePx: 1,
      viewportBounds: expect.objectContaining({
        east: 180,
        west: -180,
      }),
    })
  })

  it('does not update with an older aggregation after a newer settle event is scheduled', async () => {
    const aggregateDeferreds: Array<Deferred<AggregatedFootprintPoint[]>> = []
    const aggregate = vi.fn(() => {
      const deferred = createDeferred<AggregatedFootprintPoint[]>()
      aggregateDeferreds.push(deferred)
      return deferred.promise
    })
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { moveEndHandlers, update } = await renderFootprintCanvas({
      aggregate,
      loadFootprintsPromise: loadFootprints.promise,
    })

    vi.useFakeTimers()
    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    moveEndHandlers[0]()
    await vi.advanceTimersByTimeAsync(160)

    expect(aggregate).toHaveBeenCalledTimes(1)

    moveEndHandlers[0]()
    await act(async () => {
      aggregateDeferreds[0].resolve(aggregatedPoints)
      await Promise.resolve()
    })

    expect(update).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(160)

    expect(aggregate).toHaveBeenCalledTimes(2)

    await act(async () => {
      aggregateDeferreds[1].resolve(newerAggregatedPoints)
      await Promise.resolve()
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(newerAggregatedPoints)
  })

  it('does not warn when unmounted while footprint aggregation is pending', async () => {
    const aggregateDeferred = createDeferred<AggregatedFootprintPoint[]>()
    const aggregate = vi.fn(() => aggregateDeferred.promise)
    const dispose = vi.fn(() => {
      aggregateDeferred.reject(new Error('Footprint aggregation worker disposed'))
    })
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { moveEndHandlers, renderResult } = await renderFootprintCanvas({
      aggregate,
      dispose,
      loadFootprintsPromise: loadFootprints.promise,
    })

    vi.useFakeTimers()
    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    moveEndHandlers[0]()
    await vi.advanceTimersByTimeAsync(160)

    expect(aggregate).toHaveBeenCalledTimes(1)

    renderResult.unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(dispose).toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })
})
