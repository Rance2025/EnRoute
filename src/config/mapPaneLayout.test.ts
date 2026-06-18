import { describe, expect, it } from 'vitest'

import {
  calculateSingleWorldMapPaneLayout,
  calculateWorldPixelWidthAtZoom,
  measureAmapWorldPixelWidthAtZoom,
} from './mapPaneLayout'

function lngLat([lng, lat]: [number, number]) {
  return {
    getLng: () => lng,
    getLat: () => lat,
  }
}

describe('single-world map pane layout', () => {
  it('moves only the surplus desktop width into the left panel', () => {
    expect(
      calculateSingleWorldMapPaneLayout({
        viewportWidth: 1440,
        worldWidthPx: 1024,
      }),
    ).toEqual({
      mapPaneWidth: 1024,
      sidePanelWidth: 416,
    })
  })

  it('keeps the map full-width when the viewport is narrower than one world', () => {
    expect(
      calculateSingleWorldMapPaneLayout({
        viewportWidth: 820,
        worldWidthPx: 1024,
      }),
    ).toEqual({
      mapPaneWidth: 820,
      sidePanelWidth: 0,
    })
  })

  it('uses AMap projection measurements scaled to the target zoom', () => {
    const worldWidth = measureAmapWorldPixelWidthAtZoom(
      {
        getZoom: () => 4,
        getCenter: () => lngLat([720, 35]),
        lngLatToContainer: ([lng]) => ({ x: lng * (4096 / 360), y: 0 }),
      },
      2,
    )

    expect(worldWidth).toBeCloseTo(1024)
  })

  it('prefers AMap pixel measurements at the target zoom when available', () => {
    const sampledLngs: number[] = []
    const worldWidth = measureAmapWorldPixelWidthAtZoom(
      {
        getZoom: () => 4,
        getCenter: () => lngLat([104, 35]),
        lnglatToPixel: ([lng], zoom) => {
          sampledLngs.push(lng)
          return { x: ((lng + 180) / 360) * 256 * 2 ** zoom, y: 0 }
        },
        lngLatToContainer: () => ({ x: 0, y: 0 }),
      },
      2,
    )

    expect(worldWidth).toBeCloseTo(1024)
    expect(sampledLngs).toEqual([-180, 180])
  })

  it('falls back to Web Mercator tile width when projection measurement is unavailable', () => {
    const worldWidth = measureAmapWorldPixelWidthAtZoom(
      {
        getZoom: () => 4,
        getCenter: () => lngLat([104, 35]),
        lngLatToContainer: () => ({ x: 0, y: 0 }),
      },
      2,
    )

    expect(worldWidth).toBe(calculateWorldPixelWidthAtZoom(2))
  })
})
