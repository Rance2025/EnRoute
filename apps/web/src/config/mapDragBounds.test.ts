import { describe, expect, it } from 'vitest'

import {
  calculateMinimumZoomForLatitudeCoverage,
  calculateBoundedCenterForViewport,
  calculateNextBoundedDragCenter,
  installBoundedMapDrag,
  type BoundedDragMap,
  type ContainerPoint,
} from './mapDragBounds'
import type { MapBounds } from './mapCamera'

const bounds: MapBounds = {
  southWest: [73.3, 17.8],
  northEast: [135.1, 53.7],
}

const viewportSize = {
  width: 120,
  height: 100,
}

function projectWithCenter(center: [number, number]) {
  return ([lng, lat]: [number, number]): ContainerPoint => ({
    x: viewportSize.width / 2 + (lng - center[0]) * 10,
    y: viewportSize.height / 2 - (lat - center[1]) * 10,
  })
}

function unprojectWithCenter(center: [number, number]) {
  return ({ x, y }: ContainerPoint): [number, number] => [
    center[0] + (x - viewportSize.width / 2) / 10,
    center[1] - (y - viewportSize.height / 2) / 10,
  ]
}

function lngLat([lng, lat]: [number, number]) {
  return {
    getLng: () => lng,
    getLat: () => lat,
  }
}

