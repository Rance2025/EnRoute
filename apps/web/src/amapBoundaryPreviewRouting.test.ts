import { describe, expect, it } from 'vitest'

import { shouldRenderAmapBoundaryPreview } from './amapBoundaryPreviewRouting'

describe('AMap boundary preview routing', () => {
  it('enables the standalone AMap boundary preview from the query string', () => {
    expect(shouldRenderAmapBoundaryPreview('?amapBoundaryPreview=1')).toBe(true)
    expect(shouldRenderAmapBoundaryPreview('?amapBoundaryPreview=true')).toBe(true)
    expect(shouldRenderAmapBoundaryPreview('?view=map')).toBe(false)
  })
})
