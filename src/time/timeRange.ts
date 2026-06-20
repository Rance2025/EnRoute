export type TimeRangeMode = 'day' | 'week' | 'month' | 'year' | 'custom'
export type CalendarDisplayMode = 'week' | 'month'
export type TimePresetKey =
  | 'all'
  | 'imported'
  | 'recent365'
  | 'recent30'
  | 'recent7'
  | 'qingdao'
  | 'quarter'

export type TimeRangeSelection = {
  mode: TimeRangeMode
  start: string
  end: string
  anchorDate: string
  label?: string
  isOpenEnded?: boolean
}

export type TimeRangeDisplay = {
  title: string
  detail: string
  accountingLabel: string
}

export type TimeRangeTimestamps = {
  startTimestampSeconds: number
  endTimestampSeconds: number
}

export type DateCell = {
  date: string
  day: number
  inCurrentMonth: boolean
}

export type PickerPageMode = Extract<TimeRangeMode, 'day' | 'week' | 'month' | 'year'>

export type PickerPageOption = {
  key: string
  label: string
  detail?: string
  start: string
  end: string
  active: boolean
  outsidePage?: boolean
}

type PickerPageBase = {
  title: string
  label: string
  gridClassName: string
  options: PickerPageOption[]
}

export type CalendarPickerPage = PickerPageBase & {
  mode: 'day'
  visibleRows: number
  activeWeekIndex: number
}

export type AggregatePickerPage = PickerPageBase & {
  mode: Extract<PickerPageMode, 'week' | 'month' | 'year'>
  visibleRows?: never
  activeWeekIndex?: never
}

export type PickerPage = CalendarPickerPage | AggregatePickerPage

const firstImportedDate = '2022-03-01'

export function createTodayKey(now = new Date()) {
  return formatDateKey(now)
}

export function createTodaySelection(): TimeRangeSelection {
  return selectDay(createTodayKey())
}

export function createCurrentSelection(mode: TimeRangeMode): TimeRangeSelection {
  const today = createTodayKey()
  const currentDate = parseDate(today)

  if (mode === 'day') return selectDay(today)
  if (mode === 'week') return selectWeek(today)
  if (mode === 'month') {
    return selectMonth(currentDate.getFullYear(), currentDate.getMonth() + 1)
  }
  if (mode === 'year') return selectYear(currentDate.getFullYear())

  return selectPresetRange('all')
}

export function getCurrentRangeActionLabel(mode: TimeRangeMode) {
  if (mode === 'day') return '回到今天'
  if (mode === 'week') return '回到本周'
  if (mode === 'month') return '回到本月'
  if (mode === 'year') return '回到今年'

  return '回到全部'
}

export function selectDay(date: string): TimeRangeSelection {
  return {
    mode: 'day',
    start: date,
    end: date,
    anchorDate: date,
  }
}

export function selectWeek(date: string): TimeRangeSelection {
  const weekStart = startOfWeek(parseDate(date))
  const start = formatDateKey(weekStart)
  const end = formatDateKey(addDays(weekStart, 6))

  return {
    mode: 'week',
    start,
    end,
    anchorDate: start,
  }
}

export function selectMonth(year: number, month: number): TimeRangeSelection {
  const start = formatDateKey(new Date(year, month - 1, 1))
  const end = formatDateKey(new Date(year, month, 0))

  return {
    mode: 'month',
    start,
    end,
    anchorDate: start,
  }
}

export function selectYear(year: number): TimeRangeSelection {
  return {
    mode: 'year',
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    anchorDate: `${year}-06-30`,
  }
}

