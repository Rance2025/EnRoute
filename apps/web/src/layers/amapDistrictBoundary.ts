type AmapBoundaryLngLat = {
  getLng?: () => number
  getLat?: () => number
  lng?: number
  lat?: number
}

export type AmapBoundaryPath = AMap.LngLatLike[]

export type AmapDistrictBoundarySummary = {
  ringCount: number
  pointCount: number
}

export function extractDistrictBoundaryPaths(boundaries: unknown): AmapBoundaryPath[] {
  if (!Array.isArray(boundaries)) return []

  return boundaries
    .map((boundary) => extractBoundaryPath(boundary))
    .filter((path) => path.length >= 3)
}

export function summarizeDistrictBoundary(paths: AmapBoundaryPath[]): AmapDistrictBoundarySummary {
  return {
    ringCount: paths.length,
    pointCount: paths.reduce((total, path) => total + path.length, 0),
  }
}

function extractBoundaryPath(boundary: unknown): AmapBoundaryPath {
  if (!Array.isArray(boundary)) return []

  return boundary
    .map((point) => extractLngLat(point))
    .filter((point): point is AMap.LngLatLike => point !== null)
}

function extractLngLat(point: unknown): AMap.LngLatLike | null {
  if (Array.isArray(point) && point.length >= 2) {
    const lng = Number(point[0])
    const lat = Number(point[1])

    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  if (!point || typeof point !== 'object') return null

  const amapPoint = point as AmapBoundaryLngLat
  const lng = typeof amapPoint.getLng === 'function'
    ? amapPoint.getLng()
    : Number(amapPoint.lng)
  const lat = typeof amapPoint.getLat === 'function'
    ? amapPoint.getLat()
    : Number(amapPoint.lat)

  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
}
