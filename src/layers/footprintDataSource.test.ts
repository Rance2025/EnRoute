import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadFootprintSnapshot } from './footprintDataSource'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadFootprintSnapshot', () => {
  it('posts viewport sampling input to the local footprints snapshot API', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        points: [],
        metrics: {
          selectedCount: 0,
          totalDistanceMeters: 0,
          averageDistanceMetersPerDay: 0,
        },
        selectedBounds: null,
        debug: {
          rawCount: 0,
          renderedCount: 0,
          renderRatio: 0,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFootprintSnapshot(undefined, {
      timeRange: {
        startTimestampSeconds: 1,
        endTimestampSeconds: 2,
        dayCount: 1,
      },
      zoom: 10,
      cellSizePx: 0.5,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      viewportNorthWestWorldPixel: { x: 10, y: 20 },
    }, signal)).resolves.toEqual({
      points: [],
      metrics: {
        selectedCount: 0,
        totalDistanceMeters: 0,
        averageDistanceMetersPerDay: 0,
      },
      selectedBounds: null,
      debug: {
        rawCount: 0,
        renderedCount: 0,
        renderRatio: 0,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/footprints/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeRange: {
          startTimestampSeconds: 1,
          endTimestampSeconds: 2,
          dayCount: 1,
        },
        zoom: 10,
        cellSizePx: 0.5,
        viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
        viewportNorthWestWorldPixel: { x: 10, y: 20 },
      }),
      signal,
    })
  })

  it('serializes open-ended time ranges as a finite API bound instead of JSON null', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        points: [],
        metrics: {
          selectedCount: 0,
          totalDistanceMeters: 0,
          averageDistanceMetersPerDay: 0,
        },
        selectedBounds: null,
        debug: {
          rawCount: 0,
          renderedCount: 0,
          renderRatio: 0,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await loadFootprintSnapshot(undefined, {
      timeRange: {
        startTimestampSeconds: 1,
        endTimestampSeconds: Number.POSITIVE_INFINITY,
        dayCount: 1,
      },
      zoom: 10,
      cellSizePx: 0.5,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      viewportNorthWestWorldPixel: { x: 10, y: 20 },
    }, signal)

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      timeRange: { endTimestampSeconds: number }
    }

    expect(Number.isFinite(requestBody.timeRange.endTimestampSeconds)).toBe(true)
    expect(requestBody.timeRange.endTimestampSeconds).toBe(8_640_000_000_000)
  })

  it('keeps existing /api/footprints configuration compatible with the snapshot route', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        points: [],
        metrics: {
          selectedCount: 0,
          totalDistanceMeters: 0,
          averageDistanceMetersPerDay: 0,
        },
        selectedBounds: null,
        debug: {
          rawCount: 0,
          renderedCount: 0,
          renderRatio: 0,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await loadFootprintSnapshot('/api/footprints', {
      timeRange: {
        startTimestampSeconds: 1,
        endTimestampSeconds: 2,
        dayCount: 1,
      },
      zoom: 10,
      cellSizePx: 0.5,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      viewportNorthWestWorldPixel: { x: 10, y: 20 },
    }, signal)

    expect(fetchMock).toHaveBeenCalledWith('/api/footprints/snapshot', expect.any(Object))
  })

  it('rejects failed footprints API responses', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFootprintSnapshot('/api/footprints/snapshot', {
      timeRange: {
        startTimestampSeconds: 1,
        endTimestampSeconds: 2,
        dayCount: 1,
      },
      zoom: 10,
      cellSizePx: 0.5,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      viewportNorthWestWorldPixel: { x: 10, y: 20 },
    }, signal)).rejects.toThrow(
      'Failed to load footprint API: 500',
    )
  })

  it('rejects malformed footprints API payloads', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        points: [{ id: 'missing-numeric-fields' }],
        metrics: {
          selectedCount: 0,
          totalDistanceMeters: 0,
          averageDistanceMetersPerDay: 0,
        },
        selectedBounds: null,
        debug: {
          rawCount: 0,
          renderedCount: 0,
          renderRatio: 0,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFootprintSnapshot('/api/footprints/snapshot', {
      timeRange: {
        startTimestampSeconds: 1,
        endTimestampSeconds: 2,
        dayCount: 1,
      },
      zoom: 10,
      cellSizePx: 0.5,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      viewportNorthWestWorldPixel: { x: 10, y: 20 },
    }, signal)).rejects.toThrow(
      'Invalid footprint API response',
    )
  })
})