export function selectPresetRange(preset: TimePresetKey): TimeRangeSelection {
  const today = createTodayKey()

  if (preset === 'all') {
    return {
      mode: 'custom',
      start: firstImportedDate,
      end: today,
      anchorDate: today,
      label: '全部',
      isOpenEnded: true,
    }
  }

  if (preset === 'imported') {
    return {
      mode: 'custom',
      start: firstImportedDate,
      end: today,
      anchorDate: today,
      label: '导入数据',
    }
  }

  if (preset === 'recent365') {
    return {
      mode: 'custom',
      start: formatDateKey(addDays(parseDate(today), -364)),
      end: today,
      anchorDate: today,
      label: '最近一年',
    }
  }

  if (preset === 'recent30') {
    return {
      mode: 'custom',
      start: formatDateKey(addDays(parseDate(today), -29)),
      end: today,
      anchorDate: today,
      label: '最近一月',
    }
  }

  if (preset === 'recent7') {
    return {
      mode: 'custom',
      start: formatDateKey(addDays(parseDate(today), -6)),
      end: today,
      anchorDate: today,
      label: '最近一周',
    }
  }

  if (preset === 'qingdao') {
    return {
      mode: 'custom',
      start: '2026-06-15',
      end: '2026-06-19',
      anchorDate: '2026-06-19',
      label: '青岛之行',
    }
  }

  const currentDate = parseDate(today)
  const quarterStartMonth = Math.floor(currentDate.getMonth() / 3) * 3
  const start = formatDateKey(new Date(currentDate.getFullYear(), quarterStartMonth, 1))
  const end = formatDateKey(new Date(currentDate.getFullYear(), quarterStartMonth + 3, 0))

  return {
    mode: 'custom',
    start,
    end,
    anchorDate: today,
    label: '本季度',
  }
}

export function setCustomRangeBoundary(
  selection: TimeRangeSelection,
  boundary: 'start' | 'end',
): TimeRangeSelection {
  const base =
    selection.mode === 'custom' ? selection : selectPresetRange('recent30')
  const next =
    boundary === 'start'
      ? { ...base, start: formatDateKey(addDays(parseDate(base.start), -7)) }
      : { ...base, end: formatDateKey(addDays(parseDate(base.end), 7)) }

  return normalizeCustomSelection(next)
}

export function setCustomDateRange(start: string, end: string): TimeRangeSelection {
  return normalizeCustomSelection({
    mode: 'custom',
    start,
    end,
    anchorDate: end,
    label: '自定义',
  })
}

export function updateCustomDateBoundary(
  selection: TimeRangeSelection,
  boundary: 'start' | 'end',
  value: string,
): TimeRangeSelection {
  const base =
    selection.mode === 'custom' ? selection : selectPresetRange('all')
  if (!isValidDateKey(value)) return base

  return normalizeCustomSelection({
    ...base,
    [boundary]: value,
    label: '自定义',
    isOpenEnded: false,
  })
}

export function createTimeRangeTimestamps(selection: TimeRangeSelection): TimeRangeTimestamps {
  return {
    startTimestampSeconds: dateKeyToShanghaiStartTimestampSeconds(selection.start),
    endTimestampSeconds: selection.isOpenEnded
      ? Number.POSITIVE_INFINITY
      : dateKeyToShanghaiStartTimestampSeconds(selection.end) + 86_399,
  }
}

export function getTimeRangeDisplay(selection: TimeRangeSelection): TimeRangeDisplay {
  const today = createTodayKey()

  if (selection.mode === 'day') {
    const title = selection.start === today ? '今天' : formatShortDate(selection.start)

    return {
      title,
      detail: formatFullDate(selection.start),
      accountingLabel: '日',
    }
  }

  if (selection.mode === 'week') {
    return {
      title: `第${getWeekNumber(selection.start)}周`,
      detail: formatRangeDetail(selection.start, selection.end),
      accountingLabel: '周',
    }
  }

  if (selection.mode === 'month') {
    const date = parseDate(selection.start)

    return {
      title: `${date.getMonth() + 1}月`,
      detail: `${date.getFullYear()}年${date.getMonth() + 1}月`,
      accountingLabel: '月',
    }
  }

  if (selection.mode === 'year') {
    const year = parseDate(selection.start).getFullYear()

    return {
      title: `${year}年`,
      detail: `${year}年`,
      accountingLabel: '年',
    }
  }

  return {
    title: selection.label ?? '自定义',
    detail: selection.label === '全部'
      ? `${formatMonthDot(selection.start)} 至今`
      : formatRangeDetail(selection.start, selection.end),
    accountingLabel: '自定义',
  }
}

