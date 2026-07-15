import { afterEach, describe, expect, it, vi } from 'vitest'

import { realisticAccountingDataset } from './realDataFixtures'
import {
  createAccountingTransaction,
  loadAccountingDataset,
  updateAccountingAccount,
  updateAccountingTransaction,
} from './accountingDataSource'


afterEach(() => {
  vi.restoreAllMocks()
})

describe('accountingDataSource', () => {
  it('loads the production dataset from the accounting API', async () => {
    const fetcher = vi.fn(async () => jsonResponse(realisticAccountingDataset))

    await expect(loadAccountingDataset({ fetcher })).resolves.toEqual(realisticAccountingDataset)

    expect(fetcher).toHaveBeenCalledWith('/api/accounting/dataset', {
      signal: undefined,
    })
  })

  it('reports the FastAPI detail for a failed request', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ detail: '数据库写入失败' }, 500))

    await expect(loadAccountingDataset({ fetcher })).rejects.toThrow('数据库写入失败')
  })

  it('posts, puts and patches persistence payloads', async () => {
    const transaction = realisticAccountingDataset.transactions[0]
    const account = realisticAccountingDataset.accounts[0]
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return jsonResponse(init?.method === 'PATCH' ? { ...account, ...body } : { ...transaction, ...body })
    }) as unknown as typeof fetch

    await createAccountingTransaction(transaction, { fetcher })
    await updateAccountingTransaction(transaction.id, transaction, { fetcher })
    await updateAccountingAccount(account.id, { openingBalanceInCents: 88800 }, { fetcher })

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/accounting/transactions', expect.objectContaining({ method: 'POST' }))
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/accounting/transactions/${transaction.id}`, expect.objectContaining({ method: 'PUT' }))
    expect(fetcher).toHaveBeenNthCalledWith(3, `/api/accounting/accounts/${account.id}`, expect.objectContaining({ method: 'PATCH' }))
  })
})

function jsonResponse(payload: unknown, status = 200) {
  const response = new Response(null, { status })
  response.json = async () => payload
  return response
}

