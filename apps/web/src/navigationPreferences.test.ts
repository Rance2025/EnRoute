import { describe, expect, it, vi } from 'vitest'

import {
  MAP_ADMIN_BOUNDARIES_VISIBLE_STORAGE_KEY,
  MAP_PROJECTION_STORAGE_KEY,
  MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY,
  MAP_PLACE_LABELS_VISIBLE_STORAGE_KEY,
  NAVIGATION_STYLE_STORAGE_KEY,
  readMapAdminBoundariesVisible,
  readMapProjection,
  readMapDebugPanelVisible,
  readMapPlaceLabelsVisible,
  readNavigationStyle,
  writeMapAdminBoundariesVisible,
  writeMapProjection,
  writeMapDebugPanelVisible,
  writeMapPlaceLabelsVisible,
  writeNavigationStyle,
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
})
