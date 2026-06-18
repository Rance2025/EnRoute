import type { ContainerPoint } from './mapDragBounds'
import type { MapBounds } from './mapCamera'

type LngLatPoint = {
  getLng: () => number
  getLat: () => number
}

export type BoundedZoomMap = {
  setStatus: (status: {
    dragEnable?: boolean
    scrollWheel?: boolean
    doubleClickZoom?: boolean
    keyboardEnable?: boolean
  }) => void
  getZoom: () => number
  getCenter: () => LngLatPoint
  setZoomAndCenter: (zoom: number, center: [number, number], immediately?: boolean) => void
}

type CalculateBoundedZoomCenterOptions = {
  center: [number, number]
  currentZoom: number
  targetZoom: number
  focalPoint: ContainerPoint
  viewportSize: {
    width: number
    height: number
  }
  bounds: MapBounds
}

const TILE_SIZE = 256
const MAX_MERCATOR_LATITUDE = 85.05112878
const WHEEL_ZOOM_SENSITIVITY = 0.0022
const WHEEL_ZOOM_MIN_STEP = 0.08
const WHEEL_ZOOM_MAX_STEP = 0.42
const TOOLBAR_ZOOM_STEP = 0.5
const ZOOM_ANIMATION_DURATION_MS = 180
const ZOOM_ANIMATION_FRAME_MS = 16

export function calculateBoundedZoomCenter({
  center,
  currentZoom,
  targetZoom,
  focalPoint,
  viewportSize,
  bounds,
}: CalculateBoundedZoomCenterOptions): [number, number] {
  const focalLngLat = containerPointToLngLat({
    point: focalPoint,
    center,
    zoom: currentZoom,
    viewportSize,
  })
  const worldAtTargetZoom = projectLngLat(focalLngLat, targetZoom)
  const targetCenterWorld = {
    x: worldAtTargetZoom.x - (focalPoint.x - viewportSize.width / 2),
    y: worldAtTargetZoom.y - (focalPoint.y - viewportSize.height / 2),
  }
  const boundedCenterWorld = clampWorldYToLatitudeBounds({
    centerWorld: targetCenterWorld,
    zoom: targetZoom,
    viewportSize,
    bounds,
  })

  return unprojectWorldPoint(boundedCenterWorld, targetZoom)
}

export function installBoundedMapZoom(
  map: BoundedZoomMap,
  container: HTMLElement,
  bounds: MapBounds,
) {
  map.setStatus({
    dragEnable: false,
    scrollWheel: false,
    doubleClickZoom: false,
    keyboardEnable: false,
  })

  let animationTimer: number | null = null

  function onWheel(event: WheelEvent) {
    if (!event.cancelable) return

    event.preventDefault()

    const currentZoom = map.getZoom()
    const zoomStep = calculateWheelZoomStep(event.deltaY)
    const targetZoom = clampZoom(
      currentZoom + zoomStep,
      calculateMinimumZoomForViewport(container.clientHeight),
    )

    if (targetZoom === currentZoom) return

    const rect = container.getBoundingClientRect()
    animateZoom({
      map,
      container,
      bounds,
      startZoom: currentZoom,
      targetZoom,
      focalPoint: {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      onTimer: (timer) => {
        if (animationTimer !== null) window.clearTimeout(animationTimer)
        animationTimer = timer
      },
    })
  }

  container.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    if (animationTimer !== null) window.clearTimeout(animationTimer)
    container.removeEventListener('wheel', onWheel)
  }
}

export function zoomByStep(
  map: BoundedZoomMap,
  container: HTMLElement,
  bounds: MapBounds,
  direction: 1 | -1,
) {
  const currentZoom = map.getZoom()
  const targetZoom = clampZoom(
    currentZoom + TOOLBAR_ZOOM_STEP * direction,
    calculateMinimumZoomForViewport(container.clientHeight),
  )

  if (targetZoom === currentZoom) return

  const center = map.getCenter()
  const targetCenter = calculateBoundedZoomCenter({
    center: [center.getLng(), center.getLat()],
    currentZoom,
    targetZoom,
    focalPoint: {
      x: container.clientWidth / 2,
      y: container.clientHeight / 2,
    },
    viewportSize: {
      width: container.clientWidth,
      height: container.clientHeight,
    },
    bounds,
  })

  map.setZoomAndCenter(targetZoom, targetCenter, true)
}

