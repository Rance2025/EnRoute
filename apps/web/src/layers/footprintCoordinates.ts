export type FootprintCoordinateSystem = 'wgs84' | 'gcj02' | 'none'

export type FootprintCoordinate = {
  longitude: number
  latitude: number
}

export type FootprintCoordinateTransformOptions = FootprintCoordinate & {
  sourceCoordinateSystem?: FootprintCoordinateSystem
}

const EARTH_SEMI_MAJOR_AXIS = 6378245.0
const EARTH_ECCENTRICITY_SQUARED = 0.006693421622965943
const PI = Math.PI

export function transformFootprintCoordinate({
  longitude,
  latitude,
  sourceCoordinateSystem = 'wgs84',
}: FootprintCoordinateTransformOptions): FootprintCoordinate {
  if (sourceCoordinateSystem !== 'wgs84' || isOutsideChina(longitude, latitude)) {
    return { longitude, latitude }
  }

  const [deltaLongitude, deltaLatitude] = calculateWgs84ToGcj02Offset(longitude, latitude)

  return {
    longitude: longitude + deltaLongitude,
    latitude: latitude + deltaLatitude,
  }
}

export function transformGcj02ToWgs84Coordinate({
  longitude,
  latitude,
}: FootprintCoordinate): FootprintCoordinate {
  if (isOutsideChina(longitude, latitude)) {
    return { longitude, latitude }
  }

  let wgs84Longitude = longitude
  let wgs84Latitude = latitude

  for (let index = 0; index < 4; index += 1) {
    const gcj02Coordinate = transformFootprintCoordinate({
      longitude: wgs84Longitude,
      latitude: wgs84Latitude,
      sourceCoordinateSystem: 'wgs84',
    })
    wgs84Longitude -= gcj02Coordinate.longitude - longitude
    wgs84Latitude -= gcj02Coordinate.latitude - latitude
  }

  return {
    longitude: wgs84Longitude,
    latitude: wgs84Latitude,
  }
}

export function parseFootprintCoordinateSystem(
  value: string | undefined,
): FootprintCoordinateSystem {
  const normalized = value?.trim().toLowerCase()

  if (normalized === 'gcj02' || normalized === 'none') return normalized

  return 'wgs84'
}

function isOutsideChina(longitude: number, latitude: number) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271
}

function calculateWgs84ToGcj02Offset(longitude: number, latitude: number) {
  const adjustedLongitude = longitude - 105.0
  const adjustedLatitude = latitude - 35.0
  let deltaLatitude = transformLatitude(adjustedLongitude, adjustedLatitude)
  let deltaLongitude = transformLongitude(adjustedLongitude, adjustedLatitude)
  const radianLatitude = (latitude / 180.0) * PI
  let magic = Math.sin(radianLatitude)
  magic = 1 - EARTH_ECCENTRICITY_SQUARED * magic * magic
  const sqrtMagic = Math.sqrt(magic)

  deltaLatitude =
    (deltaLatitude * 180.0) /
    (((EARTH_SEMI_MAJOR_AXIS * (1 - EARTH_ECCENTRICITY_SQUARED)) / (magic * sqrtMagic)) * PI)
  deltaLongitude =
    (deltaLongitude * 180.0) /
    ((EARTH_SEMI_MAJOR_AXIS / sqrtMagic) * Math.cos(radianLatitude) * PI)

  return [deltaLongitude, deltaLatitude] as const
}

function transformLatitude(x: number, y: number) {
  let result =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  result += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  result += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  result +=
    ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0

  return result
}

function transformLongitude(x: number, y: number) {
  let result =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  result += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  result += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  result +=
    ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) /
    3.0

  return result
}
