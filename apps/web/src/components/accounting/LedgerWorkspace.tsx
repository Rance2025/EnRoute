import {
  Plus,
} from 'lucide-react'
import { LayoutGroup, motion } from 'framer-motion'
import { siAlipay, siMeituan, siTiktok, siWechat } from 'simple-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { formatCnyFromCents } from '../../accounting/money'
import meituanLogoRabbitWordmarkUrl from '../../assets/meituan-logo-rabbit-wordmark.png'
import type {
  Account,
  AccountPeriodSummary,
  AccountingDataset,
  Transaction,
} from '../../accounting/types'
import {
  formatMonthDay,
} from './formatting'
import { TransactionRow } from './TransactionRow'

const typeLabels = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
}

const ACCOUNT_CARD_LAYOUT_TRANSITION = {
  layout: {
    type: 'spring',
    stiffness: 430,
    damping: 38,
    mass: 0.9,
  },
  opacity: {
    duration: 0.18,
  },
} as const

type AccountCardBrand = 'wechat' | 'alipay' | 'meituan' | 'jd' | 'douyin' | 'bank' | 'generic'

type AccountCardBrandConfig = {
  title: string
  logoPath?: string
  logoImageSrc?: string
  logoViewBox?: string
  baseHex: string
}

const JD_WORDMARK_LOGO_PATH =
  'M2.8 5h6.3v9.4c0 3.7-2.2 5.5-6 5.5H1v-3.7h1.8c1.3 0 2-.6 2-1.9V8.6h-2V5Zm8.7 0h4.6c4.4 0 7.1 2.7 7.1 7s-2.7 7-7.1 7h-4.6V5Zm4.1 10.4h.4c1.8 0 2.9-1.2 2.9-3.4s-1.1-3.4-2.9-3.4h-.4v6.8Z'
const ALIPAY_WORDMARK_LOGO_PATH =
  'M5.781 9.63v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333 3.426 1.158 4.203 1.22 4.203 1.22v3.709s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781Zm.104 3.408c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809Z'
const MEITUAN_RABBIT_WORDMARK_LOGO_SRC = meituanLogoRabbitWordmarkUrl
const UNIONPAY_LOGO_PATH =
  'M4.2 6h4.9l-1.8 12H2.4c-.8 0-1.4-.7-1.3-1.5L2.5 7.2C2.6 6.5 3.3 6 4.2 6Zm6.2 0h4.9l-1.8 12H8.6L10.4 6Zm6.2 0h3.2c2 0 3.3 1.6 3 3.5l-1 6.3c-.2 1.3-1.3 2.2-2.6 2.2h-4.4L16.6 6Zm-11 3.4-.4 2.1h1.3c.6 0 1-.4 1.1-1l.2-1.1H5.6Zm5.9 0-.8 5.2h1.6l.8-5.2h-1.6Zm6.5 0-.8 5.2h1.2c.4 0 .8-.3.9-.8l.5-3.5c.1-.5-.2-.9-.8-.9h-1Z'
const GENERIC_CARD_LOGO_PATH =
  'M3 7.2C3 6 4 5 5.2 5h13.6C20 5 21 6 21 7.2v9.6c0 1.2-1 2.2-2.2 2.2H5.2C4 19 3 18 3 16.8V7.2Zm2.4 2.1v2h13.2v-2H5.4Zm0 5.2v1.6h5.2v-1.6H5.4Z'

type AccountCardBrandStyle = CSSProperties & Record<'--account-card-bg-start' | '--account-card-bg-mid' | '--account-card-bg-end', string>

const accountCardBrandConfigs: Record<AccountCardBrand, AccountCardBrandConfig> = {
  wechat: { title: siWechat.title, logoPath: siWechat.path, baseHex: `#${siWechat.hex}` },
  alipay: { title: siAlipay.title, logoPath: ALIPAY_WORDMARK_LOGO_PATH, baseHex: `#${siAlipay.hex}` },
  meituan: {
    title: 'Meituan Waimai',
    logoImageSrc: MEITUAN_RABBIT_WORDMARK_LOGO_SRC,
    logoViewBox: '0 0 1072 419',
    baseHex: `#${siMeituan.hex}`,
  },
  jd: { title: 'JD.com', logoPath: JD_WORDMARK_LOGO_PATH, baseHex: '#DA291C' },
  douyin: { title: siTiktok.title, logoPath: siTiktok.path, baseHex: `#${siTiktok.hex}` },
  bank: { title: 'UnionPay', logoPath: UNIONPAY_LOGO_PATH, baseHex: '#00447C' },
  generic: { title: 'Card', logoPath: GENERIC_CARD_LOGO_PATH, baseHex: '#123F35' },
}

