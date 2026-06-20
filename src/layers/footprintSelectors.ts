import { createTimeRangeTimestamps, type TimeRangeSelection } from '../time/timeRange'
import type { FootprintPoint } from './footprintTypes'

export type FootprintMetricSnapshot = {
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
}

export type FootprintLngLatBounds = {
  southWest: [number, number]
  northEast: [number, number]
}

export function filterFootprintPointsByTimeRange(
  points: FootprintPoint[],
  selection: TimeRangeSelection,
) {
  const { startTimestampSeconds, endTimestampSeconds } =
    createTimeRangeTimestamps(selection)

  return points.filter(
    (point) =>
      point.timestampSeconds >= startTimestampSeconds &&
      point.timestampSeconds <= endTimestampSeconds,
  )
}

export function calculateFootprintMetrics(
  points: FootprintPoint[],
  selection: TimeRangeSelection,
): FootprintMetricSnapshot {
  return calculateFootprintMetricsForTimestamps(points, createTimeRangeTimestamps(selection))
}

export function calculateFootprintMetricsForTimestamps(
  points: FootprintPoint[],
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
    dayCount: number
  },
): FootprintMetricSnapshot {
  let selectedCount = 0
  let totalDistanceMeters = 0

  for (const point of points) {
    if (!isPointInTimestampRange(point, timeRange)) continue

    selectedCount += 1
    if (Number.isFinite(point.distance) && point.distance > 0) {
      totalDistanceMeters += point.distance
    }
  }

  return {
    selectedCount,
    totalDistanceMeters,
    averageDistanceMetersPerDay: totalDistanceMeters / Math.max(timeRange.dayCount, 1),
  }
}

export function calculateFootprintLngLatBounds(
  points: FootprintPoint[],
): FootprintLngLatBounds | null {
  if (points.length === 0) return null

  let west = points[0].longitude
  let east = points[0].longitude
  let south = points[0].latitude
  let north = points[0].latitude

  for (const point of points) {
    west = Math.min(west, point.longitude)
    east = Math.max(east, point.longitude)
    south = Math.min(south, point.latitude)
    north = Math.max(north, point.latitude)
  }

  return {
    southWest: [west, south],
    northEast: [east, north],
  }
}

export function filterFootprintPointsByTimestampRange(
  points: FootprintPoint[],
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
  },
) {
  return points.filter((point) => isPointInTimestampRange(point, timeRange))
}

function isPointInTimestampRange(
  point: FootprintPoint,
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
  },
) {
  return (
    point.timestampSeconds >= timeRange.startTimestampSeconds &&
    point.timestampSeconds <= timeRange.endTimestampSeconds
  )
}
