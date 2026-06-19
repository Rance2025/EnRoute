export type FootprintStyle = {
  pixelSize: number
  color: string
}

export const DEFAULT_FOOTPRINT_STYLE: FootprintStyle = {
  pixelSize: 1.5,
  color: '#123f35',
}

export const FOOTPRINT_PIXEL_SIZE_MIN = 0.3
export const FOOTPRINT_PIXEL_SIZE_MAX = 3.5
export const FOOTPRINT_PIXEL_SIZE_STEP = 0.1

const FOOTPRINT_PIXEL_SIZE_PRECISION = 10
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export function normalizeFootprintStyle(value: Partial<FootprintStyle> | null | undefined) {
  return {
    pixelSize: normalizeFootprintPixelSize(value?.pixelSize),
    color: normalizeFootprintColor(value?.color),
  }
}

export function normalizeFootprintPixelSize(pixelSize: unknown) {
  if (typeof pixelSize !== 'number' || !Number.isFinite(pixelSize)) {
    return DEFAULT_FOOTPRINT_STYLE.pixelSize
  }

  const clampedPixelSize = Math.min(
    Math.max(pixelSize, FOOTPRINT_PIXEL_SIZE_MIN),
    FOOTPRINT_PIXEL_SIZE_MAX,
  )

  return Math.round(clampedPixelSize * FOOTPRINT_PIXEL_SIZE_PRECISION) /
    FOOTPRINT_PIXEL_SIZE_PRECISION
}

export function normalizeFootprintColor(color: unknown) {
  if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
    return DEFAULT_FOOTPRINT_STYLE.color
  }

  return color.toLowerCase()
}
