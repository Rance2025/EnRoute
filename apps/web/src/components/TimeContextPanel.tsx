import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Footprints,
  Globe2,
  MapPinned,
  Plane,
  Route,
  type LucideIcon,
} from 'lucide-react'

import { ledgerAtlasDataset } from '../accounting/ledgerAtlasData'
import { formatCnyFromCents } from '../accounting/money'
import { getPeriodMetrics } from '../accounting/selectors'
import type { AppView } from '../appLayout'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import {
  createCurrentSelection,
  formatTimeRangeDate,
  getCalendarLabel,
  getCurrentRangeActionLabel,
  getPickerPage,
  getTimeRangeDisplay,
  getVisibleMonthDays,
  getVisibleMonthWeekIndex,
  moveDayCalendarPage,
  movePickerPage,
  selectDay,
  selectMonth,
  selectPresetRange,
  selectWeek,
  selectYear,
  updateCustomDateBoundary,
  type CalendarDisplayMode,
  type PickerPage,
  type PickerPageOption,
  type TimeRangeMode,
  type TimeRangeSelection,
} from '../time/timeRange'
import type { FootprintDistanceBucket, FootprintDistanceSeries } from '../layers/footprintTypes'

export type TimeRangeKey = TimeRangeMode
export type TimeContextMetricItem = {
  label: string
  value: string
  tone?: 'income' | 'expense'
}

const DAY_CALENDAR_TRANSITION_MS = 260
const MAP_ALL_TIME_START_DATE = '2026-01-11'

const timeModeOptions: Array<SegmentedOption<TimeRangeMode>> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'custom', label: '自定义' },
]

const customPresetOptions: Array<{ value: 'all' | 'recent365' | 'recent30' | 'recent7'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'recent365', label: '最近一年' },
  { value: 'recent30', label: '最近一月' },
  { value: 'recent7', label: '最近一周' },
]

const calendarModeOptions: Array<SegmentedOption<CalendarDisplayMode>> = [
  { value: 'week', label: '周历' },
  { value: 'month', label: '月历' },
]

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']

type TimeContextPanelProps = {
  view: AppView
  selection: TimeRangeSelection
  secondaryContextLabel?: string
  metricItems?: TimeContextMetricItem[]
  distanceSeries?: FootprintDistanceSeries
  onSelectionChange: (selection: TimeRangeSelection) => void
}

type TimeNavigationDirection = 'previous' | 'next'

type TimeNavigationState = {
  direction: TimeNavigationDirection | null
  sequence: number
}

type CustomDatePickerMode = 'day' | 'month'
type TemporaryPickerMode = 'default' | 'month' | 'year'
type DistanceTrendScale = 'linear' | 'log'
type DistanceTrendGroupingMode = 'daily' | 'grouped'
type DistanceTrendSummaryLabel = string | {
  primary: string
  secondary: string
}

const DISTANCE_TREND_GROUP_TARGET = 120
const DISTANCE_TREND_GROUP_MIN = 100
const DISTANCE_TREND_GROUP_MAX = 160
const DISTANCE_TREND_CUSTOM_GROUP_THRESHOLD = 200

function TimeArrowIcon({ direction }: { direction: -1 | 1 }) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight

  return <Icon size={18} strokeWidth={3} aria-hidden="true" />
}

function useMeasuredStageHeight(isLayoutFrozen: boolean) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageHeight, setStageHeight] = useState<number | null>(null)

  const measureStageHeight = useCallback(() => {
    if (isLayoutFrozen) return

    const stage = stageRef.current
    if (!stage) return

    const nextHeight = Math.ceil(stage.getBoundingClientRect().height)
    if (nextHeight <= 0) return

    setStageHeight((current) => (current === nextHeight ? current : nextHeight))
  }, [isLayoutFrozen])

  useLayoutEffect(() => {
    measureStageHeight()
  })

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(measureStageHeight)
    observer.observe(stage)

    return () => observer.disconnect()
  }, [measureStageHeight])

  return {
    stageRef,
    panelContentStyle: stageHeight === null
      ? undefined
      : ({
          '--time-panel-stage-height': `${stageHeight}px`,
        } as CSSProperties),
  }
}

