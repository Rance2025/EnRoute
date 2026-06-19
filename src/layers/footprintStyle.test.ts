import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FOOTPRINT_STYLE,
  normalizeFootprintOpacity,
  normalizeFootprintStyle,
} from './footprintStyle'

describe('footprint style normalization', () => {
  it('keeps the current footprint point opacity as the default', () => {
    expect(DEFAULT_FOOTPRINT_STYLE.opacity).toBe(0.82)
    expect(normalizeFootprintStyle(null)).toEqual({
      color: '#123f35',
      opacity: 0.82,
      pixelSize: 1.5,
    })
  })

  it('rounds footprint opacity to 0.01 precision', () => {
    expect(normalizeFootprintOpacity(0.736)).toBe(0.74)
    expect(normalizeFootprintStyle({ opacity: 0.734 }).opacity).toBe(0.73)
  })

  it('clamps footprint opacity to the supported 0.3 to 1 range', () => {
    expect(normalizeFootprintOpacity(0.1)).toBe(0.3)
    expect(normalizeFootprintOpacity(1.2)).toBe(1)
  })

  it('falls back to default opacity for invalid values', () => {
    expect(normalizeFootprintOpacity(Number.NaN)).toBe(0.82)
    expect(normalizeFootprintStyle({ opacity: '0.9' as never }).opacity).toBe(0.82)
  })
})
