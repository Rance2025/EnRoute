import type { CashflowBucket } from '../../accounting/insightSelectors'
import { formatCnyFromCents } from '../../accounting/money'

type CashflowTrendChartProps = {
  buckets: CashflowBucket[]
  previousBuckets?: CashflowBucket[]
  measure: 'amount' | 'count'
  granularity: 'day' | 'week' | 'month'
}

const viewBoxWidth = 760
const viewBoxHeight = 260
const plotTop = 24
const plotBottom = 214

export function CashflowTrendChart({
  buckets,
  previousBuckets = [],
  measure,
  granularity,
}: CashflowTrendChartProps) {
  const values = buckets.flatMap((bucket) => bucketValues(bucket, measure))
  const hasPreviousData = previousBuckets.some((bucket) => bucket.transactionCount > 0)
  const comparablePreviousBuckets = hasPreviousData ? previousBuckets : []
  const previousValues = comparablePreviousBuckets.map((bucket) => netValue(bucket, measure))
  const max = Math.max(...values, ...previousValues, 1)
  const min = Math.min(...values, ...previousValues, 0)
  const span = Math.max(max - min, 1)
  const baseline = toY(0, min, span)
  const groupWidth = buckets.length === 0 ? viewBoxWidth : (viewBoxWidth - 56) / buckets.length
  const barWidth = Math.max(4, Math.min(18, groupWidth * 0.22))
  const netPoints = buckets.map((bucket, index) => point(index, netValue(bucket, measure), groupWidth, min, span))
  const previousPoints = comparablePreviousBuckets.map((bucket, index) => point(index, netValue(bucket, measure), groupWidth, min, span))

  return (
    <section className="accounting-trend" aria-label="主收支趋势">
      <header className="accounting-chart-header">
        <div>
          <span>{measure === 'amount' ? '金额' : '笔数'}</span>
          <strong>收入、支出与净额</strong>
        </div>
        <span>最终粒度：{granularityLabel(granularity)}</span>
      </header>
      <svg role="img" aria-label="收支趋势图" viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}>
        <line className="accounting-trend__baseline" x1="28" x2={viewBoxWidth - 16} y1={baseline} y2={baseline} />
        {buckets.map((bucket, index) => {
          const center = 38 + groupWidth * (index + 0.5)
          const income = incomeValue(bucket, measure)
          const expense = expenseValue(bucket, measure)
          const incomeY = toY(income, min, span)
          const expenseY = toY(expense, min, span)
          return (
            <g key={bucket.key}>
              <rect data-testid="trend-income-bar" className="accounting-trend__bar accounting-trend__bar--income" x={center - barWidth - 2} y={Math.min(incomeY, baseline)} width={barWidth} height={Math.max(0, Math.abs(baseline - incomeY))} rx="3" />
              <rect data-testid="trend-expense-bar" className="accounting-trend__bar accounting-trend__bar--expense" x={center + 2} y={Math.min(expenseY, baseline)} width={barWidth} height={Math.max(0, Math.abs(baseline - expenseY))} rx="3" />
              <text x={center} y="240" textAnchor="middle">{shortLabel(bucket.label)}</text>
            </g>
          )
        })}
        {netPoints.length > 0 ? <polyline data-testid="trend-net-line" data-scale="shared" className="accounting-trend__net" points={netPoints.join(' ')} fill="none" /> : null}
        {previousPoints.length > 0 ? <polyline data-testid="trend-previous-line" className="accounting-trend__previous" points={previousPoints.join(' ')} fill="none" strokeDasharray="6 6" /> : null}
      </svg>
      {!hasPreviousData ? <p className="accounting-chart-empty">无可比数据</p> : null}
      <div className="accounting-chart-legend" aria-label="趋势图例">
        <span><i data-tone="income" />收入</span>
        <span><i data-tone="expense" />支出</span>
        <span><i data-tone="net" />净额</span>
        {hasPreviousData ? <span><i data-tone="previous" />上周期净额</span> : null}
      </div>
      <table className="sr-only">
        <caption>收支趋势数据</caption>
        <thead><tr><th>周期</th><th>收入</th><th>支出</th><th>净额</th></tr></thead>
        <tbody>{buckets.map((bucket) => <tr key={bucket.key}><th>{bucket.label}</th><td>{formatValue(incomeValue(bucket, measure), measure)}</td><td>{formatValue(expenseValue(bucket, measure), measure)}</td><td>{formatValue(netValue(bucket, measure), measure)}</td></tr>)}</tbody>
      </table>
    </section>
  )
}

function bucketValues(bucket: CashflowBucket, measure: 'amount' | 'count') {
  return [incomeValue(bucket, measure), expenseValue(bucket, measure), netValue(bucket, measure)]
}

function incomeValue(bucket: CashflowBucket, measure: 'amount' | 'count') {
  return measure === 'amount' ? bucket.incomeInCents : bucket.incomeCount
}

function expenseValue(bucket: CashflowBucket, measure: 'amount' | 'count') {
  return measure === 'amount' ? bucket.expenseInCents : bucket.expenseCount
}

function netValue(bucket: CashflowBucket, measure: 'amount' | 'count') {
  return measure === 'amount' ? bucket.netInCents : bucket.incomeCount - bucket.expenseCount
}

function toY(value: number, min: number, span: number) {
  return plotBottom - ((value - min) / span) * (plotBottom - plotTop)
}

function point(index: number, value: number, groupWidth: number, min: number, span: number) {
  return `${38 + groupWidth * (index + 0.5)},${toY(value, min, span)}`
}

function granularityLabel(granularity: 'day' | 'week' | 'month') {
  return granularity === 'day' ? '日' : granularity === 'week' ? '周' : '月'
}

function shortLabel(label: string) {
  return label.length >= 10 ? label.slice(5).replace('-', '/') : label
}

function formatValue(value: number, measure: 'amount' | 'count') {
  return measure === 'amount' ? `¥${formatCnyFromCents(Math.abs(value))}` : `${value} 笔`
}
