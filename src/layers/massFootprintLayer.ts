import { normalizeFootprintColor, normalizeFootprintPixelSize } from './footprintStyle'

type MassFootprintLayerOptions = {
  color?: string
  pixelSize?: number
}

export type MassFootprintPoint = {
  id: string
  longitude: number
  latitude: number
}

const DEFAULT_OPACITY = 0.82

export function createMassFootprintLayer(
  AMapRuntime: Pick<typeof AMap, 'MassMarks' | 'Pixel' | 'Size'>,
  map: AMap.Map,
  options: MassFootprintLayerOptions = {},
) {
  const pixelSize = normalizeFootprintPixelSize(options.pixelSize)
  const color = normalizeFootprintColor(options.color)
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
    update(points: MassFootprintPoint[]) {
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
