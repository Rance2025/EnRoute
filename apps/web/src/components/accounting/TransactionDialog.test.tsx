import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ledgerAtlasDataset } from '../../accounting/ledgerAtlasData'
import type { TransactionDraft } from '../../accounting/transactionDraft'
import { TransactionDialog, type TransactionDialogMode } from './TransactionDialog'

afterEach(cleanup)

describe('TransactionDialog', () => {
  it('shows complete detail paths and switches to edit mode', () => {
    const onModeChange = vi.fn()
    renderDialog({ kind: 'detail', transactionId: 'tx-yogurt' }, { onModeChange })

    const dialog = screen.getByRole('dialog', { name: '流水详情' })
    expect(within(dialog).getByText('餐饮 / 饮品')).toBeInTheDocument()
    expect(within(dialog).getByText('主题 / 日常节律')).toBeInTheDocument()
    expect(within(dialog).getByText('本地原型 · 本次会话有效')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '编辑流水' }))
    expect(onModeChange).toHaveBeenCalledWith({ kind: 'edit', transactionId: 'tx-yogurt' })
  })

  it('creates an income draft with account category tags time and note', () => {
    const onSave = vi.fn()
    renderDialog({ kind: 'create' }, { onSave })
    const dialog = screen.getByRole('dialog', { name: '新增流水' })

    fireEvent.click(within(dialog).getByRole('button', { name: '收入' }))
    fireEvent.change(within(dialog).getByLabelText('金额'), { target: { value: '88.50' } })
    fireEvent.change(within(dialog).getByLabelText('账户'), { target: { value: 'fund-bank' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '选择分类 工作收入' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '选择标签 人生阶段 / 大学' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '选择标签 地点旅行 / 青岛之行' }))
    fireEvent.change(within(dialog).getByLabelText('备注'), { target: { value: '临时收入' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存流水' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'income',
      amount: '88.50',
      accountId: 'fund-bank',
      categoryId: 'income-work',
      tagIds: ['college', 'qingdao-trip'],
      note: '临时收入',
    }))
  })

  it('retains values and shows field errors for an invalid transfer', () => {
    const onSave = vi.fn()
    renderDialog({ kind: 'create' }, { onSave })
    const dialog = screen.getByRole('dialog', { name: '新增流水' })

    fireEvent.click(within(dialog).getByRole('button', { name: '转账' }))
    fireEvent.change(within(dialog).getByLabelText('金额'), { target: { value: '20.00' } })
    fireEvent.change(within(dialog).getByLabelText('转出账户'), { target: { value: 'fund-wechat' } })
    fireEvent.change(within(dialog).getByLabelText('转入账户'), { target: { value: 'fund-wechat' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存流水' }))

    expect(within(dialog).getByText('转入账户不能与转出账户相同')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('金额')).toHaveValue('20.00')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('closes on Escape and restores focus to the trigger', () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const { unmount } = renderDialog({ kind: 'create' }, { onClose, returnFocusTo: trigger })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})

function renderDialog(
  mode: TransactionDialogMode,
  overrides: {
    onModeChange?: (mode: TransactionDialogMode) => void
    onSave?: (draft: TransactionDraft) => void
    onClose?: () => void
    returnFocusTo?: HTMLElement
  } = {},
) {
  return render(
    <TransactionDialog
      dataset={ledgerAtlasDataset}
      mode={mode}
      onModeChange={overrides.onModeChange ?? (() => undefined)}
      onSave={overrides.onSave ?? (() => undefined)}
      onClose={overrides.onClose ?? (() => undefined)}
      returnFocusTo={overrides.returnFocusTo}
    />,
  )
}
