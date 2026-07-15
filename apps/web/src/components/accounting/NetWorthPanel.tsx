import type { CSSProperties } from 'react'

import type { PortfolioPeriodSummary } from '../../accounting/types'
import { AccountingMetric } from './AccountingMetric'
import { formatCurrency, formatSignedCurrency } from './formatting'

export function NetWorthPanel({ summary }: { summary: PortfolioPeriodSummary }) {
  const maximumPosition = Math.max(
    summary.closingAssetsInCents,
    summary.closingLiabilitiesInCents,
    1,
  )
  const bridgeMaximum = Math.max(
    Math.abs(summary.openingNetWorthInCents),
    summary.incomeInCents,
    summary.expenseInCents,
    Math.abs(summary.closingNetWorthInCents),
    1,
  )
  const bridge = [
    { label: '期初净资产', value: summary.openingNetWorthInCents, tone: 'opening' },
    { label: '收入', value: summary.incomeInCents, tone: 'income' },
    { label: '支出', value: -summary.expenseInCents, tone: 'expense' },
    { label: '期末净资产', value: summary.closingNetWorthInCents, tone: 'closing' },
  ]

  return (
    <section
      className={`net-worth-panel${summary.closingNetWorthInCents < 0 ? ' is-negative' : ''}`}
      aria-label="全部账户净资产"
    >
      <header className="net-worth-panel__header">
        <div>
          <span>全部账户 · 期末净资产</span>
          <strong>{formatCurrency(summary.closingNetWorthInCents)}</strong>
          <small>期间 {formatSignedCurrency(summary.netChangeInCents)}</small>
        </div>
        <div className="net-worth-panel__metrics">
          <AccountingMetric label="收入" value={formatCurrency(summary.incomeInCents)} tone="positive" />
          <AccountingMetric label="支出" value={formatCurrency(summary.expenseInCents)} tone="negative" />
        </div>
      </header>

      <div className="net-position" aria-label="资产与负债对向图">
        <div className="net-position__side net-position__side--liability">
          <span>负债</span>
          <strong>{formatCurrency(summary.closingLiabilitiesInCents)}</strong>
          <i style={{ '--position-size': summary.closingLiabilitiesInCents / maximumPosition } as CSSProperties} />
        </div>
        <span className="net-position__axis" aria-hidden="true" />
        <div className="net-position__side net-position__side--asset">
          <span>资产</span>
          <strong>{formatCurrency(summary.closingAssetsInCents)}</strong>
          <i style={{ '--position-size': summary.closingAssetsInCents / maximumPosition } as CSSProperties} />
        </div>
      </div>

      <div className="net-worth-bridge" aria-label="净资产桥接图">
        {bridge.map((item) => (
          <div className={`net-worth-bridge__item net-worth-bridge__item--${item.tone}`} key={item.label}>
            <span
              aria-hidden="true"
              style={{ '--bridge-size': Math.abs(item.value) / bridgeMaximum } as CSSProperties}
            />
            <small>{item.label}</small>
            <strong>{formatSignedCurrency(item.value)}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}
