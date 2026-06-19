import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadFootprintPoints } from './footprintDataSource'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadFootprintPoints', () => {
  it('returns an empty list without fetching when no URL is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFootprintPoints('', new AbortController().signal)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches and parses the configured CSV URL', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        [
          'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
          '1768144456,1,121.511383,31.296564,0,5,-1,0,1,0,10',
        ].join('\n'),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const points = await loadFootprintPoints('/local/backUpData-all.csv', signal)

    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({
      longitude: expect.closeTo(121.515779, 6),
      latitude: expect.closeTo(31.29454, 6),
    })
    expect(fetchMock).toHaveBeenCalledWith('/local/backUpData-all.csv', { signal })
  })

  it('passes the configured source coordinate system into CSV parsing', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        [
          'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
          '1768144456,1,121.511383,31.296564,0,5,-1,0,1,0,10',
        ].join('\n'),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const points = await loadFootprintPoints('/local/backUpData-all.csv', signal, 'gcj02')

    expect(points[0]).toMatchObject({
      longitude: 121.511383,
      latitude: 31.296564,
    })
  })
})
