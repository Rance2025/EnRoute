import type { TimeRangeSelection } from '../time/timeRange'
import type { AdminRegionDepth } from './adminRegionVectorTileSource'

export type AdminRegionBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type AdminRegionRanking = {
  rank: number
  regionId: string
  name: string
  footprintCount: number
  bounds: AdminRegionBounds
}

export type AdminRegionSummary = {
  depth: AdminRegionDepth
  visitedRegionIds: string[]
  visitedCount: number
  totalCount: number
  thumbnail: {
    viewBox: string
    basePath: string
    visitedPath: string
  }
  rankings: AdminRegionRanking[]
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
    isAdminRegionThumbnail(value.thumbnail) &&
    Array.isArray(value.rankings) &&
    value.rankings.every(isAdminRegionRanking)
  )
}

function isAdminRegionDepth(value: unknown): value is AdminRegionDepth {
  return value === 1 || value === 2 || value === 3 || value === 4
}

function isAdminRegionThumbnail(value: unknown): value is AdminRegionSummary['thumbnail'] {
  return (
    isRecord(value) &&
    typeof value.viewBox === 'string' &&
    typeof value.basePath === 'string' &&
    typeof value.visitedPath === 'string'
  )
}

function isAdminRegionRanking(value: unknown): value is AdminRegionRanking {
  return (
    isRecord(value) &&
    isPositiveInteger(value.rank) &&
    typeof value.regionId === 'string' &&
    typeof value.name === 'string' &&
    isNonNegativeInteger(value.footprintCount) &&
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
