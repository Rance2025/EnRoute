import { describe, expect, it, vi } from 'vitest'

import { createFootprintGeoJson, createLocaFootprintLayer } from './locaFootprintLayer'

describe('createFootprintGeoJson', () => {
  it('converts aggregated points into GeoJSON features', () => {
    expect(
      createFootprintGeoJson([
        {
          id: 'a',
          longitude: 121.5,
          latitude: 31.2,
          count: 3,
          minAccuracy: 5,
          startTimestampSeconds: 1,
          endTimestampSeconds: 2,
        },
      ]),
    ).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'a',
            count: 3,
            minAccuracy: 5,
            startTimestampSeconds: 1,
            endTimestampSeconds: 2,
          },
          geometry: {
            type: 'Point',
            coordinates: [121.5, 31.2],
          },
        },
      ],
    })
  })
})

describe('createLocaFootprintLayer', () => {
  it('initializes the point layer using the official Loca 2.0 sequence', () => {
    const calls: string[] = []
    const setSource = vi.fn()
    const setStyle = vi.fn()
    const map = {}
    const sourceInstances: unknown[] = []
    const pointLayer = { setSource, setStyle }
    const container = {
      add: vi.fn((layer: unknown) => {
        calls.push('add')
        expect(layer).toBe(pointLayer)
      }),
      destroy: vi.fn(),
    }
    const Loca = {
      Container: vi.fn(function () {
        calls.push('Container')
        return container
      }),
      PointLayer: vi.fn(function () {
        calls.push('PointLayer')
        return pointLayer
      }),
      GeoJSONSource: vi.fn(function (options: unknown) {
        calls.push('GeoJSONSource')
        sourceInstances.push(options)
        return options
      }),
    } as unknown as typeof globalThis.Loca
    setSource.mockImplementation((source) => {
      calls.push('setSource')
      expect(source).toBe(sourceInstances[0])
    })
    setStyle.mockImplementation(() => {
      calls.push('setStyle')
    })

    createLocaFootprintLayer(Loca, map as AMap.Map)

    expect(calls).toEqual(['Container', 'PointLayer', 'GeoJSONSource', 'setSource', 'setStyle', 'add'])
    expect(Loca.PointLayer).toHaveBeenCalledWith({
      zIndex: 20,
      opacity: 0.9,
      visible: true,
      blend: 'lighter',
    })
    expect(Loca.GeoJSONSource).toHaveBeenCalledWith({
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
    expect(setSource).toHaveBeenCalledWith({
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
    expect(setStyle).toHaveBeenCalledWith({
      unit: 'px',
      radius: expect.any(Function),
      color: 'rgba(255, 225, 154, 0.92)',
      borderWidth: 0,
      blurWidth: 5,
    })
    expect(container.add).toHaveBeenCalledWith(pointLayer)
  })

  it('sets a new source on external update and destroys the container', () => {
    const setSource = vi.fn()
    const setStyle = vi.fn()
    const destroy = vi.fn()
    const add = vi.fn()
    const map = {}
    const Loca = {
      Container: vi.fn(function () {
        return { add, destroy }
      }),
      PointLayer: vi.fn(function () {
        return { setSource, setStyle }
      }),
      GeoJSONSource: vi.fn(function (options: unknown) {
        return options
      }),
    } as unknown as typeof globalThis.Loca

    const layer = createLocaFootprintLayer(Loca, map as AMap.Map)
    layer.update([])
    layer.destroy()

    expect(Loca.Container).toHaveBeenCalledWith({ map })
    expect(Loca.GeoJSONSource).toHaveBeenNthCalledWith(1, {
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
    expect(setSource).toHaveBeenNthCalledWith(2, {
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
    expect(add).toHaveBeenCalled()
    expect(destroy).toHaveBeenCalled()
  })
})
