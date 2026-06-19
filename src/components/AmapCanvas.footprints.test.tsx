import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  loadFootprintsPromise,
}: {
  containerSize?: { width: number; height: number }
  loadFootprintsPromise: Promise<FootprintPoint[]>
}) {
  const moveEndHandlers: Array<() => void> = []
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
    layerRecords,
    moveEndHandlers,
    renderResult,
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
        pixelSize: 1.5,
      },
    )
    expect(layerRecords[0].update).toHaveBeenCalledWith(loadedPoints)

    layerRecords[0].update.mockClear()

    expect(moveEndHandlers).toHaveLength(0)
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

  it('does not reproject footprints after zoomend because MassMarks follows zoom natively', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { layerRecords, zoomEndHandlers } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    layerRecords[0].update.mockClear()

    zoomEndHandlers[0]()

    expect(layerRecords[0].update).not.toHaveBeenCalled()
  })

  it('does not reproject footprints after a window resize because MassMarks remains attached to the map', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { layerRecords } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    await act(async () => {
      loadFootprints.resolve(loadedPoints)
      await Promise.resolve()
    })
    layerRecords[0].update.mockClear()

    window.dispatchEvent(new Event('resize'))

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
    expect(layerRecords[2].update).toHaveBeenCalledWith(loadedPoints)
  })

  it('keeps the existing footprint style when the size input receives an invalid value', async () => {
    const loadFootprints = createDeferred<FootprintPoint[]>()
    const { createMassFootprintLayer } = await renderFootprintMassMarks({
      loadFootprintsPromise: loadFootprints.promise,
    })

    fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))
    fireEvent.change(screen.getByLabelText('足迹点大小数值'), {
      target: { value: 'not-a-number' },
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
        color: '#123f35',
        pixelSize: 1.5,
      },
    )
  })
})
