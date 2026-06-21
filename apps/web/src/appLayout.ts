export type AppView = 'overview' | 'map' | 'schedule' | 'accounting'

export type ViewportSize = {
  width: number
  height: number
}

export const SECONDARY_NAV_RAIL_WIDTH = 60
const DESKTOP_DATA_PANEL_MIN_WIDTH = 420
const DESKTOP_DATA_PANEL_MAX_WIDTH = 560
const DESKTOP_DATA_PANEL_WIDTH_RATIO = 0.27
const MOBILE_SHELL_BREAKPOINT = 720

export function calculateAvailableMapShellWidth({
  viewportWidth,
  secondaryRailWidth,
}: {
  viewportWidth: number
  secondaryRailWidth: number
}) {
  return Math.max(viewportWidth - secondaryRailWidth, 0)
}

export function calculateUnifiedMapPaneWidth({
  viewportWidth,
  secondaryRailWidth,
  dataPanelWidth,
}: {
  viewportWidth: number
  secondaryRailWidth: number
  dataPanelWidth: number
}) {
  return Math.max(viewportWidth - secondaryRailWidth - dataPanelWidth, 0)
}

export function calculateUnifiedDataPanelWidth({
  viewportSize,
  secondaryRailWidth = SECONDARY_NAV_RAIL_WIDTH,
}: {
  view: AppView
  viewportSize: ViewportSize
  secondaryRailWidth?: number
}) {
  if (viewportSize.width <= MOBILE_SHELL_BREAKPOINT) return 0

  const availableShellWidth = calculateAvailableMapShellWidth({
    viewportWidth: viewportSize.width,
    secondaryRailWidth,
  })
  const proportionalWidth = Math.round(availableShellWidth * DESKTOP_DATA_PANEL_WIDTH_RATIO)

  return Math.min(
    Math.max(proportionalWidth, DESKTOP_DATA_PANEL_MIN_WIDTH),
    DESKTOP_DATA_PANEL_MAX_WIDTH,
    availableShellWidth,
  )
}
