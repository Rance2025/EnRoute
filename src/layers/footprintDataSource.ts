import { parseFootprintCsv } from './footprintCsv'
import {
  parseFootprintCoordinateSystem,
  type FootprintCoordinateSystem,
} from './footprintCoordinates'
import type { FootprintPoint } from './footprintTypes'

type FootprintDataSourceEnv = {
  VITE_FOOTPRINT_COORDINATE_SYSTEM?: string
}

export async function loadFootprintPoints(
  csvUrl: string | undefined,
  signal: AbortSignal,
  sourceCoordinateSystem: FootprintCoordinateSystem = parseFootprintCoordinateSystem(
    (import.meta.env as FootprintDataSourceEnv).VITE_FOOTPRINT_COORDINATE_SYSTEM,
  ),
): Promise<FootprintPoint[]> {
  const trimmedUrl = csvUrl?.trim()
  if (!trimmedUrl) return []

  const response = await fetch(trimmedUrl, { signal })
  if (!response.ok) {
    throw new Error(`Failed to load footprint CSV: ${response.status}`)
  }

  return parseFootprintCsv(await response.text(), { sourceCoordinateSystem })
}
