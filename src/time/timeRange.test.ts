import { describe, expect, it } from 'vitest'

import {
  createCurrentSelection,
  createTodaySelection,
  getCurrentRangeActionLabel,
  getTimeRangeDisplay,
  getVisibleMonthDays,
  moveTimeSelection,
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

  it('moves day and month calendar selections by one visible period', () => {
    const day = createTodaySelection()

    expect(moveTimeSelection(day, -1, 'week')).toMatchObject({
      mode: 'day',
      anchorDate: '2026-06-12',
      start: '2026-06-12',
      end: '2026-06-12',
    })

    expect(moveTimeSelection(day, 1, 'month')).toMatchObject({
      mode: 'day',
      anchorDate: '2026-07-19',
      start: '2026-07-19',
      end: '2026-07-19',
    })
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
