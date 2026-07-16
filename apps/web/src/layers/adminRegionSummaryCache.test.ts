import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TimeRangeSelection } from '../time/timeRange'
import type { AdminRegionSummary } from './adminRegionSummaryDataSource'
import type { AdminRegionDepth } from './adminRegionVectorTileSource'
import {
  clearAdminRegionSummaryCache,
  getCachedAdminRegionSummary,
  prefetchAdminRegionSummaries,
  retryAdminRegionSummary,
} from './adminRegionSummaryCache'

beforeEach(() => {
  clearAdminRegionSummaryCache()
})

function createTimeRange(day: number): TimeRangeSelection {
  const date = `2026-07-${String(day).padStart(2, '0')}`
  return {
    mode: 'day',
    start: date,
    end: date,
    anchorDate: date,
  }
}

function createSummary(depth: AdminRegionDepth, suffix = 'initial'): AdminRegionSummary {
  return {
    depth,
    visitedRegionIds: [`region-${depth}-${suffix}`],
    visitedCount: 1,
    totalCount: depth * 10,
    visitedPath: `M${depth} ${depth}Z`,
    regionMetrics: [],
  }
}

describe('adminRegionSummaryCache', () => {
  it('starts all four depths immediately and deduplicates inflight and completed keys', async () => {
    const resolvers = new Map<AdminRegionDepth, (summary: AdminRegionSummary) => void>()
    const loader = vi.fn(({ depth }: { depth: AdminRegionDepth }) => (
      new Promise<AdminRegionSummary>((resolve) => {
        resolvers.set(depth, resolve)
      })
    ))
    const timeRange = createTimeRange(1)
    const onSettled = vi.fn()

    const firstPrefetch = prefetchAdminRegionSummaries({ timeRange, loader, onSettled })
    const secondPrefetch = prefetchAdminRegionSummaries({ timeRange, loader })

    expect(loader.mock.calls.map(([options]) => options.depth)).toEqual([1, 2, 3, 4])

    for (const depth of [1, 2, 3, 4] as const) {
      resolvers.get(depth)?.(createSummary(depth))
    }
    const [firstResults, secondResults] = await Promise.all([firstPrefetch, secondPrefetch])

    expect(firstResults.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(secondResults.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(onSettled.mock.calls.map(([depth]) => depth)).toEqual([1, 2, 3, 4])
    expect(onSettled.mock.calls.every(([, result]) => result.status === 'fulfilled')).toBe(true)
    expect(getCachedAdminRegionSummary(timeRange, 3)).toEqual(createSummary(3))

    await prefetchAdminRegionSummaries({ timeRange, loader })
    expect(loader).toHaveBeenCalledTimes(4)
  })

  it('does not cache failed or aborted depths and retries only missing keys', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const attempts = new Map<AdminRegionDepth, number>()
    const loader = vi.fn(async ({ depth }: { depth: AdminRegionDepth }) => {
      attempts.set(depth, (attempts.get(depth) ?? 0) + 1)
      if (depth === 2 && attempts.get(depth) === 1) throw new Error('summary unavailable')
      if (depth === 4 && attempts.get(depth) === 1) throw abortError
      return createSummary(depth)
    })
    const timeRange = createTimeRange(2)

    const firstResults = await prefetchAdminRegionSummaries({ timeRange, loader })

    expect(firstResults[1]).toMatchObject({ status: 'rejected' })
    expect(firstResults[3]).toEqual({ status: 'rejected', reason: abortError })
    expect(getCachedAdminRegionSummary(timeRange, 1)).toEqual(createSummary(1))
    expect(getCachedAdminRegionSummary(timeRange, 2)).toBeNull()
    expect(getCachedAdminRegionSummary(timeRange, 4)).toBeNull()

    await prefetchAdminRegionSummaries({ timeRange, loader })

    expect(attempts).toEqual(new Map([
      [1, 1],
      [2, 2],
      [3, 1],
      [4, 2],
    ]))
    expect(getCachedAdminRegionSummary(timeRange, 2)).toEqual(createSummary(2))
    expect(getCachedAdminRegionSummary(timeRange, 4)).toEqual(createSummary(4))
  })

  it('aborts every inflight loader when the cache is cleared', async () => {
    const signals: AbortSignal[] = []
    const rejectors: Array<(reason: unknown) => void> = []
    const loader = vi.fn(({ signal }: { signal: AbortSignal }) => (
      new Promise<AdminRegionSummary>((_resolve, reject) => {
        signals.push(signal)
        rejectors.push(reject)
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        }, { once: true })
      })
    ))

    const pending = prefetchAdminRegionSummaries({
      timeRange: createTimeRange(2),
      loader,
    })
    expect(signals).toHaveLength(4)

    clearAdminRegionSummaryCache()
    const everySignalWasAborted = signals.every((signal) => signal.aborted)
    rejectors.forEach((reject) => {
      reject(new DOMException('Test cleanup', 'AbortError'))
    })
    await pending

    expect(everySignalWasAborted).toBe(true)
  })

  it('replaces one completed depth on retry and drops stale data when retry fails', async () => {
    const timeRange = createTimeRange(3)
    const loader = vi.fn(async ({ depth }: { depth: AdminRegionDepth }) => (
      createSummary(depth, 'initial')
    ))
    await prefetchAdminRegionSummaries({ timeRange, loader })
    loader.mockImplementationOnce(async ({ depth }: { depth: AdminRegionDepth }) => (
      createSummary(depth, 'retried')
    ))

    await expect(retryAdminRegionSummary({
      timeRange,
      depth: 2,
      loader,
    })).resolves.toEqual(createSummary(2, 'retried'))
    expect(getCachedAdminRegionSummary(timeRange, 2)).toEqual(createSummary(2, 'retried'))

    loader.mockRejectedValueOnce(new Error('retry failed'))
    await expect(retryAdminRegionSummary({
      timeRange,
      depth: 2,
      loader,
    })).rejects.toThrow('retry failed')
    expect(getCachedAdminRegionSummary(timeRange, 2)).toBeNull()
  })

  it('keeps completed summaries for only the eight most recent time ranges', async () => {
    const loader = vi.fn(async ({ depth }: { depth: AdminRegionDepth }) => createSummary(depth))
    const ranges = Array.from({ length: 9 }, (_, index) => createTimeRange(index + 1))

    for (const timeRange of ranges) {
      await prefetchAdminRegionSummaries({ timeRange, loader })
    }

    expect(getCachedAdminRegionSummary(ranges[0], 1)).toBeNull()
    expect(getCachedAdminRegionSummary(ranges[1], 1)).toEqual(createSummary(1))
    expect(getCachedAdminRegionSummary(ranges[8], 4)).toEqual(createSummary(4))
    expect(loader).toHaveBeenCalledTimes(36)
  })
})
