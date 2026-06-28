export type FootprintVectorTileRange =
  | {
    start: string
    end: string
    range?: never
  }
  | {
    range: 'all'
    start?: never
    end?: never
  }

export type FootprintVectorTileSourceOptions = FootprintVectorTileRange & {
  tileUrl?: string
}

export type FootprintCircleLayerStyle = {
  pixelSize: number
  color: string
  opacity: number
}

export const DEFAULT_FOOTPRINT_TILE_URL = '/api/map/tiles/footprints/{z}/{x}/{y}.mvt'
export const MAX_FOOTPRINT_TILE_ZOOM = 16
export const FOOTPRINT_VECTOR_SOURCE_ID = 'footprints'
export const FOOTPRINT_VECTOR_SOURCE_LAYER = 'footprints'
export const FOOTPRINT_CIRCLE_LAYER_ID = 'footprints-circle'

export function createFootprintVectorTileSource(
  options: FootprintVectorTileSourceOptions,
) {
  const { tileUrl = DEFAULT_FOOTPRINT_TILE_URL } = options
  const params = new URLSearchParams()

  if (options.range === 'all') {
    params.set('range', 'all')
  } else {
    params.set('start', options.start)
    params.set('end', options.end)
  }

  return {
    type: 'vector' as const,
    tiles: [`${tileUrl}?${params.toString()}`],
    minzoom: 0,
    maxzoom: MAX_FOOTPRINT_TILE_ZOOM,
  }
}

export function createFootprintCircleLayer(style: FootprintCircleLayerStyle) {
  return {
    id: FOOTPRINT_CIRCLE_LAYER_ID,
    type: 'circle' as const,
    source: FOOTPRINT_VECTOR_SOURCE_ID,
    'source-layer': FOOTPRINT_VECTOR_SOURCE_LAYER,
    paint: {
      'circle-radius': style.pixelSize / 2,
      'circle-color': style.color,
      'circle-opacity': style.opacity,
    },
  }
}
