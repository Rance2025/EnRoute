import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaxonomyInsightNode } from '../../accounting/insightSelectors'
import { TaxonomyTreePanel } from './TaxonomyTreePanel'

afterEach(cleanup)

const nodes: TaxonomyInsightNode[] = [
  {
    id: 'food', name: '餐饮', path: '餐饮', depth: 0,
    direct: { incomeInCents: 0, expenseInCents: 10_000, transferInCents: 0, netInCents: -10_000, transactionCount: 1 },
    aggregate: { incomeInCents: 0, expenseInCents: 35_000, transferInCents: 0, netInCents: -35_000, transactionCount: 3 },
  },
  {
    id: 'dinner', name: '正餐', path: '餐饮 / 正餐', parentId: 'food', depth: 1,
    direct: { incomeInCents: 0, expenseInCents: 25_000, transferInCents: 0, netInCents: -25_000, transactionCount: 2 },
    aggregate: { incomeInCents: 0, expenseInCents: 25_000, transferInCents: 0, netInCents: -25_000, transactionCount: 2 },
  },
]

describe('TaxonomyTreePanel', () => {
  it('defaults categories to a treemap and offers columns and tree table locally', () => {
    const onSelectNode = vi.fn()
    render(<TaxonomyTreePanel taxonomy="category" nodes={nodes} measure="amount" onSelectNode={onSelectNode} />)

    expect(screen.getByRole('img', { name: '分类矩形树图' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '层级柱图' }))
    expect(screen.getByRole('img', { name: '分类层级柱图' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '树表' }))
    expect(screen.getByRole('table', { name: '分类树金额表' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /餐饮 \/ 正餐/ }))
    expect(onSelectNode).toHaveBeenCalledWith(nodes[1])
  })

  it('keeps tags as a full tree amount table and warns against horizontal addition', () => {
    render(<TaxonomyTreePanel taxonomy="tag" nodes={nodes} measure="amount" onSelectNode={() => undefined} />)

    expect(screen.queryByRole('button', { name: '矩形树图' })).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: '标签树金额表' })).toBeInTheDocument()
    expect(screen.getByText('标签可能重叠，不可横向相加')).toBeInTheDocument()
    expect(screen.getByText('直接金额')).toBeInTheDocument()
    expect(screen.getByText('后代聚合')).toBeInTheDocument()
    expect(screen.getByText('净额')).toBeInTheDocument()
    expect(screen.getByText('收入')).toBeInTheDocument()
    expect(screen.getByText('支出')).toBeInTheDocument()
    expect(screen.getByText('笔数')).toBeInTheDocument()
  })
})
