import type { FootprintPoint } from './footprintTypes'

type MassFootprintLayerOptions = {
  color?: string
  pixelSize?: number
}

const DEFAULT_COLOR = '#123f35'
const DEFAULT_PIXEL_SIZE = 1.5
const DEFAULT_OPACITY = 0.82
const MAX_PIXEL_SIZE = 5
const MIN_PIXEL_SIZE = 1
const PIXEL_SIZE_PRECISION = 10
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export function createMassFootprintLayer(
  AMapRuntime: Pick<typeof AMap, 'MassMarks' | 'Pixel' | 'Size'>,
  map: AMap.Map,
  options: MassFootprintLayerOptions = {},
) {
  const pixelSize = normalizePixelSize(options.pixelSize)
  const color = normalizeColor(options.color)
  const halfPixel = pixelSize / 2
  let destroyed = false
  const massMarks = new AMapRuntime.MassMarks([], {
    alwaysRender: true,
    cursor: 'default',
    opacity: 1,
    style: {
      url: createPointIconDataUrl(color, pixelSize),
      size: new AMapRuntime.Size(pixelSize, pixelSize),
      anchor: new AMapRuntime.Pixel(halfPixel, halfPixel),
    },
    zIndex: 20,
  })

  massMarks.setMap(map)

  return {
    update(points: FootprintPoint[]) {
      massMarks.setData(
        points.map((point) => ({
          id: point.id,
          lnglat: [point.longitude, point.latitude],
        })),
      )
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      massMarks.clear()
      massMarks.setMap(null)
    },
  }
}

function normalizePixelSize(pixelSize: number | undefined) {
  if (typeof pixelSize !== 'number' || !Number.isFinite(pixelSize)) {
    return DEFAULT_PIXEL_SIZE
  }

  const clampedPixelSize = Math.min(Math.max(pixelSize, MIN_PIXEL_SIZE), MAX_PIXEL_SIZE)

  return Math.round(clampedPixelSize * PIXEL_SIZE_PRECISION) / PIXEL_SIZE_PRECISION
}

function normalizeColor(color: string | undefined) {
  if (!color || !HEX_COLOR_PATTERN.test(color)) return DEFAULT_COLOR

  return color.toLowerCase()
}

function createPointIconDataUrl(color: string, size: number) {
  const radius = size / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="${color}" fill-opacity="${DEFAULT_OPACITY}"/></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
