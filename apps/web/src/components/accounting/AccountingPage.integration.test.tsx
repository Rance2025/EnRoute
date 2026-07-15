import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyAccountingDataset } from '../../accounting/realDataFixtures'
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
})

function renderAccountingPage() {
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
    />,
  )
}

function jsonResponse(payload: unknown, status = 200) {
  const response = new Response(null, { status })
  response.json = async () => payload
  return response
}
