import { describe, expect, it, vi } from 'vitest'

import type { TimeRangeSelection } from '../time/timeRange'
import { loadAdminRegionSummary } from './adminRegionSummaryDataSource'

function createTimeRange(): TimeRangeSelection {
  return {
    mode: 'custom',
    start: '2026-06-16',
    end: '2026-06-19',
    anchorDate: '2026-06-19',
  }
}

function createPayload() {
  return {
    depth: 3,
    visitedRegionIds: ['310100', '330100'],
    visitedCount: 2,
    totalCount: 2,
    thumbnail: {
      viewBox: '0 0 320 150',
      basePath: 'M0 0L10 0L10 10Z',
      visitedPath: 'M1 1L5 1L5 5Z',
    },
    rankings: [
      {
        rank: 1,
        regionId: '310100',
        name: 'Shanghai',
        footprintCount: 4,
        bounds: {
          west: 120.85,
          south: 30.65,
          east: 122.15,
          north: 31.9,
        },
      },
    ],
  }
}

function createJsonResponse(payload: unknown, status = 200) {
  const response = new Response(null, { status })
  response.json = async () => payload
  return response
}

function createRequest(
  fetcher: typeof fetch,
): Parameters<typeof loadAdminRegionSummary>[0] {
  return {
    depth: 3,
    timeRange: createTimeRange(),
    signal: new AbortController().signal,
    fetcher,
  }
}

describe('loadAdminRegionSummary', () => {
  it('loads the selected depth and time range with the supplied abort signal', async () => {
    const payload = createPayload()
    const fetcher = vi.fn(async () => createJsonResponse(payload))
    const signal = new AbortController().signal

    await expect(loadAdminRegionSummary({
      depth: 3,
      timeRange: createTimeRange(),
      signal,
      fetcher,
    })).resolves.toEqual(payload)

    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin-regions/summary?depth=3&start=2026-06-16&end=2026-06-19',
      { signal },
    )
  })

  it('reports non-successful summary responses', async () => {
    const fetcher = vi.fn(async () => createJsonResponse({}, 503))

    await expect(loadAdminRegionSummary(createRequest(fetcher))).rejects.toThrow(
      'Admin-region summary request failed: 503',
    )
  })

  it('passes AbortError through unchanged', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const fetcher = vi.fn(async () => {
      throw abortError
    })

    await expect(loadAdminRegionSummary(createRequest(fetcher))).rejects.toBe(abortError)
  })

  it.each([
    ['an array at the response root', () => []],
    ['an unsupported depth', () => ({ ...createPayload(), depth: 5 })],
    ['a non-string visited region id', () => ({
      ...createPayload(),
      visitedRegionIds: ['310100', 330100],
    })],
    ['a negative visited count', () => ({ ...createPayload(), visitedCount: -1 })],
    ['a fractional total count', () => ({ ...createPayload(), totalCount: 1.5 })],
    ['an incomplete thumbnail', () => ({
      ...createPayload(),
      thumbnail: { viewBox: '0 0 320 150', basePath: 'M0 0Z' },
    })],
    ['a zero ranking position', () => ({
      ...createPayload(),
      rankings: [{ ...createPayload().rankings[0], rank: 0 }],
    })],
    ['a negative footprint count', () => ({
      ...createPayload(),
      rankings: [{ ...createPayload().rankings[0], footprintCount: -1 }],
    })],
    ['a non-finite ranking bound', () => ({
      ...createPayload(),
      rankings: [{
        ...createPayload().rankings[0],
        bounds: { ...createPayload().rankings[0].bounds, east: Number.POSITIVE_INFINITY },
      }],
    })],
    ['an array instead of ranking bounds', () => ({
      ...createPayload(),
      rankings: [{ ...createPayload().rankings[0], bounds: [120, 30, 122, 32] }],
    })],
  ])('rejects malformed payloads with %s', async (_description, createInvalidPayload) => {
    const fetcher = vi.fn(async () => createJsonResponse(createInvalidPayload()))

    await expect(loadAdminRegionSummary(createRequest(fetcher))).rejects.toThrow(
      'Invalid admin-region summary response',
    )
  })
})
