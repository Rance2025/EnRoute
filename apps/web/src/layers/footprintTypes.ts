export type FootprintPoint = {
  id: string
  timestampSeconds: number
  longitude: number
  latitude: number
  accuracy: number
  speed: number
  distance: number
  heading: number
  altitude: number
  locType: number
  isBackForeground: number
  stepType: number
}

export type AggregatedFootprintPoint = {
  id: string
  longitude: number
  latitude: number
  count: number
  minAccuracy: number
  startTimestampSeconds: number
  endTimestampSeconds: number
}

export type FootprintMetrics = {
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
  distanceSeries?: FootprintDistanceSeries
  selectedBounds?: FootprintLngLatBounds | null
}

export type FootprintDistanceSeries = {
  granularity: 'hour' | 'day'
  unit: 'hour' | 'day'
  buckets: FootprintDistanceBucket[]
}

export type FootprintDistanceBucket = {
  key: string
  label: string
  distanceMeters: number
}

export type FootprintLngLatBounds = {
  southWest: [number, number]
  northEast: [number, number]
}

export type FootprintRenderSnapshot = {
  points: AggregatedFootprintPoint[]
  metrics: FootprintMetrics
  selectedBounds: FootprintLngLatBounds | null
}

export type LngLatBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type WorldPixelPoint = {
  x: number
  y: number
}
