import type { MapBounds } from './mapCamera'

export const TILE_SIZE = 256
export const AMAP_MIN_ZOOM = 2
export const MAX_MERCATOR_LATITUDE = 85.05112878
const POLAR_EDGE_CROP_FACTOR = 1.27

export type WorldPoint = {
  x: number
  y: number
}

export function calculateMinimumZoomForWorldCoverage(viewportHeight: number) {
  return Math.max(
    roundZoomUpToAmapPrecision(Math.log2((viewportHeight * POLAR_EDGE_CROP_FACTOR) / TILE_SIZE)),
    AMAP_MIN_ZOOM,
  )
}

export function projectLngLat([lng, lat]: [number, number], zoom: number): WorldPoint {
  const scale = TILE_SIZE * 2 ** zoom
  const clampedLat = Math.min(Math.max(lat, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE)
  const sinLat = Math.sin((clampedLat * Math.PI) / 180)

  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
}

export function unprojectWorldPoint(point: WorldPoint, zoom: number): [number, number] {
  const scale = TILE_SIZE * 2 ** zoom
  const lng = (point.x / scale) * 360 - 180
  const latRadians = Math.atan(Math.sinh(Math.PI * (1 - (2 * point.y) / scale)))

  return [lng, (latRadians * 180) / Math.PI]
}

export function calculateLatitudeMidpoint(bounds: MapBounds) {
  const northWorld = projectLngLat([0, bounds.northEast[1]], AMAP_MIN_ZOOM)
  const southWorld = projectLngLat([0, bounds.southWest[1]], AMAP_MIN_ZOOM)

  return unprojectWorldPoint(
    {
      x: northWorld.x,
      y: (northWorld.y + southWorld.y) / 2,
    },
    AMAP_MIN_ZOOM,
  )[1]
}

export function isAtMinimumWorldZoom(zoom: number, viewportHeight: number) {
  return zoom <= calculateMinimumZoomForWorldCoverage(viewportHeight) + 0.000001
}

function roundZoomUpToAmapPrecision(zoom: number) {
  return Math.ceil(zoom * 100) / 100
}