function animateZoom({
  map,
  container,
  bounds,
  startZoom,
  targetZoom,
  focalPoint,
  onTimer,
}: {
  map: BoundedZoomMap
  container: HTMLElement
  bounds: MapBounds
  startZoom: number
  targetZoom: number
  focalPoint: ContainerPoint
  onTimer: (timer: number) => void
}) {
  const startedAt = performance.now()

  function tick() {
    const progress = Math.min((performance.now() - startedAt) / ZOOM_ANIMATION_DURATION_MS, 1)
    const easedProgress = easeOutCubic(progress)
    const zoom = startZoom + (targetZoom - startZoom) * easedProgress
    const center = map.getCenter()
    const nextCenter = calculateBoundedZoomCenter({
      center: [center.getLng(), center.getLat()],
      currentZoom: map.getZoom(),
      targetZoom: zoom,
      focalPoint,
      viewportSize: {
        width: container.clientWidth,
        height: container.clientHeight,
      },
      bounds,
    })

    map.setZoomAndCenter(zoom, nextCenter, true)

    if (progress < 1) {
      onTimer(window.setTimeout(tick, ZOOM_ANIMATION_FRAME_MS))
    }
  }

  tick()
}

function calculateWheelZoomStep(deltaY: number) {
  const direction = deltaY > 0 ? -1 : 1
  const magnitude = Math.min(
    Math.max(Math.abs(deltaY) * WHEEL_ZOOM_SENSITIVITY, WHEEL_ZOOM_MIN_STEP),
    WHEEL_ZOOM_MAX_STEP,
  )

  return direction * magnitude
}

function calculateMinimumZoomForViewport(viewportHeight: number) {
  return Math.log2(viewportHeight / TILE_SIZE)
}

function clampZoom(zoom: number, minZoom: number) {
  return Math.min(Math.max(zoom, minZoom), 20)
}

function clampWorldYToLatitudeBounds({
  centerWorld,
  zoom,
  viewportSize,
  bounds,
}: {
  centerWorld: ContainerPoint
  zoom: number
  viewportSize: { width: number; height: number }
  bounds: MapBounds
}) {
  const northEdgeWorld = projectLngLat([0, bounds.northEast[1]], zoom).y
  const southEdgeWorld = projectLngLat([0, bounds.southWest[1]], zoom).y
  const halfViewportHeight = viewportSize.height / 2
  const minCenterY = northEdgeWorld + halfViewportHeight
  const maxCenterY = southEdgeWorld - halfViewportHeight

  if (minCenterY > maxCenterY) {
    return centerWorld
  }

  return {
    x: centerWorld.x,
    y: Math.min(Math.max(centerWorld.y, minCenterY), maxCenterY),
  }
}

function containerPointToLngLat({
  point,
  center,
  zoom,
  viewportSize,
}: {
  point: ContainerPoint
  center: [number, number]
  zoom: number
  viewportSize: { width: number; height: number }
}) {
  const centerWorld = projectLngLat(center, zoom)

  return unprojectWorldPoint(
    {
      x: centerWorld.x + point.x - viewportSize.width / 2,
      y: centerWorld.y + point.y - viewportSize.height / 2,
    },
    zoom,
  )
}

function projectLngLat([lng, lat]: [number, number], zoom: number): ContainerPoint {
  const scale = TILE_SIZE * 2 ** zoom
  const clampedLat = Math.min(Math.max(lat, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE)
  const sinLat = Math.sin((clampedLat * Math.PI) / 180)

  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
}

function unprojectWorldPoint(point: ContainerPoint, zoom: number): [number, number] {
  const scale = TILE_SIZE * 2 ** zoom
  const lng = (point.x / scale) * 360 - 180
  const latRadians = Math.atan(Math.sinh(Math.PI * (1 - (2 * point.y) / scale)))

  return [lng, (latRadians * 180) / Math.PI]
}

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3
}
