import { describe, expect, it } from 'vitest'

import { selectDay, selectMonth, selectPresetRange, setCustomDateRange } from '../time/timeRange'
import type { FootprintPoint } from './footprintTypes'
import {
  calculateFootprintMetrics,
  calculateFootprintLngLatBounds,
  filterFootprintPointsByTimeRange,
} from './footprintSelectors'

const basePoint: FootprintPoint = {
  id: 'base',
  timestampSeconds: 0,
  longitude: 0,
  latitude: 0,
  accuracy: 5,
  speed: -1,
  distance: 0,
  heading: 0,
  altitude: 0,
  locType: 1,
  isBackForeground: 1,
  stepType: 0,
}

function point(
  id: string,
  timestampSeconds: number,
  longitude: number,
  latitude: number,
  distance = 0,
): FootprintPoint {
  return {
    ...basePoint,
    id,
    timestampSeconds,
    longitude,
    latitude,
    distance,
  }
}

describe('footprint selectors', () => {
  it('filters footprint points by inclusive selected time range timestamps', () => {
    const points = [
      point('before', 1781798399, 120, 30),
      point('start', 1781798400, 121, 31),
      point('middle', 1781840000, 122, 32),
      point('end', 1781884799, 123, 33),
      point('after', 1781884800, 124, 34),
    ]

    expect(filterFootprintPointsByTimeRange(points, selectDay('2026-06-19')).map(({ id }) => id)).toEqual([
      'start',
      'middle',
      'end',
    ])
  })

  it('uses the same date range model for month and custom presets', () => {
    const points = [
      point('may-end', 1780243199, 120, 30),
      point('june-start', 1780243200, 121, 31),
      point('june-end', 1782835199, 122, 32),
      point('july-start', 1782835200, 123, 33),
    ]

    expect(filterFootprintPointsByTimeRange(points, selectMonth(2026, 6)).map(({ id }) => id)).toEqual([
      'june-start',
      'june-end',
    ])

    expect(
      filterFootprintPointsByTimeRange(points, setCustomDateRange('2026-06-30', '2026-06-01')).map(
        ({ id }) => id,
      ),
    ).toEqual(['june-start', 'june-end'])

    expect(filterFootprintPointsByTimeRange(points, selectPresetRange('all')).map(({ id }) => id)).toEqual([
      'may-end',
      'june-start',
      'june-end',
      'july-start',
    ])
  })

  it('does not cap all-time footprint filtering at the current visible date', () => {
    const points = [
      point('first-imported-day', 1646064000, 120, 30),
      point('visible-today-end', 1781884799, 121, 31),
      point('future-imported', 1781971200, 122, 32),
    ]

    expect(filterFootprintPointsByTimeRange(points, selectPresetRange('all')).map(({ id }) => id)).toEqual([
      'first-imported-day',
      'visible-today-end',
      'future-imported',
    ])
  })

  it('calculates bounds for the currently displayed footprint points', () => {
    expect(calculateFootprintLngLatBounds([])).toBeNull()
    expect(calculateFootprintLngLatBounds([point('single', 1, 121.5, 31.2)])).toEqual({
      southWest: [121.5, 31.2],
      northEast: [121.5, 31.2],
    })

    expect(
      calculateFootprintLngLatBounds([
        point('west', 1, 120, 31),
        point('east', 2, 123, 30),
        point('north', 3, 121, 34),
      ]),
    ).toEqual({
      southWest: [120, 30],
      northEast: [123, 34],
    })
  })

  it('calculates exact metrics for the selected calendar range before render thinning', () => {
    const points = [
      point('before', 1781798399, 120, 30, 90),
      point('start', 1781798400, 121, 31, 100),
      point('middle', 1781840000, 122, 32, 200.5),
      point('end', 1781884799, 123, 33, Number.NaN),
      point('after', 1781971200, 124, 34, 300),
    ]

    expect(calculateFootprintMetrics(points, selectDay('2026-06-19'))).toEqual({
      selectedCount: 3,
      totalDistanceMeters: 300.5,
      averageDistanceMetersPerDay: 300.5,
      distanceSeries: {
        granularity: 'hour',
        unit: 'hour',
        buckets: Array.from({ length: 24 }, (_, hour) => ({
          key: `2026-06-19T${hour.toString().padStart(2, '0')}`,
          label: `${hour.toString().padStart(2, '0')}:00`,
          distanceMeters: { 0: 100, 11: 200.5 }[hour] ?? 0,
        })),
      },
    })

    expect(calculateFootprintMetrics(points, setCustomDateRange('2026-06-19', '2026-06-20'))).toEqual({
      selectedCount: 3,
      totalDistanceMeters: 300.5,
      averageDistanceMetersPerDay: 150.25,
      distanceSeries: {
        granularity: 'day',
        unit: 'day',
        buckets: [
          { key: '2026-06-19', label: '6月19日', distanceMeters: 300.5 },
          { key: '2026-06-20', label: '6月20日', distanceMeters: 0 },
        ],
      },
    })
  })
})
