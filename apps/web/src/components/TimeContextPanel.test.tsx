import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  selectDay,
  selectMonth,
  selectWeek,
  selectYear,
  setCustomDateRange,
  type TimeRangeSelection,
} from '../time/timeRange'
import type { FootprintDistanceSeries } from '../layers/footprintTypes'
import { TimeContextPanel } from './TimeContextPanel'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-20T10:20:30+08:00'))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function StatefulMapTimeContextPanel({
  initialSelection,
  onSelectionChange,
  distanceSeries,
}: {
  initialSelection: TimeRangeSelection
  onSelectionChange: (selection: TimeRangeSelection) => void
  distanceSeries?: FootprintDistanceSeries
}) {
  const [selection, setSelection] = useState(initialSelection)

  return (
    <TimeContextPanel
      view="map"
      selection={selection}
      distanceSeries={distanceSeries}
      onSelectionChange={(nextSelection) => {
        onSelectionChange(nextSelection)
        setSelection(nextSelection)
      }}
    />
  )
}

const hourlyDistanceSeries: FootprintDistanceSeries = {
  granularity: 'hour',
  unit: 'hour',
  buckets: Array.from({ length: 24 }, (_, hour) => ({
    key: `2026-06-19T${hour.toString().padStart(2, '0')}`,
    label: `${hour.toString().padStart(2, '0')}:00`,
    distanceMeters: { 0: 100, 11: 300 }[hour] ?? 0,
  })),
}

const dailyDistanceSeries: FootprintDistanceSeries = {
  granularity: 'day',
  unit: 'day',
  buckets: [
    { key: '2026-06-18', label: '6月18日', distanceMeters: 0 },
    { key: '2026-06-19', label: '6月19日', distanceMeters: 400 },
    { key: '2026-06-20', label: '6月20日', distanceMeters: 1200 },
  ],
}

const denseYearDistanceSeries: FootprintDistanceSeries = {
  granularity: 'day',
  unit: 'day',
  buckets: Array.from({ length: 365 }, (_, index) => ({
    key: createDateKeyFromOffset('2026-01-01', index),
    label: `${Math.floor(index / 31) + 1}月${(index % 31) + 1}日`,
    distanceMeters: index === 170 ? 1200 : 0,
  })),
}

function createDateKeyFromOffset(startDateKey: string, offsetDays: number) {
  const [year, month, day] = startDateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + offsetDays)

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

