import type { FootprintPoint } from './footprintTypes'

type MassFootprintLayerOptions = {
  color?: string
  pixelSize?: number
}

const DEFAULT_COLOR = '#b8544c'
const DEFAULT_PIXEL_SIZE = 2
const DEFAULT_OPACITY = 0.82

export function createMassFootprintLayer(
  AMapRuntime: Pick<typeof AMap, 'MassMarks' | 'Pixel' | 'Size'>,
  map: AMap.Map,
  options: MassFootprintLayerOptions = {},
) {
  const pixelSize = options.pixelSize ?? DEFAULT_PIXEL_SIZE
  const halfPixel = pixelSize / 2
  let destroyed = false
  const massMarks = new AMapRuntime.MassMarks([], {
    alwaysRender: true,
    cursor: 'default',
    opacity: 1,
    style: {
      url: createPointIconDataUrl(options.color ?? DEFAULT_COLOR, pixelSize),
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

function createPointIconDataUrl(color: string, size: number) {
  const radius = size / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="${color}" fill-opacity="${DEFAULT_OPACITY}"/></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
