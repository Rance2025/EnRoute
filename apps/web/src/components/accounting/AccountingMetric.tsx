type AccountingMetricProps = {
  label: string
  value: string
  supporting?: string
  tone?: 'positive' | 'negative' | 'neutral'
}

export function AccountingMetric({
  label,
  value,
  supporting,
  tone = 'neutral',
}: AccountingMetricProps) {
  return (
    <div className={`accounting-metric accounting-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {supporting ? <small>{supporting}</small> : null}
    </div>
  )
}
