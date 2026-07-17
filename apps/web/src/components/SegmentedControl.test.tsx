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

function VerticalDemoSegmentedControl() {
  const [value, setValue] = useState<'overview' | 'map' | 'schedule' | 'accounting'>('map')

  return (
    <SegmentedControl
      ariaLabel="Vertical pages"
      options={pageOptions}
      orientation="vertical"
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

  it('keeps the visible segment label in the fixed button cell', () => {
    render(<DemoSegmentedControl />)

    const slider = screen.getByRole('slider')
    const selectedButton = screen.getByRole('button', { pressed: true })

    expect(slider.querySelector('.segmented-control__thumb-label')).toBeNull()
    expect(slider.querySelector('.segmented-control__active-labels')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(selectedButton.querySelectorAll('.segmented-control__label')).toHaveLength(1)
    expect(selectedButton).toHaveAttribute('data-segment-label', selectedButton.textContent)
  })

  it('uses one slider-clipped active label layer instead of per-button color clips', () => {
    render(<DemoSegmentedControl />)

    const control = screen.getByRole('group', { name: '页面' })
    const activeLabels = control.querySelector('.segmented-control__active-labels')
    const buttons = screen.getAllByRole('button')

    expect(activeLabels).toHaveAttribute('aria-hidden', 'true')
    expect(
      [...activeLabels?.querySelectorAll('.segmented-control__active-label') ?? []].map(
        (label) => label.textContent,
      ),
    ).toEqual(pageOptions.map((option) => option.label))

    for (const button of buttons) {
      expect(button.style.getPropertyValue('--segmented-active-start')).toBe('')
      expect(button.style.getPropertyValue('--segmented-active-end')).toBe('')
    }
  })

  it('previews a middle slider position while dragging and snaps on release', () => {
    render(<DemoSegmentedControl />)
    mockControlRect()

    const control = screen.getByRole('group', { name: '页面' })
    const slider = screen.getByRole('slider', { name: '页面滑块' })

    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 })

    expect(screen.getByRole('button', { name: '地图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 })

    expect(control.style.getPropertyValue('--segment-thumb-index')).toBe('2.5')
    expect(screen.getByRole('button', { name: '地图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.pointerUp(slider, { clientX: 300, pointerId: 1 })

    expect(screen.getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(control.style.getPropertyValue('--segment-thumb-index')).toBe('')
    expect(control).not.toHaveClass('is-dragging')
  })

  it('ends a drag when the pointer is released over a segment button', () => {
    render(<DemoSegmentedControl />)
    mockControlRect()

    const control = screen.getByRole('group', { name: '页面' })
    const slider = screen.getByRole('slider', { name: '页面滑块' })
    const targetButton = screen.getByRole('button', { name: '记账' })
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()

    Object.assign(control, {
      setPointerCapture,
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
    })

    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 })
    fireEvent.pointerMove(targetButton, { clientX: 300, pointerId: 1 })
    fireEvent.pointerUp(targetButton, { clientX: 300, pointerId: 1 })

    expect(setPointerCapture).toHaveBeenCalledWith(1)
    expect(releasePointerCapture).toHaveBeenCalledWith(1)
    expect(targetButton).toHaveAttribute('aria-pressed', 'true')
    expect(control.style.getPropertyValue('--segment-thumb-index')).toBe('')
    expect(control).not.toHaveClass('is-dragging')
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

  it('uses the vertical axis for a vertical segmented slider', () => {
    render(<VerticalDemoSegmentedControl />)

    const control = screen.getByRole('group', { name: 'Vertical pages' })
    const slider = screen.getByRole('slider', { name: 'Vertical pages滑块' })

    vi.spyOn(control, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 40,
      bottom: 160,
      width: 40,
      height: 160,
      toJSON: () => ({}),
    } as DOMRect)

    expect(control).toHaveClass('segmented-control--vertical')
    expect(slider).toHaveAttribute('aria-orientation', 'vertical')

    fireEvent.pointerDown(slider, { clientX: 20, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 20, clientY: 140, pointerId: 1 })
    fireEvent.pointerUp(slider, { clientX: 20, clientY: 140, pointerId: 1 })

    expect(screen.getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
