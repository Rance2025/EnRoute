import { transformGcj02ToWgs84Coordinate } from './footprintCoordinates'

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

export type DistrictBoundaryGeoJsonInput = {
  name: string
  adcode: string
  level: AMap.DistrictSearchLevel
  paths: AmapBoundaryPath[]
  targetCoordinateSystem?: 'gcj02' | 'wgs84'
}

export type DistrictBoundaryFeatureCollection = {
  type: 'FeatureCollection'
  features: DistrictBoundaryFeature[]
}

export type DistrictBoundaryFeature = {
  type: 'Feature'
  properties: {
    name: string
    adcode: string
    level: AMap.DistrictSearchLevel
    ringCount: number
    pointCount: number
  }
  geometry: {
    type: 'MultiPolygon'
    coordinates: AmapBoundaryPath[][]
  }
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

export function createDistrictBoundaryGeoJson({
  name,
  adcode,
  level,
  paths,
  targetCoordinateSystem = 'gcj02',
}: DistrictBoundaryGeoJsonInput): DistrictBoundaryFeatureCollection {
  const summary = summarizeDistrictBoundary(paths)
  const coordinates = paths
    .map((path) => targetCoordinateSystem === 'wgs84'
      ? path.map(transformAmapPointToWgs84)
      : path)
    .map(normalizeGeoJsonLinearRing)
    .filter((path): path is AmapBoundaryPath => path !== null)
    .map((path) => [path])

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name,
        adcode,
        level,
        ringCount: summary.ringCount,
        pointCount: summary.pointCount,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates,
      },
    }],
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

function transformAmapPointToWgs84([longitude, latitude]: AMap.LngLatLike): AMap.LngLatLike {
  const transformedCoordinate = transformGcj02ToWgs84Coordinate({ longitude, latitude })

  return [transformedCoordinate.longitude, transformedCoordinate.latitude]
}

function normalizeGeoJsonLinearRing(path: AmapBoundaryPath): AmapBoundaryPath | null {
  if (path.length < 3) return null

  const closedPath = isSameLngLat(path[0], path[path.length - 1])
    ? path
    : [...path, path[0]]
  const uniquePointCount = new Set(closedPath.map(([lng, lat]) => `${lng},${lat}`)).size

  return closedPath.length >= 4 && uniquePointCount >= 3 ? closedPath : null
}

function isSameLngLat([leftLng, leftLat]: AMap.LngLatLike, [rightLng, rightLat]: AMap.LngLatLike) {
  return leftLng === rightLng && leftLat === rightLat
}
