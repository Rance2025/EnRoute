import { parseFootprintCsv } from './footprintCsv'
import type { FootprintPoint } from './footprintTypes'

export async function loadFootprintPoints(
  csvUrl: string | undefined,
  signal: AbortSignal,
): Promise<FootprintPoint[]> {
  const trimmedUrl = csvUrl?.trim()
  if (!trimmedUrl) return []

  const response = await fetch(trimmedUrl, { signal })
  if (!response.ok) {
    throw new Error(`Failed to load footprint CSV: ${response.status}`)
  }

  return parseFootprintCsv(await response.text())
}
