import { describe, expect, it } from 'vitest'

import { formatAverageDistanceMeters, formatDistanceMeters } from './mapMetricFormat'

describe('map metric formatting', () => {
  it('formats footprint distances with meter and kilometer thresholds', () => {
    expect(formatDistanceMeters(0)).toBe('0 m')
    expect(formatDistanceMeters(9_999)).toBe('9,999 m')
    expect(formatDistanceMeters(10_000)).toBe('10 km')
    expect(formatDistanceMeters(12_345)).toBe('12.3 km')
  })

  it('formats average footprint distances with one fixed decimal place', () => {
    expect(formatAverageDistanceMeters(0)).toBe('0 m')
    expect(formatAverageDistanceMeters(123.44)).toBe('123.4 m')
    expect(formatAverageDistanceMeters(9_999.94)).toBe('9,999.9 m')
    expect(formatAverageDistanceMeters(10_000)).toBe('10.0 km')
    expect(formatAverageDistanceMeters(12_345)).toBe('12.3 km')
  })
})
