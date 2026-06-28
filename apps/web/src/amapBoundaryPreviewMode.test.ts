import { describe, expect, it } from 'vitest'

import { resolveAmapBoundaryPreviewMode } from './amapBoundaryPreviewMode'

describe('AMap boundary preview mode', () => {
  it('distinguishes native AMap preview from Mapbox overlay preview', () => {
    expect(resolveAmapBoundaryPreviewMode('?amapBoundaryPreview=1')).toBe('amap')
    expect(resolveAmapBoundaryPreviewMode('?amapBoundaryPreview=true')).toBe('amap')
    expect(resolveAmapBoundaryPreviewMode('?amapBoundaryPreview=mapbox')).toBe('mapbox')
    expect(resolveAmapBoundaryPreviewMode('?view=map')).toBe(null)
  })
})
