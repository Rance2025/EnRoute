import type { FootprintPoint } from './footprintTypes'

type FootprintDataSourceEnv = {
  VITE_FOOTPRINT_API_URL?: string
}

const DEFAULT_FOOTPRINT_API_URL = '/api/footprints'

export async function loadFootprintPoints(
  apiUrl: string | undefined,
  signal: AbortSignal,
): Promise<FootprintPoint[]> {
  const trimmedUrl =
    apiUrl?.trim() ||
    (import.meta.env as FootprintDataSourceEnv).VITE_FOOTPRINT_API_URL?.trim() ||
    DEFAULT_FOOTPRINT_API_URL

  const response = await fetch(trimmedUrl, { signal })
  if (!response.ok) {
    throw new Error(`Failed to load footprint API: ${response.status}`)
  }

  return parseFootprintApiResponse(await response.json())
}

function parseFootprintApiResponse(payload: unknown): FootprintPoint[] {
  if (!isFootprintApiResponse(payload)) {
    throw new Error('Invalid footprint API response')
  }

  return payload.points
}

function isFootprintApiResponse(payload: unknown): payload is { points: FootprintPoint[] } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'points' in payload &&
    Array.isArray(payload.points) &&
    payload.points.every(isFootprintPoint)
  )
}

function isFootprintPoint(point: unknown): point is FootprintPoint {
  if (typeof point !== 'object' || point === null) return false

  const candidate = point as Partial<Record<keyof FootprintPoint, unknown>>

  return (
    typeof candidate.id === 'string' &&
    isFiniteNumber(candidate.timestampSeconds) &&
    isFiniteNumber(candidate.longitude) &&
    isFiniteNumber(candidate.latitude) &&
    isFiniteNumber(candidate.accuracy) &&
    isFiniteNumber(candidate.speed) &&
    isFiniteNumber(candidate.distance) &&
    isFiniteNumber(candidate.heading) &&
    isFiniteNumber(candidate.altitude) &&
    isFiniteNumber(candidate.locType) &&
    isFiniteNumber(candidate.isBackForeground) &&
    isFiniteNumber(candidate.stepType)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
