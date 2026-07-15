import { describe, expect, it } from 'vitest'

import { ledgerAtlasDataset } from './ledgerAtlasData'
import {
  changeDraftType,
  createTransactionDraft,
  createTransactionDraftFromTransaction,
  saveTransactionDraft,
  validateTransactionDraft,
} from './transactionDraft'

const now = '2026-07-14T10:30:00+08:00'

describe('transaction drafts', () => {
  it('creates an empty expense draft for the supplied time', () => {
    expect(createTransactionDraft(now)).toEqual({
      type: 'expense',
      amount: '',
      accountId: '',
      fromAccountId: '',
      toAccountId: '',
      occurredAt: now,
      categoryId: '',
      tagIds: [],
      note: '',
    })
  })

  it('reports field-level errors without discarding draft values', () => {
    const draft = {
      ...createTransactionDraft(now),
      type: 'transfer' as const,
      amount: '0',
      fromAccountId: '',
      toAccountId: '',
    }

    expect(validateTransactionDraft(draft, ledgerAtlasDataset)).toEqual({
      amount: '金额必须大于 0',
      fromAccountId: '请选择转出账户',
      toAccountId: '请选择转入账户',
    })
    expect(draft.amount).toBe('0')
  })

  it('rejects identical transfer accounts and incompatible categories', () => {
    expect(validateTransactionDraft({
      ...createTransactionDraft(now),
      type: 'transfer',
      amount: '20.00',
      fromAccountId: 'fund-wechat',
      toAccountId: 'fund-wechat',
      categoryId: 'expense-food',
    }, ledgerAtlasDataset)).toMatchObject({
      toAccountId: '转入账户不能与转出账户相同',
      categoryId: '所选分类与流水类型不匹配',
    })
  })

  it('clears a category when the transaction type makes it incompatible', () => {
    const next = changeDraftType({
      ...createTransactionDraft(now),
      categoryId: 'expense-food',
    }, 'income', ledgerAtlasDataset)

    expect(next).toMatchObject({ type: 'income', categoryId: '' })
  })

  it('creates an editable draft that retains transaction identity metadata', () => {
    const transaction = ledgerAtlasDataset.transactions.find((item) => item.id === 'tx-yogurt')!

    expect(createTransactionDraftFromTransaction(transaction)).toMatchObject({
      transactionId: 'tx-yogurt',
      createdAt: transaction.createdAt,
      type: 'expense',
      amount: '45.78',
      accountId: 'fund-meituan',
      categoryId: 'expense-drink',
    })
  })

  it('creates and edits immutable session transaction arrays', () => {
    const original = ledgerAtlasDataset.transactions
    const created = saveTransactionDraft(original, {
      ...createTransactionDraft(now),
      type: 'income',
      amount: '88.50',
      accountId: 'fund-bank',
      categoryId: 'income-work',
      tagIds: ['college'],
      note: '临时收入',
    }, now)

    expect(created).not.toBe(original)
    expect(original.some((transaction) => transaction.note === '临时收入')).toBe(false)
    expect(created.at(-1)).toMatchObject({
      type: 'income',
      amountInCents: 8_850,
      createdAt: now,
      updatedAt: now,
    })

    const editable = createTransactionDraftFromTransaction(created.at(-1)!)
    const edited = saveTransactionDraft(created, { ...editable, amount: '99.00' }, '2026-07-14T11:00:00+08:00')
    const updated = edited.find((transaction) => transaction.id === editable.transactionId)
    expect(updated).toMatchObject({
      amountInCents: 9_900,
      createdAt: now,
      updatedAt: '2026-07-14T11:00:00+08:00',
    })
  })
})
