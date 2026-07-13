import type { LayerSpecification } from 'mapbox-gl'

export type AdminRegionDepth = 1 | 2 | 3 | 4

export type AdminRegionVectorTileSourceOptions = {
  tileUrl?: string
  focusRegionId: string
  depth: AdminRegionDepth
}

export const DEFAULT_ADMIN_REGION_TILE_URL = '/api/map/tiles/admin-regions/{z}/{x}/{y}.mvt'
export const MAX_ADMIN_REGION_TILE_ZOOM = 9
export const ADMIN_REGION_VECTOR_SOURCE_ID = 'admin-regions'
export const ADMIN_REGION_VECTOR_SOURCE_LAYER = 'admin_regions'
export const ADMIN_REGION_FILL_LAYER_ID = 'admin-regions-fill'
export const ADMIN_REGION_LINE_LAYER_ID = 'admin-regions-line'
export const ADMIN_REGION_SELECTION_FILL_LAYER_ID = 'admin-regions-selection-fill'
export const ADMIN_REGION_BOUNDARY_REGION_IDS_PROPERTY = 'boundary_region_ids'

type AdminRegionLayerFilter = NonNullable<LayerSpecification['filter']>

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

export function createAdminRegionFillFilter(activeRegionIds?: string[]): AdminRegionLayerFilter {
  return createAdminRegionLayerFilter({
    kind: 'fill',
    geometryTypes: ['Polygon', 'MultiPolygon'],
    activeRegionIds,
  })
}

export function createAdminRegionLineFilter(activeRegionIds?: string[]): AdminRegionLayerFilter {
  return createAdminRegionLayerFilter({
    kind: 'line',
    geometryTypes: ['LineString', 'MultiLineString'],
    activeRegionIds,
  })
}

export function createAdminRegionSelectionFillFilter(regionId?: string): AdminRegionLayerFilter {
  return [
    'all',
    ['==', ['get', 'kind'], 'fill'],
    ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    ['==', ['get', 'region_id'], regionId ?? ''],
  ]
}

export function createAdminRegionFillLayer(activeRegionIds?: string[]): LayerSpecification {
  return {
    id: ADMIN_REGION_FILL_LAYER_ID,
    type: 'fill',
    source: ADMIN_REGION_VECTOR_SOURCE_ID,
    'source-layer': ADMIN_REGION_VECTOR_SOURCE_LAYER,
    slot: 'top',
    filter: createAdminRegionFillFilter(activeRegionIds),
    paint: {
      'fill-color': '#1f6f67',
      'fill-opacity': 0.18,
      'fill-antialias': false,
    },
  }
}

export function createAdminRegionLineLayer(activeRegionIds?: string[]): LayerSpecification {
  return {
    id: ADMIN_REGION_LINE_LAYER_ID,
    type: 'line',
    source: ADMIN_REGION_VECTOR_SOURCE_ID,
    'source-layer': ADMIN_REGION_VECTOR_SOURCE_LAYER,
    slot: 'top',
    filter: createAdminRegionLineFilter(activeRegionIds),
    paint: {
      'line-color': '#0b4f47',
      'line-opacity': 0.92,
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
    },
  }
}

export function createAdminRegionSelectionFillLayer(regionId?: string): LayerSpecification {
  return {
    id: ADMIN_REGION_SELECTION_FILL_LAYER_ID,
    type: 'fill',
    source: ADMIN_REGION_VECTOR_SOURCE_ID,
    'source-layer': ADMIN_REGION_VECTOR_SOURCE_LAYER,
    slot: 'top',
    filter: createAdminRegionSelectionFillFilter(regionId),
    paint: {
      'fill-color': '#0b4f47',
      'fill-opacity': 0.36,
      'fill-antialias': false,
    },
  }
}

function createAdminRegionLayerFilter({
  kind,
  geometryTypes,
  activeRegionIds,
}: {
  kind: 'fill' | 'line'
  geometryTypes: string[]
  activeRegionIds?: string[]
}): AdminRegionLayerFilter {
  const filter: AdminRegionLayerFilter = [
    'all',
    ['==', ['get', 'kind'], kind],
    ['in', ['geometry-type'], ['literal', geometryTypes]],
  ]

  if (activeRegionIds) {
    if (kind === 'line') {
      filter.push(createActiveAdminRegionLineFilter(activeRegionIds))
    } else {
      filter.push(['in', ['get', 'region_id'], ['literal', activeRegionIds]])
    }
  }

  return filter
}

function createActiveAdminRegionLineFilter(activeRegionIds: string[]): AdminRegionLayerFilter {
  return [
    'any',
    ['in', ['get', 'region_id'], ['literal', activeRegionIds]],
    ...activeRegionIds.map((regionId) => [
      '>=',
      [
        'index-of',
        `|${regionId}|`,
        ['coalesce', ['get', ADMIN_REGION_BOUNDARY_REGION_IDS_PROPERTY], ''],
      ],
      0,
    ]),
  ] as AdminRegionLayerFilter
}
