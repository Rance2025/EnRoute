declare namespace AMap {
  type LngLatLike = [number, number]

  class Size {
    constructor(width: number, height: number)
    width: number
    height: number
  }

  class Pixel {
    constructor(x: number, y: number)
    x: number
    y: number
  }

  class Bounds {
    constructor(southWest: LngLatLike, northEast: LngLatLike)
  }

  class Map {
    constructor(container: string | HTMLElement, options?: MapOptions)
    addControl(control: unknown): void
    destroy(): void
    resize(): void
    on(eventName: string, callback: () => void): void
    off(eventName: string, callback: () => void): void
    setMapStyle(style: string): void
    setPitch(pitch: number, immediately?: boolean): void
    setRotation(rotation: number, immediately?: boolean): void
    setStatus(status: {
      dragEnable?: boolean
      pitchEnable?: boolean
      rotateEnable?: boolean
      scrollWheel?: boolean
      doubleClickZoom?: boolean
      keyboardEnable?: boolean
    }): void
    setCenter(center: LngLatLike, immediately?: boolean, duration?: number): void
    setZoomAndCenter(
      zoom: number,
      center: LngLatLike,
      immediately?: boolean,
      duration?: number,
    ): void
    setZoom(zoom: number, immediately?: boolean, duration?: number): void
    setBounds(bounds: BoundsLike, immediately?: boolean, avoid?: number[], duration?: number): void
    setLimitBounds(bounds: Bounds): void
    getCenter(): { getLng: () => number; getLat: () => number }
    lnglatToPixel(lngLat: LngLatLike, level: number): { x: number; y: number }
    lngLatToContainer(lngLat: LngLatLike): { x: number; y: number }
    containerToLngLat(point: { x: number; y: number }): { getLng: () => number; getLat: () => number }
    getPitch(): number
    getRotation(): number
    getZoom(): number
    zoomIn(): void
    zoomOut(): void
  }

  class MassMarks {
    constructor(data: MassMarksData[], options: MassMarksOptions)
    clear(): void
    setData(data: MassMarksData[]): void
    setMap(map: Map | null): void
    setStyle(style: MassMarksStyle | MassMarksStyle[]): void
  }

  type MassMarksData = {
    id?: string
    lnglat: LngLatLike
  }

  type MassMarksOptions = {
    zIndex?: number
    opacity?: number
    cursor?: string
    alwaysRender?: boolean
    style: MassMarksStyle
  }

  type MassMarksStyle = {
    url: string
    size: Size
    anchor: Pixel
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
    zooms?: [number, number]
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