function pointerEvent(
  type: string,
  options: {
    x: number
    y: number
    pointerId?: number
    button?: number
    isPrimary?: boolean
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  Object.defineProperties(event, {
    clientX: { value: options.x },
    clientY: { value: options.y },
    pointerId: { value: options.pointerId ?? 1 },
    button: { value: options.button ?? 0 },
    isPrimary: { value: options.isPrimary ?? true },
    pointerType: { value: 'mouse' },
  })
  return event
}

describe('bounded map dragging', () => {
  it('keeps the visible latitude viewport inside bounds while dragging north or south', () => {
    const center: [number, number] = [82, 50]
    const nextCenter = calculateNextBoundedDragCenter({
      currentCenter: center,
      previousPointer: { x: 100, y: 100 },
      currentPointer: { x: 100, y: 200 },
      bounds,
      viewportSize,
      lngLatToContainer: projectWithCenter(center),
      containerToLngLat: unprojectWithCenter(center),
    })

    expect(nextCenter[0]).toBe(82)
    expect(nextCenter[1]).toBeCloseTo(48.58)
  })

  it('locks latitude when the current viewport is taller than the latitude bounds', () => {
    const center: [number, number] = [100, 30]
    const narrowBounds: MapBounds = {
      southWest: [99, 29],
      northEast: [101, 31],
    }

    const nextCenter = calculateNextBoundedDragCenter({
      currentCenter: center,
      previousPointer: { x: 100, y: 100 },
      currentPointer: { x: 200, y: 200 },
      bounds: narrowBounds,
      viewportSize,
      lngLatToContainer: projectWithCenter(center),
      containerToLngLat: unprojectWithCenter(center),
    })

    expect(nextCenter[0]).toBe(90)
    expect(nextCenter[1]).toBeCloseTo(30.005039)
  })

  it('does not constrain longitude while clamping the latitude viewport', () => {
    const center: [number, number] = [100, 30]

    const nextCenter = calculateNextBoundedDragCenter({
      currentCenter: center,
      previousPointer: { x: 100, y: 100 },
      currentPointer: { x: 200, y: 100 },
      bounds,
      viewportSize,
      lngLatToContainer: projectWithCenter(center),
      containerToLngLat: unprojectWithCenter(center),
    })

    expect(nextCenter).toEqual([90, 30])
  })

  it('clamps the center after zoom changes enlarge the visible latitude viewport', () => {
    const center: [number, number] = [120, 80]
    const mercatorBounds: MapBounds = {
      southWest: [-180, -85.05112878],
      northEast: [180, 85.05112878],
    }

    const nextCenter = calculateBoundedCenterForViewport({
      center,
      bounds: mercatorBounds,
      viewportSize,
      lngLatToContainer: ([, lat]) => {
        if (lat === mercatorBounds.northEast[1]) return { x: 60, y: 30 }
        if (lat === mercatorBounds.southWest[1]) return { x: 60, y: 260 }
        return { x: 60, y: 50 }
      },
      containerToLngLat: ({ y }) => {
        if (y > 50) return [120, 70]
        return center
      },
    })

    expect(nextCenter[0]).toBe(120)
    expect(nextCenter[1]).toBe(70)
  })

  it('uses projected edge pixels instead of getBounds-style latitude estimates', () => {
    const center: [number, number] = [120, 82]
    const mercatorBounds: MapBounds = {
      southWest: [-180, -85.05112878],
      northEast: [180, 85.05112878],
    }

    const nextCenter = calculateBoundedCenterForViewport({
      center,
      bounds: mercatorBounds,
      viewportSize,
      lngLatToContainer: ([, lat]) => {
        if (lat === mercatorBounds.northEast[1]) return { x: 60, y: 68 }
        if (lat === mercatorBounds.southWest[1]) return { x: 60, y: 280 }
        return { x: 60, y: 50 }
      },
      containerToLngLat: ({ y }) => {
        if (y > 50) return [120, 76]
        return center
      },
    })

    expect(nextCenter).toEqual([120, 76])
  })

  it('calculates a minimum zoom that crops polar edges instead of barely fitting the world', () => {
    expect(calculateMinimumZoomForLatitudeCoverage(815)).toBe(2.02)
    expect(calculateMinimumZoomForLatitudeCoverage(1152)).toBe(2.52)
    expect(calculateMinimumZoomForLatitudeCoverage(1800)).toBe(3.16)
  })

  it('locks dragging at the render center when the map cannot zoom out to fit the viewport height', () => {
    const center: [number, number] = [104, 0]
    const mercatorBounds: MapBounds = {
      southWest: [-180, -85.05112878],
      northEast: [180, 85.05112878],
    }
    const nextCenter = calculateNextBoundedDragCenter({
      currentCenter: center,
      currentZoom: 2,
      previousPointer: { x: 100, y: 100 },
      currentPointer: { x: 110, y: 140 },
      bounds: mercatorBounds,
      viewportSize,
      lngLatToContainer: ([lng, lat]) => ({
        x: viewportSize.width / 2 + (lng - center[0]),
        y: viewportSize.height / 2 - lat * 0.5,
      }),
      containerToLngLat: ({ x, y }) => [center[0] + x - viewportSize.width / 2, 80 - y],
    })

    expect(nextCenter[0]).toBeCloseTo(0)
    expect(nextCenter[1]).toBeCloseTo(0)
  })

  it('disables native map dragging and handles bounded pointer dragging without rebound debt', () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: viewportSize.width },
      clientHeight: { value: viewportSize.height },
    })
    const statusCalls: Array<{ dragEnable?: boolean }> = []
    const centers: Array<[number, number]> = []
    let center: [number, number] = [80, 30]

    const map: BoundedDragMap = {
      setStatus: (status) => statusCalls.push(status),
      getCenter: () => lngLat(center),
      setCenter: (nextCenter) => {
        center = nextCenter
        centers.push(nextCenter)
      },
      lngLatToContainer: (value) => projectWithCenter(center)(value),
      containerToLngLat: (value) => unprojectWithCenter(center)(value),
    }

    const dispose = installBoundedMapDrag(map, container, bounds)

    container.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 100 }))
    container.dispatchEvent(pointerEvent('pointermove', { x: 120, y: 100 }))
    container.dispatchEvent(pointerEvent('pointermove', { x: 110, y: 100 }))
    container.dispatchEvent(pointerEvent('pointerup', { x: 110, y: 100 }))

    expect(statusCalls).toContainEqual({ dragEnable: false })
    expect(centers).toEqual([
      [78, 30],
      [79, 30],
    ])

    dispose()
    container.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 100 }))
    container.dispatchEvent(pointerEvent('pointermove', { x: 200, y: 100 }))

    expect(centers).toHaveLength(2)
  })
})
