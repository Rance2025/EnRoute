import { Archive, EyeOff, Pencil, WalletCards, X } from 'lucide-react'
import { useState } from 'react'

import { parseCnyToCents } from '../../accounting/money'
import type { AccountingShellAction } from '../../accounting/shell'
import type { Account } from '../../accounting/types'
import { formatCurrency } from './formatting'

export function AccountManagementDialog({
  action,
  account,
  onSave,
  onClose,
}: {
  action: AccountingShellAction
  account: Account
  onSave: (account: Account) => void | Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(account)
  const [openingBalance, setOpeningBalance] = useState(
    (Math.abs(account.openingBalanceInCents) / 100).toFixed(2),
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async (next: Account, timestamp = new Date().toISOString()) => {
    setSaving(true)
    setError('')
    try {
      await onSave({ ...next, updatedAt: timestamp })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法保存账户')
    } finally {
      setSaving(false)
    }
  }
  const title = getActionTitle(action)

  return (
    <div className="accounting-modal-backdrop">
      <section className="accounting-modal-card account-management-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="accounting-modal-head">
          <div><span>账户管理</span><strong>{title}</strong></div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        {error ? <small className="account-management-dialog__error" role="alert">{error}</small> : null}
        {action === 'edit-account' ? (
          <div className="account-management-dialog__form">
            <label><span>账户名称</span><input aria-label="账户名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>账户性质</span><select aria-label="账户性质" value={draft.nature} onChange={(event) => setDraft({ ...draft, nature: event.target.value as Account['nature'] })}><option value="asset">资产</option><option value="liability">负债</option></select></label>
            <label><span>数据来源</span><input aria-label="数据来源" value={draft.sourceLabel ?? ''} onChange={(event) => setDraft({ ...draft, sourceLabel: event.target.value })} /></label>
            <button type="button" className="is-primary" aria-label="保存账户资料" onClick={() => save(draft)}><Pencil size={14} />保存账户资料</button>
          </div>
        ) : null}
        {action === 'adjust-opening-balance' ? (
          <div className="account-management-dialog__form">
            <p>当前期初 {formatCurrency(account.openingBalanceInCents)}</p>
            <label><span>{account.nature === 'liability' ? '期初欠款' : '期初余额'}</span><input aria-label="期初余额" inputMode="decimal" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
            <button type="button" className="is-primary" disabled={saving} onClick={() => {
              try {
                const cents = parseCnyToCents(openingBalance)
                if (cents < 0) throw new Error('期初金额不能小于零')
                save({ ...account, openingBalanceInCents: account.nature === 'liability' ? -cents : cents })
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : '请输入有效金额')
              }
            }}>保存期初余额</button>
          </div>
        ) : null}
        {action === 'set-account-brand' ? (
          <div className="account-management-dialog__form">
            <label><span>账户品牌</span><select aria-label="账户品牌" value={draft.brand?.slug ?? 'generic'} onChange={(event) => setDraft({ ...draft, brand: brandFromSlug(event.target.value) })}><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="meituan">美团</option><option value="bank">银行</option><option value="generic">通用</option></select></label>
            <button type="button" className="is-primary" onClick={() => save(draft)}><WalletCards size={14} />保存账户品牌</button>
          </div>
        ) : null}
        {action === 'toggle-account-hidden' ? (
          <div className="account-management-dialog__confirm">
            <EyeOff size={24} /><p>{account.hidden ? '恢复后账户会重新出现在常用列表。' : '隐藏仅影响默认展示，不会删除余额和流水。'}</p>
            <button type="button" className="is-primary" onClick={() => save({ ...account, hidden: !account.hidden })}>{account.hidden ? '取消隐藏账户' : '确认隐藏账户'}</button>
          </div>
        ) : null}
        {action === 'archive-account' ? (
          <div className="account-management-dialog__confirm account-management-dialog__confirm--danger">
            <Archive size={24} /><p>归档后默认不再参与账户轮替，但历史流水仍会保留。</p>
            <button type="button" className="is-danger" aria-label="确认归档账户" onClick={() => save({ ...account, archivedAt: new Date().toISOString() })}>确认归档账户</button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function getActionTitle(action: AccountingShellAction) {
  if (action === 'edit-account') return '编辑账户资料'
  if (action === 'adjust-opening-balance') return '调整期初余额'
  if (action === 'set-account-brand') return '设置账户品牌'
  if (action === 'toggle-account-hidden') return '隐藏账户'
  return '归档账户'
}

function brandFromSlug(slug: string) {
  const brands = {
    wechat: { slug: 'wechat', label: '微信', color: '#1f9f69' },
    alipay: { slug: 'alipay', label: '支付宝', color: '#2f7f83' },
    meituan: { slug: 'meituan', label: '美团', color: '#9a861f' },
    bank: { slug: 'bank', label: '银行', color: '#657d83' },
    generic: { slug: 'generic', label: '账户', color: '#708c87' },
  }
  return brands[slug as keyof typeof brands] ?? brands.generic
}
