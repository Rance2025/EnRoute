import type {
  AggregatedFootprintPoint,
  FootprintLngLatBounds,
  FootprintRenderSnapshot,
  LngLatBounds,
  WorldPixelPoint,
} from './footprintTypes'
import type { TimeRangeTimestamps } from '../time/timeRange'

type FootprintDataSourceEnv = {
  VITE_FOOTPRINT_API_URL?: string
}

export type FootprintSnapshotRequest = {
  timeRange: TimeRangeTimestamps
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
  viewportNorthWestWorldPixel: WorldPixelPoint
}

export type FootprintRenderDebug = {
  rawCount: number
  renderedCount: number
  renderRatio: number
}

export type FootprintSnapshot = FootprintRenderSnapshot & {
  debug: FootprintRenderDebug
}

const DEFAULT_FOOTPRINT_API_URL = '/api/footprints/snapshot'
const OPEN_ENDED_TIMESTAMP_SECONDS = 8_640_000_000_000

export async function loadFootprintSnapshot(
  apiUrl: string | undefined,
  input: FootprintSnapshotRequest,
  signal: AbortSignal,
): Promise<FootprintSnapshot> {
  const trimmedUrl =
    apiUrl?.trim() ||
    (import.meta.env as FootprintDataSourceEnv).VITE_FOOTPRINT_API_URL?.trim() ||
    DEFAULT_FOOTPRINT_API_URL
  const snapshotUrl = normalizeSnapshotApiUrl(trimmedUrl)

  const response = await fetch(snapshotUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createSerializableSnapshotRequest(input)),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load footprint API: ${response.status}`)
  }

  return parseFootprintSnapshotResponse(await response.json())
}

function createSerializableSnapshotRequest(input: FootprintSnapshotRequest): FootprintSnapshotRequest {
  return {
    ...input,
    timeRange: {
      ...input.timeRange,
      endTimestampSeconds: Number.isFinite(input.timeRange.endTimestampSeconds)
        ? input.timeRange.endTimestampSeconds
        : OPEN_ENDED_TIMESTAMP_SECONDS,
    },
  }
}

function normalizeSnapshotApiUrl(url: string) {
  return url.replace(/\/api\/footprints\/?$/, '/api/footprints/snapshot')
}

function parseFootprintSnapshotResponse(payload: unknown): FootprintSnapshot {
  if (!isFootprintSnapshot(payload)) {
    throw new Error('Invalid footprint API response')
  }

  return payload
}

function isFootprintSnapshot(payload: unknown): payload is FootprintSnapshot {
  if (typeof payload !== 'object' || payload === null) return false

  const candidate = payload as Partial<FootprintSnapshot>

  return (
    Array.isArray(candidate.points) &&
    candidate.points.every(isAggregatedFootprintPoint) &&
    isMetrics(candidate.metrics) &&
    isFootprintLngLatBoundsOrNull(candidate.selectedBounds) &&
    isDebug(candidate.debug)
  )
}

function isAggregatedFootprintPoint(point: unknown): point is AggregatedFootprintPoint {
  if (typeof point !== 'object' || point === null) return false

  const candidate = point as Partial<Record<keyof AggregatedFootprintPoint, unknown>>

  return (
    typeof candidate.id === 'string' &&
    isFiniteNumber(candidate.longitude) &&
    isFiniteNumber(candidate.latitude) &&
    isFiniteNumber(candidate.count) &&
    isFiniteNumber(candidate.minAccuracy) &&
    isFiniteNumber(candidate.startTimestampSeconds) &&
    isFiniteNumber(candidate.endTimestampSeconds)
  )
}

function isMetrics(metrics: unknown): metrics is FootprintSnapshot['metrics'] {
  if (typeof metrics !== 'object' || metrics === null) return false

  const candidate = metrics as Partial<Record<keyof FootprintSnapshot['metrics'], unknown>>

  return (
    isFiniteNumber(candidate.selectedCount) &&
    isFiniteNumber(candidate.totalDistanceMeters) &&
    isFiniteNumber(candidate.averageDistanceMetersPerDay)
  )
}

function isDebug(debug: unknown): debug is FootprintRenderDebug {
  if (typeof debug !== 'object' || debug === null) return false

  const candidate = debug as Partial<Record<keyof FootprintRenderDebug, unknown>>

  return (
    isFiniteNumber(candidate.rawCount) &&
    isFiniteNumber(candidate.renderedCount) &&
    isFiniteNumber(candidate.renderRatio)
  )
}

function isFootprintLngLatBoundsOrNull(bounds: unknown): bounds is FootprintLngLatBounds | null {
  if (bounds === null) return true
  if (typeof bounds !== 'object') return false

  const candidate = bounds as Partial<FootprintLngLatBounds>

  return isLngLatPair(candidate.southWest) && isLngLatPair(candidate.northEast)
}

function isLngLatPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
