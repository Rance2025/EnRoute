import { createTimeRangeTimestamps, type TimeRangeSelection } from '../time/timeRange'
import type { FootprintPoint } from './footprintTypes'

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
