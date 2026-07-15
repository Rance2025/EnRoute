import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AccountingShellSnapshot } from '../../accounting/shell'
import { AccountingRightContextPanel } from './AccountingRightContextPanel'

afterEach(cleanup)

const snapshot: AccountingShellSnapshot = {
  metricItems: [],
  context: {
    eyebrow: '当前账户',
    title: '招商银行',
    description: '账户流水、余额和分类洞察跟随前景卡片联动。',
    rows: [
      { label: '性质', value: '资产' },
      { label: '币种', value: 'CNY' },
    ],
    actions: [{ id: 'edit-account', label: '编辑账户资料' }],
  },
}

describe('AccountingRightContextPanel', () => {
  it('uses the same two-card glass hierarchy for every accounting context', () => {
    render(<AccountingRightContextPanel snapshot={snapshot} onAction={() => undefined} />)

    const panel = screen.getByLabelText('记账右侧上下文')
    expect(panel.children).toHaveLength(2)
    expect(within(panel).getByLabelText('当前分区摘要')).toHaveClass('right-context-panel__glass')
    expect(within(panel).getByLabelText('工作区状态')).toHaveClass('right-context-panel__glass')
    expect(within(panel).getByText('招商银行')).toBeInTheDocument()
    expect(within(panel).getByText('资产')).toBeInTheDocument()
  })

  it('forwards actions and keeps a stable loading placeholder without map copy', () => {
    const onAction = vi.fn()
    const { rerender } = render(<AccountingRightContextPanel snapshot={snapshot} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑账户资料' }))
    expect(onAction).toHaveBeenCalledWith('edit-account')

    rerender(<AccountingRightContextPanel snapshot={null} onAction={onAction} />)
    expect(screen.getByLabelText('记账右侧上下文')).toHaveTextContent('正在准备记账上下文')
    expect(screen.queryByText('图层与状态')).not.toBeInTheDocument()
  })
})
