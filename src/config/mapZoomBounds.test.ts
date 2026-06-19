import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calculateBoundedZoomCenter,
  calculateIntermediateZoomCenter,
  installBoundedMapZoom,
  zoomByStep,
  type BoundedZoomMap,
} from './mapZoomBounds'
import type { ContainerPoint } from './mapDragBounds'
import type { MapBounds } from './mapCamera'

const renderBounds: MapBounds = {
  southWest: [-180, -85.05112878],
  northEast: [180, 85.05112878],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function makeMercatorProjection(options: {
  center: [number, number]
  zoom: number
  viewportSize: { width: number; height: number }
}) {
  const centerWorld = projectMercator(options.center, options.zoom)

  return {
    lngLatToContainer: (lngLat: [number, number]): ContainerPoint => {
      const world = projectMercator(lngLat, options.zoom)

      return {
        x: options.viewportSize.width / 2 + world.x - centerWorld.x,
        y: options.viewportSize.height / 2 + world.y - centerWorld.y,
      }
    },
  }
}

function lngLat([lng, lat]: [number, number]) {
  return {
    getLng: () => lng,
    getLat: () => lat,
  }
}

function projectMercator([lng, lat]: [number, number], zoom: number): ContainerPoint {
  const scale = 256 * 2 ** zoom
  const sinLat = Math.sin((lat * Math.PI) / 180)

  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
}

describe('bounded map zooming', () => {
  it('pre-clamps the center before zooming out near the north render edge', () => {
    const viewportSize = { width: 100, height: 100 }

    const nextCenter = calculateBoundedZoomCenter({
      center: [120, 84],
      currentZoom: 3,
      targetZoom: 1,
      focalPoint: { x: 50, y: 50 },
      viewportSize,
      bounds: renderBounds,
    })

    const projection = makeMercatorProjection({
      center: nextCenter,
      zoom: 1,
      viewportSize,
    })

    expect(projection.lngLatToContainer([120, renderBounds.northEast[1]]).y).toBeLessThanOrEqual(0)
    expect(projection.lngLatToContainer([120, renderBounds.southWest[1]]).y).toBeGreaterThanOrEqual(
      viewportSize.height,
    )
  })

  it('pre-clamps the center before zooming out near the south render edge', () => {
    const viewportSize = { width: 100, height: 100 }

    const nextCenter = calculateBoundedZoomCenter({
      center: [120, -84],
      currentZoom: 3,
      targetZoom: 1,
      focalPoint: { x: 50, y: 50 },
      viewportSize,
      bounds: renderBounds,
    })

    const projection = makeMercatorProjection({
      center: nextCenter,
      zoom: 1,
      viewportSize,
    })

    expect(projection.lngLatToContainer([120, renderBounds.northEast[1]]).y).toBeLessThanOrEqual(0)
    expect(projection.lngLatToContainer([120, renderBounds.southWest[1]]).y).toBeGreaterThanOrEqual(
      viewportSize.height,
    )
  })

  it('does not constrain longitude while preserving the focal point during bounded zoom', () => {
    const nextCenter = calculateBoundedZoomCenter({
      center: [720, 10],
      currentZoom: 4,
      targetZoom: 5,
      focalPoint: { x: 70, y: 40 },
      viewportSize: { width: 100, height: 100 },
      bounds: renderBounds,
    })

    expect(nextCenter[0]).toBeGreaterThan(180)
  })

  it('animates toolbar zoom steps with eased intermediate frames', () => {
    vi.useFakeTimers()
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    let zoom = 5
    let center: [number, number] = [120, 30]
    const zooms: number[] = []
    const map = {
      getZoom: vi.fn(() => zoom),
      getCenter: vi.fn(() => lngLat(center)),
      setZoomAndCenter: vi.fn((nextZoom: number, nextCenter: [number, number]) => {
        zoom = nextZoom
        center = nextCenter
        zooms.push(nextZoom)
      }),
    }
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 100 },
      clientHeight: { value: 100 },
    })

    zoomByStep(map, container, renderBounds, 1)

    expect(requestAnimationFrame).toHaveBeenCalled()
    expect(setTimeoutSpy).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(zooms.length).toBeGreaterThan(4)
    expect(zooms[0]).toBeGreaterThan(5)
    expect(zooms[0]).toBeLessThan(5.5)
    expect(zooms.at(-1)).toBeCloseTo(5.5)
    expect(zooms[1] - zooms[0]).toBeGreaterThan(zooms.at(-1)! - zooms.at(-2)!)

    vi.useRealTimers()
  })

  it('cancels stale toolbar zoom animations when clicking repeatedly', () => {
    vi.useFakeTimers()
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    let zoom = 5
    let center: [number, number] = [104, 35]
    const zooms: number[] = []
    const map = {
      getZoom: () => zoom,
      getCenter: () => lngLat(center),
      setZoomAndCenter: (nextZoom: number, nextCenter: [number, number]) => {
        zoom = nextZoom
        center = nextCenter
        zooms.push(nextZoom)
      },
    }
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 1432 },
      clientHeight: { value: 815 },
    })

    zoomByStep(map, container, renderBounds, 1)
    vi.advanceTimersByTime(32)
    const zoomAfterFirstClick = zoom
    zoomByStep(map, container, renderBounds, 1)

    expect(cancelAnimationFrame).toHaveBeenCalled()

    vi.runAllTimers()

    expect(zoomAfterFirstClick).toBeGreaterThan(5)
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b))
    expect(zooms.at(-1)).toBeGreaterThan(5.5)
    expect(zooms.at(-1)).toBeLessThanOrEqual(zoomAfterFirstClick + 0.5)

    vi.useRealTimers()
  })

  it('locks the center to the vertical render midpoint at minimum AMap zoom', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 1432 },
      clientHeight: { value: 815 },
    })
    let zoom = 2.52
    let center: [number, number] = [104, 35]
    const map = {
      setStatus: vi.fn(),
      getZoom: vi.fn(() => zoom),
      getCenter: vi.fn(() => lngLat(center)),
      setZoomAndCenter: vi.fn((nextZoom: number, nextCenter: [number, number]) => {
        zoom = nextZoom
        center = nextCenter
      }),
    }

    zoomByStep(map, container, renderBounds, -1)
    vi.runAllTimers()

    const lastCall = map.setZoomAndCenter.mock.calls.at(-1)
    expect(lastCall?.[0]).toBeCloseTo(2.02)
    expect(lastCall?.[1][0]).toBeCloseTo(104)
    expect(lastCall?.[1][1]).toBeCloseTo(0)

    vi.useRealTimers()
  })

  it('does not restart zoom animation when already locked at minimum zoom', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 1432 },
      clientHeight: { value: 815 },
      getBoundingClientRect: {
        value: () => ({ left: 0, top: 0, width: 1432, height: 815 }),
      },
    })
    const map: BoundedZoomMap = {
      setStatus: vi.fn(),
      getZoom: () => 2.02,
      getCenter: () => lngLat([104, 0]),
      setZoomAndCenter: vi.fn(),
    }

    const dispose = installBoundedMapZoom(map, container, renderBounds)

    container.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 900,
        clientX: 716,
        clientY: 407.5,
      }),
    )
    vi.runAllTimers()

    expect(map.setZoomAndCenter).not.toHaveBeenCalled()

    dispose()
    vi.useRealTimers()
  })

  it('cancels stale wheel animations when a newer wheel event starts', () => {
    vi.useFakeTimers()
    let zoom = 4
    let center: [number, number] = [104, 35]
    const calls: number[] = []
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 1432 },
      clientHeight: { value: 815 },
      getBoundingClientRect: {
        value: () => ({ left: 0, top: 0, width: 1432, height: 815 }),
      },
    })
    const map: BoundedZoomMap = {
      setStatus: vi.fn(),
      getZoom: () => zoom,
      getCenter: () => lngLat(center),
      setZoomAndCenter: (nextZoom, nextCenter) => {
        zoom = nextZoom
        center = nextCenter
        calls.push(nextZoom)
      },
    }

    const dispose = installBoundedMapZoom(map, container, renderBounds)
    const wheelOut = () =>
      container.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 900,
          clientX: 716,
          clientY: 407.5,
        }),
      )

    wheelOut()
    vi.advanceTimersByTime(16)
    wheelOut()
    vi.runAllTimers()

    expect(calls).toEqual([...calls].sort((a, b) => b - a))

    dispose()
    vi.useRealTimers()
  })

  it('uses a stronger zoom step for standard mouse wheel deltas', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 1432 },
      clientHeight: { value: 815 },
      getBoundingClientRect: {
        value: () => ({ left: 0, top: 0, width: 1432, height: 815 }),
      },
    })
    const calls: number[] = []
    const map: BoundedZoomMap = {
      setStatus: vi.fn(),
      getZoom: () => 5,
      getCenter: () => lngLat([104, 35]),
      setZoomAndCenter: (nextZoom) => {
        calls.push(nextZoom)
      },
    }

    const dispose = installBoundedMapZoom(map, container, renderBounds)

    container.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -120,
        clientX: 716,
        clientY: 407.5,
      }),
    )
    vi.runAllTimers()

    expect(calls.at(-1)).toBeGreaterThanOrEqual(5.45)

    dispose()
    vi.useRealTimers()
  })

  it('moves toward the minimum zoom midpoint before the final zoom frame', () => {
    const nextCenter = calculateIntermediateZoomCenter({
      startCenter: [104, 35],
      currentCenter: [104, 35],
      currentZoom: 2.55,
      startZoom: 2.55,
      frameZoom: 2.1,
      focalPoint: { x: 716, y: 407.5 },
      viewportSize: { width: 1432, height: 815 },
      bounds: renderBounds,
    })

    expect(nextCenter[0]).toBeCloseTo(104)
    expect(nextCenter[1]).toBeLessThan(4)
    expect(nextCenter[1]).toBeGreaterThan(1)
  })

  it('disables native wheel zoom and handles wheel zoom through a bounded listener', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 100 },
      clientHeight: { value: 100 },
      getBoundingClientRect: {
        value: () => ({
          left: 10,
          top: 20,
          width: 100,
          height: 100,
        }),
      },
    })
    const statusCalls: Array<{
      dragEnable?: boolean
      scrollWheel?: boolean
      doubleClickZoom?: boolean
      keyboardEnable?: boolean
    }> = []
    const centers: Array<[number, [number, number], boolean?]> = []
    const map: BoundedZoomMap = {
      setStatus: (status) => statusCalls.push(status),
      getZoom: () => 5,
      getCenter: () => lngLat([120, 30]),
      setZoomAndCenter: (zoom, center, immediately) => centers.push([zoom, center, immediately]),
    }

    const dispose = installBoundedMapZoom(map, container, renderBounds)
    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -200,
      clientX: 60,
      clientY: 70,
    })

    container.dispatchEvent(wheelEvent)
    vi.runAllTimers()

    expect(wheelEvent.defaultPrevented).toBe(true)
    expect(statusCalls).toContainEqual({
      dragEnable: false,
      scrollWheel: false,
      doubleClickZoom: false,
      keyboardEnable: false,
    })
    expect(centers.at(-1)?.[0]).toBeGreaterThan(5)
    expect(centers.at(-1)?.[2]).toBe(true)

    dispose()
    vi.useRealTimers()
  })
})
