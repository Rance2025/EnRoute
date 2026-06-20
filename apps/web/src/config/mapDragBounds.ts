import type { MapBounds } from './mapCamera'
import {
  calculateLatitudeMidpoint,
  calculateMinimumZoomForWorldCoverage,
  isAtMinimumWorldZoom,
} from './mercator'
import { calculateWorldCenter } from './mapCamera'

export type ContainerPoint = {
  x: number
  y: number
}

type LngLatPoint = {
  getLng: () => number
  getLat: () => number
}

export type BoundedDragMap = {
  setStatus: (status: { dragEnable?: boolean }) => void
  getZoom?: () => number
  getCenter: () => LngLatPoint
  setCenter: (center: [number, number], immediately?: boolean, duration?: number) => void
  lngLatToContainer: (lngLat: [number, number]) => ContainerPoint
  containerToLngLat: (point: ContainerPoint) => LngLatPoint | [number, number]
}

export function clampMapCenterToLatitudeBounds(
  map: BoundedDragMap,
  container: HTMLElement,
  bounds: MapBounds,
) {
  const center = map.getCenter()
  const nextCenter = calculateBoundedCenterForViewport({
    center: [center.getLng(), center.getLat()],
    bounds,
    viewportSize: {
      width: container.clientWidth,
      height: container.clientHeight,
    },
    lngLatToContainer: map.lngLatToContainer.bind(map),
    containerToLngLat: map.containerToLngLat.bind(map),
  })

  map.setCenter(nextCenter, true)
}

type CalculateBoundedCenterForViewportOptions = {
  center: [number, number]
  fallbackCenter?: [number, number]
  bounds: MapBounds
  viewportSize: {
    width: number
    height: number
  }
  lngLatToContainer: (lngLat: [number, number]) => ContainerPoint
  containerToLngLat: (point: ContainerPoint) => LngLatPoint | [number, number]
}

const LATITUDE_EDGE_PADDING_DEGREES = 0.12
type DragState = {
  pointerId: number
  lastPointer: ContainerPoint
}

type CalculateNextBoundedDragCenterOptions = {
  currentCenter: [number, number]
  currentZoom?: number
  previousPointer: ContainerPoint
  currentPointer: ContainerPoint
  bounds: MapBounds
  viewportSize: {
    width: number
    height: number
  }
  lngLatToContainer: (lngLat: [number, number]) => ContainerPoint
  containerToLngLat: (point: ContainerPoint) => LngLatPoint | [number, number]
}

export function installBoundedMapDrag(
  map: BoundedDragMap,
  container: HTMLElement,
  bounds: MapBounds,
) {
  map.setStatus({ dragEnable: false })

  let dragState: DragState | null = null

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || shouldIgnorePointerTarget(event.target)) {
      return
    }

    dragState = {
      pointerId: event.pointerId,
      lastPointer: pointerFromEvent(event),
    }
    container.classList.add('is-map-dragging')
    capturePointerIfPossible(container, event.pointerId)
    event.preventDefault()
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const nextPointer = pointerFromEvent(event)
    const center = map.getCenter()
    const nextCenter = calculateNextBoundedDragCenter({
      currentCenter: [center.getLng(), center.getLat()],
      currentZoom: typeof map.getZoom === 'function' ? map.getZoom() : undefined,
      previousPointer: dragState.lastPointer,
      currentPointer: nextPointer,
      bounds,
      viewportSize: {
        width: container.clientWidth,
        height: container.clientHeight,
      },
      lngLatToContainer: map.lngLatToContainer.bind(map),
      containerToLngLat: map.containerToLngLat.bind(map),
    })

    map.setCenter(nextCenter, true)
    dragState.lastPointer = nextPointer
    event.preventDefault()
  }

  function stopDragging(event: PointerEvent) {
    if (!dragState || dragState.pointerId !== event.pointerId) return

    releasePointerCaptureIfActive(container, event.pointerId)
    container.classList.remove('is-map-dragging')
    dragState = null
  }

  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerup', stopDragging)
  container.addEventListener('pointercancel', stopDragging)

  return () => {
    container.removeEventListener('pointerdown', onPointerDown)
    container.removeEventListener('pointermove', onPointerMove)
    container.removeEventListener('pointerup', stopDragging)
    container.removeEventListener('pointercancel', stopDragging)
    container.classList.remove('is-map-dragging')
  }
}

