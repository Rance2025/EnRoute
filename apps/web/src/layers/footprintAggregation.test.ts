import { describe, expect, it } from 'vitest'

import { aggregateFootprintPoints, createFootprintRenderSnapshot } from './footprintAggregation'
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

function timedPoint(
  id: string,
  timestampSeconds: number,
  longitude: number,
  latitude: number,
  distance = 0,
): FootprintPoint {
  return {
    ...basePoint,
    id,
    longitude,
    latitude,
    timestampSeconds,
    distance,
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

  it('buckets by the current viewport screen-pixel origin instead of global world-pixel origin', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', -179.998764038, 0), point('2', -179.998352051, 0)],
      zoom: 10,
      cellSizePx: 1,
      viewportBounds: { west: -180, south: -1, east: -179, north: 1 },
      viewportNorthWestWorldPixel: {
        x: 0.6,
        y: 131071,
      },
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

  it('keeps points inside a viewport that wraps across the world edge', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', 121.511383, 31.296564), point('2', -30, 31.296564)],
      zoom: 2,
      cellSizePx: 8,
      viewportBounds: { west: 60, south: 20, east: -160, north: 45 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(1)
    expect(result[0].longitude).toBeCloseTo(121.511383, 5)
  })

  it('keeps points visible when the viewport spans the full world longitude range', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', 121.511383, 31.296564), point('2', -30, 31.296564)],
      zoom: 2,
      cellSizePx: 8,
      viewportBounds: { west: -180, south: -85.05112878, east: 180, north: 85.05112878 },
    })

    expect(result.map((sample) => sample.count).reduce((sum, count) => sum + count, 0)).toBe(2)
  })

  it('keeps an antimeridian bucket representative near the wrapped world edge', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', 179.999, 0), point('2', -179.999, 0)],
      zoom: 10,
      cellSizePx: 10,
      viewportBounds: { west: 179.99, south: -1, east: -179.99, north: 1 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(2)
    expect(Math.abs(Math.abs(result[0].longitude) - 180)).toBeLessThan(0.01)
  })

  it('returns a render snapshot with exact range metrics and sampled viewport representatives', () => {
    const selectedA = timedPoint('selected-a', 1781798400, 121.511383, 31.296564, 100)
    const selectedB = timedPoint('selected-b', 1781840000, 121.511384, 31.296565, 250)
    const selectedOutOfView = timedPoint('selected-out-of-view', 1781840100, 118, 30, 50)
    const after = timedPoint('after', 1781884800, 121.511385, 31.296566, 999)

    const snapshot = createFootprintRenderSnapshot({
      points: [selectedA, selectedB, selectedOutOfView, after],
      timeRange: {
        startTimestampSeconds: 1781798400,
        endTimestampSeconds: 1781884799,
        dayCount: 1,
      },
      zoom: 16,
      cellSizePx: 8,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })

    expect(snapshot.metrics).toEqual({
      selectedCount: 3,
      totalDistanceMeters: 400,
      averageDistanceMetersPerDay: 400,
      distanceSeries: {
        granularity: 'quarter-hour',
        unit: 'quarter-hour',
        buckets: Array.from({ length: 96 }, (_, bucketIndex) => {
          const hour = Math.floor(bucketIndex / 4)
          const minute = (bucketIndex % 4) * 15
          const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

          return {
            key: `2026-06-19T${label}`,
            label,
            distanceMeters: { 0: 100, 46: 300 }[bucketIndex] ?? 0,
          }
        }),
      },
    })
    expect(snapshot.selectedBounds).toEqual({
      southWest: [118, 30],
      northEast: [121.511384, 31.296565],
    })
    expect(snapshot.points).toHaveLength(1)
    expect(snapshot.points[0]).toMatchObject({ count: 2 })
  })
})
