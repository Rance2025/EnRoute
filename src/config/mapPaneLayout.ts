import { calculateMinimumZoomForWorldCoverage, TILE_SIZE } from './mercator'

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

type FallbackSingleWorldPaneLayoutOptions = {
  viewportWidth: number
  viewportHeight: number
}

export function calculateSingleWorldMapPaneLayout({
  viewportWidth,
  worldWidthPx,
}: SingleWorldMapPaneLayoutOptions) {
  const normalizedViewportWidth = Math.max(viewportWidth, 0)
  const singleWorldWidth = Math.max(worldWidthPx, 0)
  const mapPaneWidth = Math.min(normalizedViewportWidth, singleWorldWidth)

  return {
    mapPaneWidth,
    sidePanelWidth: Math.max(normalizedViewportWidth - mapPaneWidth, 0),
  }
}

export function calculateFallbackSingleWorldPaneLayout({
  viewportWidth,
  viewportHeight,
}: FallbackSingleWorldPaneLayoutOptions) {
  return calculateSingleWorldMapPaneLayout({
    viewportWidth,
    worldWidthPx: calculateWorldPixelWidthAtZoom(
      calculateMinimumZoomForWorldCoverage(viewportHeight),
    ),
  })
}

export function measureAmapWorldPixelWidthAtZoom(
  map: WorldWidthMeasuringMap,
  targetZoom: number,
) {
  const currentZoom = map.getZoom()

  if (typeof map.lnglatToPixel === 'function') {
    const westPixel = map.lnglatToPixel([-180, 0], targetZoom)
    const eastPixel = map.lnglatToPixel([180, 0], targetZoom)
    const measuredPixelWidth = Math.abs(eastPixel.x - westPixel.x)

    if (Number.isFinite(measuredPixelWidth) && measuredPixelWidth > 0) {
      return measuredPixelWidth
    }
  }

  const west = map.lngLatToContainer([-180, 0])
  const east = map.lngLatToContainer([180, 0])
  const measuredWidth = Math.abs(east.x - west.x)
  const scaledWidth = measuredWidth * 2 ** (targetZoom - currentZoom)

  return Number.isFinite(scaledWidth) && scaledWidth > 0
    ? scaledWidth
    : calculateWorldPixelWidthAtZoom(targetZoom)
}

export function calculateWorldPixelWidthAtZoom(zoom: number) {
  return TILE_SIZE * 2 ** zoom
}
