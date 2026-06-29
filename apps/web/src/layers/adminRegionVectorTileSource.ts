import type { LayerSpecification } from 'mapbox-gl'

export type AdminRegionDepth = 1 | 2 | 3

export type AdminRegionVectorTileSourceOptions = {
  tileUrl?: string
  focusRegionId: string
  depth: AdminRegionDepth
}

export const DEFAULT_ADMIN_REGION_TILE_URL = '/api/map/tiles/admin-regions/{z}/{x}/{y}.mvt'
export const MAX_ADMIN_REGION_TILE_ZOOM = 8
export const ADMIN_REGION_VECTOR_SOURCE_ID = 'admin-regions'
export const ADMIN_REGION_VECTOR_SOURCE_LAYER = 'admin_regions'
export const ADMIN_REGION_FILL_LAYER_ID = 'admin-regions-fill'
export const ADMIN_REGION_LINE_LAYER_ID = 'admin-regions-line'

export function createAdminRegionVectorTileSource({
  tileUrl = DEFAULT_ADMIN_REGION_TILE_URL,
  focusRegionId,
  depth,
}: AdminRegionVectorTileSourceOptions) {
  const params = new URLSearchParams()
  params.set('focusRegionId', focusRegionId)
  params.set('depth', String(depth))

  return {
    type: 'vector' as const,
    tiles: [`${tileUrl}?${params.toString()}`],
    minzoom: 0,
    maxzoom: MAX_ADMIN_REGION_TILE_ZOOM,
    promoteId: 'region_id',
  }
}

export function createAdminRegionFillLayer(): LayerSpecification {
  return {
    id: ADMIN_REGION_FILL_LAYER_ID,
    type: 'fill',
    source: ADMIN_REGION_VECTOR_SOURCE_ID,
    'source-layer': ADMIN_REGION_VECTOR_SOURCE_LAYER,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'fill'],
      ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    ],
    paint: {
      'fill-color': '#3f7f74',
      'fill-opacity': 0.06,
      'fill-antialias': false,
    },
  }
}

export function createAdminRegionLineLayer(): LayerSpecification {
  return {
    id: ADMIN_REGION_LINE_LAYER_ID,
    type: 'line',
    source: ADMIN_REGION_VECTOR_SOURCE_ID,
    'source-layer': ADMIN_REGION_VECTOR_SOURCE_LAYER,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'line'],
      ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
    ],
    paint: {
      'line-color': '#27645c',
      'line-opacity': 0.78,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        1,
        0.45,
        4,
        0.8,
        8,
        1.2,
        12,
        1.8,
      ],
    },
  }
}
