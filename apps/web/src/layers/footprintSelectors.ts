import { createTimeRangeTimestamps, type TimeRangeSelection } from '../time/timeRange'
import type { FootprintDistanceSeries, FootprintPoint } from './footprintTypes'

const QUARTER_HOUR_SECONDS = 15 * 60
const QUARTER_HOURS_PER_DAY = 24 * 4

export type FootprintMetricSnapshot = {
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
  distanceSeries: FootprintDistanceSeries
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
    averageDistanceMetersPerDay:
      totalDistanceMeters / getElapsedDayCountForAverage(timeRange),
    distanceSeries: calculateDistanceSeries(points, timeRange),
  }
}

function getElapsedDayCountForAverage(timeRange: {
  startTimestampSeconds: number
  endTimestampSeconds: number
}) {
  const nowTimestampSeconds = Math.floor(Date.now() / 1000)
  const effectiveEndTimestampSeconds = Number.isFinite(timeRange.endTimestampSeconds)
    ? Math.min(timeRange.endTimestampSeconds, nowTimestampSeconds)
    : nowTimestampSeconds
  const startDate = shanghaiDateFromTimestampSeconds(timeRange.startTimestampSeconds)
  const effectiveEndDate = shanghaiDateFromTimestampSeconds(effectiveEndTimestampSeconds)

  if (effectiveEndDate < startDate) return 1

  const millisecondsPerDay = 24 * 60 * 60 * 1000

  return Math.max(
    Math.floor((effectiveEndDate.getTime() - startDate.getTime()) / millisecondsPerDay) + 1,
    1,
  )
}

function calculateDistanceSeries(
  points: FootprintPoint[],
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
    dayCount: number
  },
): FootprintDistanceSeries {
  if (Math.max(timeRange.dayCount, 1) === 1) {
    return calculateQuarterHourDistanceSeries(points, timeRange)
  }

  return calculateDailyDistanceSeries(points, timeRange)
}

function calculateQuarterHourDistanceSeries(
  points: FootprintPoint[],
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
  },
): FootprintDistanceSeries {
  const startDate = shanghaiDateFromTimestampSeconds(timeRange.startTimestampSeconds)
  const dayStartTimestampSeconds = shanghaiDateStartTimestampSeconds(startDate)
  const distanceByBucket = new Map<number, number>()

  for (const point of points) {
    if (!isPointInTimestampRange(point, timeRange)) continue
    if (!Number.isFinite(point.distance) || point.distance <= 0) continue

    const bucketIndex = Math.floor(
      (point.timestampSeconds - dayStartTimestampSeconds) / QUARTER_HOUR_SECONDS,
    )
    distanceByBucket.set(
      bucketIndex,
      (distanceByBucket.get(bucketIndex) ?? 0) + point.distance,
    )
  }

  const dateKey = formatDateKey(startDate)

  return {
    granularity: 'quarter-hour',
    unit: 'quarter-hour',
    buckets: Array.from({ length: QUARTER_HOURS_PER_DAY }, (_, bucketIndex) => {
      const hour = Math.floor(bucketIndex / 4)
      const minute = (bucketIndex % 4) * 15
      const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

      return {
        key: `${dateKey}T${label}`,
        label,
        distanceMeters: distanceByBucket.get(bucketIndex) ?? 0,
      }
    }),
  }
}

function calculateDailyDistanceSeries(
  points: FootprintPoint[],
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
  },
): FootprintDistanceSeries {
  const selectedPoints = points.filter((point) => isPointInTimestampRange(point, timeRange))
  const effectiveEndTimestampSeconds = Number.isFinite(timeRange.endTimestampSeconds)
    ? timeRange.endTimestampSeconds
    : selectedPoints.reduce(
        (latestTimestampSeconds, point) => Math.max(latestTimestampSeconds, point.timestampSeconds),
        timeRange.startTimestampSeconds,
      )
  const startDate = shanghaiDateFromTimestampSeconds(timeRange.startTimestampSeconds)
  const endDate = shanghaiDateFromTimestampSeconds(effectiveEndTimestampSeconds)
  const distanceByDate = new Map<string, number>()

  for (const point of selectedPoints) {
    if (!Number.isFinite(point.distance) || point.distance <= 0) continue

    const key = formatDateKey(shanghaiDateFromTimestampSeconds(point.timestampSeconds))
    distanceByDate.set(key, (distanceByDate.get(key) ?? 0) + point.distance)
  }

  const buckets: FootprintDistanceSeries['buckets'] = []
  const currentDate = new Date(startDate)

  while (currentDate <= endDate) {
    const key = formatDateKey(currentDate)
    buckets.push({
      key,
      label: `${currentDate.getMonth() + 1}月${currentDate.getDate()}日`,
      distanceMeters: distanceByDate.get(key) ?? 0,
    })
    currentDate.setDate(currentDate.getDate() + 1)
  }

  return {
    granularity: 'day',
    unit: 'day',
    buckets,
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

function shanghaiDateFromTimestampSeconds(timestampSeconds: number) {
  const shanghaiTimestampMilliseconds = (timestampSeconds + 8 * 60 * 60) * 1000
  const date = new Date(shanghaiTimestampMilliseconds)

  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )
}

function shanghaiDateStartTimestampSeconds(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 1000 - 8 * 60 * 60
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}
