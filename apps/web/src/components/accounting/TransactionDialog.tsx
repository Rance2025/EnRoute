import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import {
  changeDraftType,
  createTransactionDraft,
  createTransactionDraftFromTransaction,
  validateTransactionDraft,
  type TransactionDraft,
  type TransactionDraftErrors,
} from '../../accounting/transactionDraft'
import type { AccountingDataset, TransactionType } from '../../accounting/types'
import {
  formatMonthDay,
  getTransactionAccountLabel,
  getTransactionCategoryPath,
  getTransactionTagPaths,
} from './formatting'
import { CategoryTreePicker, TagTreePicker } from './TaxonomyPicker'

export type TransactionDialogMode =
  | { kind: 'detail'; transactionId: string }
  | { kind: 'create' }
  | { kind: 'edit'; transactionId: string }

const typeOptions: Array<{
  value: TransactionType
  label: string
  icon: typeof ArrowDownLeft
}> = [
  { value: 'expense', label: '支出', icon: ArrowUpRight },
  { value: 'income', label: '收入', icon: ArrowDownLeft },
  { value: 'transfer', label: '转账', icon: ArrowLeftRight },
]

export function TransactionDialog({
  dataset,
  mode,
  onModeChange,
  onSave,
  onClose,
  returnFocusTo,
}: {
  dataset: AccountingDataset
  mode: TransactionDialogMode
  onModeChange: (mode: TransactionDialogMode) => void
  onSave: (draft: TransactionDraft) => void
  onClose: () => void
  returnFocusTo?: HTMLElement | null
}) {
  const panelRef = useRef<HTMLElement>(null)
  const transaction = mode.kind === 'create'
    ? undefined
    : dataset.transactions.find((candidate) => candidate.id === mode.transactionId)
  const [draft, setDraft] = useState<TransactionDraft>(() => getInitialDraft(mode, transaction))
  const [errors, setErrors] = useState<TransactionDraftErrors>({})

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      returnFocusTo?.focus()
    }
  }, [onClose, returnFocusTo])

  if (mode.kind === 'detail' && transaction) {
    const categoryPath = getTransactionCategoryPath(dataset.categories, transaction)
    const tagPaths = getTransactionTagPaths(dataset.tags, transaction)
    return (
      <DialogShell title="流水详情" panelRef={panelRef} onClose={onClose}>
        <p className="accounting-prototype-note">本地原型 · 本次会话有效</p>
        <div className={`ios-amount-card ios-amount-card--${transaction.type}`}>
          <span>{formatMonthDay(transaction.occurredAt)}</span>
          <strong>{formatDisplayAmount(transaction.type, transaction.amountInCents)}</strong>
          <em>{getTransactionAccountLabel(dataset, transaction)}</em>
        </div>
        <dl className="transaction-detail-list">
          <Detail label="名称" value={transaction.note ?? categoryPath} />
          <Detail label="账户" value={getTransactionAccountLabel(dataset, transaction)} />
          <Detail label="分类" value={categoryPath} />
          <Detail label="标签" value={tagPaths.length > 0 ? tagPaths : ['无标签']} />
          <Detail label="发生时间" value={transaction.occurredAt} />
        </dl>
        <footer className="accounting-modal-actions">
          <button
            type="button"
            className="is-primary"
            aria-label="编辑流水"
            onClick={() => onModeChange({ kind: 'edit', transactionId: transaction.id })}
          >
            <Pencil size={15} aria-hidden="true" />
            编辑流水
          </button>
        </footer>
      </DialogShell>
    )
  }

  const title = mode.kind === 'edit' ? '编辑流水' : '新增流水'
  const submit = () => {
    const nextErrors = validateTransactionDraft(draft, dataset)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    onSave(draft)
  }

  return (
    <DialogShell title={title} panelRef={panelRef} onClose={onClose}>
      <p className="accounting-prototype-note">本地原型 · 本次会话有效</p>
      <div className="transaction-form">
        <fieldset>
          <legend>类型</legend>
          <div className="ios-form-chip-row" aria-label="流水类型">
            {typeOptions.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.value}
                  type="button"
                  className={draft.type === option.value ? 'is-active' : undefined}
                  aria-pressed={draft.type === option.value}
                  onClick={() => setDraft((current) => changeDraftType(current, option.value, dataset))}
                >
                  <Icon size={14} aria-hidden="true" />
                  {option.label}
                </button>
              )
            })}
          </div>
        </fieldset>
        <FormField label="金额" error={errors.amount}>
          <input
            aria-label="金额"
            inputMode="decimal"
            value={draft.amount}
            placeholder="0.00"
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
          />
        </FormField>
        {draft.type === 'transfer' ? (
          <div className="transaction-form__account-pair">
            <AccountSelect
              label="转出账户"
              value={draft.fromAccountId}
              error={errors.fromAccountId}
              dataset={dataset}
              onChange={(fromAccountId) => setDraft({ ...draft, fromAccountId })}
            />
            <AccountSelect
              label="转入账户"
              value={draft.toAccountId}
              error={errors.toAccountId}
              dataset={dataset}
              onChange={(toAccountId) => setDraft({ ...draft, toAccountId })}
            />
          </div>
        ) : (
          <AccountSelect
            label="账户"
            value={draft.accountId}
            error={errors.accountId}
            dataset={dataset}
            onChange={(accountId) => setDraft({ ...draft, accountId })}
          />
        )}
        <FormField label="发生时间" error={errors.occurredAt}>
          <input
            type="datetime-local"
            aria-label="发生时间"
            value={draft.occurredAt.slice(0, 16)}
            onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })}
          />
        </FormField>
        <div className="transaction-form__taxonomy">
          <span>分类</span>
          <CategoryTreePicker
            categories={dataset.categories}
            type={draft.type}
            value={draft.categoryId}
            onChange={(categoryId) => setDraft({ ...draft, categoryId })}
          />
          {errors.categoryId ? <small role="alert">{errors.categoryId}</small> : null}
        </div>
        <div className="transaction-form__taxonomy">
          <span>标签</span>
          <TagTreePicker
            tags={dataset.tags}
            values={draft.tagIds}
            onChange={(tagIds) => setDraft({ ...draft, tagIds })}
          />
          {errors.tagIds ? <small role="alert">{errors.tagIds}</small> : null}
        </div>
        <FormField label="备注">
          <textarea
            aria-label="备注"
            value={draft.note}
            placeholder="写下这笔钱发生了什么"
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </FormField>
      </div>
      <footer className="accounting-modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" className="is-primary" aria-label="保存流水" onClick={submit}>
          保存流水
        </button>
      </footer>
    </DialogShell>
  )
}

