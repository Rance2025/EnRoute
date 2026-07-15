import type { TimeRangeSelection } from '../time/timeRange'
import {
  loadAdminRegionSummary,
  type AdminRegionSummary,
} from './adminRegionSummaryDataSource'
import type { AdminRegionDepth } from './adminRegionVectorTileSource'

type AdminRegionSummaryLoaderOptions = {
  depth: AdminRegionDepth
  timeRange: TimeRangeSelection
  signal: AbortSignal
}

type AdminRegionSummaryLoader = (
  options: AdminRegionSummaryLoaderOptions,
) => Promise<AdminRegionSummary>

type PrefetchAdminRegionSummariesOptions = {
  timeRange: TimeRangeSelection
  loader?: AdminRegionSummaryLoader
  onSettled?: (
    depth: AdminRegionDepth,
    result: PromiseSettledResult<AdminRegionSummary>,
  ) => void
}

type RetryAdminRegionSummaryOptions = PrefetchAdminRegionSummariesOptions & {
  depth: AdminRegionDepth
}

type InflightAdminRegionSummary = {
  controller: AbortController
  promise: Promise<AdminRegionSummary>
}

const ADMIN_REGION_DEPTHS: readonly AdminRegionDepth[] = [1, 2, 3, 4]
const MAX_COMPLETED_TIME_RANGES = 8

const completed = new Map<string, AdminRegionSummary>()
const inflight = new Map<string, InflightAdminRegionSummary>()
const recentTimeRanges = new Map<string, true>()

export function prefetchAdminRegionSummaries({
  timeRange,
  loader = loadAdminRegionSummary,
  onSettled,
}: PrefetchAdminRegionSummariesOptions): Promise<PromiseSettledResult<AdminRegionSummary>[]> {
  touchTimeRange(timeRange)
  return Promise.allSettled(
    ADMIN_REGION_DEPTHS.map((depth) => (
      loadSummary({ depth, timeRange, loader }).then(
        (summary) => {
          onSettled?.(depth, { status: 'fulfilled', value: summary })
          return summary
        },
        (reason: unknown) => {
          onSettled?.(depth, { status: 'rejected', reason })
          throw reason
        },
      )
    )),
  )
}

export function getCachedAdminRegionSummary(
  timeRange: TimeRangeSelection,
  depth: AdminRegionDepth,
): AdminRegionSummary | null {
  const summary = completed.get(createSummaryKey(timeRange, depth)) ?? null
  if (summary) touchTimeRange(timeRange)
  return summary
}

export function retryAdminRegionSummary({
  timeRange,
  depth,
  loader = loadAdminRegionSummary,
}: RetryAdminRegionSummaryOptions): Promise<AdminRegionSummary> {
  touchTimeRange(timeRange)
  completed.delete(createSummaryKey(timeRange, depth))
  return loadSummary({ depth, timeRange, loader })
}

export function clearAdminRegionSummaryCache(): void {
  for (const summaryKey of [...inflight.keys()]) {
    abortInflightSummary(summaryKey)
  }
  completed.clear()
  recentTimeRanges.clear()
}

export function cancelAdminRegionSummaryRequests(timeRange: TimeRangeSelection): void {
  const summaryKeyPrefix = `${createTimeRangeKey(timeRange)}:`
  for (const summaryKey of [...inflight.keys()]) {
    if (summaryKey.startsWith(summaryKeyPrefix)) {
      abortInflightSummary(summaryKey)
    }
  }
}

function loadSummary({
  depth,
  timeRange,
  loader,
}: {
  depth: AdminRegionDepth
  timeRange: TimeRangeSelection
  loader: AdminRegionSummaryLoader
}): Promise<AdminRegionSummary> {
  const summaryKey = createSummaryKey(timeRange, depth)
  const cachedSummary = completed.get(summaryKey)
  if (cachedSummary) return Promise.resolve(cachedSummary)

  const activeRequest = inflight.get(summaryKey)
  if (activeRequest) return activeRequest.promise

  const rangeKey = createTimeRangeKey(timeRange)
  const controller = new AbortController()
  const request = loader({
    depth,
    timeRange,
    signal: controller.signal,
  }).then((summary) => {
    if (summary.depth !== depth) {
      throw new Error(`Admin-region summary depth mismatch: expected ${depth}, got ${summary.depth}`)
    }
    if (recentTimeRanges.has(rangeKey) && inflight.get(summaryKey)?.promise === request) {
      completed.set(summaryKey, summary)
    }
    return summary
  }).finally(() => {
    if (inflight.get(summaryKey)?.promise === request) {
      inflight.delete(summaryKey)
    }
  })

  inflight.set(summaryKey, { controller, promise: request })
  return request
}

function touchTimeRange(timeRange: TimeRangeSelection): void {
  const rangeKey = createTimeRangeKey(timeRange)
  recentTimeRanges.delete(rangeKey)
  recentTimeRanges.set(rangeKey, true)

  while (recentTimeRanges.size > MAX_COMPLETED_TIME_RANGES) {
    const oldestRangeKey = recentTimeRanges.keys().next().value
    if (typeof oldestRangeKey !== 'string') return

    recentTimeRanges.delete(oldestRangeKey)
    for (const depth of ADMIN_REGION_DEPTHS) {
      const summaryKey = `${oldestRangeKey}:${depth}`
      completed.delete(summaryKey)
      abortInflightSummary(summaryKey)
    }
  }
}

function abortInflightSummary(summaryKey: string): void {
  const activeRequest = inflight.get(summaryKey)
  if (!activeRequest) return

  inflight.delete(summaryKey)
  activeRequest.controller.abort()
}

function createSummaryKey(timeRange: TimeRangeSelection, depth: AdminRegionDepth): string {
  return `${createTimeRangeKey(timeRange)}:${depth}`
}

function createTimeRangeKey(timeRange: TimeRangeSelection): string {
  return `${timeRange.start}:${timeRange.end}`
}
