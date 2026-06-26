export type NavigationStyle = 'icon' | 'mixed'
export type MapProjectionPreference = 'globe' | 'mercator'

export const NAVIGATION_STYLE_STORAGE_KEY = 'enroute:navigation-style'
export const MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY = 'enroute:map-debug-panel-visible'
export const MAP_PROJECTION_STORAGE_KEY = 'enroute:map-projection'

export function readNavigationStyle(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
): NavigationStyle {
  try {
    const storedValue = storage?.getItem(NAVIGATION_STYLE_STORAGE_KEY)

    return storedValue === 'mixed' ? 'mixed' : 'icon'
  } catch {
    return 'icon'
  }
}

export function writeNavigationStyle(
  style: NavigationStyle,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(NAVIGATION_STYLE_STORAGE_KEY, style)
  } catch {
    // Local preference writes should never block the UI.
  }
}

export function readMapDebugPanelVisible(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
) {
  try {
    return storage?.getItem(MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeMapDebugPanelVisible(
  visible: boolean,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY, visible ? 'true' : 'false')
  } catch {
    // Local preference writes should never block the UI.
  }
}

export function readMapProjection(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
): MapProjectionPreference {
  try {
    const storedValue = storage?.getItem(MAP_PROJECTION_STORAGE_KEY)

    return storedValue === 'mercator' ? 'mercator' : 'globe'
  } catch {
    return 'globe'
  }
}

export function writeMapProjection(
  projection: MapProjectionPreference,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(MAP_PROJECTION_STORAGE_KEY, projection)
  } catch {
    // Local preference writes should never block the UI.
  }
}

function getBrowserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}
