import { describe, expect, it } from 'vitest'

import {
  createDistrictBoundaryGeoJson,
  extractDistrictBoundaryPaths,
  summarizeDistrictBoundary,
} from './amapDistrictBoundary'

function lngLat(lng: number, lat: number) {
  return {
    getLng: () => lng,
    getLat: () => lat,
  }
}

describe('AMap district boundary parsing', () => {
  it('converts AMap boundary rings into polygon paths', () => {
    const paths = extractDistrictBoundaryPaths([
      [lngLat(121, 31), lngLat(122, 31), lngLat(121, 31)],
      [lngLat(120, 30), lngLat(121, 30), lngLat(120, 30)],
    ])

    expect(paths).toEqual([
      [[121, 31], [122, 31], [121, 31]],
      [[120, 30], [121, 30], [120, 30]],
    ])
  })

  it('summarizes multi-part district boundaries for visual quality checks', () => {
    expect(summarizeDistrictBoundary([
      [[121, 31], [122, 31], [121, 31]],
      [[120, 30], [121, 30], [121, 31], [120, 30]],
    ])).toEqual({
      ringCount: 2,
      pointCount: 7,
    })
  })

  it('creates a Mapbox-compatible GeoJSON multipolygon from AMap boundary paths', () => {
    expect(createDistrictBoundaryGeoJson({
      name: '浦东新区',
      adcode: '310115',
      level: 'district',
      paths: [
        [[121, 31], [122, 31], [121.5, 32]],
        [[120, 30], [121, 30], [120.5, 31]],
      ],
    })).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          name: '浦东新区',
          adcode: '310115',
          level: 'district',
          ringCount: 2,
          pointCount: 6,
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[121, 31], [122, 31], [121.5, 32], [121, 31]]],
            [[[120, 30], [121, 30], [120.5, 31], [120, 30]]],
          ],
        },
      }],
    })
  })

  it('drops degenerate rings that cannot form valid GeoJSON polygons', () => {
    expect(createDistrictBoundaryGeoJson({
      name: 'invalid',
      adcode: '000000',
      level: 'district',
      paths: [
        [[121, 31], [122, 31], [121, 31]],
      ],
    }).features[0].geometry.coordinates).toEqual([])
  })

  it('converts AMap GCJ-02 boundary paths to WGS84 for Mapbox overlays', () => {
    const geoJson = createDistrictBoundaryGeoJson({
      name: '北京市',
      adcode: '110000',
      level: 'province',
      targetCoordinateSystem: 'wgs84',
      paths: [
        [
          [116.403372, 39.917931],
          [116.404372, 39.917931],
          [116.403372, 39.918931],
        ],
      ],
    })

    expect(geoJson.features[0].geometry.coordinates[0][0][0]).toEqual([
      expect.closeTo(116.397128, 6),
      expect.closeTo(39.916527, 6),
    ])
  })
})
