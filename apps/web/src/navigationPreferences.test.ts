import { describe, expect, it, vi } from 'vitest'

import {
  NAVIGATION_STYLE_STORAGE_KEY,
  readNavigationStyle,
  writeNavigationStyle,
} from './navigationPreferences'

function createStorage(initialValue?: string) {
  const values = new Map<string, string>()
  if (initialValue !== undefined) values.set(NAVIGATION_STYLE_STORAGE_KEY, initialValue)

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
})
