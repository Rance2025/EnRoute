import type { FootprintPoint } from './footprintTypes'
import {
  normalizeFootprintColor,
  normalizeFootprintOpacity,
  normalizeFootprintPixelSize,
} from './footprintStyle'

type MassFootprintLayerOptions = {
  color?: string
  opacity?: number
  pixelSize?: number
}

export function createMassFootprintLayer(
  AMapRuntime: Pick<typeof AMap, 'MassMarks' | 'Pixel' | 'Size'>,
  map: AMap.Map,
  options: MassFootprintLayerOptions = {},
) {
  const pixelSize = normalizeFootprintPixelSize(options.pixelSize)
  const color = normalizeFootprintColor(options.color)
  const opacity = normalizeFootprintOpacity(options.opacity)
  const halfPixel = pixelSize / 2
  let destroyed = false
  const massMarks = new AMapRuntime.MassMarks([], {
    alwaysRender: true,
    cursor: 'default',
    opacity: 1,
    style: {
      url: createPointIconDataUrl(color, pixelSize, opacity),
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

function createPointIconDataUrl(color: string, size: number, opacity: number) {
  const radius = size / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="${color}" fill-opacity="${opacity}"/></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