export function calculateNextBoundedDragCenter({
  currentCenter,
  currentZoom,
  previousPointer,
  currentPointer,
  bounds,
  viewportSize,
  lngLatToContainer,
  containerToLngLat,
}: CalculateNextBoundedDragCenterOptions): [number, number] {
  const centerPoint = lngLatToContainer(currentCenter)
  const targetPoint = {
    x: centerPoint.x - (currentPointer.x - previousPointer.x),
    y: centerPoint.y - (currentPointer.y - previousPointer.y),
  }
  const targetLngLat = normalizeLngLat(containerToLngLat(targetPoint))
  const viewportEdgeOffsets = calculateViewportEdgeOffsets({
    center: currentCenter,
    viewportSize,
    containerToLngLat,
  })

  const minLatitude = bounds.southWest[1] + viewportEdgeOffsets.south + LATITUDE_EDGE_PADDING_DEGREES
  const maxLatitude = bounds.northEast[1] - viewportEdgeOffsets.north - LATITUDE_EDGE_PADDING_DEGREES
  const lockedLatitude =
    currentZoom !== undefined && isAtMinimumWorldZoom(currentZoom, viewportSize.height)
      ? calculateLatitudeMidpoint(bounds)
      : undefined
  const lockedLongitude =
    currentZoom !== undefined && isAtMinimumWorldZoom(currentZoom, viewportSize.height)
      ? calculateWorldCenter(bounds)[0]
      : undefined

  return [
    lockedLongitude ?? targetLngLat[0],
    lockedLatitude ??
      (minLatitude > maxLatitude
        ? calculateLatitudeMidpoint(bounds)
        : clampToViewportRange(targetLngLat[1], currentCenter[1], minLatitude, maxLatitude)),
  ]
}

export function calculateBoundedCenterForViewport({
  center,
  fallbackCenter = center,
  bounds,
  viewportSize,
  lngLatToContainer,
  containerToLngLat,
}: CalculateBoundedCenterForViewportOptions): [number, number] {
  const centerPoint = lngLatToContainer(center)
  const northEdgePoint = lngLatToContainer([center[0], bounds.northEast[1]])
  const southEdgePoint = lngLatToContainer([center[0], bounds.southWest[1]])

  if (northEdgePoint.y > 0) {
    return normalizeLngLat(
      containerToLngLat({
        x: centerPoint.x,
        y: centerPoint.y + northEdgePoint.y + LATITUDE_EDGE_PADDING_DEGREES,
      }),
    )
  }

  if (southEdgePoint.y < viewportSize.height) {
    return normalizeLngLat(
      containerToLngLat({
        x: centerPoint.x,
        y: centerPoint.y - (viewportSize.height - southEdgePoint.y) - LATITUDE_EDGE_PADDING_DEGREES,
      }),
    )
  }

  const viewportEdgeOffsets = calculateViewportEdgeOffsets({
    center,
    viewportSize,
    containerToLngLat,
  })

  return [
    center[0],
    clampToViewportRange(
      center[1],
      fallbackCenter[1],
      bounds.southWest[1] + viewportEdgeOffsets.south + LATITUDE_EDGE_PADDING_DEGREES,
      bounds.northEast[1] - viewportEdgeOffsets.north - LATITUDE_EDGE_PADDING_DEGREES,
    ),
  ]
}

export function calculateMinimumZoomForLatitudeCoverage(viewportHeight: number) {
  return calculateMinimumZoomForWorldCoverage(viewportHeight)
}

function pointerFromEvent(event: PointerEvent): ContainerPoint {
  return {
    x: event.clientX,
    y: event.clientY,
  }
}

function shouldIgnorePointerTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('button, a, input, textarea, select'))
}

function capturePointerIfPossible(container: HTMLElement, pointerId: number) {
  if (!canCapturePointer(container)) return

  try {
    container.setPointerCapture(pointerId)
  } catch {
    // Synthetic pointer events used by tests do not belong to an active pointer stream.
  }
}

function releasePointerCaptureIfActive(container: HTMLElement, pointerId: number) {
  if (!canReleasePointer(container)) return

  try {
    if (!container.hasPointerCapture || container.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId)
    }
  } catch {
    // The browser may have already released capture after pointer cancellation.
  }
}

function clampToViewportRange(value: number, fallback: number, min: number, max: number) {
  if (min > max) {
    return fallback
  }

  return Math.min(Math.max(value, min), max)
}

function canCapturePointer(container: HTMLElement): container is HTMLElement & {
  setPointerCapture: (pointerId: number) => void
} {
  return typeof container.setPointerCapture === 'function'
}

function canReleasePointer(container: HTMLElement): container is HTMLElement & {
  releasePointerCapture: (pointerId: number) => void
  hasPointerCapture?: (pointerId: number) => boolean
} {
  return typeof container.releasePointerCapture === 'function'
}

function normalizeLngLat(lngLat: LngLatPoint | [number, number]): [number, number] {
  if (Array.isArray(lngLat)) {
    return lngLat
  }

  return [lngLat.getLng(), lngLat.getLat()]
}

function calculateViewportEdgeOffsets({
  center,
  viewportSize,
  containerToLngLat,
}: {
  center: [number, number]
  viewportSize: { width: number; height: number }
  containerToLngLat: (point: ContainerPoint) => LngLatPoint | [number, number]
}) {
  const northWest = normalizeLngLat(containerToLngLat({ x: 0, y: 0 }))
  const southEast = normalizeLngLat(
    containerToLngLat({ x: viewportSize.width, y: viewportSize.height }),
  )

  return {
    west: Math.abs(center[0] - northWest[0]),
    east: Math.abs(southEast[0] - center[0]),
    north: Math.abs(northWest[1] - center[1]),
    south: Math.abs(center[1] - southEast[1]),
  }
}
