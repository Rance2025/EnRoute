import { describe, expect, it } from 'vitest'

import { aggregateFootprintPoints } from './footprintAggregation'
import type { FootprintPoint } from './footprintTypes'

const basePoint: Omit<FootprintPoint, 'id' | 'longitude' | 'latitude' | 'timestampSeconds'> = {
  accuracy: 5,
  speed: -1,
  distance: 0,
  heading: 0,
  altitude: 0,
  locType: 1,
  isBackForeground: 1,
  stepType: 0,
}

function point(id: string, longitude: number, latitude: number): FootprintPoint {
  return {
    ...basePoint,
    id,
    longitude,
    latitude,
    timestampSeconds: 1768144456 + Number(id),
  }
}

describe('aggregateFootprintPoints', () => {
  it('merges very close points into one bucket within the viewport', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', 121.511383, 31.296564), point('2', 121.511384, 31.296565)],
      zoom: 16,
      cellSizePx: 8,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(2)
  })

  it('returns more or equal representatives when zoom increases', () => {
    const points = [point('1', 121.511383, 31.296564), point('2', 121.5122, 31.2973)]
    const lowZoom = aggregateFootprintPoints({
      points,
      zoom: 12,
      cellSizePx: 12,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })
    const highZoom = aggregateFootprintPoints({
      points,
      zoom: 18,
      cellSizePx: 12,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })

    expect(lowZoom.length).toBeLessThanOrEqual(highZoom.length)
  })

  it('filters points outside viewport bounds', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', 121.511383, 31.296564), point('2', 118, 30)],
      zoom: 14,
      cellSizePx: 8,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(1)
  })
})
