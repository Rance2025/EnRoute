import { describe, expect, it, vi } from 'vitest'

import {
  ADMIN_REGION_FILL_OPACITY_STORAGE_KEY,
  ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY,
  GLASS_PANEL_OPACITY_STORAGE_KEY,
  MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY,
  MAP_PROJECTION_STORAGE_KEY,
  MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY,
  MAP_LANGUAGE_STORAGE_KEY,
  MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY,
  MAP_STYLE_STORAGE_KEY,
  NAVIGATION_STYLE_STORAGE_KEY,
  SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY,
  SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY,
  readAdminRegionFillOpacity,
  readAdminRegionLinesVisible,
  readGlassPanelOpacity,
  readMapAdminBoundariesVisible,
  readMapLanguage,
  readMapProjection,
  readMapDebugPanelVisible,
  readMapPlaceLabelsVisible,
  readMapStyle,
  readNavigationStyle,
  readShowAllAdminRegions,
  readShowFootprintsInRegionMode,
  writeAdminRegionFillOpacity,
  writeAdminRegionLinesVisible,
  writeMapAdminBoundariesVisible,
  writeMapLanguage,
  writeMapProjection,
  writeMapDebugPanelVisible,
  writeMapPlaceLabelsVisible,
  writeMapStyle,
  writeNavigationStyle,
  writeGlassPanelOpacity,
  writeShowAllAdminRegions,
  writeShowFootprintsInRegionMode,
} from './navigationPreferences'

function createStorage(initialValue?: string, key = NAVIGATION_STYLE_STORAGE_KEY) {
  const values = new Map<string, string>()
  if (initialValue !== undefined) values.set(key, initialValue)

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  } as Pick<Storage, 'getItem' | 'setItem'>
}

