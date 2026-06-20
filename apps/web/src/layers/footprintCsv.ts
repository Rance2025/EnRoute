import type { FootprintPoint } from './footprintTypes'
import {
  transformFootprintCoordinate,
  type FootprintCoordinateSystem,
} from './footprintCoordinates'

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

export type ParseFootprintCsvOptions = {
  sourceCoordinateSystem?: FootprintCoordinateSystem
}

export function parseFootprintCsv(
  csv: string,
  { sourceCoordinateSystem = 'wgs84' }: ParseFootprintCsvOptions = {},
): FootprintPoint[] {
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

    const cells = line.split(',').map((cell) => cell.trim())
    const point = parseRow(cells, columnIndex, rowIndex, sourceCoordinateSystem)

    return point ? [point] : []
  })
}

function parseRow(
  cells: string[],
  columnIndex: Map<string, number>,
  rowIndex: number,
  sourceCoordinateSystem: FootprintCoordinateSystem,
): FootprintPoint | null {
  const value = (column: string) => Number(cells[columnIndex.get(column) ?? -1])
  const longitude = value('longitude')
  const latitude = value('latitude')
  const timestampSeconds = value('dataTime')

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return null

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
    accuracy: value('accuracy'),
    speed: value('speed'),
    distance: value('distance'),
    heading: value('heading'),
    altitude: value('altitude'),
    locType: value('locType'),
    isBackForeground: value('isBackForeground'),
    stepType: value('stepType'),
  }
}
