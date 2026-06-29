import { describe, expect, it } from 'vitest'

import * as adminRegionVectorTiles from './adminRegionVectorTileSource'

describe('adminRegionVectorTileSource', () => {
  it('builds a global Mapbox vector source capped at the admin cache zoom', () => {
    const source = adminRegionVectorTiles.createAdminRegionVectorTileSource({
      focusRegionId: 'world',
      depth: 3,
    })

    expect(source).toEqual({
      type: 'vector',
      tiles: ['/api/map/tiles/admin-regions/{z}/{x}/{y}.mvt?focusRegionId=world&depth=3'],
      minzoom: 0,
      maxzoom: 8,
      promoteId: 'region_id',
    })
  })

  it('builds admin-region fill and line layers from the vector tile source layer', () => {
    const fillLayer = adminRegionVectorTiles.createAdminRegionFillLayer()
    const lineLayer = adminRegionVectorTiles.createAdminRegionLineLayer()

    expect(fillLayer).toMatchObject({
      id: 'admin-regions-fill',
      type: 'fill',
      source: 'admin-regions',
      'source-layer': 'admin_regions',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'fill'],
        ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      ],
    })
    expect(fillLayer.paint).toMatchObject({
      'fill-color': '#3f7f74',
      'fill-opacity': 0.06,
    })

    expect(lineLayer).toMatchObject({
      id: 'admin-regions-line',
      type: 'line',
      source: 'admin-regions',
      'source-layer': 'admin_regions',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'line'],
        ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      ],
    })
    expect(lineLayer.paint).toMatchObject({
      'line-color': '#27645c',
      'line-opacity': 0.78,
    })
  })
})
