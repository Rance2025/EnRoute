import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyAccountingDataset, realisticAccountingDataset } from '../../accounting/realDataFixtures'
import { defaultAccountingStatisticsControls } from '../../accounting/shell'
import { AccountingPage } from '../AccountingPage'


afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AccountingPage real data integration', () => {
  it('loads the API dataset instead of production demo data', async () => {
    const fetcher = vi.fn(async () => jsonResponse(emptyAccountingDataset))
    vi.stubGlobal('fetch', fetcher)

    renderAccountingPage()

    expect(screen.getByText('正在载入记账数据')).toBeInTheDocument()
    expect(await screen.findByText('当前数据库还没有记账数据')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/accounting/dataset', { signal: expect.any(AbortSignal) })
  })

  it('shows a retry action when loading fails', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ detail: '记账数据库不可用' }, 503))
    vi.stubGlobal('fetch', fetcher)

    renderAccountingPage()

    await waitFor(() => expect(screen.getByText('记账数据库不可用')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '重新载入' })).toBeInTheDocument()
  })

  it('persists an edited transaction before closing the dialog', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.method) return jsonResponse(realisticAccountingDataset)
      const body = JSON.parse(String(init.body))
      return jsonResponse({
        ...realisticAccountingDataset.transactions[0],
        ...body,
        updatedAt: '2026-07-15T01:00:00Z',
      })
    })
    vi.stubGlobal('fetch', fetcher)
    renderAccountingPage()
    await screen.findByRole('button', { name: '查看流水 午餐' })

    fireEvent.click(screen.getByRole('button', { name: '查看流水 午餐' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑流水' }))
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '20.80' } })
    fireEvent.click(screen.getByRole('button', { name: '保存流水' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      '/api/accounting/transactions/transaction-import-1',
      expect.objectContaining({ method: 'PUT' }),
    ))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getAllByText('-¥20.80').length).toBeGreaterThan(0)
  })

  it('keeps the edit dialog and input when persistence fails', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => (
      init?.method
        ? jsonResponse({ detail: '数据库写入失败' }, 500)
        : jsonResponse(realisticAccountingDataset)
    ))
    vi.stubGlobal('fetch', fetcher)
    renderAccountingPage()
    await screen.findByRole('button', { name: '查看流水 午餐' })

    fireEvent.click(screen.getByRole('button', { name: '查看流水 午餐' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑流水' }))
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '20.80' } })
    fireEvent.click(screen.getByRole('button', { name: '保存流水' }))

    expect(await screen.findByText('数据库写入失败')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('金额')).toHaveValue('20.80')
  })

  it('requests the latest imported month once when the untouched current month is empty', async () => {
    const fetcher = vi.fn(async () => jsonResponse(realisticAccountingDataset))
    const onRequestTimeRangeChange = vi.fn()
    vi.stubGlobal('fetch', fetcher)

    renderAccountingPage({
      timeRange: {
        mode: 'month',
        start: '2026-07-01',
        end: '2026-07-31',
        anchorDate: '2026-07-15',
      },
      onRequestTimeRangeChange,
    })

    await waitFor(() => expect(onRequestTimeRangeChange).toHaveBeenCalledTimes(1))
    expect(onRequestTimeRangeChange).toHaveBeenCalledWith({
      mode: 'month',
      start: '2026-06-01',
      end: '2026-06-30',
      anchorDate: '2026-06-18',
      label: '最新账单月份',
    })
  })
})

function renderAccountingPage(overrides: Partial<React.ComponentProps<typeof AccountingPage>> = {}) {
  return render(
    <AccountingPage
      section="ledger"
      timeRange={{
        mode: 'custom',
        start: '2026-06-01',
        end: '2026-06-30',
        anchorDate: '2026-06-18',
      }}
      statisticsControls={defaultAccountingStatisticsControls}
      shellCommand={null}
      onShellCommandHandled={vi.fn()}
      onShellSnapshotChange={vi.fn()}
      {...overrides}
    />,
  )
}

function jsonResponse(payload: unknown, status = 200) {
  const response = new Response(null, { status })
  response.json = async () => payload
  return response
}
