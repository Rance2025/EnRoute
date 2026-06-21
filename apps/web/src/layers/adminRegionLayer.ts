import type { AdminRegion } from './adminRegionTypes'

type AdminRegionLayerRuntime = Pick<typeof AMap, 'Polygon'>
type RegionPolygon = Pick<AMap.Polygon, 'setMap'>

const UNLOCKED_STROKE = '#123f35'
const UNLOCKED_FILL = '#123f35'
const LOCKED_STROKE = '#17231f'
const LOCKED_FILL = '#17231f'

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
      strokeOpacity: unlocked ? 0.52 : 0.16,
      strokeWeight: unlocked ? 1.2 : 0.7,
      fillColor: unlocked ? UNLOCKED_FILL : LOCKED_FILL,
      fillOpacity: unlocked ? 0.16 : 0.035,
      bubble: true,
      cursor: 'default',
      zIndex: unlocked ? 18 : 16,
    })
    polygon.setMap(map)
    return polygon
  })
}
