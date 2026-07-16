import type { TimeRangeSelection } from '../time/timeRange'
import type { AdminRegionDepth } from './adminRegionVectorTileSource'

export type AdminRegionBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type AdminRegionMetric = {
  regionId: string
  name: string
  footprintCount: number
  stayDurationSeconds: number
  travelDistanceMeters: number
  bounds: AdminRegionBounds
}

export type AdminRegionSummary = {
  depth: AdminRegionDepth
  visitedRegionIds: string[]
  visitedCount: number
  totalCount: number
  visitedPath: string
  regionMetrics: AdminRegionMetric[]
}

type LoadAdminRegionSummaryOptions = {
  baseUrl?: string
  depth: AdminRegionDepth
  timeRange: TimeRangeSelection
  signal: AbortSignal
  fetcher?: typeof fetch
}

export async function loadAdminRegionSummary({
  baseUrl = '/api/admin-regions/summary',
  depth,
  timeRange,
  signal,
  fetcher = fetch,
}: LoadAdminRegionSummaryOptions): Promise<AdminRegionSummary> {
  const searchParams = new URLSearchParams()
  searchParams.set('depth', String(depth))
  searchParams.set('start', timeRange.start)
  searchParams.set('end', timeRange.end)

  const response = await fetcher(`${baseUrl}?${searchParams.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`Admin-region summary request failed: ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!isAdminRegionSummary(payload)) {
    throw new Error('Invalid admin-region summary response')
  }

  return payload
}

function isAdminRegionSummary(value: unknown): value is AdminRegionSummary {
  return (
    isRecord(value) &&
    isAdminRegionDepth(value.depth) &&
    Array.isArray(value.visitedRegionIds) &&
    value.visitedRegionIds.every((regionId) => typeof regionId === 'string') &&
    isNonNegativeInteger(value.visitedCount) &&
    isNonNegativeInteger(value.totalCount) &&
    typeof value.visitedPath === 'string' &&
    Array.isArray(value.regionMetrics) &&
    value.regionMetrics.every(isAdminRegionMetric)
  )
}

function isAdminRegionDepth(value: unknown): value is AdminRegionDepth {
  return value === 1 || value === 2 || value === 3 || value === 4
}

function isAdminRegionMetric(value: unknown): value is AdminRegionMetric {
  return (
    isRecord(value) &&
    typeof value.regionId === 'string' &&
    typeof value.name === 'string' &&
    isNonNegativeInteger(value.footprintCount) &&
    isNonNegativeInteger(value.stayDurationSeconds) &&
    isNonNegativeFiniteNumber(value.travelDistanceMeters) &&
    isAdminRegionBounds(value.bounds)
  )
}

function isAdminRegionBounds(value: unknown): value is AdminRegionBounds {
  return (
    isRecord(value) &&
    isFiniteNumber(value.west) &&
    isFiniteNumber(value.south) &&
    isFiniteNumber(value.east) &&
    isFiniteNumber(value.north)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
