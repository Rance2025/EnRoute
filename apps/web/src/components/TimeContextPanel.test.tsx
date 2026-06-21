import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  selectDay,
  selectMonth,
  selectWeek,
  setCustomDateRange,
  type TimeRangeSelection,
} from '../time/timeRange'
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
}: {
  initialSelection: TimeRangeSelection
  onSelectionChange: (selection: TimeRangeSelection) => void
}) {
  const [selection, setSelection] = useState(initialSelection)

  return (
    <TimeContextPanel
      view="map"
      selection={selection}
      onSelectionChange={(nextSelection) => {
        onSelectionChange(nextSelection)
        setSelection(nextSelection)
      }}
    />
  )
}

describe('TimeContextPanel', () => {
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

  it('lets the day calendar title switch into month selection by year', () => {
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
    expect(
      within(calendar).getByRole('button', {
        name: '返回日期选择，当前2026年',
      }),
    ).toBeInTheDocument()
    expect(within(calendar).getByRole('button', { name: '上一年' })).toBeInTheDocument()
    expect(within(calendar).getByRole('button', { name: '下一年' })).toBeInTheDocument()
    expect(within(calendar).queryByLabelText('日历日期')).not.toBeInTheDocument()

    fireEvent.click(within(calendar).getByRole('button', { name: '下一年' }))

    expect(
      within(calendar).getByRole('button', {
        name: '返回日期选择，当前2027年',
      }),
    ).toBeInTheDocument()
    expect(calendar.querySelector('.time-calendar-grid-motion')).toHaveClass(
      'time-range-grid-motion--next',
    )

    fireEvent.click(within(calendar).getByRole('button', { name: '5月' }))

    expect(
      within(calendar).getByRole('button', {
        name: '切换到月份选择，当前2027年5月',
      }),
    ).toBeInTheDocument()
    expect(within(calendar).getByLabelText('日历日期')).toBeInTheDocument()
    expect(within(calendar).queryByLabelText('月份选择')).not.toBeInTheDocument()
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'day',
        start: '2027-05-20',
        anchorDate: '2027-05-20',
      }),
    )
  })

  it('lets the week picker title switch into month selection by year', () => {
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
    expect(within(picker).getByRole('button', { name: '上一年' })).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: '下一年' })).toBeInTheDocument()
    expect(within(picker).queryByText('第25周')).not.toBeInTheDocument()

    fireEvent.click(within(picker).getByRole('button', { name: '5月' }))

    expect(
      within(picker).getByRole('button', {
        name: '切换到月份选择，当前2026年5月',
      }),
    ).toBeInTheDocument()
    expect(within(picker).queryByLabelText('月份选择')).not.toBeInTheDocument()
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'week',
        start: '2026-05-18',
        end: '2026-05-24',
        anchorDate: '2026-05-20',
      }),
    )
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
    expect(within(timeCardSummary).getByText('6 笔')).toBeInTheDocument()
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
