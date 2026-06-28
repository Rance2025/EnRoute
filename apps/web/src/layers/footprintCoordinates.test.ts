import { describe, expect, it } from 'vitest'

import {
  transformFootprintCoordinate,
  transformGcj02ToWgs84Coordinate,
} from './footprintCoordinates'

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

describe('transformGcj02ToWgs84Coordinate', () => {
  it('converts GCJ-02 coordinates inside China back to WGS84', () => {
    expect(
      transformGcj02ToWgs84Coordinate({
        longitude: 116.403372,
        latitude: 39.917931,
      }),
    ).toEqual({
      longitude: expect.closeTo(116.397128, 6),
      latitude: expect.closeTo(39.916527, 6),
    })
  })

  it('keeps GCJ-02 coordinates outside China unchanged', () => {
    expect(
      transformGcj02ToWgs84Coordinate({
        longitude: -122.4194,
        latitude: 37.7749,
      }),
    ).toEqual({
      longitude: -122.4194,
      latitude: 37.7749,
    })
  })

  it('round-trips WGS84 coordinates through GCJ-02 with sub-meter drift', () => {
    const wgs84Coordinate = {
      longitude: 121.473701,
      latitude: 31.230416,
    }
    const gcj02Coordinate = transformFootprintCoordinate({
      ...wgs84Coordinate,
      sourceCoordinateSystem: 'wgs84',
    })

    expect(transformGcj02ToWgs84Coordinate(gcj02Coordinate)).toEqual({
      longitude: expect.closeTo(wgs84Coordinate.longitude, 6),
      latitude: expect.closeTo(wgs84Coordinate.latitude, 6),
    })
  })
})
