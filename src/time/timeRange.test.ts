import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  createCurrentSelection,
  createTodaySelection,
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
} from './timeRange'

describe('time range selection model', () => {
  it('represents today as a concrete day range', () => {
    const selection = createTodaySelection()

    expect(selection).toMatchObject({
      mode: 'day',
      start: '2026-06-19',
      end: '2026-06-19',
    })
    expect(getTimeRangeDisplay(selection)).toMatchObject({
      title: '今天',
      detail: '2026年6月19日 · 发生时间',
      accountingLabel: '日',
    })
  })

  it('creates current-period selections and labels for each top-level mode', () => {
    expect(createCurrentSelection('day')).toMatchObject({
      mode: 'day',
      start: '2026-06-19',
      end: '2026-06-19',
    })

    expect(createCurrentSelection('week')).toMatchObject({
      mode: 'week',
      start: '2026-06-15',
      end: '2026-06-21',
    })

    expect(createCurrentSelection('month')).toMatchObject({
      mode: 'month',
      start: '2026-06-01',
      end: '2026-06-30',
    })

    expect(createCurrentSelection('year')).toMatchObject({
      mode: 'year',
      start: '2026-01-01',
      end: '2026-12-31',
    })

    expect(getCurrentRangeActionLabel('day')).toBe('回到今天')
    expect(getCurrentRangeActionLabel('week')).toBe('回到本周')
    expect(getCurrentRangeActionLabel('month')).toBe('回到本月')
    expect(getCurrentRangeActionLabel('year')).toBe('回到今年')
  })

  it('lays out month calendars against the real weekday grid', () => {
    const days = getVisibleMonthDays('2026-07-14')

    expect(days).toHaveLength(35)
    expect(days.slice(0, 7).map((day) => day.date)).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ])
    expect(days.findIndex((day) => day.date === '2026-07-01')).toBe(2)
    expect(days[0]).toMatchObject({ day: 29, inCurrentMonth: false })
    expect(days[2]).toMatchObject({ day: 1, inCurrentMonth: true })
    expect(days.at(-1)).toMatchObject({ date: '2026-08-02', inCurrentMonth: false })
  })

  it('locates the active week inside the visible month grid', () => {
    expect(getVisibleMonthWeekIndex('2026-06-19')).toBe(2)
    expect(getVisibleMonthWeekIndex('2026-07-14')).toBe(2)
    expect(getVisibleMonthWeekIndex('2026-08-30')).toBe(4)
  })

  it('builds unified picker pages for day, week, month, and year modes', () => {
    const dayPage = getPickerPage(selectDay('2026-07-14'))

    expect(dayPage).toMatchObject({
      mode: 'day',
      title: '2026年7月',
      gridClassName: 'time-picker-grid--days',
      visibleRows: 5,
      activeWeekIndex: 2,
    })
    if (dayPage.mode === 'day') {
      expectTypeOf(dayPage.visibleRows).toEqualTypeOf<number>()
      expectTypeOf(dayPage.activeWeekIndex).toEqualTypeOf<number>()
    }
    expect(dayPage.options).toHaveLength(35)
    expect(dayPage.options[0]).toMatchObject({
      key: '2026-06-29',
      label: '29',
      start: '2026-06-29',
      outsidePage: true,
    })
    expect(dayPage.options.find((option) => option.key === '2026-07-14')).toMatchObject({
      label: '14',
      start: '2026-07-14',
      active: true,
      outsidePage: false,
    })

    const weekPage = getPickerPage(selectWeek('2026-07-20'))

    expect(weekPage).toMatchObject({
      mode: 'week',
      title: '2026年7月',
      gridClassName: 'time-picker-grid--weeks',
    })
    expect(weekPage).not.toHaveProperty('visibleRows')
    expect(weekPage).not.toHaveProperty('activeWeekIndex')
    expect(weekPage.options.map((option) => option.start)).toEqual([
      '2026-06-29',
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
    ])
    expect(weekPage.options.find((option) => option.start === '2026-07-20')).toMatchObject({
      label: '第30周',
      detail: '7月20日 - 7月26日',
      active: true,
    })

    const monthPage = getPickerPage(selectMonth(2026, 7))

    expect(monthPage).toMatchObject({
      mode: 'month',
      title: '2026年',
      gridClassName: 'time-picker-grid--months',
    })
    expect(monthPage.options).toHaveLength(12)
    expect(monthPage.options[6]).toMatchObject({
      key: '2026-07',
      label: '7月',
      start: '2026-07-01',
      active: true,
    })

    const yearPage = getPickerPage(selectYear(2026))

    expect(yearPage).toMatchObject({
      mode: 'year',
      title: '2020 - 2029',
      gridClassName: 'time-picker-grid--years',
    })
    expect(yearPage.options.map((option) => option.label)).toEqual([
      '2020年',
      '2021年',
      '2022年',
      '2023年',
      '2024年',
      '2025年',
      '2026年',
      '2027年',
      '2028年',
      '2029年',
    ])
    expect(yearPage.options.find((option) => option.key === '2026')).toMatchObject({
      active: true,
      start: '2026-01-01',
    })
  })

  it('moves unified picker pages by the visible page unit', () => {
    expect(movePickerPage(selectDay('2026-07-14'), -1)).toMatchObject({
      mode: 'day',
      anchorDate: '2026-06-14',
      start: '2026-06-14',
    })

    expect(movePickerPage(selectWeek('2026-07-20'), 1)).toMatchObject({
      mode: 'week',
      anchorDate: '2026-08-17',
      start: '2026-08-17',
      end: '2026-08-23',
    })

    expect(movePickerPage(selectMonth(2026, 7), 1)).toMatchObject({
      mode: 'month',
      anchorDate: '2027-07-01',
      start: '2027-07-01',
      end: '2027-07-31',
    })

    expect(movePickerPage(selectYear(2026), -1)).toMatchObject({
      mode: 'year',
      anchorDate: '2016-06-30',
      start: '2016-01-01',
      end: '2016-12-31',
    })
  })

  it('moves the day calendar by the active secondary display mode', () => {
    const selection = selectDay('2026-06-21')

    expect(getCalendarLabel(selection, 'week')).toBe('2026年6月')
    expect(getCalendarLabel(selection, 'month')).toBe('2026年6月')
    expect(moveDayCalendarPage(selection, -1, 'week')).toMatchObject({
      mode: 'day',
      anchorDate: '2026-06-14',
      start: '2026-06-14',
    })
    expect(moveDayCalendarPage(selection, 1, 'month')).toMatchObject({
      mode: 'day',
      anchorDate: '2026-07-21',
      start: '2026-07-21',
    })
  })

  it('keeps day page movement inside the target month at month ends', () => {
    expect(movePickerPage(selectDay('2026-01-31'), 1)).toMatchObject({
      mode: 'day',
      anchorDate: '2026-02-28',
      start: '2026-02-28',
    })

    expect(movePickerPage(selectDay('2026-03-31'), -1)).toMatchObject({
      mode: 'day',
      anchorDate: '2026-02-28',
      start: '2026-02-28',
    })
  })

  it('selects concrete day, week, month, and year ranges', () => {
    expect(selectDay('2026-06-21')).toMatchObject({
      mode: 'day',
      start: '2026-06-21',
      end: '2026-06-21',
    })

    expect(selectWeek('2026-06-22')).toMatchObject({
      mode: 'week',
      start: '2026-06-22',
      end: '2026-06-28',
    })

    expect(selectMonth(2026, 7)).toMatchObject({
      mode: 'month',
      start: '2026-07-01',
      end: '2026-07-31',
    })

    expect(selectYear(2025)).toMatchObject({
      mode: 'year',
      start: '2025-01-01',
      end: '2025-12-31',
    })
  })

  it('provides all-time and custom preset ranges through the same interface', () => {
    expect(selectPresetRange('all')).toMatchObject({
      mode: 'all',
      start: '2022-03-01',
      end: '2026-06-19',
    })

    expect(selectPresetRange('recent30')).toMatchObject({
      mode: 'custom',
      start: '2026-05-21',
      end: '2026-06-19',
    })

    expect(getTimeRangeDisplay(selectPresetRange('qingdao'))).toMatchObject({
      title: '青岛之行',
      detail: '2026年6月15日 - 2026年6月19日',
      accountingLabel: '自定义',
    })
  })
})
