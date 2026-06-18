import { TILE_SIZE } from './mercator'

type LngLatPoint = {
  getLng: () => number
  getLat: () => number
}

export type WorldWidthMeasuringMap = {
  getZoom: () => number
  getCenter: () => LngLatPoint
  lnglatToPixel?: (lngLat: [number, number], level: number) => { x: number; y: number }
  lngLatToContainer: (lngLat: [number, number]) => { x: number; y: number }
}

type SingleWorldMapPaneLayoutOptions = {
  viewportWidth: number
  worldWidthPx: number
}

export const SINGLE_WORLD_MAP_GUARD_PX = 1

export function calculateSingleWorldMapPaneLayout({
  viewportWidth,
  worldWidthPx,
}: SingleWorldMapPaneLayoutOptions) {
  const maxMapPaneWidth = Math.max(Math.floor(worldWidthPx) - SINGLE_WORLD_MAP_GUARD_PX, 0)
  const mapPaneWidth = Math.min(Math.max(Math.floor(viewportWidth), 0), maxMapPaneWidth)

  return {
    mapPaneWidth,
    sidePanelWidth: Math.max(Math.floor(viewportWidth) - mapPaneWidth, 0),
  }
}

export function measureAmapWorldPixelWidthAtZoom(
  map: WorldWidthMeasuringMap,
  targetZoom: number,
) {
  const currentZoom = map.getZoom()
  const center = map.getCenter()
  const centerLng = center.getLng()

  if (typeof map.lnglatToPixel === 'function') {
    const westPixel = map.lnglatToPixel([centerLng - 180, 0], targetZoom)
    const eastPixel = map.lnglatToPixel([centerLng + 180, 0], targetZoom)
    const measuredPixelWidth = Math.abs(eastPixel.x - westPixel.x)

    if (Number.isFinite(measuredPixelWidth) && measuredPixelWidth > 0) {
      return measuredPixelWidth
    }
  }

  const west = map.lngLatToContainer([centerLng - 180, 0])
  const east = map.lngLatToContainer([centerLng + 180, 0])
  const measuredWidth = Math.abs(east.x - west.x)
  const scaledWidth = measuredWidth * 2 ** (targetZoom - currentZoom)

  return Number.isFinite(scaledWidth) && scaledWidth > 0
    ? scaledWidth
    : calculateWorldPixelWidthAtZoom(targetZoom)
}

export function calculateWorldPixelWidthAtZoom(zoom: number) {
  return TILE_SIZE * 2 ** zoom
}
