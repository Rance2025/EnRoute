export function formatMetricCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function formatDistanceMeters(value: number) {
  return formatDistance(value, 0, 1)
}

export function formatAverageDistanceMeters(value: number) {
  return `${formatDistance(value, value <= 0 ? 0 : 1, 1)}/day`
}

function formatDistance(value: number, minimumFractionDigits: number, maximumFractionDigits: number) {
  if (value >= 10_000) {
    return `${new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value / 1000)} km`
  }

  return `${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)} m`
}
