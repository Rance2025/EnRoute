import type { AdminRegion } from './adminRegionTypes'

type AdminRegionLayerRuntime = Pick<typeof AMap, 'Polygon'>
type RegionPolygon = Pick<AMap.Polygon, 'setMap'>

const UNLOCKED_STROKE = '#123f35'
const UNLOCKED_FILL = 'rgba(18, 63, 53, 0.18)'
const LOCKED_STROKE = 'rgba(23, 35, 31, 0.24)'
const LOCKED_FILL = 'rgba(23, 35, 31, 0.045)'

export function createAdminRegionLayer(
  AMapRuntime: AdminRegionLayerRuntime,
  map: AMap.Map,
) {
  let polygons: RegionPolygon[] = []
  let destroyed = false

  function clear() {
    for (const polygon of polygons) {
      polygon.setMap(null)
    }
    polygons = []
  }

  return {
    update(regions: AdminRegion[]) {
      if (destroyed) return
      clear()
      polygons = regions.flatMap((region) =>
        createRegionPolygons(AMapRuntime, map, region),
      )
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clear()
    },
  }
}

function createRegionPolygons(
  AMapRuntime: AdminRegionLayerRuntime,
  map: AMap.Map,
  region: AdminRegion,
) {
  const paths = region.geometry.type === 'Polygon'
    ? [region.geometry.coordinates]
    : region.geometry.coordinates
  const unlocked = region.footprintCount > 0

  return paths.map((path) => {
    const polygon = new AMapRuntime.Polygon({
      path,
      strokeColor: unlocked ? UNLOCKED_STROKE : LOCKED_STROKE,
      strokeOpacity: unlocked ? 0.9 : 0.42,
      strokeWeight: unlocked ? 1.4 : 0.8,
      fillColor: unlocked ? UNLOCKED_FILL : LOCKED_FILL,
      fillOpacity: 1,
      bubble: true,
      cursor: 'default',
      zIndex: unlocked ? 18 : 16,
    })
    polygon.setMap(map)
    return polygon
  })
}
