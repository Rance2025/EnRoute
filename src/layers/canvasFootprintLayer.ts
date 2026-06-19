import type { FootprintPoint } from './footprintTypes'

type CanvasFootprintLayerOptions = {
  color?: string
  pixelSize?: number
}

const DEFAULT_COLOR = 'rgba(184, 84, 76, 0.92)'
const DEFAULT_PIXEL_SIZE = 1

export function createCanvasFootprintLayer(
  AMapRuntime: Pick<typeof AMap, 'CustomLayer'>,
  map: AMap.Map,
  container: HTMLElement,
  options: CanvasFootprintLayerOptions = {},
) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const color = options.color ?? DEFAULT_COLOR
  const pixelSize = options.pixelSize ?? DEFAULT_PIXEL_SIZE
  let points: FootprintPoint[] = []

  canvas.dataset.layer = 'footprints'
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '20'

  function resize(target: HTMLElement) {
    const dpr = getDevicePixelRatio()
    const width = target.clientWidth
    const height = target.clientHeight
    const backingWidth = Math.round(width * dpr)
    const backingHeight = Math.round(height * dpr)

    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    if (canvas.width !== backingWidth) canvas.width = backingWidth
    if (canvas.height !== backingHeight) canvas.height = backingHeight

    return { dpr, width, height }
  }

  resize(container)

  function render() {
    if (!context) return

    const { dpr, width, height } = resize(container)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = color

    const occupiedPixels = new Set<string>()
    for (const point of points) {
      const screenPoint = map.lngLatToContainer([point.longitude, point.latitude])
      const x = Math.floor(screenPoint.x)
      const y = Math.floor(screenPoint.y)

      if (x < 0 || y < 0 || x >= width || y >= height) continue

      const pixelKey = `${x}:${y}`
      if (occupiedPixels.has(pixelKey)) continue

      occupiedPixels.add(pixelKey)
      context.fillRect(x, y, pixelSize, pixelSize)
    }
  }

  const customLayer = new AMapRuntime.CustomLayer(canvas, {
    map,
    zIndex: 20,
    alwaysRender: false,
    render,
  })

  return {
    update(nextPoints: FootprintPoint[]) {
      points = nextPoints
      customLayer.render()
    },
    destroy() {
      customLayer.setMap(null)
    },
  }
}

function getDevicePixelRatio() {
  return Math.max(1, window.devicePixelRatio || 1)
}
