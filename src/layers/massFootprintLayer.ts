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

export type MassFootprintPoint = {
  id: string
  longitude: number
  latitude: number
}

const massMarksDataCache = new WeakMap<MassFootprintPoint[], AMap.MassMarksData[]>()

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
    update(points: MassFootprintPoint[]) {
      massMarks.setData(toMassMarksData(points))
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      massMarks.clear()
      massMarks.setMap(null)
    },
  }
}

function toMassMarksData(points: MassFootprintPoint[]) {
  const cachedData = massMarksDataCache.get(points)
  if (cachedData) return cachedData

  const data = points.map((point) => ({
    id: point.id,
    lnglat: [point.longitude, point.latitude] as AMap.LngLatLike,
  }))
  massMarksDataCache.set(points, data)

  return data
}

function createPointIconDataUrl(color: string, size: number, opacity: number) {
  const radius = size / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="${color}" fill-opacity="${opacity}"/></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