describe('navigationPreferences', () => {
  it('defaults to icon style when storage is empty or invalid', () => {
    expect(readNavigationStyle(createStorage())).toBe('icon')
    expect(readNavigationStyle(createStorage('wide'))).toBe('icon')
  })

  it('reads and writes the mixed navigation style', () => {
    const storage = createStorage('mixed')

    expect(readNavigationStyle(storage)).toBe('mixed')

    writeNavigationStyle('icon', storage)

    expect(storage.setItem).toHaveBeenCalledWith(NAVIGATION_STYLE_STORAGE_KEY, 'icon')
  })

  it('falls back without throwing when storage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    } as Pick<Storage, 'getItem' | 'setItem'>

    expect(readNavigationStyle(storage)).toBe('icon')
    expect(() => writeNavigationStyle('mixed', storage)).not.toThrow()
  })

  it('defaults the map debug panel to hidden unless storage explicitly enables it', () => {
    expect(readMapDebugPanelVisible(createStorage())).toBe(false)
    expect(readMapDebugPanelVisible(createStorage('false', MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY)))
      .toBe(false)
    expect(readMapDebugPanelVisible(createStorage('wide', MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY)))
      .toBe(false)
    expect(readMapDebugPanelVisible(createStorage('true', MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY)))
      .toBe(true)
  })

  it('writes the map debug panel visibility preference', () => {
    const storage = createStorage()

    writeMapDebugPanelVisible(true, storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY, 'true')

    writeMapDebugPanelVisible(false, storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY, 'false')
  })

  it('falls back without throwing when map debug panel storage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    } as Pick<Storage, 'getItem' | 'setItem'>

    expect(readMapDebugPanelVisible(storage)).toBe(false)
    expect(() => writeMapDebugPanelVisible(true, storage)).not.toThrow()
  })

  it('normalizes the shared glass panel opacity preference', () => {
    expect(readGlassPanelOpacity(createStorage())).toBe(0.7)
    expect(readGlassPanelOpacity(createStorage('0.48', GLASS_PANEL_OPACITY_STORAGE_KEY)))
      .toBe(0.48)
    expect(readGlassPanelOpacity(createStorage('-0.2', GLASS_PANEL_OPACITY_STORAGE_KEY)))
      .toBe(0)
    expect(readGlassPanelOpacity(createStorage('1.4', GLASS_PANEL_OPACITY_STORAGE_KEY)))
      .toBe(1)
    expect(readGlassPanelOpacity(createStorage('wide', GLASS_PANEL_OPACITY_STORAGE_KEY)))
      .toBe(0.7)
  })

  it('writes the shared glass panel opacity preference rounded to 0.01 precision', () => {
    const storage = createStorage()

    writeGlassPanelOpacity(0.736, storage)

    expect(storage.setItem).toHaveBeenCalledWith(GLASS_PANEL_OPACITY_STORAGE_KEY, '0.74')
  })

  it('falls back without throwing when glass panel opacity storage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    } as Pick<Storage, 'getItem' | 'setItem'>

    expect(readGlassPanelOpacity(storage)).toBe(0.7)
    expect(() => writeGlassPanelOpacity(0.48, storage)).not.toThrow()
  })

  it('defaults map projection to globe and only accepts globe or mercator', () => {
    expect(readMapProjection(createStorage())).toBe('globe')
    expect(readMapProjection(createStorage('wide', MAP_PROJECTION_STORAGE_KEY))).toBe('globe')
    expect(readMapProjection(createStorage('globe', MAP_PROJECTION_STORAGE_KEY))).toBe('globe')
    expect(readMapProjection(createStorage('mercator', MAP_PROJECTION_STORAGE_KEY))).toBe('mercator')
  })

  it('writes the map projection preference', () => {
    const storage = createStorage()

    writeMapProjection('mercator', storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_PROJECTION_STORAGE_KEY, 'mercator')

    writeMapProjection('globe', storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_PROJECTION_STORAGE_KEY, 'globe')
  })

  it('defaults map style to the primary style and only accepts known style ids', () => {
    expect(readMapStyle(createStorage())).toBe('primary')
    expect(readMapStyle(createStorage('wide', MAP_STYLE_STORAGE_KEY))).toBe('primary')
    expect(readMapStyle(createStorage('primary', MAP_STYLE_STORAGE_KEY))).toBe('primary')
    expect(readMapStyle(createStorage('alternate', MAP_STYLE_STORAGE_KEY))).toBe('alternate')
  })

  it('writes the map style preference', () => {
    const storage = createStorage()

    writeMapStyle('alternate', storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_STYLE_STORAGE_KEY, 'alternate')

    writeMapStyle('primary', storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_STYLE_STORAGE_KEY, 'primary')
  })

  it('defaults map language to all/default and only accepts configured language ids', () => {
    expect(readMapLanguage(createStorage())).toBe('auto')
    expect(readMapLanguage(createStorage('wide', MAP_LANGUAGE_STORAGE_KEY))).toBe('auto')
    expect(readMapLanguage(createStorage('auto', MAP_LANGUAGE_STORAGE_KEY))).toBe('auto')
    expect(readMapLanguage(createStorage('zh-Hans', MAP_LANGUAGE_STORAGE_KEY))).toBe('zh-Hans')
    expect(readMapLanguage(createStorage('en', MAP_LANGUAGE_STORAGE_KEY))).toBe('en')
  })

  it('writes the map language preference', () => {
    const storage = createStorage()

    writeMapLanguage('zh-Hans', storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_LANGUAGE_STORAGE_KEY, 'zh-Hans')

    writeMapLanguage('en', storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_LANGUAGE_STORAGE_KEY, 'en')

    writeMapLanguage('auto', storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_LANGUAGE_STORAGE_KEY, 'auto')
  })

  it('defaults map place labels and administrative boundaries to visible unless storage explicitly disables them', () => {
    expect(readMapPlaceLabelsVisible(createStorage())).toBe(true)
    expect(readMapPlaceLabelsVisible(createStorage('true', MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY)))
      .toBe(true)
    expect(readMapPlaceLabelsVisible(createStorage('wide', MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY)))
      .toBe(true)
    expect(readMapPlaceLabelsVisible(createStorage('false', MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY)))
      .toBe(false)

    expect(readMapAdminBoundariesVisible(createStorage())).toBe(true)
    expect(readMapAdminBoundariesVisible(createStorage('true', MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY)))
      .toBe(true)
    expect(readMapAdminBoundariesVisible(createStorage('wide', MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY)))
      .toBe(true)
    expect(readMapAdminBoundariesVisible(createStorage('false', MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY)))
      .toBe(false)
  })

  it('writes map place label and administrative boundary visibility preferences', () => {
    const storage = createStorage()

    writeMapPlaceLabelsVisible(false, storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY, 'false')

    writeMapPlaceLabelsVisible(true, storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY, 'true')

    writeMapAdminBoundariesVisible(false, storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY, 'false')

    writeMapAdminBoundariesVisible(true, storage)

    expect(storage.setItem).toHaveBeenCalledWith(MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY, 'true')
  })

  it('uses the intended defaults for region page display preferences', () => {
    const storage = createStorage()

    expect(readShowAllAdminRegions(storage)).toBe(false)
    expect(readShowFootprintsInRegionMode(storage)).toBe(false)
    expect(readAdminRegionLinesVisible(storage)).toBe(true)
    expect(readAdminRegionFillOpacity(storage)).toBe(0.18)
  })

  it('normalizes the stored admin-region fill opacity preference', () => {
    expect(readAdminRegionFillOpacity(
      createStorage('0.42', ADMIN_REGION_FILL_OPACITY_STORAGE_KEY),
    )).toBe(0.42)
    expect(readAdminRegionFillOpacity(
      createStorage('0.01', ADMIN_REGION_FILL_OPACITY_STORAGE_KEY),
    )).toBe(0.05)
    expect(readAdminRegionFillOpacity(
      createStorage('1.2', ADMIN_REGION_FILL_OPACITY_STORAGE_KEY),
    )).toBe(1)
    expect(readAdminRegionFillOpacity(
      createStorage('wide', ADMIN_REGION_FILL_OPACITY_STORAGE_KEY),
    )).toBe(0.18)
  })

  it('writes the admin-region fill opacity rounded to 0.01 precision', () => {
    const storage = createStorage()

    writeAdminRegionFillOpacity(0.736, storage)

    expect(storage.setItem).toHaveBeenCalledWith(
      ADMIN_REGION_FILL_OPACITY_STORAGE_KEY,
      '0.74',
    )
  })

  it('reads stored region page display preferences', () => {
    expect(readShowAllAdminRegions(
      createStorage('true', SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY),
    )).toBe(true)
    expect(readShowAllAdminRegions(
      createStorage('false', SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY),
    )).toBe(false)
    expect(readShowFootprintsInRegionMode(
      createStorage('true', SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY),
    )).toBe(true)
    expect(readShowFootprintsInRegionMode(
      createStorage('false', SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY),
    )).toBe(false)
    expect(readAdminRegionLinesVisible(
      createStorage('true', ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY),
    )).toBe(true)
    expect(readAdminRegionLinesVisible(
      createStorage('false', ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY),
    )).toBe(false)
  })

  it('writes region page display preferences to independent storage keys', () => {
    const storage = createStorage()

    writeShowAllAdminRegions(true, storage)
    writeShowFootprintsInRegionMode(false, storage)
    writeAdminRegionLinesVisible(true, storage)

    expect(storage.setItem).toHaveBeenNthCalledWith(
      1,
      SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY,
      'true',
    )
    expect(storage.setItem).toHaveBeenNthCalledWith(
      2,
      SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY,
      'false',
    )
    expect(storage.setItem).toHaveBeenNthCalledWith(
      3,
      ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY,
      'true',
    )

    writeShowAllAdminRegions(false, storage)
    writeShowFootprintsInRegionMode(true, storage)
    writeAdminRegionLinesVisible(false, storage)

    expect(readShowAllAdminRegions(storage)).toBe(false)
    expect(readShowFootprintsInRegionMode(storage)).toBe(true)
    expect(readAdminRegionLinesVisible(storage)).toBe(false)
  })

  it('uses region page display defaults when browser storage is unavailable', () => {
    vi.stubGlobal('window', undefined)

    try {
      expect(readShowAllAdminRegions()).toBe(false)
      expect(readShowFootprintsInRegionMode()).toBe(false)
      expect(readAdminRegionLinesVisible()).toBe(true)
      expect(readAdminRegionFillOpacity()).toBe(0.18)
      expect(() => writeShowAllAdminRegions(true)).not.toThrow()
      expect(() => writeShowFootprintsInRegionMode(true)).not.toThrow()
      expect(() => writeAdminRegionLinesVisible(false)).not.toThrow()
      expect(() => writeAdminRegionFillOpacity(0.42)).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back when the browser localStorage getter throws', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('blocked')
      },
    })

    try {
      expect(readShowAllAdminRegions()).toBe(false)
      expect(readShowFootprintsInRegionMode()).toBe(false)
      expect(readAdminRegionLinesVisible()).toBe(true)
      expect(() => writeShowAllAdminRegions(true)).not.toThrow()
      expect(() => writeShowFootprintsInRegionMode(true)).not.toThrow()
      expect(() => writeAdminRegionLinesVisible(false)).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back without throwing when region page display storage throws', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    } as Pick<Storage, 'getItem' | 'setItem'>

    expect(readShowAllAdminRegions(storage)).toBe(false)
    expect(readShowFootprintsInRegionMode(storage)).toBe(false)
    expect(readAdminRegionLinesVisible(storage)).toBe(true)
    expect(readAdminRegionFillOpacity(storage)).toBe(0.18)
    expect(() => writeShowAllAdminRegions(true, storage)).not.toThrow()
    expect(() => writeShowFootprintsInRegionMode(true, storage)).not.toThrow()
    expect(() => writeAdminRegionLinesVisible(false, storage)).not.toThrow()
    expect(() => writeAdminRegionFillOpacity(0.42, storage)).not.toThrow()
  })
})
