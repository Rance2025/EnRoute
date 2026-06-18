import { describe, expect, it, vi } from 'vitest'

import {
  calculateBoundedZoomCenter,
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

  it('uses immediate setZoomAndCenter calls for toolbar zoom steps', () => {
    const map = {
      getZoom: vi.fn(() => 5),
      getCenter: vi.fn(() => lngLat([120, 30])),
      setZoomAndCenter: vi.fn(),
    }
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 100 },
      clientHeight: { value: 100 },
    })

    zoomByStep(map, container, renderBounds, 1)

    expect(map.setZoomAndCenter).toHaveBeenCalledWith(5.5, expect.any(Array), true)
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
