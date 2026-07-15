import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getAccountBalanceSteps,
  getTopCategoryComposition,
  getTopDirectTagAmounts,
} from '../../accounting/insightSelectors'
import { ledgerAtlasDataset } from '../../accounting/ledgerAtlasData'
import { filterTransactionsByTimeRange, getAccountPeriodSummaries } from '../../accounting/selectors'
import type { Account } from '../../accounting/types'
import type { TimeRangeSelection } from '../../time/timeRange'
import { AccountManagementDialog } from './AccountManagementDialog'
import { AccountsWorkspace } from './AccountsWorkspace'

afterEach(cleanup)

const range: TimeRangeSelection = {
  mode: 'month',
  start: '2026-06-01',
  end: '2026-06-30',
  anchorDate: '2026-06-01',
}

describe('AccountsWorkspace', () => {
  it('renders a truthful empty state without attempting carousel math', () => {
    const { container } = render(
      <AccountsWorkspace
        dataset={{ ...ledgerAtlasDataset, accounts: [], transactions: [] }}
        summaries={[]}
        transactions={[]}
        selectedAccountId=""
        balanceSteps={[]}
        categoryComposition={{ income: { totalInCents: 0, segments: [] }, expense: { totalInCents: 0, segments: [] } }}
        topTags={[]}
        onSelectAccount={() => undefined}
        onSelectTransaction={() => undefined}
      />,
    )

    expect(screen.getByText('还没有可用账户')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.queryByLabelText('账户卡片轮替')).not.toBeInTheDocument()
  })

  it('updates transactions metrics and charts when the front card changes', () => {
    render(<WorkspaceHarness />)

    expect(screen.getByRole('heading', { name: '微信 - 日常' })).toBeInTheDocument()
    expect(screen.getByLabelText('账户余额阶梯图')).toHaveTextContent('期初¥8,600.50')
    expect(screen.getByLabelText('账户余额阶梯图')).toHaveTextContent('期末¥7,970.50')
    expect(screen.getByLabelText('账户流水列表')).toHaveTextContent('青岛住宿')

    fireEvent.click(screen.getByRole('button', { name: '选择账户 花呗' }))

    expect(screen.getByRole('heading', { name: '花呗' })).toBeInTheDocument()
    expect(screen.getByLabelText('账户余额阶梯图')).toHaveTextContent('期初¥5,840.00')
    expect(screen.getByLabelText('账户流水列表')).toHaveTextContent('地铁')
    expect(screen.getByLabelText('账户流水列表')).toHaveTextContent('还款示例')
  })

  it('keeps account management reversible and requires confirmation for archive', () => {
    const onSave = vi.fn()
    const account = ledgerAtlasDataset.accounts[0]
    const { rerender } = render(
      <AccountManagementDialog action="edit-account" account={account} onSave={onSave} onClose={() => undefined} />,
    )
    fireEvent.change(screen.getByLabelText('账户名称'), { target: { value: '微信钱包' } })
    fireEvent.click(screen.getByRole('button', { name: '保存账户资料' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: '微信钱包' }))

    rerender(
      <AccountManagementDialog action="archive-account" account={account} onSave={onSave} onClose={() => undefined} />,
    )
    expect(screen.getByText('归档后默认不再参与账户轮替，但历史流水仍会保留。')).toBeInTheDocument()
    expect(screen.queryByText('删除账户')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认归档账户' }))
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ archivedAt: expect.any(String) }))
  })
})

function WorkspaceHarness() {
  const [selectedAccountId, setSelectedAccountId] = useState(ledgerAtlasDataset.accounts[0].id)
  const transactions = useMemo(
    () => filterTransactionsByTimeRange(ledgerAtlasDataset.transactions, range),
    [],
  )
  const summaries = useMemo(() => getAccountPeriodSummaries(ledgerAtlasDataset, range), [])
  const selectedTransactions = transactions.filter((transaction) => belongsToAccount(transaction, selectedAccountId))
  return (
    <AccountsWorkspace
      dataset={ledgerAtlasDataset}
      summaries={summaries}
      transactions={selectedTransactions}
      selectedAccountId={selectedAccountId}
      balanceSteps={getAccountBalanceSteps(ledgerAtlasDataset, range, selectedAccountId)}
      categoryComposition={getTopCategoryComposition(ledgerAtlasDataset, selectedTransactions)}
      topTags={getTopDirectTagAmounts(ledgerAtlasDataset, selectedTransactions, 5)}
      onSelectAccount={setSelectedAccountId}
      onSelectTransaction={() => undefined}
    />
  )
}

function belongsToAccount(
  transaction: (typeof ledgerAtlasDataset.transactions)[number],
  accountId: Account['id'],
) {
  return transaction.type === 'transfer'
    ? transaction.fromAccountId === accountId || transaction.toAccountId === accountId
    : transaction.accountId === accountId
}
