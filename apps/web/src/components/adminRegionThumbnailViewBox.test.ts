import { describe, expect, it } from 'vitest'

import {
  ADMIN_REGION_THUMBNAIL_FRAME_ASPECT_RATIO,
  DEFAULT_ADMIN_REGION_THUMBNAIL_VIEW_BOX,
  fitAdminRegionThumbnailViewBox,
} from './adminRegionThumbnailViewBox'

describe('fitAdminRegionThumbnailViewBox', () => {
  it.each([
    {
      name: 'world',
      bounds: { x: 6, y: 16.8, width: 308, height: 144.7 },
      expected: '5.653 16.8 308.693 144.7',
    },
    {
      name: 'China',
      bounds: { x: 46.2, y: 12.4, width: 225.9, height: 158.5 },
      expected: '-9.917 12.4 338.133 158.5',
    },
  ])('fits $name bounds to the shared frame without adding vertical space', ({ bounds, expected }) => {
    const result = fitAdminRegionThumbnailViewBox(bounds)
    const [, y, width, height] = result.split(' ').map(Number)

    expect(result).toBe(expected)
    expect(width / height).toBeCloseTo(ADMIN_REGION_THUMBNAIL_FRAME_ASPECT_RATIO, 5)
    expect(y).toBe(bounds.y)
    expect(height).toBe(bounds.height)
  })

  it('expands height for content wider than the shared frame', () => {
    expect(fitAdminRegionThumbnailViewBox({ x: 0, y: 10, width: 320, height: 100 }))
      .toBe('0 -15 320 150')
  })

  it.each([
    { x: 0, y: 0, width: 0, height: 100 },
    { x: 0, y: 0, width: 100, height: Number.NaN },
  ])('falls back for invalid bounds %#', (bounds) => {
    expect(fitAdminRegionThumbnailViewBox(bounds)).toBe(DEFAULT_ADMIN_REGION_THUMBNAIL_VIEW_BOX)
  })
})
