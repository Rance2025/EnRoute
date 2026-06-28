import type { MapStylePreference } from './mapStyleOptions'

export type NavigationStyle = 'icon' | 'mixed'
export type AppTheme = 'mist'
export type MapProjectionPreference = 'globe' | 'mercator'
export type MapLanguagePreference = 'auto' | 'zh-Hans' | 'en'
export type { MapStylePreference } from './mapStyleOptions'

export const NAVIGATION_STYLE_STORAGE_KEY = 'enroute:navigation-style'
export const MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY = 'enroute:map-debug-panel-visible'
export const MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY = 'enroute:map-place-labels-visible'
export const MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY = 'enroute:map-admin-boundaries-visible'
export const APP_THEME_STORAGE_KEY = 'enroute:app-theme'
export const MAP_PROJECTION_STORAGE_KEY = 'enroute:map-projection'
export const MAP_STYLE_STORAGE_KEY = 'enroute:map-style'
export const MAP_LANGUAGE_STORAGE_KEY = 'enroute:map-language'
export const GLASS_PANEL_OPACITY_STORAGE_KEY = 'enroute:glass-panel-opacity'

export const DEFAULT_GLASS_PANEL_OPACITY = 0.92
export const GLASS_PANEL_OPACITY_MIN = 0.1
export const GLASS_PANEL_OPACITY_MAX = 1
export const GLASS_PANEL_OPACITY_STEP = 0.01

const GLASS_PANEL_OPACITY_PRECISION = 100

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

export function readGlassPanelOpacity(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
) {
  try {
    const storedValue = storage?.getItem(GLASS_PANEL_OPACITY_STORAGE_KEY)

    if (storedValue === undefined || storedValue === null) {
      return DEFAULT_GLASS_PANEL_OPACITY
    }

    return normalizeGlassPanelOpacity(Number(storedValue))
  } catch {
    return DEFAULT_GLASS_PANEL_OPACITY
  }
}

export function writeGlassPanelOpacity(
  opacity: number,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(
      GLASS_PANEL_OPACITY_STORAGE_KEY,
      formatGlassPanelOpacity(normalizeGlassPanelOpacity(opacity)),
    )
  } catch {
    // Local preference writes should never block the UI.
  }
}

export function normalizeGlassPanelOpacity(opacity: unknown) {
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) {
    return DEFAULT_GLASS_PANEL_OPACITY
  }

  const clampedOpacity = Math.min(
    Math.max(opacity, GLASS_PANEL_OPACITY_MIN),
    GLASS_PANEL_OPACITY_MAX,
  )

  return Math.round(clampedOpacity * GLASS_PANEL_OPACITY_PRECISION) /
    GLASS_PANEL_OPACITY_PRECISION
}

export function formatGlassPanelOpacity(opacity: number) {
  return normalizeGlassPanelOpacity(opacity).toString()
}

export function readMapPlaceLabelsVisible(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
) {
  return readVisibleByDefaultPreference(MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY, storage)
}

export function writeMapPlaceLabelsVisible(
  visible: boolean,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  writeBooleanPreference(MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY, visible, storage)
}

export function readMapAdminBoundariesVisible(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
) {
  return readVisibleByDefaultPreference(MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY, storage)
}

export function writeMapAdminBoundariesVisible(
  visible: boolean,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  writeBooleanPreference(MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY, visible, storage)
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

export function readMapStyle(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
): MapStylePreference {
  try {
    const storedValue = storage?.getItem(MAP_STYLE_STORAGE_KEY)

    return storedValue === 'alternate' ? 'alternate' : 'primary'
  } catch {
    return 'primary'
  }
}

export function writeMapStyle(
  style: MapStylePreference,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(MAP_STYLE_STORAGE_KEY, style)
  } catch {
    // Local preference writes should never block the UI.
  }
}

export function readMapLanguage(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
): MapLanguagePreference {
  try {
    const storedValue = storage?.getItem(MAP_LANGUAGE_STORAGE_KEY)

    return storedValue === 'zh-Hans' || storedValue === 'en' ? storedValue : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeMapLanguage(
  language: MapLanguagePreference,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(MAP_LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Local preference writes should never block the UI.
  }
}

function readVisibleByDefaultPreference(
  key: string,
  storage: Pick<Storage, 'getItem'> | undefined,
) {
  try {
    return storage?.getItem(key) !== 'false'
  } catch {
    return true
  }
}

function writeBooleanPreference(
  key: string,
  value: boolean,
  storage: Pick<Storage, 'setItem'> | undefined,
) {
  try {
    storage?.setItem(key, value ? 'true' : 'false')
  } catch {
    // Local preference writes should never block the UI.
  }
}

function getBrowserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}
