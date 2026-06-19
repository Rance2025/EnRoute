import type { AggregatedFootprintPoint } from './footprintTypes'

export function createFootprintGeoJson(points: AggregatedFootprintPoint[]): FootprintFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      properties: {
        id: point.id,
        count: point.count,
        minAccuracy: point.minAccuracy,
        startTimestampSeconds: point.startTimestampSeconds,
        endTimestampSeconds: point.endTimestampSeconds,
      },
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude],
      },
    })),
  }
}

export function createLocaFootprintLayer(LocaRuntime: typeof Loca, map: AMap.Map) {
  const container = new LocaRuntime.Container({ map })
  const pointLayer = new LocaRuntime.PointLayer({
    zIndex: 20,
    opacity: 0.9,
    visible: true,
    blend: 'lighter',
  })

  pointLayer.setSource(new LocaRuntime.GeoJSONSource({ data: createFootprintGeoJson([]) }))
  pointLayer.setStyle({
    unit: 'px',
    radius: 1,
    color: 'rgba(184, 84, 76, 0.92)',
    borderWidth: 0,
    blurWidth: 0,
  })
  container.add(pointLayer)

  return {
    update(points: AggregatedFootprintPoint[]) {
      pointLayer.setSource(new LocaRuntime.GeoJSONSource({ data: createFootprintGeoJson(points) }))
    },
    destroy() {
      container.destroy()
    },
  }
}
