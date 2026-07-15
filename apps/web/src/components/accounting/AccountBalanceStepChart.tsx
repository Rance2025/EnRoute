import type { AccountNature } from '../../accounting/types'
import type { AccountBalanceStep } from '../../accounting/insightSelectors'
import { formatCurrency } from './formatting'

export function AccountBalanceStepChart({
  steps,
  nature,
}: {
  steps: AccountBalanceStep[]
  nature: AccountNature
}) {
  const values = steps.map((step) => step.balanceInCents)
  const minimum = Math.min(...values, 0)
  const maximum = Math.max(...values, 0)
  const span = maximum - minimum || 1
  const points = steps.map((step, index) => ({
    x: steps.length < 2 ? 0 : index / (steps.length - 1) * 100,
    y: 92 - (step.balanceInCents - minimum) / span * 80,
    step,
  }))
  const path = points.reduce((commands, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`
    const previous = points[index - 1]
    return `${commands} H ${point.x} V ${point.y || previous.y}`
  }, '')
  const display = (value: number) => formatCurrency(nature === 'liability' ? Math.abs(value) : value)

  return (
    <section className="account-balance-step-chart" aria-label="账户余额阶梯图">
      <header className="insight-panel-head">
        <div>
          <strong>余额阶梯</strong>
          <span>每次跃迁对应一笔真实账户变动</span>
        </div>
        <div>
          <small>期初</small><b>{display(steps[0]?.balanceInCents ?? 0)}</b>
          <small>期末</small><b>{display(steps.at(-1)?.balanceInCents ?? 0)}</b>
        </div>
      </header>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="账户余额阶梯轨迹">
        <line x1="0" y1="92" x2="100" y2="92" />
        <path d={path} />
      </svg>
      <table className="sr-only">
        <caption>账户余额阶梯数据</caption>
        <tbody>
          {steps.map((step) => <tr key={step.id}><td>{step.occurredAt}</td><td>{step.balanceInCents}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}
