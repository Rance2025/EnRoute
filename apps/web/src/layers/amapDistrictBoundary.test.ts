import { describe, expect, it } from 'vitest'

import {
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
})
