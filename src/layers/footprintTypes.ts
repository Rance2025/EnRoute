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

export type LngLatBounds = {
  west: number
  south: number
  east: number
  north: number
}
