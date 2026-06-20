import { projectLngLat, TILE_SIZE, unprojectWorldPoint } from '../config/mercator'
import type {
  AggregatedFootprintPoint,
  FootprintRenderSnapshot,
  FootprintPoint,
  LngLatBounds,
  WorldPixelPoint,
} from './footprintTypes'
import {
  calculateFootprintLngLatBounds,
  calculateFootprintMetricsForTimestamps,
  filterFootprintPointsByTimestampRange,
} from './footprintSelectors'

type AggregateFootprintPointsInput = {
  points: FootprintPoint[]
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
  viewportNorthWestWorldPixel?: WorldPixelPoint
}

type FootprintRenderSnapshotInput = AggregateFootprintPointsInput & {
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
    dayCount: number
  }
}

type Bucket = {
  count: number
  sumRelativeX: number
  sumY: number
  minAccuracy: number
  startTimestampSeconds: number
  endTimestampSeconds: number
}

export function aggregateFootprintPoints({
  points,
  zoom,
  cellSizePx,
  viewportBounds,
  viewportNorthWestWorldPixel = projectLngLat([viewportBounds.west, viewportBounds.north], zoom),
}: AggregateFootprintPointsInput): AggregatedFootprintPoint[] {
  const buckets = new Map<string, Bucket>()
  const worldWidthPx = TILE_SIZE * 2 ** zoom

  for (const point of points) {
    if (!isPointInsideBounds(point, viewportBounds)) continue

    const projected = projectLngLat([point.longitude, point.latitude], zoom)
    const relativeX = normalizeViewportRelativeWorldX(
      projected.x,
      viewportNorthWestWorldPixel.x,
      worldWidthPx,
    )
    const bucketX = Math.floor(relativeX / cellSizePx)
    const bucketY = Math.floor((projected.y - viewportNorthWestWorldPixel.y) / cellSizePx)
    const bucketKey = `${bucketX}:${bucketY}`
    const bucket = buckets.get(bucketKey)

    if (!bucket) {
      buckets.set(bucketKey, {
        count: 1,
        sumRelativeX: relativeX,
        sumY: projected.y,
        minAccuracy: point.accuracy,
        startTimestampSeconds: point.timestampSeconds,
        endTimestampSeconds: point.timestampSeconds,
      })
      continue
    }

    bucket.count += 1
    bucket.sumRelativeX += relativeX
    bucket.sumY += projected.y
    bucket.minAccuracy = Math.min(bucket.minAccuracy, point.accuracy)
    bucket.startTimestampSeconds = Math.min(bucket.startTimestampSeconds, point.timestampSeconds)
    bucket.endTimestampSeconds = Math.max(bucket.endTimestampSeconds, point.timestampSeconds)
  }

  return [...buckets.entries()].map(([id, bucket]) => {
    const averageX = normalizeWorldX(
      viewportNorthWestWorldPixel.x + bucket.sumRelativeX / bucket.count,
      worldWidthPx,
    )
    const [longitude, latitude] = unprojectWorldPoint(
      {
        x: averageX,
        y: bucket.sumY / bucket.count,
      },
      zoom,
    )

    return {
      id,
      longitude,
      latitude,
      count: bucket.count,
      minAccuracy: bucket.minAccuracy,
      startTimestampSeconds: bucket.startTimestampSeconds,
      endTimestampSeconds: bucket.endTimestampSeconds,
    }
  })
}

export function createFootprintRenderSnapshot({
  points,
  timeRange,
  zoom,
  cellSizePx,
  viewportBounds,
  viewportNorthWestWorldPixel,
}: FootprintRenderSnapshotInput): FootprintRenderSnapshot {
  const selectedPoints = filterFootprintPointsByTimestampRange(points, timeRange)

  return {
    points: aggregateFootprintPoints({
      points: selectedPoints,
      zoom,
      cellSizePx,
      viewportBounds,
      viewportNorthWestWorldPixel,
    }),
    metrics: calculateFootprintMetricsForTimestamps(points, timeRange),
    selectedBounds: calculateFootprintLngLatBounds(selectedPoints),
  }
}

function isPointInsideBounds(point: FootprintPoint, bounds: LngLatBounds) {
  return (
    isLongitudeInsideBounds(point.longitude, bounds) &&
    point.latitude >= bounds.south &&
    point.latitude <= bounds.north
  )
}

function isLongitudeInsideBounds(longitude: number, bounds: LngLatBounds) {
  if (bounds.west <= bounds.east) {
    return longitude >= bounds.west && longitude <= bounds.east
  }

  return longitude >= bounds.west || longitude <= bounds.east
}

function normalizeViewportRelativeWorldX(projectedX: number, originX: number, worldWidthPx: number) {
  const relativeX = projectedX - originX

  return relativeX < 0 ? relativeX + worldWidthPx : relativeX
}

function normalizeWorldX(x: number, worldWidthPx: number) {
  const normalizedX = x % worldWidthPx

  return normalizedX < 0 ? normalizedX + worldWidthPx : normalizedX
}
