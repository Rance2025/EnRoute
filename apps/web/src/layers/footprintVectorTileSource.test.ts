import { describe, expect, it } from 'vitest'

import * as footprintVectorTiles from './footprintVectorTileSource'

describe('createFootprintVectorTileSource', () => {
  it('builds a Mapbox vector source capped at zoom 18', () => {
    const source = footprintVectorTiles.createFootprintVectorTileSource({
      start: '2024-02-10',
      end: '2026-03-09',
    })

    expect(source.type).toBe('vector')
    expect(source.maxzoom).toBe(18)
    expect(source.tiles).toEqual([
      '/api/map/tiles/footprints/{z}/{x}/{y}.mvt?start=2024-02-10&end=2026-03-09',
    ])
    expect(source.tiles[0]).not.toContain('datasetVersion')
    expect(source.tiles[0]).not.toContain('mode=')
    expect(source.tiles[0]).not.toContain('count=')
  })

  it('uses a compact all-range tile URL for open ended ranges', () => {
    const source = footprintVectorTiles.createFootprintVectorTileSource({
      range: 'all',
    } as Parameters<typeof footprintVectorTiles.createFootprintVectorTileSource>[0])

    expect(source.maxzoom).toBe(18)
    expect(source.tiles).toEqual([
      '/api/map/tiles/footprints/{z}/{x}/{y}.mvt?range=all',
    ])
  })

  it('builds a plain footprint circle layer from the vector tile source', () => {
    const createFootprintCircleLayer = (
      footprintVectorTiles as typeof footprintVectorTiles & {
        createFootprintCircleLayer?: (style: {
          pixelSize: number
          color: string
          opacity: number
        }) => unknown
      }
    ).createFootprintCircleLayer

    expect(createFootprintCircleLayer).toBeTypeOf('function')

    const layer = createFootprintCircleLayer?.({
      pixelSize: 1.5,
      color: '#123f35',
      opacity: 0.82,
    }) as {
      id?: string
      type?: string
      source?: string
      'source-layer'?: string
      paint?: Record<string, unknown>
    }

    expect(layer).toMatchObject({
      id: 'footprints-circle',
      type: 'circle',
      source: 'footprints',
      'source-layer': 'footprints',
      paint: {
        'circle-radius': 1.5,
        'circle-color': '#123f35',
        'circle-opacity': 0.82,
      },
    })
    expect(JSON.stringify(layer)).not.toContain('heatmap')
    expect(JSON.stringify(layer)).not.toContain('cluster')
    expect(JSON.stringify(layer)).not.toContain('count')
  })
})
