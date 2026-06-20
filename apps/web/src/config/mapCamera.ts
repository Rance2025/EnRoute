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

export function calculateWorldCenter(bounds: MapBounds): [number, number] {
  return [
    (bounds.southWest[0] + bounds.northEast[0]) / 2,
    (bounds.southWest[1] + bounds.northEast[1]) / 2,
  ]
}

export function resetMapCamera(
  map: ResettableMap,
  bounds: AMap.Bounds,
  avoid?: number[],
) {
  map.setPitch(DEFAULT_MAP_CAMERA.pitch, true)
  map.setRotation(DEFAULT_MAP_CAMERA.rotation, true)
  map.setBounds(bounds, false, avoid, MAP_RESET_DURATION_MS)
}
