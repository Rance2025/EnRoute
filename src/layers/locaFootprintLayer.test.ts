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
  it('initializes with an empty source before external updates', () => {
    const setSource = vi.fn()
    const setStyle = vi.fn()
    const map = {}
    const Loca = {
      Container: vi.fn(function () {
        return { destroy: vi.fn() }
      }),
      PointLayer: vi.fn(function () {
        return { setSource, setStyle }
      }),
      GeoJSONSource: vi.fn(function (options: unknown) {
        return options
      }),
    } as unknown as typeof globalThis.Loca

    createLocaFootprintLayer(Loca, map as AMap.Map)

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
  })

  it('updates source data and destroys the container', () => {
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
    expect(Loca.PointLayer).toHaveBeenCalledWith({
      loca: expect.objectContaining({ add, destroy }),
      zIndex: 20,
      opacity: 0.9,
      visible: true,
      blend: 'lighter',
    })
    expect(setStyle).toHaveBeenCalledWith({
      unit: 'px',
      radius: expect.any(Function),
      color: 'rgba(255, 225, 154, 0.92)',
      borderWidth: 0,
      blurWidth: 5,
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
    expect(add).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalled()
  })
})
