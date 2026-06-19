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
    loca: container,
    zIndex: 20,
    opacity: 0.9,
    visible: true,
    blend: 'lighter',
  })

  pointLayer.setStyle({
    unit: 'px',
    radius: (_index, feature) => Math.min(5, 1.5 + Math.log2((feature.properties.count ?? 1) + 1)),
    color: 'rgba(255, 225, 154, 0.92)',
    borderWidth: 0,
    blurWidth: 5,
  })

  return {
    update(points: AggregatedFootprintPoint[]) {
      pointLayer.setSource(new LocaRuntime.GeoJSONSource({ data: createFootprintGeoJson(points) }))
    },
    destroy() {
      container.destroy()
    },
  }
}