type LedgerWorkspaceProps = {
  dataset: AccountingDataset
  transactions: Transaction[]
  onSelectTransaction: (transaction: Transaction) => void
  onCreateTransaction: () => void
}

export function LedgerWorkspace({
  dataset,
  transactions,
  onSelectTransaction,
  onCreateTransaction,
}: LedgerWorkspaceProps) {
  return (
    <div
      className="accounting-workspace ios-account-ledger-workspace"
      aria-label="账户与流水工作台"
    >
      <section className="glass-panel glass-panel--solid ios-panel ios-ledger-main">
        <header className="ios-ledger-toolbar">
          <div>
            <strong>流水明细</strong>
            <span>全部流水</span>
          </div>
          <div className="ios-ledger-toolbar__meta">
            <span>当前范围</span>
            <b>{transactions.length} 笔</b>
          </div>
          <div className="ios-ledger-toolbar__actions">
            <button type="button" onClick={onCreateTransaction}>
              <Plus size={15} strokeWidth={2.2} />
              新增流水
            </button>
          </div>
        </header>

        <div className="accounting-scroll--ledger" aria-label="流水列表">
          {transactions.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              dataset={dataset}
              transaction={transaction}
              onSelect={() => onSelectTransaction(transaction)}
            />
          ))}
          {transactions.length === 0 ? (
            <div className="ios-empty-ledger">当前时间范围内没有流水</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

type AccountsWorkspaceProps = {
  summaries: AccountPeriodSummary[]
  transactions: Transaction[]
  selectedAccountId: string
  onSelectAccount: (accountId: string) => void
}

export function AccountsWorkspace({
  summaries,
  transactions,
  selectedAccountId,
  onSelectAccount,
}: AccountsWorkspaceProps) {
  const accountStackRef = useRef<HTMLDivElement>(null)
  const [frontAccountId, setFrontAccountId] = useState<string | null>(null)
  const lastAccountStackWheelAtRef = useRef(0)
  const totalBalanceInCents = summaries.reduce(
    (total, summary) => total + summary.closingInCents,
    0,
  )
  const filteredTransactions =
    selectedAccountId === 'all'
      ? transactions
      : transactions.filter((transaction) => transactionBelongsToAccount(transaction, selectedAccountId))
  const selectedSummary = summaries.find((summary) => summary.account.id === selectedAccountId)
  const activeAccountName = selectedSummary?.account.name ?? '全部账户'
  const fallbackFrontAccountId = summaries[0]?.account.id ?? null
  const resolvedFrontAccountId =
    frontAccountId && summaries.some((summary) => summary.account.id === frontAccountId)
      ? frontAccountId
      : fallbackFrontAccountId
  const frontStackIndex = Math.max(
    0,
    summaries.findIndex((summary) => summary.account.id === resolvedFrontAccountId),
  )
  const orderedStackSummaries = rotateAccountSummaries(summaries, frontStackIndex)
  const summaryVariantByAccountId = new Map(
    summaries.map((summary, index) => [summary.account.id, (index % 4) + 1]),
  )

  const handleAccountStackWheel = useCallback((event: WheelEvent) => {
    if (summaries.length < 2) return

    const direction = Math.sign(event.deltaY)
    if (direction === 0) return

    event.preventDefault()
    const now = window.performance.now()
    if (now - lastAccountStackWheelAtRef.current < 170) return

    lastAccountStackWheelAtRef.current = now
    const nextIndex = wrapIndex(frontStackIndex + (direction > 0 ? 1 : -1), summaries.length)
    setFrontAccountId(summaries[nextIndex]?.account.id ?? null)
  }, [frontStackIndex, summaries])

  useEffect(() => {
    const stackNode = accountStackRef.current
    if (!stackNode) return

    stackNode.addEventListener('wheel', handleAccountStackWheel, { passive: false })
    return () => {
      stackNode.removeEventListener('wheel', handleAccountStackWheel)
    }
  }, [handleAccountStackWheel])

  return (
    <div
      className="accounting-workspace ios-accounts-workspace"
      aria-label="账户工作台"
    >
      <section className="glass-panel glass-panel--solid ios-panel ios-account-filter-panel" aria-label="账户筛选卡片">
        <div className="ios-account-filter-panel__accounts">
          <header className="ios-panel-head">
            <strong>账户卡片</strong>
            <span>{summaries.length} 个账户</span>
          </header>
          <div className="ios-account-stack-summary">
            <span>估算净资产</span>
            <strong>¥{formatCnyFromCents(totalBalanceInCents)}</strong>
          </div>
          <button
            type="button"
            className="ios-account-all-filter"
            aria-pressed={selectedAccountId === 'all'}
            onClick={() => onSelectAccount('all')}
          >
            <span>全部流水</span>
            <strong>{transactions.length} 笔</strong>
          </button>
          <LayoutGroup id="account-card-stack">
            <motion.div
              layout="position"
              className="ios-account-filter-stack"
              aria-label="层叠账户卡片"
              transition={ACCOUNT_CARD_LAYOUT_TRANSITION}
              ref={accountStackRef}
            >
              {orderedStackSummaries.map((summary, stackIndex) => (
                <AccountFilterCard
                  key={summary.account.id}
                  layoutId={`account-card-${summary.account.id}`}
                  variant={summaryVariantByAccountId.get(summary.account.id) ?? 1}
                  stackIndex={stackIndex}
                  brand={getAccountCardBrand(summary.account)}
                  title={summary.account.name}
                  detail={`${summary.transactionCount} 笔 · ${summary.account.sourceFundType ?? 'fund'}`}
                  balance={`¥${formatCnyFromCents(summary.closingInCents)}`}
                  movement={formatSigned(
                    summary.incomeInCents -
                      summary.expenseInCents +
                      summary.transferInInCents -
                      summary.transferOutInCents,
                  )}
                  active={summary.account.id === resolvedFrontAccountId}
                  compact={stackIndex > 0}
                  onSelect={() => setFrontAccountId(summary.account.id)}
                />
              ))}
            </motion.div>
          </LayoutGroup>
        </div>
      </section>

      <section className="glass-panel glass-panel--solid ios-panel ios-account-movement-panel" aria-label="账户流动">
        <header className="ios-panel-head">
          <strong>账户流水</strong>
          <span>{activeAccountName}</span>
        </header>
        <div className="accounting-scroll--ledger" aria-label="账户流水列表">
          {filteredTransactions.map((transaction) => (
            <AccountMovementRow key={transaction.id} transaction={transaction} />
          ))}
          {filteredTransactions.length === 0 ? (
            <div className="ios-empty-ledger">当前账户在这个时间范围内没有流水</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function AccountFilterCard({
  layoutId,
  variant,
  stackIndex,
  brand,
  title,
  detail,
  balance,
  movement,
  active,
  compact = false,
  onSelect,
}: {
  layoutId: string
  variant: number
  stackIndex: number
  brand: AccountCardBrand
  title: string
  detail: string
  balance: string
  movement: string
  active: boolean
  compact?: boolean
  onSelect: () => void
}) {
  const brandConfig = getAccountCardBrandConfig(brand)

  return (
    <motion.button
      layout="position"
      layoutId={layoutId}
      transition={ACCOUNT_CARD_LAYOUT_TRANSITION}
      type="button"
      className={[
        'ios-account-filter-card',
        `ios-account-filter-card--${variant}`,
        `ios-account-filter-card--rank-${Math.min(stackIndex, 3)}`,
        `ios-account-filter-card--brand-${brand}`,
        active ? 'is-active' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={active}
      onClick={onSelect}
      style={getAccountCardBrandStyle(brandConfig)}
    >
      <span className="ios-account-filter-card__surface">
        <span className="ios-account-filter-card__brand-logo" aria-hidden="true">
          <svg viewBox={brandConfig.logoViewBox ?? '0 0 24 24'} focusable="false">
            <title>{brandConfig.title}</title>
            {brandConfig.logoImageSrc ? (
              <image
                href={brandConfig.logoImageSrc}
                width="1072"
                height="419"
                preserveAspectRatio="xMidYMid meet"
              />
            ) : (
              <path d={brandConfig.logoPath ?? GENERIC_CARD_LOGO_PATH} fill="currentColor" />
            )}
          </svg>
        </span>
        <span className="ios-account-filter-card__body">
          <strong>{title}</strong>
          {compact ? null : <em>{detail}</em>}
        </span>
        <span className="ios-account-filter-card__side">
          <b>{balance}</b>
          {compact ? null : <small>{movement}</small>}
        </span>
      </span>
    </motion.button>
  )
}

function getAccountCardBrand(account: Account): AccountCardBrand {
  const label = `${account.id} ${account.name} ${account.sourceFundId ?? ''} ${account.sourceFundType ?? ''}`.toLowerCase()

  if (label.includes('wechat') || label.includes('weixin') || account.name.includes('微信')) {
    return 'wechat'
  }
  if (label.includes('alipay') || label.includes('huabei') || account.name.includes('支付宝') || account.name.includes('花呗')) {
    return 'alipay'
  }
  if (label.includes('meituan') || account.name.includes('美团')) {
    return 'meituan'
  }
  if (label.includes('jd') || label.includes('jingdong') || account.name.includes('京东')) {
    return 'jd'
  }
  if (label.includes('douyin') || label.includes('tiktok') || account.name.includes('抖音')) {
    return 'douyin'
  }
  if (label.includes('bank') || account.name.includes('银行') || account.name.includes('银行卡')) {
    return 'bank'
  }

  return 'generic'
}

function getAccountCardBrandConfig(brand: AccountCardBrand): AccountCardBrandConfig {
  return accountCardBrandConfigs[brand]
}

function getAccountCardBrandStyle(config: AccountCardBrandConfig): AccountCardBrandStyle {
  const brand = getAccountCardBrandByConfig(config)
  const tone = getAccountCardBrandTone(brand, config)

  return {
    '--account-card-bg-start': tone.start,
    '--account-card-bg-mid': tone.mid,
    '--account-card-bg-end': tone.end,
  }
}

function getAccountCardBrandByConfig(config: AccountCardBrandConfig): AccountCardBrand {
  const matchedEntry = Object.entries(accountCardBrandConfigs).find(([, brandConfig]) => brandConfig === config)
  return (matchedEntry?.[0] as AccountCardBrand | undefined) ?? 'generic'
}

function getAccountCardBrandTone(
  brand: AccountCardBrand,
  brandConfig: AccountCardBrandConfig,
) {
  if (brand === 'meituan') {
    return {
      start: '#d6a800',
      mid: '#a77f05',
      end: '#50410a',
    }
  }

  return {
    start: mixHexColor(brandConfig.baseHex, '#1f3430', 0.36),
    mid: mixHexColor(brandConfig.baseHex, '#123f35', 0.58),
    end: mixHexColor(brandConfig.baseHex, '#07110f', 0.78),
  }
}

function mixHexColor(fromHex: string, toHex: string, weight: number) {
  const from = parseHexColor(fromHex)
  const to = parseHexColor(toHex)

  return `#${from.map((channel, index) => {
    const mixed = Math.round(channel * (1 - weight) + to[index] * weight)
    return mixed.toString(16).padStart(2, '0')
  }).join('')}`
}

function parseHexColor(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return [18, 63, 53]

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function rotateAccountSummaries(
  summaries: AccountPeriodSummary[],
  offset: number,
): AccountPeriodSummary[] {
  if (summaries.length < 2) return summaries

  const start = wrapIndex(offset, summaries.length)
  return [...summaries.slice(start), ...summaries.slice(0, start)]
}

function wrapIndex(index: number, length: number) {
  return ((index % length) + length) % length
}

function AccountMovementRow({ transaction }: { transaction: Transaction }) {
  return (
    <article className={`ios-account-movement-row ios-account-movement-row--${transaction.type}`}>
      <span>{typeLabels[transaction.type]}</span>
      <div>
        <strong>{transaction.note ?? formatMonthDay(transaction.occurredAt)}</strong>
        <small>{formatMonthDay(transaction.occurredAt)}</small>
      </div>
      <b>{formatTransactionAmount(transaction)}</b>
    </article>
  )
}

function transactionBelongsToAccount(transaction: Transaction, accountId: string) {
  if (transaction.type === 'transfer') {
    return transaction.fromAccountId === accountId || transaction.toAccountId === accountId
  }

  return transaction.accountId === accountId
}

function formatTransactionAmount(transaction: Transaction) {
  if (transaction.type === 'income') return `+¥${formatCnyFromCents(transaction.amountInCents)}`
  if (transaction.type === 'expense') return `-¥${formatCnyFromCents(transaction.amountInCents)}`

  return `¥${formatCnyFromCents(transaction.amountInCents)}`
}

function formatSigned(amountInCents: number) {
  if (amountInCents === 0) return '¥0.00'

  return `${amountInCents > 0 ? '+' : '-'}¥${formatCnyFromCents(Math.abs(amountInCents))}`
}