export function formatTimeRangeDate(value: string) {
  return formatFullDate(value)
}

export function getPickerPage(selection: TimeRangeSelection): PickerPage {
  if (selection.mode === 'week') return getWeekPickerPage(selection)
  if (selection.mode === 'month') return getMonthPickerPage(selection)
  if (selection.mode === 'year') return getYearPickerPage(selection)

  return getDayPickerPage(selection)
}

export function movePickerPage(
  selection: TimeRangeSelection,
  direction: -1 | 1,
): TimeRangeSelection {
  const anchor = parseDate(selection.anchorDate)

  if (selection.mode === 'week') {
    const nextMonth = addMonths(anchor, direction)
    return selectWeek(formatDateKey(nextMonth))
  }

  if (selection.mode === 'month') {
    return selectMonth(anchor.getFullYear() + direction, anchor.getMonth() + 1)
  }

  if (selection.mode === 'year') {
    return selectYear(parseDate(selection.start).getFullYear() + direction * 10)
  }

  return selectDay(formatDateKey(addMonths(anchor, direction)))
}

export function moveDayCalendarPage(
  selection: TimeRangeSelection,
  direction: -1 | 1,
  calendarMode: CalendarDisplayMode,
): TimeRangeSelection {
  const anchor = parseDate(selection.anchorDate)

  if (calendarMode === 'week') {
    return selectDay(formatDateKey(addDays(anchor, direction * 7)))
  }

  return selectDay(formatDateKey(addMonths(anchor, direction)))
}

export function getCalendarLabel(selection: TimeRangeSelection, calendarMode: CalendarDisplayMode) {
  void calendarMode

  return formatYearMonth(selection.anchorDate)
}

export function getVisibleMonthDays(anchorDate: string): DateCell[] {
  const anchor = parseDate(anchorDate)
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const firstVisibleDay = startOfWeek(new Date(year, month, 1))
  const lastMonthDay = new Date(year, month + 1, 0)
  const lastVisibleDay = addDays(startOfWeek(lastMonthDay), 6)
  const visibleDayCount =
    Math.round((lastVisibleDay.getTime() - firstVisibleDay.getTime()) / 86_400_000) + 1

  return Array.from({ length: visibleDayCount }, (_, index) => {
    const date = addDays(firstVisibleDay, index)

    return {
      date: formatDateKey(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === month,
    }
  })
}

export function getVisibleMonthWeekIndex(anchorDate: string) {
  const anchor = parseDate(anchorDate)
  const firstVisibleDay = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const dayOffset = Math.round((anchor.getTime() - firstVisibleDay.getTime()) / 86_400_000)

  return Math.floor(dayOffset / 7)
}

function getDayPickerPage(selection: TimeRangeSelection): PickerPage {
  const days = getVisibleMonthDays(selection.anchorDate)

  return {
    mode: 'day',
    title: formatYearMonth(selection.anchorDate),
    label: '按日选择',
    gridClassName: 'time-picker-grid--days',
    visibleRows: days.length / 7,
    activeWeekIndex: getVisibleMonthWeekIndex(selection.anchorDate),
    options: days.map((day) => ({
      key: day.date,
      label: String(day.day),
      start: day.date,
      end: day.date,
      active: selection.mode === 'day' && selection.start === day.date,
      outsidePage: day.inCurrentMonth ? false : true,
    })),
  }
}

function getWeekPickerPage(selection: TimeRangeSelection): PickerPage {
  const anchor = parseDate(selection.anchorDate)
  const firstVisibleWeek = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const lastMonthDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const lastVisibleWeek = startOfWeek(lastMonthDay)
  const weekCount =
    Math.round((lastVisibleWeek.getTime() - firstVisibleWeek.getTime()) / (86_400_000 * 7)) +
    1

  return {
    mode: 'week',
    title: formatYearMonth(selection.anchorDate),
    label: '按周聚合',
    gridClassName: 'time-picker-grid--weeks',
    options: Array.from({ length: weekCount }, (_, index) => {
      const start = addDays(firstVisibleWeek, index * 7)
      const startKey = formatDateKey(start)
      const endKey = formatDateKey(addDays(start, 6))

      return {
        key: startKey,
        label: `第${getWeekNumber(startKey)}周`,
        detail: `${formatMonthDay(startKey)} - ${formatMonthDay(endKey)}`,
        start: startKey,
        end: endKey,
        active: selection.mode === 'week' && selection.start === startKey,
      }
    }),
  }
}

function getMonthPickerPage(selection: TimeRangeSelection): PickerPage {
  const anchor = parseDate(selection.anchorDate)
  const year = anchor.getFullYear()

  return {
    mode: 'month',
    title: `${year}年`,
    label: '按月聚合',
    gridClassName: 'time-picker-grid--months',
    options: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const start = formatDateKey(new Date(year, index, 1))
      const end = formatDateKey(new Date(year, month, 0))

      return {
        key: `${year}-${String(month).padStart(2, '0')}`,
        label: `${month}月`,
        start,
        end,
        active: selection.mode === 'month' && selection.start === start,
      }
    }),
  }
}

