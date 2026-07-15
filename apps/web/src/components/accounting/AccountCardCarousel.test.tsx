import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ledgerAtlasDataset } from '../../accounting/ledgerAtlasData'
import { getAccountPeriodSummaries } from '../../accounting/selectors'
import type { TimeRangeSelection } from '../../time/timeRange'
import { AccountCardCarousel } from './AccountCardCarousel'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const range: TimeRangeSelection = {
  mode: 'month',
  start: '2026-06-01',
  end: '2026-06-30',
  anchorDate: '2026-06-01',
}
const summaries = getAccountPeriodSummaries(ledgerAtlasDataset, range)

describe('AccountCardCarousel', () => {
  it('renders only a front card and two back cards with position count', () => {
    render(<CarouselHarness />)

    expect(screen.getAllByRole('button', { name: /选择账户/ })).toHaveLength(3)
    expect(screen.getByText(`1 / ${summaries.length}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `选择账户 ${summaries[0].account.name}` })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses a wheel threshold and animation lock so one gesture advances one card', () => {
    vi.useFakeTimers()
    render(<CarouselHarness />)
    const carousel = screen.getByLabelText('账户卡片轮替')

    fireEvent.wheel(carousel, { deltaY: 10 })
    expect(screen.getByText(`1 / ${summaries.length}`)).toBeInTheDocument()
    fireEvent.wheel(carousel, { deltaY: 20 })
    expect(screen.getByText(`2 / ${summaries.length}`)).toBeInTheDocument()
    fireEvent.wheel(carousel, { deltaY: 80 })
    expect(screen.getByText(`2 / ${summaries.length}`)).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(260))
    fireEvent.wheel(carousel, { deltaY: 80 })
    expect(screen.getByText(`3 / ${summaries.length}`)).toBeInTheDocument()
  })

  it('supports clicking back cards, arrow keys, and looping', () => {
    render(<CarouselHarness initialId={summaries.at(-1)!.account.id} />)
    const carousel = screen.getByLabelText('账户卡片轮替')

    fireEvent.keyDown(carousel, { key: 'ArrowRight' })
    expect(screen.getByText(`1 / ${summaries.length}`)).toBeInTheDocument()

    const second = summaries[1].account
    fireEvent.click(screen.getByRole('button', { name: `选择账户 ${second.name}` }))
    expect(screen.getByText(`2 / ${summaries.length}`)).toBeInTheDocument()
  })

  it('disables movement for a single account', () => {
    const onSelect = vi.fn()
    render(
      <AccountCardCarousel
        summaries={[summaries[0]]}
        selectedAccountId={summaries[0].account.id}
        onSelectAccount={onSelect}
      />,
    )
    const carousel = screen.getByLabelText('账户卡片轮替')
    fireEvent.wheel(carousel, { deltaY: 100 })
    fireEvent.keyDown(carousel, { key: 'ArrowRight' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /选择账户/ })).toHaveLength(1)
  })
})

function CarouselHarness({ initialId = summaries[0].account.id }: { initialId?: string }) {
  const [selectedAccountId, setSelectedAccountId] = useState(initialId)
  return (
    <AccountCardCarousel
      summaries={summaries}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
    />
  )
}
