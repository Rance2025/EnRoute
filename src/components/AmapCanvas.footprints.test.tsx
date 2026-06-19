import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AmapConfig } from '../config/amap'
import type { FootprintPoint } from '../layers/footprintTypes'

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
  containerSize = { width: 1024, height: 768 },
  destroy = vi.fn(),
  loadFootprintsPromise,
}: {
  containerSize?: { width: number; height: number }
  destroy?: () => void
  loadFootprintsPromise: Promise<FootprintPoint[]>
}) {
  const mapMoveHandlers: Array<() => void> = []
  const zoomChangeHandlers: Array<() => void> = []
  const moveEndHandlers: Array<() => void> = []
  const zoomEndHandlers: Array<() => void> = []
  const completeHandlers: Array<() => void> = []
  const update = vi.fn()
  const createCanvasFootprintLayer = vi.fn(() => ({ update, destroy }))

  class MockMap {
    addControl = vi.fn()
    destroy = vi.fn()
    resize = vi.fn()
    on = vi.fn((eventName: string, callback: () => void) => {
      if (eventName === 'mapmove') mapMoveHandlers.push(callback)
      if (eventName === 'zoomchange') zoomChangeHandlers.push(callback)
      if (eventName === 'moveend') moveEndHandlers.push(callback)
      if (eventName === 'zoomend') zoomEndHandlers.push(callback)
      if (eventName === 'complete') completeHandlers.push(callback)
    })
    off = vi.fn()
    getZoom = vi.fn(() => 10)
    getCenter = vi.fn(() => ({ getLng: () => 121.5, getLat: () => 31.2 }))
    lnglatToPixel = vi.fn(() => ({ x: 0, y: 0 }))
    lngLatToContainer = vi.fn(() => ({ x: 0, y: 0 }))
    containerToLngLat = vi.fn(() => ({ getLng: () => 121.5, getLat: () => 31.2 }))
    setCenter = vi.fn()
    setZoomAndCenter = vi.fn()
    setPitch = vi.fn()
    setRotation = vi.fn()
    setStatus = vi.fn()
    getPitch = vi.fn(() => 0)
    getRotation = vi.fn(() => 0)
  }

  vi.doMock('../layers/footprintDataSource', () => ({
    loadFootprintPoints: vi.fn(() => loadFootprintsPromise),
  }))
  vi.doMock('../layers/canvasFootprintLayer', () => ({
    createCanvasFootprintLayer,
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

  return {
    createCanvasFootprintLayer,
    completeHandlers,
    destroy,
    mapMoveHandlers,
    moveEndHandlers,
    renderResult,
    update,
    zoomChangeHandlers,
    zoomEndHandlers,
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('AmapCanvas footprint layer wiring', () => {
  it('updates the canvas footprint layer on the next animation frame while the map is moving', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { mapMoveHandlers, update } = await renderFootprintCanvas({
      loadFootprintsPromise: loadFootprints.promise,
    })

    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    update.mockClear()

    mapMoveHandlers[0]()

    expect(requestAnimationFrame).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(loadedPoints, expect.any(Object), expect.any(HTMLElement))
  })

  it('updates the canvas footprint layer on the next animation frame while the map is zooming', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { update, zoomChangeHandlers } = await renderFootprintCanvas({
      loadFootprintsPromise: loadFootprints.promise,
    })

    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    update.mockClear()

    zoomChangeHandlers[0]()

    expect(requestAnimationFrame).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(loadedPoints, expect.any(Object), expect.any(HTMLElement))
  })

  it('updates the canvas footprint layer with raw loaded points after a map settle event', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { moveEndHandlers, update } = await renderFootprintCanvas({
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

    expect(update).toHaveBeenCalledWith(loadedPoints, expect.any(Object), expect.any(HTMLElement))
  })

  it('updates the canvas footprint layer after the AMap complete event settles', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { completeHandlers, update } = await renderFootprintCanvas({
      loadFootprintsPromise: loadFootprints.promise,
    })

    vi.useFakeTimers()
    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    await vi.advanceTimersByTimeAsync(160)
    update.mockClear()

    completeHandlers[0]()
    await vi.advanceTimersByTimeAsync(159)

    expect(update).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(update).toHaveBeenCalledWith(loadedPoints, expect.any(Object), expect.any(HTMLElement))
  })

  it('does not update for a superseded settle event', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { moveEndHandlers, update } = await renderFootprintCanvas({
      loadFootprintsPromise: loadFootprints.promise,
    })

    vi.useFakeTimers()
    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    moveEndHandlers[0]()
    moveEndHandlers[0]()
    await vi.advanceTimersByTimeAsync(159)

    expect(update).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(loadedPoints, expect.any(Object), expect.any(HTMLElement))
  })

  it('updates the canvas footprint layer after a window resize settles', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { update } = await renderFootprintCanvas({
      loadFootprintsPromise: loadFootprints.promise,
    })

    vi.useFakeTimers()
    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    await vi.advanceTimersByTimeAsync(160)
    update.mockClear()

    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(160)

    expect(update).toHaveBeenCalledWith(loadedPoints, expect.any(Object), expect.any(HTMLElement))
  })

  it('destroys the canvas footprint layer on unmount', async () => {
    const destroy = vi.fn()
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { renderResult } = await renderFootprintCanvas({
      destroy,
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    renderResult.unmount()

    expect(destroy).toHaveBeenCalled()
  })
})