function getYearPickerPage(selection: TimeRangeSelection): PickerPage {
  const selectedYear = parseDate(selection.start).getFullYear()
  const pageStart = Math.floor(selectedYear / 10) * 10
  const pageEnd = pageStart + 9

  return {
    mode: 'year',
    title: `${pageStart} - ${pageEnd}`,
    label: '按年聚合',
    gridClassName: 'time-picker-grid--years',
    options: Array.from({ length: 10 }, (_, index) => {
      const year = pageStart + index

      return {
        key: String(year),
        label: `${year}年`,
        start: `${year}-01-01`,
        end: `${year}-12-31`,
        active: selection.mode === 'year' && selectedYear === year,
      }
    }),
  }
}

function normalizeCustomSelection(selection: TimeRangeSelection): TimeRangeSelection {
  if (selection.start <= selection.end) {
    return {
      ...selection,
      mode: 'custom',
      anchorDate: selection.end,
      label: '自定义',
      isOpenEnded: false,
    }
  }

  return {
    ...selection,
    mode: 'custom',
    start: selection.end,
    end: selection.start,
    anchorDate: selection.start,
    label: '自定义',
    isOpenEnded: false,
  }
}

function startOfWeek(date: Date) {
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return addDays(date, mondayOffset)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(date.getDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  const targetMonthStart = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const targetMonthLastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate()
  const targetDay = Math.min(date.getDate(), targetMonthLastDay)

  return new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), targetDay)
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return formatDateKey(parseDate(value)) === value
}

function dateKeyToShanghaiStartTimestampSeconds(value: string) {
  const [year, month, day] = value.split('-').map(Number)

  return Math.floor(Date.UTC(year, month - 1, day) / 1000) - 8 * 60 * 60
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatFullDate(value: string) {
  const date = parseDate(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatRangeDetail(start: string, end: string) {
  const startDate = parseDate(start)
  const endDate = parseDate(end)

  if (startDate.getFullYear() !== endDate.getFullYear()) {
    return `${formatFullDate(start)} - ${formatFullDate(end)}`
  }

  return `${startDate.getFullYear()}年 ${formatMonthDay(start)} - ${formatMonthDay(end)}`
}

function formatShortDate(value: string) {
  const date = parseDate(value)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatMonthDay(value: string) {
  const date = parseDate(value)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatYearMonth(value: string) {
  const date = parseDate(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function formatMonthDot(value: string) {
  const date = parseDate(value)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getWeekNumber(value: string) {
  const date = parseDate(value)
  const firstDay = new Date(date.getFullYear(), 0, 1)
  const dayOfYear =
    Math.floor((date.getTime() - firstDay.getTime()) / 86_400_000) + 1
  return Math.ceil((dayOfYear + firstDay.getDay()) / 7)
}
