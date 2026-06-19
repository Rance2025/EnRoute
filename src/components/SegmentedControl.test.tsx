import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

afterEach(() => {
  cleanup()
})

const pageOptions = [
  { value: 'overview', label: '概览', disabled: true },
  { value: 'map', label: '地图' },
  { value: 'schedule', label: '日程', disabled: true },
  { value: 'accounting', label: '记账' },
] satisfies Array<SegmentedOption<'overview' | 'map' | 'schedule' | 'accounting'>>

function DemoSegmentedControl() {
  const [value, setValue] = useState<'overview' | 'map' | 'schedule' | 'accounting'>('map')

  return (
    <SegmentedControl
      ariaLabel="页面"
      options={pageOptions}
      value={value}
      onChange={setValue}
    />
  )
}

function mockControlRect() {
  const control = screen.getByRole('group', { name: '页面' })

  vi.spyOn(control, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 400,
    bottom: 44,
    width: 400,
    height: 44,
    toJSON: () => ({}),
  } as DOMRect)
}

describe('SegmentedControl', () => {
  it('switches with button clicks while exposing one draggable slider', () => {
    render(<DemoSegmentedControl />)

    expect(screen.getByRole('slider', { name: '页面滑块' })).toHaveAttribute(
      'aria-valuetext',
      '地图',
    )

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    expect(screen.getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('slider', { name: '页面滑块' })).toHaveAttribute(
      'aria-valuetext',
      '记账',
    )
  })

  it('drags the slider to the segment under the pointer', () => {
    render(<DemoSegmentedControl />)
    mockControlRect()

    const slider = screen.getByRole('slider', { name: '页面滑块' })

    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 360, pointerId: 1 })
    fireEvent.pointerUp(slider, { clientX: 360, pointerId: 1 })

    expect(screen.getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('uses arrow keys to move across enabled segments', () => {
    render(<DemoSegmentedControl />)

    const slider = screen.getByRole('slider', { name: '页面滑块' })

    fireEvent.keyDown(slider, { key: 'ArrowRight' })

    expect(screen.getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.keyDown(slider, { key: 'ArrowLeft' })

    expect(screen.getByRole('button', { name: '地图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
