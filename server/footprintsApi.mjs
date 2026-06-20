import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createFootprintStore } from './footprintStore.mjs'

const DEFAULT_DATA_PATH = 'external/backUpData-all.csv'
const DEFAULT_COORDINATE_SYSTEM = 'wgs84'

const REQUIRED_COLUMNS = [
  'dataTime',
  'locType',
  'longitude',
  'latitude',
  'heading',
  'accuracy',
  'speed',
  'distance',
  'isBackForeground',
  'stepType',
  'altitude',
]

const EARTH_SEMI_MAJOR_AXIS = 6378245.0
const EARTH_ECCENTRICITY_SQUARED = 0.006693421622965943

export async function loadFootprintPayload({
  dataPath = process.env.FOOTPRINT_DATA_PATH ?? DEFAULT_DATA_PATH,
  coordinateSystem = process.env.FOOTPRINT_COORDINATE_SYSTEM ?? DEFAULT_COORDINATE_SYSTEM,
} = {}) {
  const csv = await readFile(resolve(dataPath), 'utf8')

  return {
    points: parseFootprintCsv(csv, parseFootprintCoordinateSystem(coordinateSystem)),
  }
}

export function createFootprintsRequestHandler(options = {}) {
  let store = null

  return async function handleFootprintsRequest(request, response) {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

    if (request.method === 'POST' && url.pathname === '/api/footprints/snapshot') {
      try {
        store ??= createFootprintStore({
          dbPath: options.dbPath,
          dataPath: options.dataPath,
          coordinateSystem: options.coordinateSystem,
          loadPoints: loadFootprintPayload,
        })
        sendJson(response, 200, await store.getSnapshot(await readJsonRequestBody(request)))
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : 'Failed to load footprint snapshot',
        })
      }
      return
    }

    if (request.method !== 'GET' || url.pathname !== '/api/footprints') {
      sendJson(response, 404, { error: 'Not found' })
      return
    }

    try {
      const payload = await loadFootprintPayload(options)
      sendJson(response, 200, payload)
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Failed to load footprints',
      })
    }
  }
}

function readJsonRequestBody(request) {
  return new Promise((resolveRequest, rejectRequest) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      try {
        resolveRequest(body ? JSON.parse(body) : {})
      } catch (error) {
        rejectRequest(error)
      }
    })
    request.on('error', rejectRequest)
  })
}

function parseFootprintCsv(csv, sourceCoordinateSystem) {
  const [headerLine, ...lines] = csv.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (!headerLine) return []

  const headers = headerLine.split(',').map((header) => header.trim())
  const columnIndex = new Map(headers.map((header, index) => [header, index]))

  for (const column of REQUIRED_COLUMNS) {
    if (!columnIndex.has(column)) {
      throw new Error(`Missing footprint CSV column: ${column}`)
    }
  }

  return lines.flatMap((line, rowIndex) => {
    if (!line.trim()) return []

    const point = parseFootprintRow(
      line.split(',').map((cell) => cell.trim()),
      columnIndex,
      rowIndex,
      sourceCoordinateSystem,
    )

    return point ? [point] : []
  })
}

function parseFootprintRow(cells, columnIndex, rowIndex, sourceCoordinateSystem) {
  const value = (column) => Number(cells[columnIndex.get(column) ?? -1])
  const longitude = value('longitude')
  const latitude = value('latitude')
  const timestampSeconds = value('dataTime')
  const numericFields = {
    accuracy: value('accuracy'),
    speed: value('speed'),
    distance: value('distance'),
    heading: value('heading'),
    altitude: value('altitude'),
    locType: value('locType'),
    isBackForeground: value('isBackForeground'),
    stepType: value('stepType'),
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return null
  if (Object.values(numericFields).some((fieldValue) => !Number.isFinite(fieldValue))) return null

  const transformedCoordinate = transformFootprintCoordinate({
    longitude,
    latitude,
    sourceCoordinateSystem,
  })

  return {
    id: `${Math.trunc(timestampSeconds)}-${rowIndex}`,
    timestampSeconds: Math.trunc(timestampSeconds),
    longitude: transformedCoordinate.longitude,
    latitude: transformedCoordinate.latitude,
    ...numericFields,
  }
}

function parseFootprintCoordinateSystem(value) {
  const normalized = value?.trim().toLowerCase()

  if (normalized === 'gcj02' || normalized === 'none') return normalized

  return 'wgs84'
}

function transformFootprintCoordinate({
  longitude,
  latitude,
  sourceCoordinateSystem = DEFAULT_COORDINATE_SYSTEM,
}) {
  if (sourceCoordinateSystem !== 'wgs84' || isOutsideChina(longitude, latitude)) {
    return { longitude, latitude }
  }

  const [deltaLongitude, deltaLatitude] = calculateWgs84ToGcj02Offset(longitude, latitude)

  return {
    longitude: longitude + deltaLongitude,
    latitude: latitude + deltaLatitude,
  }
}

function isOutsideChina(longitude, latitude) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271
}

function calculateWgs84ToGcj02Offset(longitude, latitude) {
  const adjustedLongitude = longitude - 105.0
  const adjustedLatitude = latitude - 35.0
  let deltaLatitude = transformLatitude(adjustedLongitude, adjustedLatitude)
  let deltaLongitude = transformLongitude(adjustedLongitude, adjustedLatitude)
  const radianLatitude = (latitude / 180.0) * Math.PI
  let magic = Math.sin(radianLatitude)
  magic = 1 - EARTH_ECCENTRICITY_SQUARED * magic * magic
  const sqrtMagic = Math.sqrt(magic)

  deltaLatitude =
    (deltaLatitude * 180.0) /
    (((EARTH_SEMI_MAJOR_AXIS * (1 - EARTH_ECCENTRICITY_SQUARED)) / (magic * sqrtMagic)) *
      Math.PI)
  deltaLongitude =
    (deltaLongitude * 180.0) /
    ((EARTH_SEMI_MAJOR_AXIS / sqrtMagic) * Math.cos(radianLatitude) * Math.PI)

  return [deltaLongitude, deltaLatitude]
}

function transformLatitude(x, y) {
  let result =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  result += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  result += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  result +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) /
    3.0

  return result
}

function transformLongitude(x, y) {
  let result =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  result += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  result += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  result +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0

  return result
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}