describe('TimeContextPanel', () => {
  it('keeps the map time selector and distance chart visible by default', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-15')}
        metricItems={[{ label: 'Total distance', value: '12.3 km' }]}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(container.querySelector('.time-panel-content')).toBeInTheDocument()
    expect(container.querySelector('.time-context-trend')).toBeInTheDocument()
    expect(container.querySelector('.time-context-card__today')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('places distance aggregation metadata above the chart and the average value on the chart line', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectMonth(2026, 6)}
        distanceSeries={dailyDistanceSeries}
        metricItems={[
          { label: 'Footprints', value: '12,486' },
          { label: 'Distance', value: '18,732 km' },
          { label: 'Average', value: '51.3 km/day' },
          { label: 'Range days', value: '30 days' },
        ]}
        onSelectionChange={vi.fn()}
      />,
    )

    const trend = container.querySelector('.time-context-trend')

    expect(trend).toBeInTheDocument()
    expect(within(trend as HTMLElement).getByText('\u5f53\u524d\u8303\u56f4\u8ddd\u79bb')).toBeInTheDocument()
    expect(within(trend as HTMLElement).getByText(/\u6309\u65e5\u6c47\u603b/)).toBeInTheDocument()
    expect(trend?.querySelector('.time-context-trend__head')).not.toHaveTextContent('\u5747\u503c')
    expect(trend?.querySelector('.time-context-trend__average-label')).toHaveTextContent(
      /^均值\s+\d+(\.\d)?\s+(m|km)\/日$/,
    )
  })

  it('averages the current day distance chart by elapsed hours instead of all 24 hours', () => {
    vi.setSystemTime(new Date('2026-06-20T10:00:00+08:00'))

    const currentDaySeries: FootprintDistanceSeries = {
      granularity: 'hour',
      unit: 'hour',
      buckets: Array.from({ length: 24 }, (_, hour) => ({
        key: `2026-06-20T${hour.toString().padStart(2, '0')}`,
        label: `${hour.toString().padStart(2, '0')}:00`,
        distanceMeters: { 0: 40, 9: 60 }[hour] ?? 0,
      })),
    }
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-20')}
        distanceSeries={currentDaySeries}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(
      container.querySelector('.time-context-trend__average-label')?.textContent,
    ).toContain('10 m/')
    expect(container.querySelector('.time-context-trend__head small')?.textContent).toContain(
      '10.0小时',
    )
  })

  it('averages multi-day distance charts only through today when the range extends into the future', () => {
    vi.setSystemTime(new Date('2026-06-20T10:20:30+08:00'))

    const currentMonthSeries: FootprintDistanceSeries = {
      granularity: 'day',
      unit: 'day',
      buckets: Array.from({ length: 30 }, (_, index) => ({
        key: `2026-06-${(index + 1).toString().padStart(2, '0')}`,
        label: `6-${index + 1}`,
        distanceMeters: index === 19 ? 2000 : 0,
      })),
    }
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectMonth(2026, 6)}
        distanceSeries={currentMonthSeries}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(
      container.querySelector('.time-context-trend__average-label')?.textContent,
    ).toContain('100 m/')
    expect(container.querySelector('.time-context-trend__head small')?.textContent).toContain(
      '20天',
    )
  })

  it('positions the average line on the raw chart scale instead of clamping it away from the bars', () => {
    const sparsePastSeries: FootprintDistanceSeries = {
      granularity: 'day',
      unit: 'day',
      buckets: Array.from({ length: 100 }, (_, index) => ({
        key: `2026-02-${(index + 1).toString().padStart(2, '0')}`,
        label: `D${index + 1}`,
        distanceMeters: index === 99 ? 100 : 0,
      })),
    }
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2026-01-01', '2026-04-10')}
        distanceSeries={sparsePastSeries}
        onSelectionChange={vi.fn()}
      />,
    )
    const chart = container.querySelector<HTMLElement>('.time-context-trend__chart')

    expect(chart?.style.getPropertyValue('--trend-average-position')).toBe('1%')
  })

  it('keeps zero-distance bars at zero height so the average line shares the same baseline', () => {
    const zeroSeries: FootprintDistanceSeries = {
      granularity: 'day',
      unit: 'day',
      buckets: Array.from({ length: 7 }, (_, index) => ({
        key: `2026-06-${(index + 1).toString().padStart(2, '0')}`,
        label: `D${index + 1}`,
        distanceMeters: 0,
      })),
    }
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectWeek('2026-06-04')}
        distanceSeries={zeroSeries}
        onSelectionChange={vi.fn()}
      />,
    )
    const chart = container.querySelector<HTMLElement>('.time-context-trend__chart')
    const bars = Array.from(
      container.querySelectorAll<HTMLElement>('.time-context-trend__bar'),
    )

    expect(chart?.style.getPropertyValue('--trend-average-position')).toBe('0%')
    expect(bars.map((bar) => bar.style.getPropertyValue('--trend-height'))).toEqual(
      Array.from({ length: 7 }, () => '0%'),
    )
  })

  it('toggles the distance chart between linear and logarithmic scales without changing real labels', () => {
    const longTailSeries: FootprintDistanceSeries = {
      granularity: 'day',
      unit: 'day',
      buckets: [
        { key: '2026-06-18', label: '6月18日', distanceMeters: 0 },
        { key: '2026-06-19', label: '6月19日', distanceMeters: 1000 },
        { key: '2026-06-20', label: '6月20日', distanceMeters: 100000 },
      ],
    }
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectWeek('2026-06-19')}
        distanceSeries={longTailSeries}
        onSelectionChange={vi.fn()}
      />,
    )
    const bars = Array.from(
      container.querySelectorAll<HTMLElement>('.time-context-trend__bar'),
    )
    const chart = container.querySelector<HTMLElement>('.time-context-trend__chart')
    const scaleButton = screen.getByRole('button', {
      name: '距离图表尺度：线性，点击切换到对数',
    })

    expect(scaleButton).toHaveClass('time-context-trend__scale-button')
    expect(container.querySelector('.time-context-trend__title')).toBeInTheDocument()
    expect(bars.map((bar) => bar.style.getPropertyValue('--trend-height'))).toEqual([
      '0%',
      '1%',
      '100%',
    ])
    expect(chart?.style.getPropertyValue('--trend-average-position')).toBe(
      '33.666666666666664%',
    )

    fireEvent.click(scaleButton)

    expect(
      screen.getByRole('button', { name: '距离图表尺度：对数，点击切换到线性' }),
    ).toBeInTheDocument()
    expect(bars[0]?.style.getPropertyValue('--trend-height')).toBe('0%')
    expect(parseFloat(bars[1]?.style.getPropertyValue('--trend-height') ?? '')).toBeCloseTo(
      15.019,
      3,
    )
    expect(bars[2]?.style.getPropertyValue('--trend-height')).toBe('100%')
    expect(
      parseFloat(chart?.style.getPropertyValue('--trend-average-position') ?? ''),
    ).toBeCloseTo(76.83, 2)

    fireEvent.pointerEnter(container.querySelectorAll('.time-context-trend__column')[1])

    expect(screen.getByText('6月19日 · 1.0 km')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: '距离图表尺度：对数，点击切换到线性' }),
    )

    expect(
      screen.getByRole('button', { name: '距离图表尺度：线性，点击切换到对数' }),
    ).toBeInTheDocument()
    expect(bars.map((bar) => bar.style.getPropertyValue('--trend-height'))).toEqual([
      '0%',
      '1%',
      '100%',
    ])
  })

  it('keeps yearly distance buckets grouped by default while exposing a compact current-mode toggle', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectYear(2026)}
        distanceSeries={denseYearDistanceSeries}
        onSelectionChange={vi.fn()}
      />,
    )

    const trend = screen.getByLabelText('当前范围距离')
    const groupedButton = within(trend).getByRole('button', { name: '归并' })

    expect(groupedButton).toHaveClass('time-context-trend__group-button')
    expect(within(trend).getAllByRole('button', { name: '归并' })).toHaveLength(1)
    expect(container.querySelectorAll('.time-context-trend__column')).toHaveLength(122)
    expect(within(trend).getByText('按3日归并 · 171天')).toBeInTheDocument()

    const groupedColumns = Array.from(container.querySelectorAll('.time-context-trend__column'))
    fireEvent.pointerEnter(groupedColumns[56])

    expect(within(trend).getByText('6月18日-6月20日 · 日均 400 m · 共 1.2 km')).toBeInTheDocument()

    fireEvent.click(groupedButton)

    expect(within(trend).getByRole('button', { name: '逐日' })).toBeInTheDocument()
    expect(container.querySelectorAll('.time-context-trend__column')).toHaveLength(365)
  })

  it('shows the grouping toggle for custom ranges only after the range exceeds 200 days', () => {
    const twoHundredDays: FootprintDistanceSeries = {
      granularity: 'day',
      unit: 'day',
      buckets: Array.from({ length: 200 }, (_, index) => ({
        key: createDateKeyFromOffset('2026-01-01', index),
        label: `D${index + 1}`,
        distanceMeters: 100,
      })),
    }
    const twoHundredOneDays: FootprintDistanceSeries = {
      granularity: 'day',
      unit: 'day',
      buckets: Array.from({ length: 201 }, (_, index) => ({
        key: createDateKeyFromOffset('2026-01-01', index),
        label: `D${index + 1}`,
        distanceMeters: index < 2 ? 1000 : 0,
      })),
    }
    const { container, rerender } = render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2026-01-01', '2026-07-19')}
        distanceSeries={twoHundredDays}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '归并' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.time-context-trend__column')).toHaveLength(200)

    rerender(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2026-01-01', '2026-07-20')}
        distanceSeries={twoHundredOneDays}
        onSelectionChange={vi.fn()}
      />,
    )

    const trend = screen.getByLabelText('当前范围距离')

    expect(within(trend).getByRole('button', { name: '归并' })).toBeInTheDocument()
    expect(container.querySelectorAll('.time-context-trend__column')).toHaveLength(101)

    const groupedColumns = Array.from(container.querySelectorAll('.time-context-trend__column'))
    fireEvent.pointerEnter(groupedColumns[0])

    expect(within(trend).getByText('1月1日-1月2日 · 日均 1.0 km · 共 2.0 km')).toBeInTheDocument()
  })

  it('renders real distance buckets and only emphasizes the hovered or focused column', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectWeek('2026-06-19')}
        distanceSeries={dailyDistanceSeries}
        onSelectionChange={vi.fn()}
      />,
    )

    const trend = screen.getByLabelText('当前范围距离')
    const columns = Array.from(container.querySelectorAll('.time-context-trend__column'))
    const bars = Array.from(container.querySelectorAll('.time-context-trend__bar'))

    expect(columns).toHaveLength(3)
    expect(bars).toHaveLength(3)
    expect(within(trend).getByText('按日汇总 · 3天')).toBeInTheDocument()
    expect(bars.filter((bar) => bar.classList.contains('is-active'))).toHaveLength(0)

    fireEvent.pointerEnter(columns[1])

    expect(within(trend).getByText('6月19日 · 400 m')).toBeInTheDocument()
    expect(bars.filter((bar) => bar.classList.contains('is-active'))).toEqual([bars[1]])

    fireEvent.focus(columns[2])

    expect(within(trend).getByText('6月20日 · 1.2 km')).toBeInTheDocument()
    expect(bars.filter((bar) => bar.classList.contains('is-active'))).toEqual([bars[2]])
  })

  it('keeps dense year distance buckets addressable after switching back to daily columns', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectYear(2026)}
        distanceSeries={denseYearDistanceSeries}
        onSelectionChange={vi.fn()}
      />,
    )

    const trend = screen.getByLabelText('当前范围距离')
    fireEvent.click(within(trend).getByRole('button', { name: '归并' }))

    const chart = container.querySelector('.time-context-trend__chart')
    const columns = Array.from(container.querySelectorAll('.time-context-trend__column'))
    const bars = Array.from(container.querySelectorAll('.time-context-trend__bar'))

    expect(chart).toHaveClass('time-context-trend__chart--dense')
    expect(columns).toHaveLength(365)
    expect(bars).toHaveLength(365)
    expect(within(trend).getByRole('button', { name: '逐日' })).toBeInTheDocument()
    expect(within(trend).getByText('按日汇总 · 171天')).toBeInTheDocument()

    fireEvent.pointerEnter(columns[170])

    expect(within(trend).getByText(/1.2 km$/)).toBeInTheDocument()
    expect(bars.filter((bar) => bar.classList.contains('is-active'))).toEqual([bars[170]])
  })

  it('maps pointer movement anywhere in the chart area to the bucket under the same x position', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectWeek('2026-06-19')}
        distanceSeries={dailyDistanceSeries}
        onSelectionChange={vi.fn()}
      />,
    )

    const trend = screen.getByLabelText('当前范围距离')
    const chart = container.querySelector('.time-context-trend__chart') as HTMLElement
    const bars = Array.from(container.querySelectorAll('.time-context-trend__bar'))

    chart.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      width: 300,
      height: 132,
      top: 20,
      right: 310,
      bottom: 152,
      left: 10,
      toJSON: () => '',
    })

    fireEvent.pointerMove(chart, { clientX: 160, clientY: 30 })

    expect(within(trend).getByText('6月19日 · 400 m')).toBeInTheDocument()
    expect(bars.filter((bar) => bar.classList.contains('is-active'))).toEqual([bars[1]])
  })

  it('keeps the map distance chart in place and fades it while day mode shows the month calendar', () => {
    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-19')}
        distanceSeries={hourlyDistanceSeries}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('当前范围距离')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月历' }))

    expect(screen.getByLabelText('当前范围距离')).toHaveClass('is-hidden')

    fireEvent.click(screen.getByRole('button', { name: '周历' }))

    expect(screen.getByLabelText('当前范围距离')).not.toHaveClass('is-hidden')
  })

  it('keeps the map distance chart in place and fades it while a custom date picker is expanded', () => {
    render(
      <StatefulMapTimeContextPanel
        initialSelection={setCustomDateRange('2026-06-10', '2026-06-12')}
        distanceSeries={dailyDistanceSeries}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('当前范围距离')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /打开开始日期选择器/ }))

    expect(screen.getByLabelText('当前范围距离')).toHaveClass('is-hidden')

    fireEvent.click(screen.getByRole('button', { name: /打开开始日期选择器/ }))

    expect(screen.getByLabelText('当前范围距离')).not.toHaveClass('is-hidden')
  })

  it('presents a compact travel dashboard and staged time editor actions', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={selectMonth(2026, 6)}
        secondaryContextLabel="区域"
        metricItems={[
          { label: '足迹总数', value: '56' },
          { label: '国家/地区', value: '12' },
          { label: '飞行里程', value: '48,260 km' },
          { label: '旅行天数', value: '126 天' },
        ]}
        onSelectionChange={vi.fn()}
      />,
    )

    const overview = screen.getByLabelText('时间概览')

    expect(within(overview).getByText('区域时间范围')).toBeInTheDocument()
    expect(within(overview).getByRole('heading', { name: '6月' })).toBeInTheDocument()
    expect(within(overview).getByText('2026年6月')).toBeInTheDocument()
    expect(screen.getByLabelText('当前范围距离')).toBeInTheDocument()
    expect(screen.getByText('当前范围距离')).toBeInTheDocument()
    const metricStrip = screen.getByLabelText('全局范围指标')
    expect(within(metricStrip).getByText('48,260')).toHaveClass(
      'time-context-metric-strip__number',
    )
    expect(within(metricStrip).getByText('km')).toHaveClass(
      'time-context-metric-strip__unit',
    )

    const editor = screen.getByRole('region', { name: '时间编辑器' })

    expect(editor).toBeInTheDocument()
    expect(within(editor).queryByText('选择范围')).not.toBeInTheDocument()
    expect(within(editor).queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    expect(within(editor).queryByRole('button', { name: '应用时间' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('当前范围距离')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回到本月' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('keeps the selector in the persistent rail instead of entering an editing state', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2026-01-11', '2026-06-23')}
        onSelectionChange={vi.fn()}
      />,
    )
    const panel = container.querySelector('.time-context-panel')

    expect(panel).not.toHaveClass('is-editing-time')
    expect(container.querySelector('.time-context-panel__footer')).not.toBeInTheDocument()
    expect(within(panel as HTMLElement).queryByRole('button', { name: '打开设置' })).not.toBeInTheDocument()
    expect(container.querySelector('.time-panel-content')).toBeInTheDocument()
    expect(container.querySelector('.time-context-card__today')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('uses the day calendar header for either calendar mode controls or month selection context', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-26')}
        onSelectionChange={vi.fn()}
      />,
    )

    const calendar = screen.getByLabelText('日历选择')

    expect(within(calendar).getByText('按日选择')).toBeInTheDocument()
    expect(within(calendar).getByRole('group', { name: '日历显示方式' })).toBeInTheDocument()

    fireEvent.click(
      within(calendar).getByRole('button', {
        name: '切换到月份选择，当前2026年6月',
      }),
    )

    expect(within(calendar).getByText('选择月份')).toBeInTheDocument()
    expect(
      within(calendar).queryByRole('group', { name: '日历显示方式' }),
    ).not.toBeInTheDocument()
    expect(within(calendar).getByLabelText('月份选择')).toBeInTheDocument()
  })

  it('renders calendar navigation arrows as centered icon components', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-15')}
        onSelectionChange={vi.fn()}
      />,
    )

    const timeAction = container.querySelector<HTMLButtonElement>('.time-context-card__today')
    expect(timeAction).not.toBeNull()
    fireEvent.click(timeAction as HTMLButtonElement)

    const arrowButtons = container.querySelectorAll<HTMLButtonElement>(
      '.time-calendar-bar button:not(.time-period-title)',
    )

    expect(arrowButtons).toHaveLength(2)
    arrowButtons.forEach((button) => {
      expect(button.textContent?.trim()).toBe('')
      expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    })
  })

  it('renders picker navigation arrows as centered icon components', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectMonth(2026, 6)}
        onSelectionChange={vi.fn()}
      />,
    )

    const timeAction = container.querySelector<HTMLButtonElement>('.time-context-card__today')
    expect(timeAction).not.toBeNull()
    fireEvent.click(timeAction as HTMLButtonElement)

    const arrowButtons = container.querySelectorAll<HTMLButtonElement>(
      '.time-picker-bar button:not(.time-period-title)',
    )

    expect(arrowButtons).toHaveLength(2)
    arrowButtons.forEach((button) => {
      expect(button.textContent?.trim()).toBe('')
      expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    })
  })

  it('renders custom date picker navigation arrows as centered icon components', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2022-03-01', '2026-06-20')}
        onSelectionChange={vi.fn()}
      />,
    )

    const timeAction = container.querySelector<HTMLButtonElement>('.time-context-card__today')
    expect(timeAction).not.toBeNull()
    fireEvent.click(timeAction as HTMLButtonElement)
    const dateButton = container.querySelector<HTMLButtonElement>('.time-date-button')
    expect(dateButton).not.toBeNull()
    fireEvent.click(dateButton as HTMLButtonElement)

    const arrowButtons = container.querySelectorAll<HTMLButtonElement>(
      '.time-date-picker__bar button:not(.time-date-picker__title)',
    )

    expect(arrowButtons).toHaveLength(2)
    arrowButtons.forEach((button) => {
      expect(button.textContent?.trim()).toBe('')
      expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    })
  })

  it('keeps the mode switch and the time selector visible together', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-15')}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '回到今天' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('group', { name: '时间模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('slider', { name: '时间模式滑块' })).toHaveAttribute(
      'aria-valuetext',
      '日',
    )
    expect(screen.getByLabelText('日历选择')).toBeInTheDocument()
    expect(screen.queryByLabelText('时间选择页')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('自定义时间范围')).not.toBeInTheDocument()
  })

  it('resets to today while keeping the time selector visible', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-15')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '回到今天' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'day',
        start: '2026-06-20',
        end: '2026-06-20',
        anchorDate: '2026-06-20',
      }),
    )
    expect(screen.getByRole('button', { name: '回到今天' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('日历选择')).toBeInTheDocument()
  })

  it('switches time modes to the current range defaults while the editor stays open', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-15')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'week',
        start: '2026-06-15',
        end: '2026-06-21',
        anchorDate: '2026-06-20',
      }),
    )
    expect(screen.getByRole('button', { name: '回到本周' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'custom',
        start: '2026-01-11',
        end: '2026-06-20',
        label: '全部',
        isOpenEnded: true,
      }),
    )
    expect(screen.getByRole('button', { name: '回到全部' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('自定义时间范围')).toBeInTheDocument()
  })

  it('keeps the time selector visible after the user picks a concrete day', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-20')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(within(screen.getByLabelText('日历日期')).getByRole('button', { name: '15' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'day',
        start: '2026-06-15',
        end: '2026-06-15',
        anchorDate: '2026-06-15',
      }),
    )
    expect(screen.getByRole('button', { name: '回到今天' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('日历选择')).toBeInTheDocument()
  })

  it('keeps the custom range editor open while editing date boundaries', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={setCustomDateRange('2026-06-10', '2026-06-12')}
        onSelectionChange={onSelectionChange}
      />,
    )

    const customPanel = screen.getByLabelText('自定义时间范围')
    fireEvent.change(within(customPanel).getByLabelText('开始日期'), {
      target: { value: '2026-06-08' },
    })

    expect(screen.getByLabelText('自定义时间范围')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('结束日期'), {
      target: { value: '2026-06-15' },
    })

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'custom',
        start: '2026-06-08',
        end: '2026-06-15',
      }),
    )
    expect(screen.getByRole('button', { name: '回到全部' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('uses the map-only all-time start date when entering custom ranges', () => {
    const mapSelectionChange = vi.fn()
    render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-20')}
        onSelectionChange={mapSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(mapSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'custom',
        start: '2026-01-11',
        end: '2026-06-20',
        label: '全部',
        isOpenEnded: true,
      }),
    )

    cleanup()

    const accountingSelectionChange = vi.fn()
    render(
      <TimeContextPanel
        view="accounting"
        selection={selectDay('2026-06-20')}
        onSelectionChange={accountingSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(accountingSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'custom',
        start: '2022-03-01',
        end: '2026-06-20',
        label: '全部',
        isOpenEnded: true,
      }),
    )
  })

  it('lets the custom date picker title switch into month selection by year', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2022-03-01', '2026-06-20')}
        onSelectionChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /打开开始日期选择器/ }))

    const picker = screen.getByRole('dialog', { name: '开始日期选择' })
    fireEvent.click(within(picker).getByRole('button', { name: /2022年3月/ }))

    expect(within(picker).getByLabelText('月份选择')).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: /2022年/ })).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: '上一年' })).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: '下一年' })).toBeInTheDocument()
    expect(within(picker).queryByLabelText('日期选择')).not.toBeInTheDocument()

    fireEvent.click(within(picker).getByRole('button', { name: '下一年' }))

    expect(within(picker).getByRole('button', { name: /2023年/ })).toBeInTheDocument()
    expect(picker.querySelector('.time-date-picker__grid-motion')).toHaveClass(
      'time-range-grid-motion--next',
    )

    fireEvent.click(within(picker).getByRole('button', { name: '1月' }))

    expect(within(picker).getByRole('button', { name: /2023年1月/ })).toBeInTheDocument()
    expect(within(picker).getByLabelText('日期选择')).toBeInTheDocument()
    expect(within(picker).queryByLabelText('月份选择')).not.toBeInTheDocument()
  })

  it('animates custom date picker month and year navigation with the shared direction classes', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2022-03-01', '2026-06-20')}
        onSelectionChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /打开开始日期选择器/ }))

    const picker = screen.getByRole('dialog', { name: '开始日期选择' })
    const getMotion = () => picker.querySelector('.time-date-picker__grid-motion')

    expect(getMotion()).not.toHaveClass('time-range-grid-motion--previous')
    expect(getMotion()).not.toHaveClass('time-range-grid-motion--next')

    fireEvent.click(within(picker).getByRole('button', { name: '下个月' }))

    expect(within(picker).getByRole('button', { name: /2022年4月/ })).toBeInTheDocument()
    expect(getMotion()).toHaveClass('time-range-grid-motion--next')

    fireEvent.click(within(picker).getByRole('button', { name: /2022年4月/ }))
    fireEvent.click(within(picker).getByRole('button', { name: '上一年' }))

    expect(within(picker).getByRole('button', { name: /2021年/ })).toBeInTheDocument()
    expect(getMotion()).toHaveClass('time-range-grid-motion--previous')
  })

  it('lets the day calendar title pick a month and return to day mode', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-20')}
        onSelectionChange={onSelectionChange}
      />,
    )

    const calendar = screen.getByLabelText('日历选择')

    fireEvent.click(
      within(calendar).getByRole('button', {
        name: '切换到月份选择，当前2026年6月',
      }),
    )

    expect(within(calendar).getByLabelText('月份选择')).toBeInTheDocument()
    expect(within(calendar).queryByLabelText('日历日期')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(calendar).getByRole('button', { name: '5月' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'day',
        start: '2026-05-20',
        end: '2026-05-20',
        anchorDate: '2026-05-20',
      }),
    )
    expect(screen.getByRole('button', { name: '回到今天' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('日历选择')).toBeInTheDocument()
  })

  it('lets the week picker title pick a month and return to week mode', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectWeek('2026-06-20')}
        onSelectionChange={onSelectionChange}
      />,
    )

    const picker = screen.getByLabelText('时间选择页')

    fireEvent.click(
      within(picker).getByRole('button', {
        name: '切换到月份选择，当前2026年6月',
      }),
    )

    expect(within(picker).getByLabelText('月份选择')).toBeInTheDocument()
    expect(within(picker).queryByText('第25周')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(picker).getByRole('button', { name: '5月' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'week',
        start: '2026-05-18',
        end: '2026-05-24',
        anchorDate: '2026-05-20',
      }),
    )
    expect(screen.getByRole('button', { name: '回到本周' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
  })

  it('lets the month picker title pick a year and return to month mode', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectMonth(2026, 6)}
        onSelectionChange={onSelectionChange}
      />,
    )

    const picker = screen.getByLabelText('时间选择页')

    fireEvent.click(
      within(picker).getByRole('button', {
        name: '切换到年份选择，当前2026年',
      }),
    )

    expect(within(picker).getByLabelText('年份选择')).toBeInTheDocument()
    expect(within(picker).queryByRole('button', { name: '6月' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(picker).getByRole('button', { name: '2025年' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'month',
        start: '2025-06-01',
        end: '2025-06-30',
        anchorDate: '2025-06-01',
      }),
    )
    expect(screen.getByRole('button', { name: '回到本月' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('时间选择页')).toBeInTheDocument()
  })

  it('renders accounting summary values through the shared metric strip', () => {
    render(
      <TimeContextPanel
        view="accounting"
        selection={selectMonth(2026, 6)}
        onSelectionChange={vi.fn()}
      />,
    )

    const timeCardSummary = screen.getByLabelText('全局范围指标')

    expect(screen.getByText('全局时间范围')).toBeInTheDocument()
    expect(timeCardSummary.children).toHaveLength(3)
    expect(within(timeCardSummary).getByText('收入')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥5172.41')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('支出')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥481.18')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('流水')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('6')).toHaveClass(
      'time-context-metric-strip__number',
    )
    expect(within(timeCardSummary).getByText('笔')).toHaveClass(
      'time-context-metric-strip__unit',
    )
    expect(within(timeCardSummary).queryByText('净流入')).not.toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('账户')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前范围摘要')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('记账概览卡片')).not.toBeInTheDocument()
  })

  it('renders map metrics in the same global metric strip with map-specific content', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-15')}
        onSelectionChange={vi.fn()}
        metricItems={[
          { label: '当前足迹', value: '12' },
          { label: '全部足迹', value: '40441' },
          { label: '覆盖城市', value: '8' },
        ]}
      />,
    )

    const metricStrip = screen.getByLabelText('全局范围指标')

    expect(screen.getByText('全局时间范围')).toBeInTheDocument()
    expect(within(metricStrip).getByText('当前足迹')).toBeInTheDocument()
    expect(within(metricStrip).getByText('12')).toBeInTheDocument()
    expect(within(metricStrip).getByText('全部足迹')).toBeInTheDocument()
    expect(within(metricStrip).getByText('40441')).toBeInTheDocument()
    expect(within(metricStrip).getByText('覆盖城市')).toBeInTheDocument()
    expect(within(metricStrip).getByText('8')).toBeInTheDocument()
    expect(within(metricStrip).queryByText('净流入')).not.toBeInTheDocument()
    expect(within(metricStrip).queryByText('账户')).not.toBeInTheDocument()
  })

  it('splits metric values into a styled number and a normal unit', () => {
    const { container } = render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-15')}
        onSelectionChange={vi.fn()}
        metricItems={[
          { label: 'Footprints', value: '12,486' },
          { label: 'Distance', value: '18,732 km' },
          { label: 'Average', value: '51.3 km/day' },
          { label: 'Active days', value: '214 days' },
        ]}
      />,
    )

    const metrics = container.querySelectorAll('.time-context-metric-strip > div')

    expect(metrics).toHaveLength(4)
    expect(metrics[0].querySelector('.time-context-metric-strip__number')).toHaveTextContent(
      '12,486',
    )
    expect(metrics[0].querySelector('.time-context-metric-strip__unit')).toBeNull()
    expect(metrics[1].querySelector('.time-context-metric-strip__number')).toHaveTextContent(
      '18,732',
    )
    expect(metrics[1].querySelector('.time-context-metric-strip__unit')).toHaveTextContent(
      'km',
    )
    expect(metrics[2].querySelector('.time-context-metric-strip__number')).toHaveTextContent(
      '51.3',
    )
    expect(metrics[2].querySelector('.time-context-metric-strip__unit')).toHaveTextContent(
      'km/day',
    )
    expect(metrics[3].querySelector('.time-context-metric-strip__number')).toHaveTextContent(
      '214',
    )
    expect(metrics[3].querySelector('.time-context-metric-strip__unit')).toHaveTextContent(
      'days',
    )
  })

  it('does not duplicate selected dates below native custom date controls', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2026-06-10', '2026-06-12')}
        onSelectionChange={vi.fn()}
      />,
    )

    const customPanel = screen.getByLabelText('自定义时间范围')
    const dateFields = within(customPanel).getByLabelText('自定义日期字段')

    expect(within(dateFields).getByLabelText('开始日期')).toHaveValue('2026-06-10')
    expect(within(dateFields).getByLabelText('结束日期')).toHaveValue('2026-06-12')
    expect(within(dateFields).queryByText('2026年6月10日')).not.toBeInTheDocument()
    expect(within(dateFields).queryByText('2026年6月12日')).not.toBeInTheDocument()
  })

  it('places a decorative dash between custom start and end date fields', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={setCustomDateRange('2026-06-10', '2026-06-12')}
        onSelectionChange={vi.fn()}
      />,
    )

    const dateFields = screen.getByLabelText('自定义日期字段')
    const separator = dateFields.querySelector('.time-range-separator')
    const children = Array.from(dateFields.children)

    expect(separator).toBeInTheDocument()
    expect(separator).toHaveAttribute('aria-hidden', 'true')
    expect(children).toHaveLength(3)
    expect(children[0]).toContainElement(screen.getByLabelText('开始日期'))
    expect(children[1]).toBe(separator)
    expect(children[2]).toContainElement(screen.getByLabelText('结束日期'))
  })
})
