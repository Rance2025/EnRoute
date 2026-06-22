import { describe, expect, it, vi } from 'vitest'
import { createAdminRegionLayer } from './adminRegionLayer'
import type { AdminRegion } from './adminRegionTypes'

function createRuntime() {
  const setMap = vi.fn()
  const Polygon = vi.fn(function (this: { options: unknown, setMap: typeof setMap }, options: unknown) {
    Object.assign(this, { options, setMap })
  })
  return { Polygon, setMap }
}

const regions: AdminRegion[] = [
  {
    id: 'donut',
    name: 'Donut',
    level: 4,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
      ],
    },
    firstSeenTimestamp: 100,
    footprintCount: 1,
    stayDurationSeconds: 0,
    travelDistanceMeters: 0,
  },
  {
    id: 'multi',
    name: 'Multi',
    level: 4,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
        [[[30, 30], [32, 30], [32, 32], [30, 32], [30, 30]]],
      ],
    },
    firstSeenTimestamp: null,
    footprintCount: 0,
    stayDurationSeconds: 0,
    travelDistanceMeters: 0,
  },
]

describe('admin region AMap layer', () => {
  it('preserves polygon holes and multipolygon parts when creating overlays', () => {
    const runtime = createRuntime()
    const map = {} as AMap.Map
    const layer = createAdminRegionLayer(runtime as unknown as Pick<typeof AMap, 'Polygon'>, map)

    layer.update(regions)

    expect(runtime.Polygon).toHaveBeenCalledTimes(3)
    expect(runtime.Polygon.mock.calls[0]?.[0]).toMatchObject({
      path: regions[0].geometry.coordinates,
      strokeColor: '#123f35',
      fillColor: '#123f35',
      fillOpacity: 0.16,
    })
    expect(runtime.Polygon.mock.calls[1]?.[0]).toMatchObject({
      path: regions[1].geometry.coordinates[0],
      strokeColor: '#17231f',
      fillColor: '#17231f',
      fillOpacity: 0.035,
    })
  })

  it('clears old polygons on update and destroy', () => {
    const runtime = createRuntime()
    const map = {} as AMap.Map
    const layer = createAdminRegionLayer(runtime as unknown as Pick<typeof AMap, 'Polygon'>, map)

    layer.update([regions[0]])
    layer.update([])
    layer.destroy()

    expect(runtime.setMap).toHaveBeenCalledWith(null)
  })
})
