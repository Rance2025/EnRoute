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

async function renderFootprintMassMarks({
  containerSize = { width: 1024, height: 768 },
  destroy = vi.fn(),
  loadFootprintsPromise,
}: {
  containerSize?: { width: number; height: number }
  destroy?: () => void
  loadFootprintsPromise: Promise<FootprintPoint[]>
}) {
  const moveEndHandlers: Array<() => void> = []
  const zoomEndHandlers: Array<() => void> = []
  const completeHandlers: Array<() => void> = []
  const update = vi.fn()
  const createMassFootprintLayer = vi.fn(() => ({ update, destroy }))

  class MockMap {
    addControl = vi.fn()
    destroy = vi.fn()
    resize = vi.fn()
    on = vi.fn((eventName: string, callback: () => void) => {
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
    createMassFootprintLayer,
    completeHandlers,
    destroy,
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
})

describe('AmapCanvas footprint layer wiring', () => {
  it('updates the native MassMarks footprint layer with raw loaded points after data loads', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer, moveEndHandlers, update } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })

    expect(createMassFootprintLayer).toHaveBeenCalledWith(
      expect.objectContaining({ MassMarks: expect.any(Function) }),
      expect.any(Object),
    )
    expect(update).toHaveBeenCalledWith(loadedPoints)

    update.mockClear()

    expect(moveEndHandlers).toHaveLength(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not reproject footprints after AMap complete because MassMarks follows map motion natively', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { completeHandlers, update } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    update.mockClear()

    expect(completeHandlers).toHaveLength(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not reproject footprints after zoomend because MassMarks follows zoom natively', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { zoomEndHandlers, update } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    update.mockClear()

    zoomEndHandlers[0]()

    expect(update).not.toHaveBeenCalled()
  })

  it('does not reproject footprints after a window resize because MassMarks remains attached to the map', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { update } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    update.mockClear()

    window.dispatchEvent(new Event('resize'))

    expect(update).not.toHaveBeenCalled()
  })

  it('destroys the native MassMarks footprint layer on unmount', async () => {
    const destroy = vi.fn()
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { renderResult } = await renderFootprintMassMarks({
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
