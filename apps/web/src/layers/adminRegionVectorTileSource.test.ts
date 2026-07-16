import { describe, expect, it } from 'vitest'

import * as adminRegionVectorTiles from './adminRegionVectorTileSource'

describe('adminRegionVectorTileSource', () => {
  it('normalizes the configurable admin-region fill opacity', () => {
    expect(adminRegionVectorTiles.DEFAULT_ADMIN_REGION_FILL_OPACITY).toBe(0.18)
    expect(adminRegionVectorTiles.ADMIN_REGION_FILL_OPACITY_MIN).toBe(0.05)
    expect(adminRegionVectorTiles.ADMIN_REGION_FILL_OPACITY_MAX).toBe(1)
    expect(adminRegionVectorTiles.ADMIN_REGION_FILL_OPACITY_STEP).toBe(0.01)
    expect(adminRegionVectorTiles.normalizeAdminRegionFillOpacity(0.736)).toBe(0.74)
    expect(adminRegionVectorTiles.normalizeAdminRegionFillOpacity(0.01)).toBe(0.05)
    expect(adminRegionVectorTiles.normalizeAdminRegionFillOpacity(1.2)).toBe(1)
    expect(adminRegionVectorTiles.normalizeAdminRegionFillOpacity(Number.NaN)).toBe(0.18)
  })

  it('builds a global Mapbox vector source capped at the admin cache zoom', () => {
    const source = adminRegionVectorTiles.createAdminRegionVectorTileSource({
      focusRegionId: 'world',
      depth: 4,
    })

    expect(source).toEqual({
      type: 'vector',
      tiles: ['/api/map/tiles/admin-regions/{z}/{x}/{y}.mvt?focusRegionId=world&depth=4'],
      minzoom: 0,
      maxzoom: 9,
      promoteId: 'region_id',
    })
  })

  it('builds admin-region fill and line layers from the vector tile source layer', () => {
    const fillLayer = adminRegionVectorTiles.createAdminRegionFillLayer(undefined, 0.42)
    const lineLayer = adminRegionVectorTiles.createAdminRegionLineLayer()

    expect(fillLayer).toMatchObject({
      id: 'admin-regions-fill',
      type: 'fill',
      source: 'admin-regions',
      'source-layer': 'admin_regions',
      slot: 'top',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'fill'],
        ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      ],
    })
    expect(fillLayer.paint).toMatchObject({
      'fill-color': '#1f6f67',
      'fill-opacity': 0.42,
    })

    expect(lineLayer).toMatchObject({
      id: 'admin-regions-line',
      type: 'line',
      source: 'admin-regions',
      'source-layer': 'admin_regions',
      slot: 'top',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'line'],
        ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      ],
    })
    expect(lineLayer.paint).toMatchObject({
      'line-color': '#1f6f67',
      'line-opacity': 0.92,
    })
    expect(lineLayer.paint?.['line-color']).toBe(fillLayer.paint?.['fill-color'])
    expect(lineLayer.paint).toMatchObject({
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        1,
        0.9,
        4,
        1.25,
        8,
        1.75,
        12,
        2.35,
      ],
    })
  })

  it('builds active-region fill and line filters from region ids', () => {
    expect(adminRegionVectorTiles.createAdminRegionFillFilter(['310115'])).toEqual([
      'all',
      ['==', ['get', 'kind'], 'fill'],
      ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      ['in', ['get', 'region_id'], ['literal', ['310115']]],
    ])

    expect(adminRegionVectorTiles.createAdminRegionLineFilter(['310101', '310115'])).toEqual([
      'all',
      ['==', ['get', 'kind'], 'line'],
      ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      [
        'any',
        ['in', ['get', 'region_id'], ['literal', ['310101', '310115']]],
        ['>=', ['index-of', '|310101|', ['coalesce', ['get', 'boundary_region_ids'], '']], 0],
        ['>=', ['index-of', '|310115|', ['coalesce', ['get', 'boundary_region_ids'], '']], 0],
      ],
    ])
  })

  it('builds a dedicated selection fill layer and hides it without a selected region', () => {
    expect(adminRegionVectorTiles.ADMIN_REGION_SELECTION_FILL_LAYER_ID).toBe('admin-regions-selection-fill')
    expect(adminRegionVectorTiles.createAdminRegionSelectionFillFilter()).toEqual([
      'all',
      ['==', ['get', 'kind'], 'fill'],
      ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      ['==', ['get', 'region_id'], ''],
    ])
    expect(adminRegionVectorTiles.createAdminRegionSelectionFillLayer('310115')).toMatchObject({
      id: 'admin-regions-selection-fill',
      type: 'fill',
      source: 'admin-regions',
      'source-layer': 'admin_regions',
      slot: 'top',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'fill'],
        ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
        ['==', ['get', 'region_id'], '310115'],
      ],
      paint: {
        'fill-color': '#0b4f47',
        'fill-opacity': 0.36,
        'fill-antialias': false,
      },
    })
  })
})