function DialogShell({
  title,
  panelRef,
  onClose,
  children,
}: {
  title: string
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
}) {
  const titleId = `transaction-dialog-${title === '流水详情' ? 'detail' : title === '编辑流水' ? 'edit' : 'create'}`
  return (
    <div className="accounting-modal-backdrop">
      <section
        ref={panelRef}
        className="accounting-modal-card transaction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="accounting-modal-head">
          <div>
            <span>记账工作台</span>
            <strong id={titleId}>{title}</strong>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function FormField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="transaction-form__field">
      <span>{label}</span>
      {children}
      {error ? <small role="alert">{error}</small> : null}
    </label>
  )
}

function AccountSelect({
  label,
  value,
  error,
  dataset,
  onChange,
}: {
  label: string
  value: string
  error?: string
  dataset: AccountingDataset
  onChange: (value: string) => void
}) {
  return (
    <FormField label={label} error={error}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {dataset.accounts.filter((account) => !account.archivedAt).map((account) => (
          <option key={account.id} value={account.id}>{account.name}</option>
        ))}
      </select>
    </FormField>
  )
}

function Detail({ label, value }: { label: string; value: string | string[] }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{Array.isArray(value) ? value.map((item) => <span key={item}>{item}</span>) : value}</dd>
    </div>
  )
}

function getInitialDraft(
  mode: TransactionDialogMode,
  transaction: AccountingDataset['transactions'][number] | undefined,
) {
  if (mode.kind !== 'create' && transaction) {
    return createTransactionDraftFromTransaction(transaction)
  }
  return createTransactionDraft(new Date().toISOString())
}

function formatDisplayAmount(type: TransactionType, amountInCents: number) {
  const sign = type === 'income' ? '+' : type === 'expense' ? '-' : ''
  return `${sign}¥${(amountInCents / 100).toFixed(2)}`
}
