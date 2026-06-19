import { describe, expect, it, vi } from 'vitest'

import { createMassFootprintLayer } from './massFootprintLayer'
import type { FootprintPoint } from './footprintTypes'

const points: FootprintPoint[] = [
  createPoint('a', 121.5001, 31.2001),
  createPoint('b', 121.5004, 31.2004),
]

function createPoint(id: string, longitude: number, latitude: number): FootprintPoint {
  return {
    id,
    timestampSeconds: 1,
    longitude,
    latitude,
    accuracy: 5,
    speed: -1,
    distance: 0,
    heading: 0,
    altitude: 0,
    locType: 1,
    isBackForeground: 1,
    stepType: 0,
  }
}

describe('createMassFootprintLayer', () => {
  function createMassMarksRuntime() {
    const clear = vi.fn()
    const setMap = vi.fn()
    const setData = vi.fn()
    class Size {
      constructor(
        public width: number,
        public height: number,
      ) {}
    }
    class Pixel {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    const MassMarks = vi.fn(function () {
      return { clear, setData, setMap }
    })

    return { clear, MassMarks, Pixel, setData, setMap, Size }
  }

  it('creates a native AMap MassMarks layer with a tiny theme-colored sharp point icon', () => {
    const runtime = createMassMarksRuntime()
    const map = {} as AMap.Map

    const layer = createMassFootprintLayer(runtime, map)

    expect(runtime.MassMarks).toHaveBeenCalledWith([], {
      alwaysRender: true,
      cursor: 'default',
      opacity: 1,
      style: {
        anchor: expect.any(Object),
        size: expect.any(Object),
        url: expect.stringContaining('data:image/svg+xml'),
      },
      zIndex: 20,
    })
    const options = runtime.MassMarks.mock.calls[0]?.[1]
    expect(options?.style.size.width).toBe(2)
    expect(options?.style.size.height).toBe(2)
    expect(options?.style.anchor.x).toBe(1)
    expect(options?.style.anchor.y).toBe(1)
    const iconSvg = decodeURIComponent(options?.style.url ?? '')
    expect(iconSvg).toContain('#b8544c')
    expect(iconSvg).toContain('<circle')
    expect(iconSvg).not.toContain('<rect')
    expect(runtime.setMap).toHaveBeenCalledWith(map)

    layer.destroy()
  })

  it('updates MassMarks with raw footprint lnglat data and lets AMap own projection during map motion', () => {
    const runtime = createMassMarksRuntime()
    const layer = createMassFootprintLayer(runtime, {} as AMap.Map)

    layer.update(points)

    expect(runtime.setData).toHaveBeenCalledWith([
      { id: 'a', lnglat: [121.5001, 31.2001] },
      { id: 'b', lnglat: [121.5004, 31.2004] },
    ])
  })

  it('clears and detaches the native MassMarks layer on destroy', () => {
    const runtime = createMassMarksRuntime()
    const layer = createMassFootprintLayer(runtime, {} as AMap.Map)

    layer.destroy()

    expect(runtime.clear).toHaveBeenCalled()
    expect(runtime.setMap).toHaveBeenLastCalledWith(null)
  })
})
