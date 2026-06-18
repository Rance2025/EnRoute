export type MapCamera = {
  viewMode: '2D' | '3D'
  pitch: number
  rotation: number
  pitchEnable: boolean
  rotateEnable: boolean
}

export type ResettableMap = {
  setPitch: (pitch: number, immediately?: boolean) => void
  setRotation: (rotation: number, immediately?: boolean) => void
  setBounds: (
    bounds: AMap.Bounds,
    immediately?: boolean,
    avoid?: number[],
    duration?: number,
  ) => void
}

export type ZoomableMap = {
  getZoom: () => number
  setZoom: (zoom: number, immediately?: boolean, duration?: number) => void
}

export type MapBounds = {
  southWest: [number, number]
  northEast: [number, number]
}

export const DEFAULT_MAP_CAMERA: MapCamera = {
  viewMode: '2D',
  pitch: 0,
  rotation: 0,
  pitchEnable: false,
  rotateEnable: false,
}

export const MAP_RESET_DURATION_MS = 900
export const MAP_ZOOM_STEP = 0.5
export const MAP_ZOOM_DURATION_MS = 420

export function resetMapCamera(map: ResettableMap, bounds: AMap.Bounds) {
  map.setPitch(DEFAULT_MAP_CAMERA.pitch, true)
  map.setRotation(DEFAULT_MAP_CAMERA.rotation, true)
  map.setBounds(bounds, false, undefined, MAP_RESET_DURATION_MS)
}

export function zoomByStep(map: ZoomableMap, direction: 1 | -1, minZoom = -Infinity) {
  map.setZoom(
    Math.max(map.getZoom() + MAP_ZOOM_STEP * direction, minZoom),
    false,
    MAP_ZOOM_DURATION_MS,
  )
}
