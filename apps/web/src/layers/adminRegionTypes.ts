export type AdminRegionLevel = 1 | 2 | 3 | 4 | 5

export type AdminRegionGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

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
