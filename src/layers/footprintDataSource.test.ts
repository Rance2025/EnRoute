import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadFootprintPoints } from './footprintDataSource'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadFootprintPoints', () => {
  it('uses the local footprints API when no URL is configured', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        points: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFootprintPoints(undefined, signal)).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/footprints', { signal })
  })

  it('fetches and validates the configured footprints API URL', async () => {
    const signal = new AbortController().signal
    const apiPoints = [
      {
        id: '1768144456-0',
        timestampSeconds: 1768144456,
        longitude: 121.511383,
        latitude: 31.296564,
        accuracy: 5.729415,
        speed: -1,
        distance: 0,
        heading: 0,
        altitude: 10.146956,
        locType: 1,
        isBackForeground: 1,
        stepType: 0,
      },
    ]
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        points: apiPoints,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const points = await loadFootprintPoints('/api/footprints', signal)

    expect(points).toEqual(apiPoints)
    expect(fetchMock).toHaveBeenCalledWith('/api/footprints', { signal })
  })

  it('rejects failed footprints API responses', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFootprintPoints('/api/footprints', signal)).rejects.toThrow(
      'Failed to load footprint API: 500',
    )
  })

  it('rejects malformed footprints API payloads', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        points: [{ id: 'missing-numeric-fields' }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFootprintPoints('/api/footprints', signal)).rejects.toThrow(
      'Invalid footprint API response',
    )
  })
})
