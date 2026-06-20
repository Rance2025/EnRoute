import { describe, expect, it } from 'vitest'

import { transformFootprintCoordinate } from './footprintCoordinates'

describe('transformFootprintCoordinate', () => {
  it('converts WGS84 coordinates inside China to GCJ-02', () => {
    expect(
      transformFootprintCoordinate({
        longitude: 116.397128,
        latitude: 39.916527,
        sourceCoordinateSystem: 'wgs84',
      }),
    ).toEqual({
      longitude: expect.closeTo(116.403372, 6),
      latitude: expect.closeTo(39.917931, 6),
    })
  })

  it('keeps WGS84 coordinates outside China unchanged', () => {
    expect(
      transformFootprintCoordinate({
        longitude: -122.4194,
        latitude: 37.7749,
        sourceCoordinateSystem: 'wgs84',
      }),
    ).toEqual({
      longitude: -122.4194,
      latitude: 37.7749,
    })
  })

  it.each(['gcj02', 'none'] as const)(
    'keeps coordinates unchanged when the source is %s',
    (sourceCoordinateSystem) => {
      expect(
        transformFootprintCoordinate({
          longitude: 121.511383,
          latitude: 31.296564,
          sourceCoordinateSystem,
        }),
      ).toEqual({
        longitude: 121.511383,
        latitude: 31.296564,
      })
    },
  )
})
