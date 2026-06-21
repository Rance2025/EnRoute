export type AdminRegionLevel = 1 | 2 | 3 | 4 | 5

export type AdminRegionLngLat = [number, number]

export type AdminRegionGeometry =
  | { type: 'Polygon'; coordinates: AdminRegionLngLat[][] }
  | { type: 'MultiPolygon'; coordinates: AdminRegionLngLat[][][] }

export type AdminRegion = {
  id: string
  name: string
  level: AdminRegionLevel
  geometry: AdminRegionGeometry
  firstSeenTimestamp: number | null
  footprintCount: number
  stayDurationSeconds: number
  travelDistanceMeters: number
}
