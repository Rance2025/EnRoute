export type NavigationStyle = 'icon' | 'mixed'
export type AppTheme = 'mist'

export const NAVIGATION_STYLE_STORAGE_KEY = 'enroute:navigation-style'
export const MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY = 'enroute:map-debug-panel-visible'
export const APP_THEME_STORAGE_KEY = 'enroute:app-theme'

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

export function readAppTheme(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
): AppTheme {
  try {
    return storage?.getItem(APP_THEME_STORAGE_KEY) === 'mist' ? 'mist' : 'mist'
  } catch {
    return 'mist'
  }
}

export function writeAppTheme(
  theme: AppTheme,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(APP_THEME_STORAGE_KEY, theme)
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

function getBrowserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}
