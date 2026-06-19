import { projectLngLat, unprojectWorldPoint } from '../config/mercator'
import type { AggregatedFootprintPoint, FootprintPoint, LngLatBounds } from './footprintTypes'

type AggregateFootprintPointsInput = {
  points: FootprintPoint[]
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
}

type Bucket = {
  count: number
  sumX: number
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
}: AggregateFootprintPointsInput): AggregatedFootprintPoint[] {
  const buckets = new Map<string, Bucket>()

  for (const point of points) {
    if (!isPointInsideBounds(point, viewportBounds)) continue

    const projected = projectLngLat([point.longitude, point.latitude], zoom)
    const bucketX = Math.floor(projected.x / cellSizePx)
    const bucketY = Math.floor(projected.y / cellSizePx)
    const bucketKey = `${bucketX}:${bucketY}`
    const bucket = buckets.get(bucketKey)

    if (!bucket) {
      buckets.set(bucketKey, {
        count: 1,
        sumX: projected.x,
        sumY: projected.y,
        minAccuracy: point.accuracy,
        startTimestampSeconds: point.timestampSeconds,
        endTimestampSeconds: point.timestampSeconds,
      })
      continue
    }

    bucket.count += 1
    bucket.sumX += projected.x
    bucket.sumY += projected.y
    bucket.minAccuracy = Math.min(bucket.minAccuracy, point.accuracy)
    bucket.startTimestampSeconds = Math.min(bucket.startTimestampSeconds, point.timestampSeconds)
    bucket.endTimestampSeconds = Math.max(bucket.endTimestampSeconds, point.timestampSeconds)
  }

  return [...buckets.entries()].map(([id, bucket]) => {
    const [longitude, latitude] = unprojectWorldPoint(
      {
        x: bucket.sumX / bucket.count,
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

function isPointInsideBounds(point: FootprintPoint, bounds: LngLatBounds) {
  return (
    point.longitude >= bounds.west &&
    point.longitude <= bounds.east &&
    point.latitude >= bounds.south &&
    point.latitude <= bounds.north
  )
}
