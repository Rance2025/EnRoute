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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  delete window.Loca
})

describe('AmapCanvas footprint layer wiring', () => {
  it('updates footprint points after a map settle event', async () => {
    const moveEndHandlers: Array<() => void> = []
    const zoomEndHandlers: Array<() => void> = []
    const update = vi.fn()
    const aggregate = vi.fn(async () => aggregatedPoints)
    let resolveLoadFootprints: (points: FootprintPoint[]) => void = () => {}
    const loadFootprintsPromise = new Promise<FootprintPoint[]>((resolve) => {
      resolveLoadFootprints = resolve
    })

    class MockFootprintWorkerClient {
      aggregate = aggregate
      dispose = vi.fn()
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
      getZoom = vi.fn(() => 10)
      getCenter = vi.fn(() => ({ getLng: () => 121.5, getLat: () => 31.2 }))
      lnglatToPixel = vi.fn(() => ({ x: 0, y: 0 }))
      lngLatToContainer = vi.fn(() => ({ x: 0, y: 0 }))
      containerToLngLat = vi.fn(({ x, y }: { x: number; y: number }) => ({
        getLng: () => 121 + x / 1000,
        getLat: () => 31 - y / 1000,
      }))
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

    render(<AmapCanvas config={configuredAmap} />)

    await waitFor(() => expect(moveEndHandlers).toHaveLength(1), { timeout: 1000 })
    await waitFor(() => expect(aggregate).not.toHaveBeenCalled())

    vi.useFakeTimers()
    await act(async () => {
      resolveLoadFootprints(loadedPoints)
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
      cellSizePx: 8,
      viewportBounds: expect.objectContaining({
        east: expect.any(Number),
        north: expect.any(Number),
        south: expect.any(Number),
        west: expect.any(Number),
      }),
    })
  })
})
