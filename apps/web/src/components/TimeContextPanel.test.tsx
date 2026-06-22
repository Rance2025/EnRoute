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
    expect(screen.getByLabelText('本月足迹趋势')).toBeInTheDocument()
    expect(screen.getByText('本月足迹趋势')).toBeInTheDocument()
    expect(screen.getByText('48,260 km')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))

    const editor = screen.getByRole('region', { name: '时间编辑器' })

    expect(editor).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: '应用时间' })).toBeInTheDocument()
    expect(screen.queryByLabelText('本月足迹趋势')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回到本月' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
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

  it('keeps the mode switch visible while the time selector stays collapsed', () => {
    render(
      <TimeContextPanel
        view="map"
        selection={selectDay('2026-06-15')}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '修改时间' })).toHaveAttribute(
      'aria-expanded',
      'false',
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
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('时间选择页')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('自定义时间范围')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))

    expect(screen.getByRole('button', { name: '回到今天' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('日历选择')).toBeInTheDocument()
  })

  it('resets to today and closes the time selector from the open editor state', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-15')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
    fireEvent.click(screen.getByRole('button', { name: '回到今天' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'day',
        start: '2026-06-20',
        end: '2026-06-20',
        anchorDate: '2026-06-20',
      }),
    )
    expect(screen.getByRole('button', { name: '修改时间' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
  })

  it('switches time modes to the current range defaults while the editor stays open', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-15')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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

  it('closes the time selector after the user picks a concrete day', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectDay('2026-06-20')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
    fireEvent.click(within(screen.getByLabelText('日历日期')).getByRole('button', { name: '15' }))

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'day',
        start: '2026-06-15',
        end: '2026-06-15',
        anchorDate: '2026-06-15',
      }),
    )
    expect(screen.getByRole('button', { name: '修改时间' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
  })

  it('keeps the custom range editor open while editing date boundaries', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={setCustomDateRange('2026-06-10', '2026-06-12')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))

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

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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
    expect(screen.getByRole('button', { name: '修改时间' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
  })

  it('lets the week picker title pick a month and return to week mode', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectWeek('2026-06-20')}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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
    expect(screen.getByRole('button', { name: '修改时间' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('时间选择页')).not.toBeInTheDocument()
  })

  it('lets the month picker title pick a year and return to month mode', () => {
    const onSelectionChange = vi.fn()

    render(
      <StatefulMapTimeContextPanel
        initialSelection={selectMonth(2026, 6)}
        onSelectionChange={onSelectionChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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
    expect(screen.getByRole('button', { name: '修改时间' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('时间选择页')).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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

    fireEvent.click(screen.getByRole('button', { name: '修改时间' }))
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
