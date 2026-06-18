export function formatCnyFromCents(amountInCents: number) {
  const sign = amountInCents < 0 ? '-' : ''
  const absolute = Math.abs(amountInCents)
  const yuan = Math.floor(absolute / 100)
  const cents = absolute % 100

  return `${sign}${yuan}.${String(cents).padStart(2, '0')}`
}

export function parseCnyToCents(value: string) {
  const normalized = value.trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('金额必须是最多两位小数的数字')
  }

  const sign = normalized.startsWith('-') ? -1 : 1
  const unsigned = normalized.replace(/^-/, '')
  const [yuan, cents = ''] = unsigned.split('.')

  return sign * (Number(yuan) * 100 + Number(cents.padEnd(2, '0')))
}
