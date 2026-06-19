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
const STYLE_UPDATE_DELAY_MS = 120

export function createMassFootprintLayer(
  AMapRuntime: Pick<typeof AMap, 'MassMarks' | 'Pixel' | 'Size'>,
  map: AMap.Map,
  options: MassFootprintLayerOptions = {},
) {
  let currentStyle = normalizeStyleOptions(options)
  let styleUpdateTimer: number | null = null
  let destroyed = false
  const massMarks = new AMapRuntime.MassMarks([], {
    alwaysRender: true,
    cursor: 'default',
    opacity: 1,
    style: createMassMarksStyle(AMapRuntime, currentStyle),
    zIndex: 20,
  })

  massMarks.setMap(map)

  return {
    update(points: MassFootprintPoint[]) {
      massMarks.setData(toMassMarksData(points))
    },
    scheduleStyleUpdate(nextOptions: MassFootprintLayerOptions) {
      const nextStyle = normalizeStyleOptions(nextOptions)
      if (styleUpdateTimer !== null) {
        window.clearTimeout(styleUpdateTimer)
        styleUpdateTimer = null
      }
      if (areStyleOptionsEqual(currentStyle, nextStyle)) return

      styleUpdateTimer = window.setTimeout(() => {
        styleUpdateTimer = null
        if (destroyed) return

        currentStyle = nextStyle
        massMarks.setStyle(createMassMarksStyle(AMapRuntime, nextStyle))
      }, STYLE_UPDATE_DELAY_MS)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (styleUpdateTimer !== null) {
        window.clearTimeout(styleUpdateTimer)
        styleUpdateTimer = null
      }
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

function normalizeStyleOptions(options: MassFootprintLayerOptions) {
  return {
    color: normalizeFootprintColor(options.color),
    opacity: normalizeFootprintOpacity(options.opacity),
    pixelSize: normalizeFootprintPixelSize(options.pixelSize),
  }
}

function createMassMarksStyle(
  AMapRuntime: Pick<typeof AMap, 'Pixel' | 'Size'>,
  style: Required<MassFootprintLayerOptions>,
) {
  const halfPixel = style.pixelSize / 2

  return {
    url: createPointIconDataUrl(style.color, style.pixelSize, style.opacity),
    size: new AMapRuntime.Size(style.pixelSize, style.pixelSize),
    anchor: new AMapRuntime.Pixel(halfPixel, halfPixel),
  }
}

function areStyleOptionsEqual(
  left: Required<MassFootprintLayerOptions>,
  right: Required<MassFootprintLayerOptions>,
) {
  return left.color === right.color &&
    left.opacity === right.opacity &&
    left.pixelSize === right.pixelSize
}
