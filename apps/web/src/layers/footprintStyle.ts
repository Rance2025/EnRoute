export type FootprintStyle = {
  pixelSize: number
  color: string
  opacity: number
}

export const DEFAULT_FOOTPRINT_STYLE: FootprintStyle = {
  pixelSize: 2,
  color: '#123f35',
  opacity: 0.6,
}

export const FOOTPRINT_PIXEL_SIZE_MIN = 0.8
export const FOOTPRINT_PIXEL_SIZE_MAX = 3.5
export const FOOTPRINT_PIXEL_SIZE_STEP = 0.1
export const FOOTPRINT_OPACITY_MIN = 0.3
export const FOOTPRINT_OPACITY_MAX = 1
export const FOOTPRINT_OPACITY_STEP = 0.01

const FOOTPRINT_PIXEL_SIZE_PRECISION = 10
const FOOTPRINT_OPACITY_PRECISION = 100
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export function normalizeFootprintStyle(value: Partial<FootprintStyle> | null | undefined) {
  return {
    pixelSize: normalizeFootprintPixelSize(value?.pixelSize),
    color: normalizeFootprintColor(value?.color),
    opacity: normalizeFootprintOpacity(value?.opacity),
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

export function normalizeFootprintOpacity(opacity: unknown) {
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) {
    return DEFAULT_FOOTPRINT_STYLE.opacity
  }

  const clampedOpacity = Math.min(
    Math.max(opacity, FOOTPRINT_OPACITY_MIN),
    FOOTPRINT_OPACITY_MAX,
  )

  return Math.round(clampedOpacity * FOOTPRINT_OPACITY_PRECISION) /
    FOOTPRINT_OPACITY_PRECISION
}
