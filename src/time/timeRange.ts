export type TimeRangeMode = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom'
export type CalendarDisplayMode = 'week' | 'month'
export type TimePresetKey = 'all' | 'imported' | 'recent30' | 'qingdao' | 'quarter'

export type TimeRangeSelection = {
  mode: TimeRangeMode
  start: string
  end: string
  anchorDate: string
  label?: string
}

export type TimeRangeDisplay = {
  title: string
  detail: string
  accountingLabel: string
}

export type DateCell = {
  date: string
  day: number
  inCurrentMonth: boolean
}

export type WeekOption = {
  label: string
  detail: string
  value: string
  date: string
}

const today = '2026-06-19'
const firstImportedDate = '2022-03-01'

export function createTodaySelection(): TimeRangeSelection {
  return selectDay(today)
}

export function createCurrentSelection(mode: TimeRangeMode): TimeRangeSelection {
  const currentDate = parseDate(today)

  if (mode === 'day') return selectDay(today)
  if (mode === 'week') return selectWeek(today)
  if (mode === 'month') {
    return selectMonth(currentDate.getFullYear(), currentDate.getMonth() + 1)
  }
  if (mode === 'year') return selectYear(currentDate.getFullYear())
  if (mode === 'all') return selectPresetRange('all')

  return selectPresetRange('recent30')
}

export function getCurrentRangeActionLabel(mode: TimeRangeMode) {
  if (mode === 'day') return '回到今天'
  if (mode === 'week') return '回到本周'
  if (mode === 'month') return '回到本月'
  if (mode === 'year') return '回到今年'
  if (mode === 'all') return '回到全部'

  return '回到近30天'
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
  if (preset === 'all') {
    return {
      mode: 'all',
      start: firstImportedDate,
      end: today,
      anchorDate: today,
      label: '全部',
    }
  }

  if (preset === 'imported') {
    return {
      mode: 'all',
      start: firstImportedDate,
      end: today,
      anchorDate: today,
      label: '导入数据',
    }
  }

  if (preset === 'recent30') {
    return {
      mode: 'custom',
      start: formatDateKey(addDays(parseDate(today), -29)),
      end: today,
      anchorDate: today,
      label: '近30天',
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

  return {
    mode: 'custom',
    start: '2026-04-01',
    end: '2026-06-30',
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

export function moveTimeSelection(
  selection: TimeRangeSelection,
  direction: -1 | 1,
  calendarMode: CalendarDisplayMode,
): TimeRangeSelection {
  if (selection.mode === 'week') {
    return selectWeek(formatDateKey(addDays(parseDate(selection.anchorDate), direction * 7)))
  }

  if (selection.mode === 'month') {
    const anchor = parseDate(selection.anchorDate)
    return selectMonth(anchor.getFullYear(), anchor.getMonth() + 1 + direction)
  }

  if (selection.mode === 'year') {
    return selectYear(parseDate(selection.anchorDate).getFullYear() + direction)
  }

  const anchor = parseDate(selection.anchorDate)
  if (calendarMode === 'month') {
    return selectDay(formatDateKey(addMonths(anchor, direction)))
  }

  return selectDay(formatDateKey(addDays(anchor, direction * 7)))
}

export function getTimeRangeDisplay(selection: TimeRangeSelection): TimeRangeDisplay {
  if (selection.mode === 'day') {
    const title = selection.start === today ? '今天' : formatShortDate(selection.start)

    return {
      title,
      detail: `${formatFullDate(selection.start)} · 发生时间`,
      accountingLabel: '日',
    }
  }

  if (selection.mode === 'week') {
    return {
      title: `第${getWeekNumber(selection.start)}周`,
      detail: `${formatMonthDay(selection.start)} - ${formatMonthDay(selection.end)} · 按周聚合`,
      accountingLabel: '周',
    }
  }

  if (selection.mode === 'month') {
    const date = parseDate(selection.start)

    return {
      title: `${date.getMonth() + 1}月`,
      detail: `${date.getFullYear()}年${date.getMonth() + 1}月 · 按月聚合`,
      accountingLabel: '月',
    }
  }

  if (selection.mode === 'year') {
    const year = parseDate(selection.start).getFullYear()

    return {
      title: `${year}年`,
      detail: `${year}年 · 年度聚合`,
      accountingLabel: '年',
    }
  }

  if (selection.mode === 'all') {
    return {
      title: selection.label ?? '全部',
      detail: `${formatMonthDot(selection.start)} 至今`,
      accountingLabel: '全部',
    }
  }

  return {
    title: selection.label ?? '自定义',
    detail: `${formatFullDate(selection.start)} - ${formatFullDate(selection.end)}`,
    accountingLabel: '自定义',
  }
}

export function formatTimeRangeDate(value: string) {
  return formatFullDate(value)
}

export function getCalendarLabel(
  selection: TimeRangeSelection,
  calendarMode: CalendarDisplayMode,
) {
  const anchor = parseDate(selection.anchorDate)
  const suffix = calendarMode === 'week' ? '本周' : '本月'

  return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月 · ${suffix}`
}

export function getVisibleWeekDays(anchorDate: string): DateCell[] {
  const start = startOfWeek(parseDate(anchorDate))
  const anchorMonth = parseDate(anchorDate).getMonth()

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index)

    return {
      date: formatDateKey(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === anchorMonth,
    }
  })
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

export function getWeekOptions(anchorDate: string): WeekOption[] {
  const currentStart = startOfWeek(parseDate(anchorDate))

  return [-7, 0, 7].map((offset) => {
    const start = addDays(currentStart, offset)
    const startKey = formatDateKey(start)
    const endKey = formatDateKey(addDays(start, 6))
    const diff = offset / 7
    const value = diff === 0 ? '当前' : diff < 0 ? `${Math.abs(diff)}周前` : `${diff}周后`

    return {
      label: `${start.getMonth() + 1}月第${getWeekNumber(startKey)}周`,
      detail: `${formatDotMonthDay(startKey)} - ${formatDotMonthDay(endKey)} · 按周聚合`,
      value,
      date: startKey,
    }
  })
}

export function isSelectionActive(
  selection: TimeRangeSelection,
  mode: TimeRangeMode,
  start: string,
) {
  return selection.mode === mode && selection.start === start
}

function normalizeCustomSelection(selection: TimeRangeSelection): TimeRangeSelection {
  if (selection.start <= selection.end) {
    return {
      ...selection,
      mode: 'custom',
      anchorDate: selection.end,
      label: '自定义',
    }
  }

  return {
    ...selection,
    mode: 'custom',
    start: selection.end,
    end: selection.start,
    anchorDate: selection.start,
    label: '自定义',
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
  const next = new Date(date)
  next.setMonth(date.getMonth() + months)
  return next
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
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

function formatShortDate(value: string) {
  const date = parseDate(value)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatMonthDay(value: string) {
  const date = parseDate(value)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatDotMonthDay(value: string) {
  const date = parseDate(value)
  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`
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
