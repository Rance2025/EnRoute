import { describe, expect, it, vi } from 'vitest'

import { createCanvasFootprintLayer } from './canvasFootprintLayer'
import type { FootprintPoint } from './footprintTypes'

const points: FootprintPoint[] = [
  createPoint('a', 121.5001, 31.2001),
  createPoint('b', 121.5004, 31.2004),
  createPoint('c', 122.1, 32.1),
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

function createContainer(width = 320, height = 240) {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    value: height,
  })

  return container
}

describe('createCanvasFootprintLayer', () => {
  function createCustomLayerRuntime() {
    const render = vi.fn()
    const setMap = vi.fn()
    const CustomLayer = vi.fn(function (
      _canvas: HTMLCanvasElement,
      options: AMap.CustomLayerOptions,
    ) {
      render.mockImplementation(() => options.render?.())
      return { render, setMap }
    })

    return { CustomLayer, render, setMap }
  }

  function mockCanvasContext() {
    const context = {
      arc: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
      setTransform: vi.fn(),
    }

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )

    return context
  }

  it('sizes the canvas backing store by device pixel ratio while keeping CSS dimensions', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2)
    mockCanvasContext()
    const customLayer = createCustomLayerRuntime()
    const container = createContainer(320, 240)
    const map = {} as AMap.Map

    const layer = createCanvasFootprintLayer(customLayer, map, container)

    const canvas = customLayer.CustomLayer.mock.calls[0]?.[0]
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvas?.dataset.layer).toBe('footprints')
    expect(canvas?.width).toBe(640)
    expect(canvas?.height).toBe(480)
    expect(canvas?.style.width).toBe('320px')
    expect(canvas?.style.height).toBe('240px')
    expect(container.querySelector('canvas')).toBeNull()
    expect(customLayer.CustomLayer).toHaveBeenCalledWith(canvas, {
      map,
      zIndex: 20,
      alwaysRender: false,
      render: expect.any(Function),
    })

    layer.destroy()

    expect(customLayer.setMap).toHaveBeenCalledWith(null)
  })

  it('draws only one integer fillRect for multiple points in the same screen pixel', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1)
    const context = mockCanvasContext()
    const customLayer = createCustomLayerRuntime()
    const container = createContainer()
    const map = {
      lngLatToContainer: vi
        .fn()
        .mockReturnValueOnce({ x: 10.2, y: 20.6 })
        .mockReturnValueOnce({ x: 10.4, y: 20.1 })
        .mockReturnValueOnce({ x: 30.8, y: 40.2 }),
    } as unknown as AMap.Map
    const layer = createCanvasFootprintLayer(customLayer, map, container, { color: '#b8544c' })

    layer.update(points)

    expect(context.fillRect).toHaveBeenCalledTimes(2)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 320, 240)
    expect(context.fillRect).toHaveBeenNthCalledWith(1, 10, 20, 1, 1)
    expect(context.fillRect).toHaveBeenNthCalledWith(2, 30, 40, 1, 1)
    expect(context.arc).not.toHaveBeenCalled()
    expect(context.fillStyle).toBe('#b8544c')

    layer.destroy()
  })
})