export function TimeContextPanel({
  metricItems,
  distanceSeries,
  secondaryContextLabel,
  view,
  selection,
  onSelectionChange,
}: TimeContextPanelProps) {
  const [calendarMode, setCalendarMode] = useState<CalendarDisplayMode>('week')
  const [isDayCalendarCollapsingWeek, setIsDayCalendarCollapsingWeek] = useState(false)
  const [isDayCalendarExpandingMonth, setIsDayCalendarExpandingMonth] = useState(false)
  const [isCustomDatePickerOpen, setIsCustomDatePickerOpen] = useState(false)
  const [activeTrendIndex, setActiveTrendIndex] = useState<number | null>(null)
  const [distanceTrendScale, setDistanceTrendScale] = useState<DistanceTrendScale>('linear')
  const [distanceTrendGroupingMode, setDistanceTrendGroupingMode] =
    useState<DistanceTrendGroupingMode>('grouped')
  const [dayCalendarCollapseSequence, setDayCalendarCollapseSequence] = useState(0)
  const [dayCalendarExpandSequence, setDayCalendarExpandSequence] = useState(0)
  const [navigationState, setNavigationState] = useState<TimeNavigationState>({
    direction: null,
    sequence: 0,
  })
  const heading = getTimeRangeDisplay(selection)
  const resetLabel = getCurrentRangeActionLabel(selection.mode)
  const timeActionLabel = resetLabel
  const summaryItems = metricItems ?? (view === 'accounting'
    ? getAccountingSummary(selection)
    : [])
  const compatibleDistanceSeries = getCompatibleDistanceSeriesForSelection(distanceSeries, selection)
  const hasStaleDistanceSeries = Boolean(distanceSeries && !compatibleDistanceSeries)
  const distanceTrend = getDistanceTrendModel(
    compatibleDistanceSeries,
    distanceTrendScale,
    selection.mode,
    distanceTrendGroupingMode,
  )
  const activeTrendBucket = activeTrendIndex === null
    ? null
    : distanceTrend.values[activeTrendIndex] ?? null
  const shouldRenderDistanceTrend = view === 'map'
  const isEditorOverlayOpen = shouldRenderDistanceTrend && ((
    selection.mode === 'day' &&
    (calendarMode === 'month' || isDayCalendarCollapsingWeek)
  ) || (
    selection.mode === 'custom' &&
    isCustomDatePickerOpen
  ))
  const isDistanceTrendHidden = isEditorOverlayOpen || hasStaleDistanceSeries
  const { stageRef, panelContentStyle } = useMeasuredStageHeight(isEditorOverlayOpen)
  useEffect(() => {
    if (!isDayCalendarCollapsingWeek) return undefined

    const timer = window.setTimeout(() => {
      setIsDayCalendarCollapsingWeek(false)
    }, DAY_CALENDAR_TRANSITION_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [dayCalendarCollapseSequence, isDayCalendarCollapsingWeek])

  useEffect(() => {
    if (!isDayCalendarExpandingMonth) return undefined

    const timer = window.setTimeout(() => {
      setIsDayCalendarExpandingMonth(false)
    }, DAY_CALENDAR_TRANSITION_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [dayCalendarExpandSequence, isDayCalendarExpandingMonth])

  function handleSelectionChange(
    nextSelection: TimeRangeSelection,
  ) {
    if (timeSelectionsAreEqual(selection, nextSelection)) return

    setNavigationState((current) => (
      current.direction === null ? current : { ...current, direction: null }
    ))
    onSelectionChange(nextSelection)
  }

  function handleTimeActionClick() {
    handleSelectionChange(createCurrentSelectionForView(selection.mode, view))
  }

  function handleCalendarModeChange(mode: CalendarDisplayMode) {
    if (mode === calendarMode) return

    if (calendarMode === 'month' && mode === 'week') {
      setIsDayCalendarCollapsingWeek(true)
      setIsDayCalendarExpandingMonth(false)
      setDayCalendarCollapseSequence((current) => current + 1)
      setCalendarMode(mode)
      return
    }

    if (calendarMode === 'week' && mode === 'month') {
      setIsDayCalendarCollapsingWeek(false)
      setIsDayCalendarExpandingMonth(true)
      setDayCalendarExpandSequence((current) => current + 1)
      setCalendarMode(mode)
      return
    }

    setIsDayCalendarCollapsingWeek(false)
    setIsDayCalendarExpandingMonth(false)
    setCalendarMode(mode)
  }

  const handleCustomDatePickerOpenChange = useCallback((isOpen: boolean) => {
    setIsCustomDatePickerOpen(isOpen)
  }, [])

  function handleTrendPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const bucketCount = distanceTrend.values.length
    if (bucketCount === 0) return

    const chartBounds = event.currentTarget.getBoundingClientRect()
    if (chartBounds.width <= 0) return

    const relativeX = Math.min(
      Math.max(event.clientX - chartBounds.left, 0),
      chartBounds.width - 0.01,
    )
    const nextIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((relativeX / chartBounds.width) * bucketCount)),
    )

    setActiveTrendIndex((current) => (current === nextIndex ? current : nextIndex))
  }

  function handleTrendGroupingToggle() {
    setActiveTrendIndex(null)
    setDistanceTrendGroupingMode((current) => (
      current === 'grouped' ? 'daily' : 'grouped'
    ))
  }

  function handlePeriodNavigate(
    direction: TimeNavigationDirection,
    nextSelection: TimeRangeSelection,
  ) {
    setNavigationState((current) => ({
      direction,
      sequence: current.sequence + 1,
    }))
    onSelectionChange(nextSelection)
  }

  function handleModeChange(range: TimeRangeMode) {
    if (range === selection.mode) return

    setIsDayCalendarCollapsingWeek(false)
    setIsDayCalendarExpandingMonth(false)
    setIsCustomDatePickerOpen(false)
    setActiveTrendIndex(null)
    handleSelectionChange(createCurrentSelectionForView(range, view))
  }

  return (
    <aside
      className="glass-panel glass-panel--solid glass-panel--large time-context-panel"
      aria-label="时间范围面板"
    >
      <div className="time-context-panel__scroll">
        <header className="time-context-card" aria-label="时间概览">
          <div className="time-context-card__top">
            <div className="time-context-card__headline">
              <span>{secondaryContextLabel ? `${secondaryContextLabel}时间范围` : '全局时间范围'}</span>
              <h2>{heading.title}</h2>
              <p>{heading.detail}</p>
            </div>
            <button
              type="button"
              className="time-context-card__today"
              aria-label={timeActionLabel}
              aria-controls="time-range-editor"
              aria-expanded="true"
              onClick={handleTimeActionClick}
            >
              {timeActionLabel}
            </button>
          </div>

          {summaryItems.length > 0 ? (
            <section
              className={[
                'time-context-metric-strip',
                view === 'map' ? 'time-context-metric-strip--map' : null,
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label="全局范围指标"
            >
              {summaryItems.map((item) => {
                const Icon = getMetricIcon(item.label)
                const metricValue = splitMetricValue(item.value)

                return (
                <div key={item.label}>
                  <span className="time-context-metric-strip__label">
                    <Icon size={13} strokeWidth={2.05} aria-hidden="true" />
                    <span>{item.label}</span>
                  </span>
                  <strong className={item.tone ? `is-${item.tone}` : undefined}>
                    <span className="time-context-metric-strip__number">
                      {metricValue.number}
                    </span>
                    {metricValue.unit ? (
                      <>
                        {' '}
                        <span className="time-context-metric-strip__unit">
                          {metricValue.unit}
                        </span>
                      </>
                    ) : null}
                  </strong>
                </div>
                )
              })}
            </section>
          ) : null}

          <SegmentedControl
            ariaLabel="时间模式"
            className="time-mode-tabs"
            options={timeModeOptions}
            value={selection.mode}
            onChange={handleModeChange}
          />

        </header>

        <div
          id="time-range-editor"
          className="time-panel-content"
          role="region"
          aria-label="时间编辑器"
          style={panelContentStyle}
          data-time-panel-overlay={isEditorOverlayOpen ? 'true' : undefined}
        >
          <div
            ref={stageRef}
            className="time-panel-content__stage"
            aria-label="时间范围内容"
          >
            {renderModeContent(
              selection,
              calendarMode,
              isDayCalendarCollapsingWeek,
              isDayCalendarExpandingMonth,
              navigationState,
              handleCalendarModeChange,
              handleSelectionChange,
              handleSelectionChange,
              handlePeriodNavigate,
              handleCustomDatePickerOpenChange,
              view,
            )}
          </div>
        </div>

        {shouldRenderDistanceTrend ? (
          <section
            className={[
              'time-context-trend',
              isDistanceTrendHidden ? 'is-hidden' : null,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={distanceTrend.title}
          >
            <div className="time-context-trend__head">
              <div className="time-context-trend__title">
                <span>{distanceTrend.title}</span>
                <button
                  className="time-context-trend__scale-button"
                  type="button"
                  aria-label={`距离图表尺度：${distanceTrend.scaleLabel}，点击切换到${distanceTrend.nextScaleLabel}`}
                  onClick={() => setDistanceTrendScale(distanceTrend.nextScale)}
                >
                  {distanceTrend.scaleLabel}
                </button>
                {distanceTrend.canToggleGrouping ? (
                  <button
                    className="time-context-trend__group-button"
                    type="button"
                    aria-label={distanceTrend.groupingLabel}
                    onClick={handleTrendGroupingToggle}
                  >
                    {distanceTrend.groupingLabel}
                  </button>
                ) : null}
              </div>
              <DistanceTrendSummary summary={activeTrendBucket?.summaryLabel ?? distanceTrend.metadata} />
            </div>
            <div
              className={[
                'time-context-trend__chart',
                distanceTrend.isDense ? 'time-context-trend__chart--dense' : null,
              ]
                .filter(Boolean)
                .join(' ')}
              role="img"
              aria-label={`${distanceTrend.title}，${distanceTrend.averageLabel}`}
              style={{
                '--trend-average-position': distanceTrend.averagePosition,
                '--trend-column-count': distanceTrend.values.length,
              } as CSSProperties}
              onPointerMove={handleTrendPointerMove}
              onPointerLeave={() => setActiveTrendIndex(null)}
            >
              <div className="time-context-trend__plot">
                <div className="time-context-trend__average-line" />
                <span className="time-context-trend__average-label">
                  {distanceTrend.averageLabel}
                </span>
                {distanceTrend.values.map((item, index) => (
                  <span
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${item.label}，${item.formattedValue}`}
                    className={[
                      'time-context-trend__column',
                      activeTrendIndex === index ? 'is-active' : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onPointerEnter={() => setActiveTrendIndex(index)}
                    onPointerLeave={() => setActiveTrendIndex((current) => (
                      current === index ? null : current
                    ))}
                    onFocus={() => setActiveTrendIndex(index)}
                    onBlur={() => setActiveTrendIndex((current) => (
                      current === index ? null : current
                    ))}
                  >
                    <span
                      className={[
                        'time-context-trend__bar',
                        activeTrendIndex === index ? 'is-active' : null,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ '--trend-height': item.height } as CSSProperties}
                    />
                  </span>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  )
}

function getMetricIcon(label: string): LucideIcon {
  if (label.includes('国家') || label.includes('地区')) return Globe2
  if (label.includes('飞行')) return Plane
  if (label.includes('天')) return CalendarDays
  if (label.includes('距离') || label.includes('里程')) return Route
  if (label.includes('足迹')) return Footprints

  return MapPinned
}

function splitMetricValue(value: string) {
  const trimmedValue = value.trim()
  const match = trimmedValue.match(/^([+-]?(?:\d|[,，.])+)(?:\s+(.+))?$/)

  if (!match) return { number: trimmedValue, unit: '' }

  return {
    number: match[1] ?? trimmedValue,
    unit: match[2] ?? '',
  }
}

function DistanceTrendSummary({ summary }: { summary: DistanceTrendSummaryLabel }) {
  if (typeof summary === 'string') {
    return (
      <small className="time-context-trend__summary">
        <span className="time-context-trend__summary-line">{summary}</span>
      </small>
    )
  }

  return (
    <small
      className="time-context-trend__summary"
      aria-label={`${summary.primary} · ${summary.secondary}`}
    >
      <span className="time-context-trend__summary-line">{summary.primary}</span>
      <span className="time-context-trend__summary-line time-context-trend__summary-line--secondary">
        {summary.secondary}
      </span>
    </small>
  )
}

function getCompatibleDistanceSeriesForSelection(
  distanceSeries: FootprintDistanceSeries | undefined,
  selection: TimeRangeSelection,
) {
  if (!distanceSeries) return undefined
  if (distanceSeries.buckets.length === 0) return distanceSeries

  const firstBucket = distanceSeries.buckets[0]
  const lastBucket = distanceSeries.buckets[distanceSeries.buckets.length - 1]
  if (!firstBucket || !lastBucket) return distanceSeries

  const firstDate = getDistanceBucketDateKey(firstBucket.key)
  const lastDate = getDistanceBucketDateKey(lastBucket.key)

  if (distanceSeries.granularity === 'hour') {
    if (selection.mode !== 'day') return undefined

    return firstDate === selection.start && lastDate === selection.end
      ? distanceSeries
      : undefined
  }

  if (selection.mode === 'day') return undefined
  if (firstDate < selection.start || lastDate > selection.end) return undefined

  return distanceSeries
}

function getDistanceBucketDateKey(bucketKey: string) {
  return bucketKey.slice(0, 10)
}

function getDistanceTrendModel(
  distanceSeries?: FootprintDistanceSeries,
  scale: DistanceTrendScale = 'linear',
  selectionMode: TimeRangeMode = 'custom',
  groupingMode: DistanceTrendGroupingMode = 'grouped',
) {
  const sourceBuckets = distanceSeries?.buckets ?? []
  const grouping = getDistanceTrendGrouping(
    sourceBuckets,
    distanceSeries?.granularity,
    selectionMode,
    groupingMode,
  )
  const rawValues = grouping.buckets.map((bucket) => Math.max(bucket.distanceMeters, 0))
  const maxValue = Math.max(...rawValues, 1)
  const maxScaledValue = getDistanceTrendScaledValue(maxValue, scale)
  const average = getDistanceTrendAverage(sourceBuckets, distanceSeries?.granularity)
  const averageValue = average.value
  const averagePosition = getDistanceTrendPosition(averageValue, maxScaledValue, scale)
  const denominatorLabel = distanceSeries?.unit === 'hour' ? '小时' : '日'
  const aggregationLabel = grouping.isGrouped
    ? `按${grouping.groupSize}日归并`
    : distanceSeries?.granularity === 'hour' ? '按小时汇总' : '按日汇总'
  const nextScale: DistanceTrendScale = scale === 'linear' ? 'log' : 'linear'

  return {
    title: '当前范围距离',
    metadata: `${aggregationLabel} · ${average.rangeLabel}`,
    averageLabel: `均值 ${formatDistanceTrendValue(averageValue)}/${denominatorLabel}`,
    averagePosition,
    scale,
    nextScale,
    scaleLabel: scale === 'linear' ? '线性' : '对数',
    nextScaleLabel: nextScale === 'linear' ? '线性' : '对数',
    canToggleGrouping: grouping.canToggle,
    groupingLabel: groupingMode === 'grouped' ? '归并' : '逐日',
    isDense: grouping.buckets.length > 90,
    values: grouping.buckets.map((bucket, index) => (
      createDistanceTrendValue(bucket, index, maxScaledValue, scale)
    )),
  }
}

type DistanceTrendDisplayBucket = FootprintDistanceBucket & {
  summaryLabel?: DistanceTrendSummaryLabel
}

function getDistanceTrendGrouping(
  buckets: FootprintDistanceBucket[],
  granularity: FootprintDistanceSeries['granularity'] | undefined,
  selectionMode: TimeRangeMode,
  groupingMode: DistanceTrendGroupingMode,
) {
  const canToggle = granularity === 'day' && (
    selectionMode === 'year' ||
    (selectionMode === 'custom' && buckets.length > DISTANCE_TREND_CUSTOM_GROUP_THRESHOLD)
  )
  const groupSize = canToggle && groupingMode === 'grouped'
    ? getDistanceTrendGroupSize(buckets.length)
    : 1
  const isGrouped = groupSize > 1

  return {
    canToggle,
    groupSize,
    isGrouped,
    buckets: isGrouped
      ? createGroupedDistanceTrendBuckets(buckets, groupSize)
      : buckets.map((bucket) => ({ ...bucket })),
  }
}

function getDistanceTrendGroupSize(bucketCount: number) {
  if (bucketCount <= DISTANCE_TREND_CUSTOM_GROUP_THRESHOLD) return 1

  let bestGroupSize = 1
  let bestColumnCount = bucketCount
  let bestScore = Number.POSITIVE_INFINITY
  const maxGroupSize = Math.ceil(bucketCount / DISTANCE_TREND_GROUP_MIN)

  for (let groupSize = 2; groupSize <= maxGroupSize; groupSize += 1) {
    const columnCount = Math.ceil(bucketCount / groupSize)
    if (
      columnCount < DISTANCE_TREND_GROUP_MIN ||
      columnCount > DISTANCE_TREND_GROUP_MAX
    ) {
      continue
    }

    const score = columnCount < DISTANCE_TREND_GROUP_TARGET
      ? (DISTANCE_TREND_GROUP_TARGET - columnCount) * 1.6
      : columnCount - DISTANCE_TREND_GROUP_TARGET

    if (
      score < bestScore ||
      (score === bestScore && columnCount > bestColumnCount)
    ) {
      bestGroupSize = groupSize
      bestColumnCount = columnCount
      bestScore = score
    }
  }

  if (bestGroupSize > 1) return bestGroupSize

  return Math.max(2, Math.round(bucketCount / DISTANCE_TREND_GROUP_TARGET))
}

function createGroupedDistanceTrendBuckets(
  buckets: FootprintDistanceBucket[],
  groupSize: number,
): DistanceTrendDisplayBucket[] {
  const groupedBuckets: DistanceTrendDisplayBucket[] = []

  for (let index = 0; index < buckets.length; index += groupSize) {
    const group = buckets.slice(index, index + groupSize)
    const first = group[0]
    const last = group[group.length - 1]
    if (!first || !last) continue

    const totalDistanceMeters = group.reduce(
      (total, bucket) => total + Math.max(bucket.distanceMeters, 0),
      0,
    )
    const averageDistanceMeters = totalDistanceMeters / group.length
    const label = formatDistanceTrendRangeLabel(first, last)

    groupedBuckets.push({
      key: `${first.key}..${last.key}`,
      label,
      distanceMeters: averageDistanceMeters,
      summaryLabel: {
        primary: label,
        secondary: `日均 ${formatDistanceTrendValue(averageDistanceMeters)}`,
      },
    })
  }

  return groupedBuckets
}

function getDistanceTrendAverage(
  buckets: FootprintDistanceBucket[],
  granularity?: FootprintDistanceSeries['granularity'],
) {
  if (buckets.length === 0) {
    return {
      value: 0,
      rangeLabel: granularity === 'hour' ? '0小时' : '0天',
    }
  }

  if (granularity === 'hour') return getHourlyDistanceTrendAverage(buckets)

  const now = new Date()
  const todayKey = formatLocalDateKey(now)
  const elapsedBuckets = buckets.filter((bucket) => {
    const dayKey = bucket.key.slice(0, 10)

    return dayKey <= todayKey
  })

  if (elapsedBuckets.length === 0) {
    return {
      value: 0,
      rangeLabel: '0天',
    }
  }

  return {
    value: (
      elapsedBuckets.reduce((total, bucket) => total + Math.max(bucket.distanceMeters, 0), 0) /
      elapsedBuckets.length
    ),
    rangeLabel: `${elapsedBuckets.length}天`,
  }
}

function getHourlyDistanceTrendAverage(buckets: FootprintDistanceBucket[]) {
  const now = new Date()
  const todayKey = formatLocalDateKey(now)
  const bucketDateKey = buckets[0]?.key.slice(0, 10) ?? ''

  if (bucketDateKey > todayKey) {
    return {
      value: 0,
      rangeLabel: '0.0小时',
    }
  }

  if (bucketDateKey < todayKey) {
    return {
      value: (
        buckets.reduce((total, bucket) => total + Math.max(bucket.distanceMeters, 0), 0) /
        buckets.length
      ),
      rangeLabel: `${buckets.length}小时`,
    }
  }

  const selectedDayStart = new Date(`${bucketDateKey}T00:00:00`)
  const elapsedHours = Math.min(
    Math.max((now.getTime() - selectedDayStart.getTime()) / (60 * 60 * 1000), 0),
    24,
  )
  const elapsedDistanceMeters = buckets.reduce((total, bucket) => {
    const bucketHourStart = new Date(`${bucket.key.slice(0, 13)}:00:00`)

    if (bucketHourStart >= now) return total

    return total + Math.max(bucket.distanceMeters, 0)
  }, 0)

  return {
    value: elapsedHours === 0 ? 0 : elapsedDistanceMeters / elapsedHours,
    rangeLabel: `${elapsedHours.toFixed(1)}小时`,
  }
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getDistanceTrendScaledValue(value: number, scale: DistanceTrendScale) {
  const safeValue = Math.max(value, 0)

  if (!Number.isFinite(safeValue) || safeValue <= 0) return 0
  if (scale === 'log') return Math.log1p(safeValue / 1000)

  return safeValue
}

function getDistanceTrendPosition(
  value: number,
  maxScaledValue: number,
  scale: DistanceTrendScale,
) {
  if (!Number.isFinite(maxScaledValue) || maxScaledValue <= 0) return '0%'

  const scaledValue = getDistanceTrendScaledValue(value, scale)

  return `${Math.min(Math.max((scaledValue / maxScaledValue) * 100, 0), 100)}%`
}

function createDistanceTrendValue(
  bucket: DistanceTrendDisplayBucket,
  index: number,
  maxScaledValue: number,
  scale: DistanceTrendScale,
) {
  const distanceMeters = Math.max(bucket.distanceMeters, 0)
  const formattedValue = formatDistanceTrendValue(distanceMeters)

  return {
    key: bucket.key || `${bucket.label}-${index}`,
    label: bucket.label,
    formattedValue,
    summaryLabel: bucket.summaryLabel ?? `${bucket.label} · ${formattedValue}`,
    height: getDistanceTrendPosition(distanceMeters, maxScaledValue, scale),
  }
}

function formatDistanceTrendRangeLabel(
  first: FootprintDistanceBucket,
  last: FootprintDistanceBucket,
) {
  const startLabel = formatDistanceTrendDateLabel(first.key, first.label)
  const endLabel = formatDistanceTrendDateLabel(last.key, last.label)

  return startLabel === endLabel ? startLabel : `${startLabel}-${endLabel}`
}

function formatDistanceTrendDateLabel(key: string, fallback: string) {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return fallback

  return `${Number(match[2])}月${Number(match[3])}日`
}

function formatDistanceTrendValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 m'

  if (value < 1000) {
    return `${new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: 0,
    }).format(value)} m`
  }

  return `${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value >= 10_000 ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value / 1000)} km`
}

function getAccountingSummary(selection: TimeRangeSelection): TimeContextMetricItem[] {
  const metrics = getPeriodMetrics(ledgerAtlasDataset, selection)

  return [
    {
      label: '收入',
      value: formatAccountingCurrency(metrics.incomeInCents),
      tone: 'income',
    },
    {
      label: '支出',
      value: formatAccountingCurrency(metrics.expenseInCents),
      tone: 'expense',
    },
    { label: '流水', value: `${metrics.transactionCount} 笔` },
  ]
}

function formatAccountingCurrency(amountInCents: number) {
  const prefix = amountInCents < 0 ? '-¥' : '¥'

  return `${prefix}${formatCnyFromCents(Math.abs(amountInCents))}`
}

function timeSelectionsAreEqual(
  currentSelection: TimeRangeSelection,
  nextSelection: TimeRangeSelection,
) {
  return (
    currentSelection.mode === nextSelection.mode &&
    currentSelection.start === nextSelection.start &&
    currentSelection.end === nextSelection.end &&
    currentSelection.anchorDate === nextSelection.anchorDate &&
    currentSelection.label === nextSelection.label
  )
}

function createSelectionFromPickerOption(
  mode: PickerPage['mode'],
  option: PickerPageOption,
): TimeRangeSelection {
  if (mode === 'day') return selectDay(option.start)
  if (mode === 'week') return selectWeek(option.anchorDate ?? option.start)
  if (mode === 'month') {
    const date = new Date(`${option.start}T00:00:00`)
    return selectMonth(date.getFullYear(), date.getMonth() + 1)
  }

  return selectYear(new Date(`${option.start}T00:00:00`).getFullYear())
}

function createCurrentSelectionForView(
  mode: TimeRangeMode,
  view: AppView,
): TimeRangeSelection {
  if (mode === 'custom') return selectPresetRangeForView('all', view)

  return createCurrentSelection(mode)
}

function selectPresetRangeForView(
  preset: 'all' | 'recent365' | 'recent30' | 'recent7',
  view: AppView,
) {
  const selection = selectPresetRange(preset)

  if (preset !== 'all' || view !== 'map') return selection

  return {
    ...selection,
    start: MAP_ALL_TIME_START_DATE,
  }
}

function renderModeContent(
  selection: TimeRangeSelection,
  calendarMode: CalendarDisplayMode,
  isDayCalendarCollapsingWeek: boolean,
  isDayCalendarExpandingMonth: boolean,
  navigationState: TimeNavigationState,
  onCalendarModeChange: (mode: CalendarDisplayMode) => void,
  onSelectionEdit: (selection: TimeRangeSelection) => void,
  onSelectionChange: (selection: TimeRangeSelection) => void,
  onPeriodNavigate: (
    direction: TimeNavigationDirection,
    selection: TimeRangeSelection,
  ) => void,
  onCustomDatePickerOpenChange: (isOpen: boolean) => void,
  view: AppView,
) {
  if (selection.mode === 'day') {
    return (
      <DayCalendarSection
        selection={selection}
        calendarMode={calendarMode}
        isCollapsingWeek={isDayCalendarCollapsingWeek}
        isExpandingMonth={isDayCalendarExpandingMonth}
        navigationState={navigationState}
        onCalendarModeChange={onCalendarModeChange}
        onSelectionChange={onSelectionChange}
        onPeriodNavigate={onPeriodNavigate}
      />
    )
  }

  if (
    selection.mode === 'week' ||
    selection.mode === 'month' ||
    selection.mode === 'year'
  ) {
    const page = getPickerPage(selection)

    return (
      <TimePickerPage
        page={page}
        selection={selection}
        navigationState={navigationState}
        onMove={(direction) =>
          onPeriodNavigate(
            direction === -1 ? 'previous' : 'next',
            movePickerPage(selection, direction),
          )
        }
        onSelect={(option) =>
          onSelectionChange(createSelectionFromPickerOption(page.mode, option))
        }
      />
    )
  }

  return (
    <CustomRangeSection
      view={view}
      selection={selection}
      onSelectionEdit={onSelectionEdit}
      onSelectionChange={onSelectionChange}
      onPickerOpenChange={onCustomDatePickerOpenChange}
    />
  )
}

function CustomRangeSection({
  view,
  selection,
  onSelectionEdit,
  onSelectionChange,
  onPickerOpenChange,
}: {
  view: AppView
  selection: TimeRangeSelection
  onSelectionEdit: (selection: TimeRangeSelection) => void
  onSelectionChange: (selection: TimeRangeSelection) => void
  onPickerOpenChange: (isOpen: boolean) => void
}) {
  const [activeBoundary, setActiveBoundary] = useState<'start' | 'end' | null>(null)
  const [renderedBoundary, setRenderedBoundary] = useState<'start' | 'end' | null>(null)
  const [pickerAnchorDate, setPickerAnchorDate] = useState(selection.anchorDate)

  useEffect(() => {
    return () => {
      onPickerOpenChange(false)
    }
  }, [onPickerOpenChange])

  function openPicker(boundary: 'start' | 'end') {
    const nextBoundary = activeBoundary === boundary
      ? null
      : boundary

    if (nextBoundary === null) {
      setActiveBoundary(null)
      return
    }

    setPickerAnchorDate(selection[nextBoundary])
    setRenderedBoundary(nextBoundary)
    setActiveBoundary(nextBoundary)
    onPickerOpenChange(true)
  }

  function handleBoundaryInput(boundary: 'start' | 'end', value: string) {
    onSelectionEdit(updateCustomDateBoundary(selection, boundary, value))
    if (isDateKey(value)) setPickerAnchorDate(value)
  }

  function handleDatePick(date: string) {
    if (!activeBoundary) return

    onSelectionChange(updateCustomDateBoundary(selection, activeBoundary, date))
    setPickerAnchorDate(date)
    setActiveBoundary(null)
  }

  function handlePickerSlotTransitionEnd(event: ReactTransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || activeBoundary !== null) return

    setRenderedBoundary(null)
    onPickerOpenChange(false)
  }

  const pickerBoundary = activeBoundary ?? renderedBoundary
  const activeValue = pickerBoundary ? selection[pickerBoundary] : selection.end

  return (
    <section className="time-custom-shell" aria-label="自定义时间范围">
      <div className="time-mode-section-head">
        <strong>自定义范围</strong>
      </div>
      <div className="time-custom-presets" aria-label="常用自定义范围">
        {customPresetOptions.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={selection.label === preset.label ? 'is-active' : undefined}
            onClick={() => {
              setActiveBoundary(null)
              setRenderedBoundary(null)
              onPickerOpenChange(false)
              onSelectionChange(selectPresetRangeForView(preset.value, view))
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="time-range-fields" aria-label="自定义日期字段">
        <CustomDateField
          boundary="start"
          label="开始"
          isOpen={activeBoundary === 'start'}
          value={selection.start}
          onInputChange={(value) => handleBoundaryInput('start', value)}
          onOpen={() => openPicker('start')}
        />
        <span className="time-range-separator" aria-hidden="true" />
        <CustomDateField
          boundary="end"
          label="结束"
          isOpen={activeBoundary === 'end'}
          value={selection.end}
          onInputChange={(value) => handleBoundaryInput('end', value)}
          onOpen={() => openPicker('end')}
        />
      </div>
      <div
        className={[
          'time-date-picker-slot',
          activeBoundary ? 'time-date-picker-slot--open' : 'time-date-picker-slot--closed',
        ].join(' ')}
        onTransitionEnd={handlePickerSlotTransitionEnd}
      >
        <div className="time-date-picker-slot__inner">
          {pickerBoundary ? (
            <CustomDatePicker
              anchorDate={pickerAnchorDate}
              boundary={pickerBoundary}
              selectedDate={activeValue}
              onAnchorDateChange={setPickerAnchorDate}
              onSelect={handleDatePick}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}

function CustomDateField({
  boundary,
  label,
  isOpen,
  value,
  onInputChange,
  onOpen,
}: {
  boundary: 'start' | 'end'
  label: string
  isOpen: boolean
  value: string
  onInputChange: (value: string) => void
  onOpen: () => void
}) {
  const ariaLabel = boundary === 'start' ? '开始日期' : '结束日期'

  return (
    <div className="time-date-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        className="sr-only"
        tabIndex={-1}
        type="text"
        value={value}
        onChange={(event) => onInputChange(event.target.value)}
      />
      <button
        type="button"
        className={isOpen ? 'time-date-button is-open' : 'time-date-button'}
        aria-label={`打开${ariaLabel}选择器，当前${formatTimeRangeDate(value)}`}
        aria-expanded={isOpen}
        onClick={onOpen}
      >
        <strong>{formatDateButtonValue(value)}</strong>
      </button>
    </div>
  )
}

function CustomDatePicker({
  anchorDate,
  boundary,
  selectedDate,
  onAnchorDateChange,
  onSelect,
}: {
  anchorDate: string
  boundary: 'start' | 'end'
  selectedDate: string
  onAnchorDateChange: (date: string) => void
  onSelect: (date: string) => void
}) {
  const [pickerMode, setPickerMode] = useState<CustomDatePickerMode>('day')
  const [navigationState, setNavigationState] = useState<TimeNavigationState>({
    direction: null,
    sequence: 0,
  })
  const days = getVisibleMonthDays(anchorDate)
  const [anchorYear] = parseDateKey(anchorDate)
  const dialogLabel = boundary === 'start' ? '开始日期选择' : '结束日期选择'
  const isMonthPicker = pickerMode === 'month'
  const title = isMonthPicker ? `${anchorYear}年` : formatPickerMonth(anchorDate)
  const titleAriaLabel = isMonthPicker
    ? `返回日期选择，当前${title}`
    : `切换到月份选择，当前${title}`

  function clearNavigationDirection() {
    setNavigationState((current) => (
      current.direction === null ? current : { ...current, direction: null }
    ))
  }

  function handleMove(direction: -1 | 1) {
    setNavigationState((current) => ({
      direction: direction === -1 ? 'previous' : 'next',
      sequence: current.sequence + 1,
    }))
    onAnchorDateChange(
      isMonthPicker
        ? moveDateKeyByYears(anchorDate, direction)
        : moveDateKeyByMonths(anchorDate, direction),
    )
  }

  function handleTitleClick() {
    clearNavigationDirection()
    setPickerMode(isMonthPicker ? 'day' : 'month')
  }

  function handleMonthSelect(month: number) {
    onAnchorDateChange(moveDateKeyToMonth(anchorDate, month))
    clearNavigationDirection()
    setPickerMode('day')
  }

  return (
    <div className="time-date-picker" role="dialog" aria-label={dialogLabel}>
      <div className="time-date-picker__bar">
        <button
          type="button"
          aria-label={isMonthPicker ? '上一年' : '上个月'}
          onClick={() => handleMove(-1)}
        >
          <TimeArrowIcon direction={-1} />
        </button>
        <button
          type="button"
          className="time-date-picker__title"
          aria-label={titleAriaLabel}
          onClick={handleTitleClick}
        >
          {title}
        </button>
        <button
          type="button"
          aria-label={isMonthPicker ? '下一年' : '下个月'}
          onClick={() => handleMove(1)}
        >
          <TimeArrowIcon direction={1} />
        </button>
      </div>
      {isMonthPicker ? null : (
        <div className="time-date-picker__weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      <div className="time-date-picker__grid-window">
        <div
          key={navigationState.sequence}
          className={[
            'time-date-picker__grid-motion',
            navigationState.direction
              ? `time-range-grid-motion--${navigationState.direction}`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {isMonthPicker ? (
            <MonthSelectionGrid
              anchorDate={anchorDate}
              className="time-date-picker__grid time-date-picker__grid--months"
              onSelect={handleMonthSelect}
            />
          ) : (
            <div className="time-date-picker__grid" aria-label="日期选择">
              {days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className={[
                    day.date === selectedDate ? 'is-active' : null,
                    day.inCurrentMonth ? null : 'is-outside-month',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelect(day.date)}
                >
                  {day.day}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MonthSelectionGrid({
  anchorDate,
  className,
  onSelect,
}: {
  anchorDate: string
  className: string
  onSelect: (month: number) => void
}) {
  const [, anchorMonth] = parseDateKey(anchorDate)

  return (
    <div className={className} aria-label="月份选择">
      {Array.from({ length: 12 }, (_, index) => {
        const month = index + 1

        return (
          <button
            key={month}
            type="button"
            className={month === anchorMonth ? 'is-active' : undefined}
            onClick={() => onSelect(month)}
          >
            {month}月
          </button>
        )
      })}
    </div>
  )
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function moveDateKeyByMonths(value: string, months: -1 | 1) {
  const [year, month, day] = parseDateKey(value)
  const targetMonthStart = new Date(year, month - 1 + months, 1)
  const targetMonthLastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate()
  const targetDay = Math.min(day, targetMonthLastDay)

  return formatDateKey(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    targetDay,
  )
}

function moveDateKeyByYears(value: string, years: number) {
  const [year, month, day] = parseDateKey(value)
  const targetYear = year + years
  const targetMonthLastDay = new Date(targetYear, month, 0).getDate()

  return formatDateKey(targetYear, month, Math.min(day, targetMonthLastDay))
}

function moveDateKeyToMonth(value: string, month: number) {
  const [year, , day] = parseDateKey(value)
  const targetMonthLastDay = new Date(year, month, 0).getDate()

  return formatDateKey(year, month, Math.min(day, targetMonthLastDay))
}

function moveDateKeyToYear(value: string, year: number) {
  const [, month, day] = parseDateKey(value)
  const targetMonthLastDay = new Date(year, month, 0).getDate()

  return formatDateKey(year, month, Math.min(day, targetMonthLastDay))
}

function formatDateButtonValue(value: string) {
  const [year, month, day] = parseDateKey(value)

  return `${year}/${padDatePart(month)}/${padDatePart(day)}`
}

function formatPickerMonth(value: string) {
  const [year, month] = parseDateKey(value)

  return `${year}年${month}月`
}

function parseDateKey(value: string): [number, number, number] {
  const [year, month, day] = value.split('-').map(Number)

  return [year, month, day]
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function DayCalendarSection({
  selection,
  calendarMode,
  isCollapsingWeek,
  isExpandingMonth,
  navigationState,
  onCalendarModeChange,
  onSelectionChange,
  onPeriodNavigate,
}: {
  selection: TimeRangeSelection
  calendarMode: CalendarDisplayMode
  isCollapsingWeek: boolean
  isExpandingMonth: boolean
  navigationState: TimeNavigationState
  onCalendarModeChange: (mode: CalendarDisplayMode) => void
  onSelectionChange: (selection: TimeRangeSelection) => void
  onPeriodNavigate: (
    direction: TimeNavigationDirection,
    selection: TimeRangeSelection,
  ) => void
}) {
  const [pickerMode, setPickerMode] = useState<CustomDatePickerMode>('day')
  const [monthPickerAnchorDate, setMonthPickerAnchorDate] = useState(selection.anchorDate)
  const [monthNavigationState, setMonthNavigationState] = useState<TimeNavigationState>({
    direction: null,
    sequence: 0,
  })
  const isMonthPicker = pickerMode === 'month'
  const [monthPickerYear] = parseDateKey(monthPickerAnchorDate)
  const title = isMonthPicker
    ? `${monthPickerYear}年`
    : getCalendarLabel(selection, calendarMode)
  const titleAriaLabel = isMonthPicker
    ? `返回日期选择，当前${title}`
    : `切换到月份选择，当前${title}`

  function clearMonthNavigationDirection() {
    setMonthNavigationState((current) => (
      current.direction === null ? current : { ...current, direction: null }
    ))
  }

  function handleMove(direction: -1 | 1) {
    if (isMonthPicker) {
      setMonthNavigationState((current) => ({
        direction: direction === -1 ? 'previous' : 'next',
        sequence: current.sequence + 1,
      }))
      setMonthPickerAnchorDate((current) => moveDateKeyByYears(current, direction))
      return
    }

    onPeriodNavigate(
      direction === -1 ? 'previous' : 'next',
      moveDayCalendarPage(selection, direction, calendarMode),
    )
  }

  function handleTitleClick() {
    if (isMonthPicker) {
      clearMonthNavigationDirection()
      setPickerMode('day')
      return
    }

    setMonthPickerAnchorDate(selection.anchorDate)
    clearMonthNavigationDirection()
    setPickerMode('month')
  }

  function handleMonthSelect(month: number) {
    const nextDate = moveDateKeyToMonth(monthPickerAnchorDate, month)

    clearMonthNavigationDirection()
    setPickerMode('day')
    onSelectionChange(selectDay(nextDate))
  }

  return (
    <section className="time-calendar-shell" aria-label="日历选择">
      <div className="time-calendar-head">
        <strong>{isMonthPicker ? '选择月份' : '按日选择'}</strong>
        {isMonthPicker ? null : (
          <SegmentedControl
            ariaLabel="日历显示方式"
            className="time-calendar-switch"
            options={calendarModeOptions}
            value={calendarMode}
            onChange={(mode) => {
              if (mode !== calendarMode) onCalendarModeChange(mode)
            }}
          />
        )}
      </div>
      <div className="time-calendar-bar">
        <button
          type="button"
          aria-label={isMonthPicker ? '上一年' : '上一段时间'}
          onClick={() => handleMove(-1)}
        >
          <TimeArrowIcon direction={-1} />
        </button>
        <button
          type="button"
          className="time-period-title time-period-title--button"
          aria-label={titleAriaLabel}
          onClick={handleTitleClick}
        >
          {title}
        </button>
        <button
          type="button"
          aria-label={isMonthPicker ? '下一年' : '下一段时间'}
          onClick={() => handleMove(1)}
        >
          <TimeArrowIcon direction={1} />
        </button>
      </div>
      {isMonthPicker ? (
        <div className="time-picker-grid-window">
          <div
            key={monthNavigationState.sequence}
            className={[
              'time-calendar-grid-motion',
              monthNavigationState.direction
                ? `time-range-grid-motion--${monthNavigationState.direction}`
                : null,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <MonthSelectionGrid
              anchorDate={monthPickerAnchorDate}
              className="time-picker-grid time-picker-grid--months"
              onSelect={handleMonthSelect}
            />
          </div>
        </div>
      ) : (
        <div className="time-calendar-body-slot">
          <AnimatedDayCalendar
            calendarMode={calendarMode}
            isCollapsingWeek={isCollapsingWeek}
            isExpandingMonth={isExpandingMonth}
            navigationState={navigationState}
            selection={selection}
            onSelectionChange={onSelectionChange}
          />
        </div>
      )}
    </section>
  )
}

function AnimatedDayCalendar({
  calendarMode,
  isCollapsingWeek,
  isExpandingMonth,
  navigationState,
  selection,
  onSelectionChange,
}: {
  calendarMode: CalendarDisplayMode
  isCollapsingWeek: boolean
  isExpandingMonth: boolean
  navigationState: TimeNavigationState
  selection: TimeRangeSelection
  onSelectionChange: (selection: TimeRangeSelection) => void
}) {
  const days = getVisibleMonthDays(selection.anchorDate)
  const renderedRows = days.length / 7
  const visibleRows = calendarMode === 'week' ? 1 : renderedRows
  const activeWeekIndex = getVisibleMonthWeekIndex(selection.anchorDate)
  const calendarBodyMode = isCollapsingWeek
    ? 'collapsing-week'
    : isExpandingMonth
      ? 'expanding-month'
      : calendarMode

  return (
    <div
      className={`time-calendar-body time-calendar-body--${calendarBodyMode}`}
      style={
        {
          '--time-calendar-visible-rows': visibleRows,
          '--time-calendar-active-week-index': activeWeekIndex,
        } as CSSProperties
      }
    >
      <div className="time-calendar-weekdays">
        {weekdayLabels.map((label) => (
          <span key={label} className="time-calendar-weekday">
            {label}
          </span>
        ))}
      </div>
      <div className="time-calendar-grid-window">
        <div
          key={navigationState.sequence}
          className={[
            'time-calendar-grid-motion',
            navigationState.direction
              ? `time-range-grid-motion--${navigationState.direction}`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="time-calendar-grid" aria-label="日历日期">
            {days.map((day, index) => (
              <button
                type="button"
                key={day.date}
                className={[
                  selection.start === day.date ? 'is-active' : null,
                  day.inCurrentMonth ? null : 'is-outside-month',
                  Math.floor(index / 7) === activeWeekIndex
                    ? 'is-visible-week'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectionChange(selectDay(day.date))}
              >
                {day.day}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function TimePickerPage({
  page,
  selection,
  navigationState,
  onMove,
  onSelect,
}: {
  page: PickerPage
  selection: TimeRangeSelection
  navigationState: TimeNavigationState
  onMove: (direction: -1 | 1) => void
  onSelect: (option: PickerPageOption) => void
}) {
  const [pickerMode, setPickerMode] = useState<TemporaryPickerMode>('default')
  const [temporaryAnchorDate, setTemporaryAnchorDate] = useState(selection.anchorDate)
  const [temporaryNavigationState, setTemporaryNavigationState] = useState<TimeNavigationState>({
    direction: null,
    sequence: 0,
  })
  const supportsTemporaryPickerTitle = page.mode === 'week' || page.mode === 'month'
  const isMonthPicker = page.mode === 'week' && pickerMode === 'month'
  const isYearPicker = page.mode === 'month' && pickerMode === 'year'
  const isTemporaryPicker = isMonthPicker || isYearPicker
  const [temporaryYear] = parseDateKey(temporaryAnchorDate)
  const title = getTemporaryPickerTitle(page, temporaryAnchorDate, isMonthPicker, isYearPicker)
  const titleAriaLabel = getTemporaryPickerTitleAriaLabel(
    page,
    title,
    isMonthPicker,
    isYearPicker,
  )
  const gridClassName = ['time-picker-grid', page.gridClassName].join(' ')
  const optionButtons = page.options.map((option) => (
    <button
      type="button"
      key={option.key}
      className={[
        option.active ? 'is-active' : null,
        option.outsidePage ? 'is-outside-page' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect(option)}
    >
      <span>{option.label}</span>
      {option.detail ? <small>{option.detail}</small> : null}
    </button>
  ))

  function clearTemporaryNavigationDirection() {
    setTemporaryNavigationState((current) => (
      current.direction === null ? current : { ...current, direction: null }
    ))
  }

  function handleMove(direction: -1 | 1) {
    if (isMonthPicker) {
      setTemporaryNavigationState((current) => ({
        direction: direction === -1 ? 'previous' : 'next',
        sequence: current.sequence + 1,
      }))
      setTemporaryAnchorDate((current) => moveDateKeyByYears(current, direction))
      return
    }

    if (isYearPicker) {
      setTemporaryNavigationState((current) => ({
        direction: direction === -1 ? 'previous' : 'next',
        sequence: current.sequence + 1,
      }))
      setTemporaryAnchorDate((current) => moveDateKeyByYears(current, direction * 10))
      return
    }

    onMove(direction)
  }

  function handleTitleClick() {
    if (!supportsTemporaryPickerTitle) return

    if (isTemporaryPicker) {
      clearTemporaryNavigationDirection()
      setPickerMode('default')
      return
    }

    setTemporaryAnchorDate(selection.anchorDate)
    clearTemporaryNavigationDirection()
    setPickerMode(page.mode === 'week' ? 'month' : 'year')
  }

  function handleMonthSelect(month: number) {
    const nextDate = moveDateKeyToMonth(temporaryAnchorDate, month)

    clearTemporaryNavigationDirection()
    setPickerMode('default')
    onSelect({
      key: nextDate,
      label: '',
      start: nextDate,
      end: nextDate,
      anchorDate: nextDate,
      active: false,
    })
  }

  function handleYearSelect(year: number) {
    const nextDate = moveDateKeyToYear(temporaryAnchorDate, year)

    clearTemporaryNavigationDirection()
    setPickerMode('default')
    onSelect({
      key: nextDate,
      label: '',
      start: nextDate,
      end: nextDate,
      anchorDate: nextDate,
      active: false,
    })
  }

  return (
    <section className="time-selector-shell" aria-label="时间选择页">
      <div className="time-mode-section-head">
        <strong>{page.label}</strong>
      </div>
      <div className="time-picker-bar">
        <button
          type="button"
          aria-label={isMonthPicker ? '上一年' : '上一页'}
          onClick={() => handleMove(-1)}
        >
          <TimeArrowIcon direction={-1} />
        </button>
        {supportsTemporaryPickerTitle ? (
          <button
            type="button"
            className="time-period-title time-period-title--button"
            aria-label={titleAriaLabel}
            onClick={handleTitleClick}
          >
            {title}
          </button>
        ) : (
          <span className="time-period-title">{title}</span>
        )}
        <button
          type="button"
          aria-label={isMonthPicker ? '下一年' : '下一页'}
          onClick={() => handleMove(1)}
        >
          <TimeArrowIcon direction={1} />
        </button>
      </div>
      <div className="time-picker-grid-window">
        <div
          key={isTemporaryPicker ? temporaryNavigationState.sequence : navigationState.sequence}
          className={[
            'time-picker-grid-motion',
            (isTemporaryPicker ? temporaryNavigationState.direction : navigationState.direction)
              ? `time-range-grid-motion--${
                  isTemporaryPicker
                    ? temporaryNavigationState.direction
                    : navigationState.direction
                }`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {isMonthPicker ? (
            <MonthSelectionGrid
              anchorDate={temporaryAnchorDate}
              className="time-picker-grid time-picker-grid--months"
              onSelect={handleMonthSelect}
            />
          ) : isYearPicker ? (
            <YearSelectionGrid
              anchorYear={temporaryYear}
              className="time-picker-grid time-picker-grid--years"
              onSelect={handleYearSelect}
            />
          ) : (
            <div className={gridClassName}>{optionButtons}</div>
          )}
        </div>
      </div>
    </section>
  )
}

function getTemporaryPickerTitle(
  page: PickerPage,
  anchorDate: string,
  isMonthPicker: boolean,
  isYearPicker: boolean,
) {
  if (isMonthPicker) {
    const [year] = parseDateKey(anchorDate)
    return `${year}年`
  }

  if (isYearPicker) {
    const [year] = parseDateKey(anchorDate)
    const pageStart = Math.floor(year / 10) * 10
    return `${pageStart} - ${pageStart + 9}`
  }

  return page.title
}

function getTemporaryPickerTitleAriaLabel(
  page: PickerPage,
  title: string,
  isMonthPicker: boolean,
  isYearPicker: boolean,
) {
  if (isMonthPicker) return `返回周选择，当前${title}`
  if (isYearPicker) return `返回月份选择，当前${title}`
  if (page.mode === 'week') return `切换到月份选择，当前${title}`
  if (page.mode === 'month') return `切换到年份选择，当前${title}`

  return title
}

function YearSelectionGrid({
  anchorYear,
  className,
  onSelect,
}: {
  anchorYear: number
  className: string
  onSelect: (year: number) => void
}) {
  const pageStart = Math.floor(anchorYear / 10) * 10

  return (
    <div className={className} aria-label="年份选择">
      {Array.from({ length: 10 }, (_, index) => {
        const year = pageStart + index

        return (
          <button
            key={year}
            type="button"
            className={year === anchorYear ? 'is-active' : undefined}
            onClick={() => onSelect(year)}
          >
            {year}年
          </button>
        )
      })}
    </div>
  )
}
