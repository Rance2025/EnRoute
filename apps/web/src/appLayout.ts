export type AppView = 'overview' | 'map' | 'schedule' | 'accounting'

export type ViewportSize = {
  width: number
  height: number
}

export const SECONDARY_NAV_RAIL_WIDTH = 300
const DESKTOP_DATA_PANEL_MIN_WIDTH = 300
const DESKTOP_DATA_PANEL_MAX_WIDTH = 360
const DESKTOP_DATA_PANEL_WIDTH_RATIO = 0.22
const MOBILE_SHELL_BREAKPOINT = 720

export function calculateAvailableMapShellWidth({
  viewportWidth,
  rightPanelWidth,
}: {
  viewportWidth: number
  rightPanelWidth: number
}) {
  return Math.max(viewportWidth - rightPanelWidth, 0)
}

export function calculateUnifiedMapPaneWidth({
  viewportWidth,
  rightPanelWidth,
  dataPanelWidth,
}: {
  viewportWidth: number
  rightPanelWidth: number
  dataPanelWidth: number
}) {
  return Math.max(viewportWidth - rightPanelWidth - dataPanelWidth, 0)
}

export function calculateUnifiedDataPanelWidth({
  viewportSize,
}: {
  view: AppView
  viewportSize: ViewportSize
}) {
  if (viewportSize.width <= MOBILE_SHELL_BREAKPOINT) return 0

  const proportionalWidth = Math.round(viewportSize.width * DESKTOP_DATA_PANEL_WIDTH_RATIO)

  return Math.min(
    Math.max(proportionalWidth, DESKTOP_DATA_PANEL_MIN_WIDTH),
    DESKTOP_DATA_PANEL_MAX_WIDTH,
    Math.floor(viewportSize.width / 2),
  )
}
