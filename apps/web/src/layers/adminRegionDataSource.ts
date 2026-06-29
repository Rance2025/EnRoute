import type {
  AdminRegion,
  AdminRegionGeometry,
  AdminRegionLevel,
  AdminRegionRequestInput,
} from './adminRegionTypes'

const DEFAULT_ADMIN_REGION_API_URL = '/api/admin-regions'

export async function loadAdminRegions(
  apiUrl: string | undefined,
  input: AdminRegionRequestInput,
  signal: AbortSignal,
): Promise<AdminRegion[]> {
  const baseUrl = apiUrl?.trim() || DEFAULT_ADMIN_REGION_API_URL
  const response = await fetch(createAdminRegionUrl(baseUrl, input), {
    method: 'GET',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load admin regions API: ${response.status}`)
  }

  const payload = await response.json()
  if (!isAdminRegionResponse(payload)) {
    throw new Error('Invalid admin regions API response')
  }

  return payload.regions
}

function createAdminRegionUrl(baseUrl: string, input: AdminRegionRequestInput) {
  const searchParams = new URLSearchParams({
    level: String(input.level),
    west: String(input.viewportBounds.west),
    south: String(input.viewportBounds.south),
    east: String(input.viewportBounds.east),
    north: String(input.viewportBounds.north),
    zoom: String(input.zoom),
  })
  return `${baseUrl}?${searchParams.toString()}`
}

function isAdminRegionResponse(payload: unknown): payload is { regions: AdminRegion[] } {
  if (typeof payload !== 'object' || payload === null) return false

  const candidate = payload as { regions?: unknown }
  return Array.isArray(candidate.regions) && candidate.regions.every(isAdminRegion)
}

function isAdminRegion(value: unknown): value is AdminRegion {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<AdminRegion>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isAdminRegionLevel(candidate.level) &&
    isAdminRegionGeometry(candidate.geometry) &&
    (candidate.firstSeenTimestamp === null || isFiniteNumber(candidate.firstSeenTimestamp)) &&
    isFiniteNumber(candidate.footprintCount) &&
    isFiniteNumber(candidate.stayDurationSeconds) &&
    isFiniteNumber(candidate.travelDistanceMeters)
  )
}

function isAdminRegionLevel(value: unknown): value is AdminRegionLevel {
  return value === 1 || value === 2 || value === 3
}

function isAdminRegionGeometry(value: unknown): value is AdminRegionGeometry {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<AdminRegionGeometry>
  return (
    (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') &&
    Array.isArray(candidate.coordinates)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
