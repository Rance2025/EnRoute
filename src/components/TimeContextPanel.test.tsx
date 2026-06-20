import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { selectMonth } from '../time/timeRange'
import { TimeContextPanel } from './TimeContextPanel'

afterEach(() => {
  cleanup()
})

describe('TimeContextPanel', () => {
  it('derives accounting summary values inside the main time card for accounting', () => {
    render(
      <TimeContextPanel
        view="accounting"
        selection={selectMonth(2026, 6)}
        onSelectionChange={vi.fn()}
      />,
    )

    const timeCardSummary = screen.getByLabelText('记账概览卡片')

    expect(within(timeCardSummary).getByText('净流入')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('+¥4691.23')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('支出')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥481.18')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('流水')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('6 笔')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('账户')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('4 个')).toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('¥420')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前范围摘要')).not.toBeInTheDocument()
  })
})
