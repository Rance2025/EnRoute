export type AmapBoundaryPreviewMode = 'amap' | 'mapbox'

export function resolveAmapBoundaryPreviewMode(search: string): AmapBoundaryPreviewMode | null {
  const params = new URLSearchParams(search)
  const value = params.get('amapBoundaryPreview')

  if (value === 'mapbox') return 'mapbox'
  if (value === '1' || value === 'true') return 'amap'

  return null
}
