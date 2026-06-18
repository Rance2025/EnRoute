import type { ContainerPoint } from './mapDragBounds'
import type { MapBounds } from './mapCamera'
import {
  calculateMinimumZoomForWorldCoverage,
  isAtMinimumWorldZoom,
  projectLngLat,
  unprojectWorldPoint,
} from './mercator'

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
  const effectiveFocalPoint = isAtMinimumWorldZoom(targetZoom, viewportSize.height)
    ? {
        x: viewportSize.width / 2,
        y: viewportSize.height / 2,
      }
    : focalPoint
  const focalLngLat = containerPointToLngLat({
    point: effectiveFocalPoint,
    center,
    zoom: currentZoom,
    viewportSize,
  })
  const worldAtTargetZoom = projectLngLat(focalLngLat, targetZoom)
  const targetCenterWorld = {
    x: worldAtTargetZoom.x - (effectiveFocalPoint.x - viewportSize.width / 2),
    y: worldAtTargetZoom.y - (effectiveFocalPoint.y - viewportSize.height / 2),
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

  const center = map.getCenter()
  const currentCenter: [number, number] = [center.getLng(), center.getLat()]
  const targetCenter = calculateBoundedZoomCenter({
    center: currentCenter,
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

  if (targetZoom === currentZoom && centersAreEqual(targetCenter, currentCenter)) return

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

    if (zoom !== map.getZoom() || !centersAreEqual(nextCenter, [center.getLng(), center.getLat()])) {
      map.setZoomAndCenter(zoom, nextCenter, true)
    }

    if (progress < 1) {
      onTimer(window.setTimeout(tick, ZOOM_ANIMATION_FRAME_MS))
    }
  }

  tick()
}

function centersAreEqual(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001
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
  return calculateMinimumZoomForWorldCoverage(viewportHeight)
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
  const midpointY = (northEdgeWorld + southEdgeWorld) / 2

  if (isAtMinimumWorldZoom(zoom, viewportSize.height)) {
    return {
      x: centerWorld.x,
      y: midpointY,
    }
  }

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

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3
}
