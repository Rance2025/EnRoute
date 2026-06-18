declare namespace AMap {
  type LngLatLike = [number, number]

  class Bounds {
    constructor(southWest: LngLatLike, northEast: LngLatLike)
  }

  class Map {
    constructor(container: string | HTMLElement, options?: MapOptions)
    addControl(control: unknown): void
    destroy(): void
    setMapStyle(style: string): void
    setPitch(pitch: number, immediately?: boolean): void
    setRotation(rotation: number, immediately?: boolean): void
    setZoomAndCenter(zoom: number, center: LngLatLike, immediately?: boolean): void
    setZoom(zoom: number, immediately?: boolean, duration?: number): void
    setBounds(bounds: BoundsLike, immediately?: boolean, avoid?: number[], duration?: number): void
    setLimitBounds(bounds: Bounds): void
    getCenter(): { getLng: () => number; getLat: () => number }
    getPitch(): number
    getRotation(): number
    getZoom(): number
    zoomIn(): void
    zoomOut(): void
  }

  type BoundsLike =
    | Bounds
    | {
        southWest: LngLatLike
        northEast: LngLatLike
      }

  type MapOptions = {
    center?: LngLatLike
    zoom?: number
    mapStyle?: string
    features?: Array<'bg' | 'point' | 'road' | 'building'>
    viewMode?: '2D' | '3D'
    pitch?: number
    rotation?: number
    pitchEnable?: boolean
    rotateEnable?: boolean
    showLabel?: boolean
    resizeEnable?: boolean
    jogEnable?: boolean
    animateEnable?: boolean
  }

  class Scale {
    constructor(options?: { position?: string })
  }

  class Geolocation {
    constructor(options?: {
      enableHighAccuracy?: boolean
      timeout?: number
      zoomToAccuracy?: boolean
      position?: {
        right?: string
        bottom?: string
      }
    })
    getCurrentPosition(): void
  }

  function plugin(name: string, callback: () => void): void
}

interface Window {
  __ENROUTE_MAP__?: AMap.Map
}
