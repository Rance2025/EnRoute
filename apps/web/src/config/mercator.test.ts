import { describe, expect, it } from 'vitest'

import {
  AMAP_MIN_ZOOM,
  calculateMaximumZoomForFullLongitudeCoverage,
  calculateMinimumZoomForViewportCoverage,
  calculateMinimumZoomForWorldCoverage,
  TILE_SIZE,
} from './mercator'
import { calculateWorldPixelWidthAtZoom } from './mapPaneLayout'

describe('mercator viewport coverage', () => {
  it('calculates the zoom where the full vertical Mercator world fits', () => {
    expect(calculateMinimumZoomForWorldCoverage(1080)).toBe(2.07)
  })

  it('rounds the full-longitude zoom down so 360 degrees fit within the map pane', () => {
    const zoom = calculateMaximumZoomForFullLongitudeCoverage(1468)

    expect(zoom).toBe(2.51)
    expect(calculateWorldPixelWidthAtZoom(zoom)).toBeLessThanOrEqual(1468)
  })

  it('stops zooming out at whichever coverage threshold is reached first', () => {
    const zoom = calculateMinimumZoomForViewportCoverage({
      viewportWidth: 1428,
      viewportHeight: 1155,
    })

    expect(zoom).toBe(2.47)
    expect(zoom).toBe(calculateMaximumZoomForFullLongitudeCoverage(1428))
    expect(calculateWorldPixelWidthAtZoom(zoom)).toBeLessThanOrEqual(1428)
  })

  it('uses the longitude threshold first when the map pane is wider than the latitude-cropped world', () => {
    const zoom = calculateMinimumZoomForViewportCoverage({
      viewportWidth: 1600,
      viewportHeight: 900,
    })

    expect(zoom).toBe(calculateMaximumZoomForFullLongitudeCoverage(1600))
    expect(zoom).toBeGreaterThan(calculateMinimumZoomForWorldCoverage(900))
    expect(calculateWorldPixelWidthAtZoom(zoom)).toBeLessThanOrEqual(1600)
  })

  it('does not go below the AMap hard minimum when the pane is narrower than one zoom-2 world', () => {
    const zoom = calculateMinimumZoomForViewportCoverage({
      viewportWidth: TILE_SIZE * 2 ** AMAP_MIN_ZOOM - 1,
      viewportHeight: 768,
    })

    expect(zoom).toBe(AMAP_MIN_ZOOM)
  })
})
