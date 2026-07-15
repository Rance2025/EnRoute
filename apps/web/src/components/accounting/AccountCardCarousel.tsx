import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { AccountPeriodSummary } from '../../accounting/types'
import { formatCurrency, formatSignedCurrency } from './formatting'

const WHEEL_THRESHOLD = 24
const WHEEL_LOCK_MS = 240

export function AccountCardCarousel({
  summaries,
  selectedAccountId,
  onSelectAccount,
}: {
  summaries: AccountPeriodSummary[]
  selectedAccountId: string
  onSelectAccount: (accountId: string) => void
}) {
  const carouselRef = useRef<HTMLDivElement>(null)
  const wheelDeltaRef = useRef(0)
  const wheelLockedRef = useRef(false)
  const unlockTimerRef = useRef<number | undefined>(undefined)
  const selectedIndex = Math.max(
    0,
    summaries.findIndex((summary) => summary.account.id === selectedAccountId),
  )
  const visibleSummaries = useMemo(
    () => Array.from({ length: Math.min(3, summaries.length) }, (_, offset) =>
      summaries[wrapIndex(selectedIndex + offset, summaries.length)]),
    [selectedIndex, summaries],
  )

  useEffect(() => () => {
    if (unlockTimerRef.current !== undefined) window.clearTimeout(unlockTimerRef.current)
  }, [])

  const move = useCallback((direction: -1 | 1) => {
    if (summaries.length < 2) return
    const next = summaries[wrapIndex(selectedIndex + direction, summaries.length)]
    if (next) onSelectAccount(next.account.id)
  }, [onSelectAccount, selectedIndex, summaries])

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (summaries.length < 2 || wheelLockedRef.current) return
    if (wheelDeltaRef.current !== 0 && Math.sign(wheelDeltaRef.current) !== Math.sign(event.deltaY)) {
      wheelDeltaRef.current = 0
    }
    wheelDeltaRef.current += event.deltaY
    if (Math.abs(wheelDeltaRef.current) < WHEEL_THRESHOLD) return

    const direction = wheelDeltaRef.current > 0 ? 1 : -1
    wheelDeltaRef.current = 0
    wheelLockedRef.current = true
    move(direction)
    unlockTimerRef.current = window.setTimeout(() => {
      wheelLockedRef.current = false
    }, WHEEL_LOCK_MS)
  }, [move, summaries.length])

  useEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) return

    carousel.addEventListener('wheel', handleWheel, { passive: false })
    return () => carousel.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  return (
    <section className="account-card-carousel-shell">
      <div
        className="account-card-carousel"
        role="group"
        aria-label="账户卡片轮替"
        data-density="compact"
        tabIndex={0}
        ref={carouselRef}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            move(1)
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            move(-1)
          }
        }}
      >
        {visibleSummaries.map((summary, stackIndex) => {
          const isFront = stackIndex === 0
          const balance = summary.closingInCents
          return (
            <motion.button
              key={summary.account.id}
              layout
              type="button"
              className={`account-card account-card--rank-${stackIndex}${isFront ? ' is-front' : ''}`}
              aria-label={`选择账户 ${summary.account.name}`}
              aria-pressed={isFront}
              onClick={() => onSelectAccount(summary.account.id)}
              animate={{
                x: stackIndex * 18,
                y: stackIndex * 16,
                scale: 1 - stackIndex * 0.045,
                opacity: 1 - stackIndex * 0.16,
              }}
              transition={{ type: 'spring', stiffness: 390, damping: 36 }}
            >
              <span className="account-card__brand" aria-hidden="true">
                {(summary.account.brand?.label ?? summary.account.name).slice(0, 2)}
              </span>
              <span className="account-card__identity">
                <small>{summary.account.brand?.label ?? '账户'}</small>
                <strong>{summary.account.name}</strong>
                <em>{summary.account.nature === 'asset' ? '资产账户' : '负债账户'} · {summary.account.currency}</em>
              </span>
              <span className="account-card__balance">
                <small>{summary.account.nature === 'liability' ? '期末欠款' : '期末余额'}</small>
                <strong>{formatCurrency(summary.account.nature === 'liability' ? Math.abs(balance) : balance)}</strong>
                <em>{formatSignedCurrency(summary.netChangeInCents)}</em>
              </span>
            </motion.button>
          )
        })}
        {summaries.length === 0 ? <p>暂无账户</p> : null}
      </div>
      <footer className="account-card-carousel__footer">
        <span>{summaries.length === 0 ? 0 : selectedIndex + 1} / {summaries.length}</span>
        <small>滚轮、点击卡片或方向键切换</small>
      </footer>
    </section>
  )
}

function wrapIndex(index: number, length: number) {
  if (length === 0) return 0
  return ((index % length) + length) % length
}
