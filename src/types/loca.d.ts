type FootprintFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties: Record<string, string | number>
    geometry: {
      type: 'Point'
      coordinates: [number, number]
    }
  }>
}

declare namespace Loca {
  class Container {
    constructor(options: { map: AMap.Map })
    add(layer: PointLayer): void
    destroy(): void
  }

  class GeoJSONSource {
    constructor(options: { data: FootprintFeatureCollection })
  }

  class PointLayer {
    constructor(options: {
      zIndex?: number
      opacity?: number
      visible?: boolean
      blend?: 'lighter' | 'normal'
    })
    setSource(source: GeoJSONSource): void
    setStyle(style: {
      unit: 'px'
      radius: number | ((index: number, feature: { properties: { count?: number } }) => number)
      color: string | ((index: number, feature: { properties: { count?: number } }) => string)
      borderWidth?: number
      blurWidth?: number
    }): void
  }
}

interface Window {
  Loca?: typeof Loca
}
