export const DEFAULT_MAP_FOCUS_MARGIN_PX = 64

export type MapFocusRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type MapFocusPadding = {
  top: number
  right: number
  bottom: number
  left: number
}

type MapFocusPaddingOptions = {
  mapRect: MapFocusRect
  leftPanelRect?: MapFocusRect | null
  rightPanelRect?: MapFocusRect | null
  safeMargin?: number
}

function isValidRect(rect: MapFocusRect | null | undefined): rect is MapFocusRect {
  return Boolean(
    rect
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.right)
    && Number.isFinite(rect.bottom)
    && rect.right > rect.left
    && rect.bottom > rect.top,
  )
}

function overlapsMap(mapRect: MapFocusRect, panelRect: MapFocusRect) {
  return (
    Math.min(mapRect.right, panelRect.right) > Math.max(mapRect.left, panelRect.left)
    && Math.min(mapRect.bottom, panelRect.bottom) > Math.max(mapRect.top, panelRect.top)
  )
}

function normalizeSafeMargin(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : DEFAULT_MAP_FOCUS_MARGIN_PX
}

function uniformPadding(value: number): MapFocusPadding {
  return { top: value, right: value, bottom: value, left: value }
}

export function calculateMapFocusPadding({
  mapRect,
  leftPanelRect,
  rightPanelRect,
  safeMargin,
}: MapFocusPaddingOptions): MapFocusPadding {
  const margin = normalizeSafeMargin(safeMargin)
  if (!isValidRect(mapRect)) return uniformPadding(margin)

  const leftOcclusion = isValidRect(leftPanelRect) && overlapsMap(mapRect, leftPanelRect)
    ? Math.min(Math.max(leftPanelRect.right, mapRect.left), mapRect.right) - mapRect.left
    : 0
  const rightOcclusion = isValidRect(rightPanelRect) && overlapsMap(mapRect, rightPanelRect)
    ? mapRect.right - Math.max(Math.min(rightPanelRect.left, mapRect.right), mapRect.left)
    : 0

  return {
    top: margin,
    right: rightOcclusion + margin,
    bottom: margin,
    left: leftOcclusion + margin,
  }
}

export function measureMapFocusPadding(
  mapNode: HTMLElement,
  safeMargin = DEFAULT_MAP_FOCUS_MARGIN_PX,
): MapFocusPadding {
  const shell = mapNode.closest('.app-shell')
  const leftPanel = shell?.querySelector<HTMLElement>('.time-context-panel')
  const rightPanel = shell?.querySelector<HTMLElement>('.right-context-panel')

  return calculateMapFocusPadding({
    mapRect: mapNode.getBoundingClientRect(),
    leftPanelRect: leftPanel?.getBoundingClientRect(),
    rightPanelRect: rightPanel?.getBoundingClientRect(),
    safeMargin,
  })
}
