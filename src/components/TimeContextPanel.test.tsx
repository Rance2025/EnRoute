import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { selectMonth } from '../time/timeRange'
import { TimeContextPanel } from './TimeContextPanel'

afterEach(() => {
  cleanup()
})

describe('TimeContextPanel', () => {
  it('derives accounting summary values from the selected time range', () => {
    render(
      <TimeContextPanel
        view="accounting"
        selection={selectMonth(2026, 6)}
        onSelectionChange={vi.fn()}
      />,
    )

    const summary = screen.getByLabelText('当前范围摘要')

    expect(within(summary).getByText('流水')).toBeInTheDocument()
    expect(within(summary).getByText('6')).toBeInTheDocument()
    expect(within(summary).getByText('¥481.18')).toBeInTheDocument()
    expect(within(summary).getByText('¥4691.23')).toBeInTheDocument()
    expect(within(summary).queryByText('¥420')).not.toBeInTheDocument()
  })
})
