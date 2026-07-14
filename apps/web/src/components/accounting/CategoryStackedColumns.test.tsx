import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { CategoryCompositionBar } from '../../accounting/insightSelectors'
import { CategoryStackedColumns } from './CategoryStackedColumns'

afterEach(cleanup)

const income: CategoryCompositionBar = {
  totalInCents: 10_000_00,
  segments: [{ id: 'salary', label: '工资', amountInCents: 10_000_00, share: 1 }],
}
const expense: CategoryCompositionBar = {
  totalInCents: 4_000_00,
  segments: [
    { id: 'food', label: '餐饮', amountInCents: 2_000_00, share: 0.5 },
    { id: 'travel', label: '旅行', amountInCents: 1_200_00, share: 0.3 },
    { id: 'other', label: '其他', amountInCents: 800_00, share: 0.2 },
  ],
}

describe('CategoryStackedColumns', () => {
  it('compares two stacked columns on one amount scale', () => {
    render(<CategoryStackedColumns income={income} expense={expense} />)

    const chart = screen.getByLabelText('收入与支出分类构成')
    expect(chart).toHaveAttribute('data-mode', 'amount')
    expect(within(chart).getByLabelText('收入分类柱')).toHaveAttribute('data-scale-maximum', '1000000')
    expect(within(chart).getByLabelText('支出分类柱')).toHaveAttribute('data-scale-maximum', '1000000')
    expect(within(chart).getByText('餐饮')).toBeInTheDocument()
    expect(within(chart).getByText('¥2,000.00 · 50%')).toBeInTheDocument()
  })

  it('switches locally to normalized composition without adding navigation', () => {
    render(<CategoryStackedColumns income={income} expense={expense} />)
    const chart = screen.getByLabelText('收入与支出分类构成')

    fireEvent.click(within(chart).getByRole('button', { name: '构成占比' }))
    expect(chart).toHaveAttribute('data-mode', 'composition')
    expect(within(chart).getByLabelText('收入分类柱')).toHaveAttribute('data-scale-maximum', '1')
    expect(within(chart).getByLabelText('支出分类柱')).toHaveAttribute('data-scale-maximum', '1')
  })
})
