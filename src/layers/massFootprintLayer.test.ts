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
    expect(options?.style.size.width).toBe(1.5)
    expect(options?.style.size.height).toBe(1.5)
    expect(options?.style.anchor.x).toBe(0.75)
    expect(options?.style.anchor.y).toBe(0.75)
    const iconSvg = decodeURIComponent(options?.style.url ?? '')
    expect(iconSvg).toContain('#123f35')
    expect(iconSvg).toContain('width="1.5"')
    expect(iconSvg).toContain('height="1.5"')
    expect(iconSvg).toContain('<circle')
    expect(iconSvg).toContain('cx="0.75"')
    expect(iconSvg).toContain('cy="0.75"')
    expect(iconSvg).toContain('r="0.75"')
    expect(iconSvg).toContain('fill-opacity="0.82"')
    expect(iconSvg).not.toContain('<rect')
    expect(runtime.setMap).toHaveBeenCalledWith(map)

    layer.destroy()
  })

  it('encodes custom point size, color, and opacity into the native MassMarks icon', () => {
    const runtime = createMassMarksRuntime()
    const layer = createMassFootprintLayer(runtime, {} as AMap.Map, {
      color: '#4f7cff',
      opacity: 0.64,
      pixelSize: 3.4,
    })

    const options = runtime.MassMarks.mock.calls[0]?.[1]
    expect(options?.style.size.width).toBe(3.4)
    expect(options?.style.size.height).toBe(3.4)
    expect(options?.style.anchor.x).toBe(1.7)
    expect(options?.style.anchor.y).toBe(1.7)
    const iconSvg = decodeURIComponent(options?.style.url ?? '')
    expect(iconSvg).toContain('#4f7cff')
    expect(iconSvg).toContain('width="3.4"')
    expect(iconSvg).toContain('height="3.4"')
    expect(iconSvg).toContain('cx="1.7"')
    expect(iconSvg).toContain('cy="1.7"')
    expect(iconSvg).toContain('r="1.7"')
    expect(iconSvg).toContain('fill-opacity="0.64"')

    layer.destroy()
  })

  it('rounds custom point opacity to 0.01 precision before creating the native icon', () => {
    const runtime = createMassMarksRuntime()
    const layer = createMassFootprintLayer(runtime, {} as AMap.Map, {
      opacity: 0.736,
    })

    const options = runtime.MassMarks.mock.calls[0]?.[1]
    const iconSvg = decodeURIComponent(options?.style.url ?? '')
    expect(iconSvg).toContain('fill-opacity="0.74"')

    layer.destroy()
  })

  it('rounds custom point size to 0.1 precision before creating the native icon', () => {
    const runtime = createMassMarksRuntime()
    const layer = createMassFootprintLayer(runtime, {} as AMap.Map, {
      pixelSize: 1.23,
    })

    const options = runtime.MassMarks.mock.calls[0]?.[1]
    expect(options?.style.size.width).toBe(1.2)
    expect(options?.style.size.height).toBe(1.2)
    expect(options?.style.anchor.x).toBe(0.6)
    expect(options?.style.anchor.y).toBe(0.6)
    const iconSvg = decodeURIComponent(options?.style.url ?? '')
    expect(iconSvg).toContain('width="1.2"')
    expect(iconSvg).toContain('height="1.2"')
    expect(iconSvg).toContain('cx="0.6"')
    expect(iconSvg).toContain('cy="0.6"')
    expect(iconSvg).toContain('r="0.6"')

    layer.destroy()
  })

  it('clamps invalid custom style values before creating the native icon', () => {
    const runtime = createMassMarksRuntime()
    const layer = createMassFootprintLayer(runtime, {} as AMap.Map, {
      color: 'url(javascript:alert(1))',
      opacity: Number.NaN,
      pixelSize: Number.NaN,
    })

    const options = runtime.MassMarks.mock.calls[0]?.[1]
    expect(options?.style.size.width).toBe(1.5)
    expect(options?.style.size.height).toBe(1.5)
    expect(options?.style.anchor.x).toBe(0.75)
    expect(options?.style.anchor.y).toBe(0.75)
    const iconSvg = decodeURIComponent(options?.style.url ?? '')
    expect(iconSvg).toContain('#123f35')
    expect(iconSvg).toContain('fill-opacity="0.82"')
    expect(iconSvg).not.toContain('javascript')

    layer.destroy()
  })

  it('clamps custom point size and opacity to their supported ranges', () => {
    const smallRuntime = createMassMarksRuntime()
    const largeRuntime = createMassMarksRuntime()

    const smallLayer = createMassFootprintLayer(smallRuntime, {} as AMap.Map, {
      opacity: 0.1,
      pixelSize: 0.1,
    })
    const largeLayer = createMassFootprintLayer(largeRuntime, {} as AMap.Map, {
      opacity: 1.2,
      pixelSize: 4.2,
    })

    const smallOptions = smallRuntime.MassMarks.mock.calls[0]?.[1]
    const largeOptions = largeRuntime.MassMarks.mock.calls[0]?.[1]
    expect(smallOptions?.style.size.width).toBe(0.3)
    expect(smallOptions?.style.anchor.x).toBe(0.15)
    expect(decodeURIComponent(smallOptions?.style.url ?? '')).toContain('width="0.3"')
    expect(decodeURIComponent(smallOptions?.style.url ?? '')).toContain('fill-opacity="0.3"')
    expect(largeOptions?.style.size.width).toBe(3.5)
    expect(largeOptions?.style.anchor.x).toBe(1.75)
    expect(decodeURIComponent(largeOptions?.style.url ?? '')).toContain('width="3.5"')
    expect(decodeURIComponent(largeOptions?.style.url ?? '')).toContain('fill-opacity="1"')

    smallLayer.destroy()
    largeLayer.destroy()
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
