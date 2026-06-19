# Footprint Glow Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render local lifetime footprint data as tiny glow points on the existing AMap page, using settle-time screen-space aggregation and AMap Loca drawing.

**Architecture:** Keep raw point parsing, aggregation, worker orchestration, and Loca rendering under `src/layers/`. React owns only the map lifecycle and event wiring; it never renders individual points. Aggregation runs after `moveend` and `zoomend`, not during continuous map motion.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, AMap JS API 2.0, Loca 2.0, Web Worker, CSS.

---

### File Structure

- Modify: `.gitignore` to ignore personal sample data and local derived data.
- Modify: `.env.example` to document the optional local footprint CSV URL.
- Modify: `package.json` to add a local sample preparation script.
- Create: `scripts/prepare-local-footprints.mjs` to copy `external/backUpData-all.csv` into ignored `public/local/backUpData-all.csv`.
- Create: `src/layers/footprintTypes.ts` for shared point and aggregation types.
- Create: `src/layers/footprintCsv.ts` and `src/layers/footprintCsv.test.ts` for CSV parsing.
- Create: `src/layers/footprintAggregation.ts` and `src/layers/footprintAggregation.test.ts` for pure screen-space aggregation.
- Create: `src/layers/footprintDataSource.ts` and `src/layers/footprintDataSource.test.ts` for optional fetch/load behavior.
- Create: `src/layers/footprintWorkerClient.ts` and `src/layers/footprintAggregation.worker.ts` for async aggregation.
- Create: `src/layers/locaFootprintLayer.ts` and `src/layers/locaFootprintLayer.test.ts` for Loca lifecycle and GeoJSON conversion.
- Modify: `src/services/amapLoader.ts` to load Loca 2.0 with AMap JS API 2.0.
- Modify: `src/types/amap.d.ts` and create `src/types/loca.d.ts` for local runtime declarations.
- Modify: `src/components/AmapCanvas.tsx` to load points, attach settle events, and update the layer.
- Modify: `src/layers/README.md` to document the settled aggregation boundary.

### Task 1: Protect Local Location Data

**Files:**

- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `package.json`
- Create: `scripts/prepare-local-footprints.mjs`

- [ ] **Step 1: Add ignore rules for local personal data**

Append these lines to `.gitignore`:

```gitignore

# Local personal data samples
external/
public/local/
```

- [ ] **Step 2: Document the optional local data URL**

Append this line to `.env.example`:

```env
VITE_FOOTPRINT_DATA_URL=/local/backUpData-all.csv
```

- [ ] **Step 3: Add the local sample preparation script**

Add a script entry to `package.json`:

```json
"prepare:footprints": "node scripts/prepare-local-footprints.mjs"
```

Create `scripts/prepare-local-footprints.mjs`:

```js
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve('external/backUpData-all.csv')
const target = resolve('public/local/backUpData-all.csv')

await stat(source)
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)

console.log(`Copied ${source} to ${target}`)
```

- [ ] **Step 4: Verify script behavior**

Run:

```powershell
npm run prepare:footprints
```

Expected: `public/local/backUpData-all.csv` exists and remains ignored by git.

- [ ] **Step 5: Verify git does not stage personal data**

Run:

```powershell
git status --short --ignored
```

Expected: `external/` and `public/local/` appear as ignored entries, not untracked entries.

### Task 2: Parse Footprint CSV

**Files:**

- Create: `src/layers/footprintTypes.ts`
- Create: `src/layers/footprintCsv.ts`
- Create: `src/layers/footprintCsv.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Create `src/layers/footprintCsv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { parseFootprintCsv } from './footprintCsv'

describe('parseFootprintCsv', () => {
  it('parses one exported location row with a seconds timestamp', () => {
    const csv = [
      'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
      '1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956',
    ].join('\n')

    expect(parseFootprintCsv(csv)).toEqual([
      {
        id: '1768144456-0',
        timestampSeconds: 1768144456,
        longitude: 121.511383,
        latitude: 31.296564,
        accuracy: 5.729415,
        speed: -1,
        distance: 0,
        heading: 0,
        altitude: 10.146956,
        locType: 1,
        isBackForeground: 1,
        stepType: 0,
      },
    ])
  })

  it('skips blank lines and rows with invalid coordinates', () => {
    const csv = [
      'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
      '',
      '1768144456,1,181,31.296564,0,5,-1,0,1,0,10',
      '1768144457,1,121.5,91,0,5,-1,0,1,0,10',
      '1768144458,1,121.5,31.2,0,5,-1,0,1,0,10',
    ].join('\n')

    expect(parseFootprintCsv(csv)).toHaveLength(1)
    expect(parseFootprintCsv(csv)[0].timestampSeconds).toBe(1768144458)
  })
})
```

- [ ] **Step 2: Run parser tests and confirm failure**

Run:

```powershell
npm test -- --run src/layers/footprintCsv.test.ts
```

Expected: fail because `src/layers/footprintCsv.ts` does not exist.

- [ ] **Step 3: Add shared types**

Create `src/layers/footprintTypes.ts`:

```ts
export type FootprintPoint = {
  id: string
  timestampSeconds: number
  longitude: number
  latitude: number
  accuracy: number
  speed: number
  distance: number
  heading: number
  altitude: number
  locType: number
  isBackForeground: number
  stepType: number
}

export type AggregatedFootprintPoint = {
  id: string
  longitude: number
  latitude: number
  count: number
  minAccuracy: number
  startTimestampSeconds: number
  endTimestampSeconds: number
}

export type LngLatBounds = {
  west: number
  south: number
  east: number
  north: number
}
```

- [ ] **Step 4: Implement the CSV parser**

Create `src/layers/footprintCsv.ts`:

```ts
import type { FootprintPoint } from './footprintTypes'

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

export function parseFootprintCsv(csv: string): FootprintPoint[] {
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
    const point = parseRow(cells, columnIndex, rowIndex)
    return point ? [point] : []
  })
}

function parseRow(
  cells: string[],
  columnIndex: Map<string, number>,
  rowIndex: number,
): FootprintPoint | null {
  const value = (column: string) => Number(cells[columnIndex.get(column) ?? -1])
  const longitude = value('longitude')
  const latitude = value('latitude')
  const timestampSeconds = value('dataTime')

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return null

  return {
    id: `${Math.trunc(timestampSeconds)}-${rowIndex}`,
    timestampSeconds: Math.trunc(timestampSeconds),
    longitude,
    latitude,
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
```

- [ ] **Step 5: Run parser tests and confirm pass**

Run:

```powershell
npm test -- --run src/layers/footprintCsv.test.ts
```

Expected: pass.

### Task 3: Implement Screen-Space Aggregation

**Files:**

- Create: `src/layers/footprintAggregation.ts`
- Create: `src/layers/footprintAggregation.test.ts`
- Modify: `src/layers/footprintTypes.ts`

- [ ] **Step 1: Write failing aggregation tests**

Create `src/layers/footprintAggregation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { aggregateFootprintPoints } from './footprintAggregation'
import type { FootprintPoint } from './footprintTypes'

const basePoint: Omit<FootprintPoint, 'id' | 'longitude' | 'latitude' | 'timestampSeconds'> = {
  accuracy: 5,
  speed: -1,
  distance: 0,
  heading: 0,
  altitude: 0,
  locType: 1,
  isBackForeground: 1,
  stepType: 0,
}

function point(id: string, longitude: number, latitude: number): FootprintPoint {
  return {
    ...basePoint,
    id,
    longitude,
    latitude,
    timestampSeconds: 1768144456 + Number(id),
  }
}

describe('aggregateFootprintPoints', () => {
  it('merges points that land in the same screen-space bucket', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', 121.511383, 31.296564), point('2', 121.511384, 31.296565)],
      zoom: 16,
      cellSizePx: 8,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(2)
  })

  it('returns more representatives when zoom increases', () => {
    const points = [point('1', 121.511383, 31.296564), point('2', 121.5122, 31.2973)]
    const lowZoom = aggregateFootprintPoints({
      points,
      zoom: 12,
      cellSizePx: 12,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })
    const highZoom = aggregateFootprintPoints({
      points,
      zoom: 18,
      cellSizePx: 12,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })

    expect(lowZoom.length).toBeLessThanOrEqual(highZoom.length)
  })

  it('filters points outside the padded viewport bounds', () => {
    const result = aggregateFootprintPoints({
      points: [point('1', 121.511383, 31.296564), point('2', 118, 30)],
      zoom: 14,
      cellSizePx: 8,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(1)
  })
})
```

- [ ] **Step 2: Run aggregation tests and confirm failure**

Run:

```powershell
npm test -- --run src/layers/footprintAggregation.test.ts
```

Expected: fail because `src/layers/footprintAggregation.ts` does not exist.

- [ ] **Step 3: Implement pure aggregation**

Create `src/layers/footprintAggregation.ts`:

```ts
import { projectLngLat, unprojectWorldPoint } from '../config/mercator'
import type { AggregatedFootprintPoint, FootprintPoint, LngLatBounds } from './footprintTypes'

type AggregateFootprintPointsInput = {
  points: FootprintPoint[]
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
}

type Bucket = {
  count: number
  sumX: number
  sumY: number
  minAccuracy: number
  startTimestampSeconds: number
  endTimestampSeconds: number
}

export function aggregateFootprintPoints({
  points,
  zoom,
  cellSizePx,
  viewportBounds,
}: AggregateFootprintPointsInput): AggregatedFootprintPoint[] {
  const buckets = new Map<string, Bucket>()

  for (const point of points) {
    if (!isPointInsideBounds(point, viewportBounds)) continue

    const projected = projectLngLat([point.longitude, point.latitude], zoom)
    const bucketX = Math.floor(projected.x / cellSizePx)
    const bucketY = Math.floor(projected.y / cellSizePx)
    const key = `${bucketX}:${bucketY}`
    const bucket = buckets.get(key)

    if (!bucket) {
      buckets.set(key, {
        count: 1,
        sumX: projected.x,
        sumY: projected.y,
        minAccuracy: point.accuracy,
        startTimestampSeconds: point.timestampSeconds,
        endTimestampSeconds: point.timestampSeconds,
      })
      continue
    }

    bucket.count += 1
    bucket.sumX += projected.x
    bucket.sumY += projected.y
    bucket.minAccuracy = Math.min(bucket.minAccuracy, point.accuracy)
    bucket.startTimestampSeconds = Math.min(bucket.startTimestampSeconds, point.timestampSeconds)
    bucket.endTimestampSeconds = Math.max(bucket.endTimestampSeconds, point.timestampSeconds)
  }

  return [...buckets.entries()].map(([key, bucket]) => {
    const [longitude, latitude] = unprojectWorldPoint(
      {
        x: bucket.sumX / bucket.count,
        y: bucket.sumY / bucket.count,
      },
      zoom,
    )

    return {
      id: key,
      longitude,
      latitude,
      count: bucket.count,
      minAccuracy: bucket.minAccuracy,
      startTimestampSeconds: bucket.startTimestampSeconds,
      endTimestampSeconds: bucket.endTimestampSeconds,
    }
  })
}

function isPointInsideBounds(point: FootprintPoint, bounds: LngLatBounds) {
  return (
    point.longitude >= bounds.west &&
    point.longitude <= bounds.east &&
    point.latitude >= bounds.south &&
    point.latitude <= bounds.north
  )
}
```

- [ ] **Step 4: Run aggregation tests and confirm pass**

Run:

```powershell
npm test -- --run src/layers/footprintAggregation.test.ts
```

Expected: pass.

### Task 4: Load Optional Local Data

**Files:**

- Create: `src/layers/footprintDataSource.ts`
- Create: `src/layers/footprintDataSource.test.ts`

- [ ] **Step 1: Write failing data source tests**

Create `src/layers/footprintDataSource.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadFootprintPoints } from './footprintDataSource'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadFootprintPoints', () => {
  it('returns an empty list when no URL is configured', async () => {
    await expect(loadFootprintPoints('', new AbortController().signal)).resolves.toEqual([])
  })

  it('fetches and parses the configured CSV URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          [
            'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
            '1768144456,1,121.511383,31.296564,0,5,-1,0,1,0,10',
          ].join('\n'),
      })),
    )

    const points = await loadFootprintPoints('/local/backUpData-all.csv', new AbortController().signal)

    expect(points).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith('/local/backUpData-all.csv', {
      signal: expect.any(AbortSignal),
    })
  })
})
```

- [ ] **Step 2: Run data source tests and confirm failure**

Run:

```powershell
npm test -- --run src/layers/footprintDataSource.test.ts
```

Expected: fail because `src/layers/footprintDataSource.ts` does not exist.

- [ ] **Step 3: Implement optional CSV loading**

Create `src/layers/footprintDataSource.ts`:

```ts
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
```

- [ ] **Step 4: Run data source tests and confirm pass**

Run:

```powershell
npm test -- --run src/layers/footprintDataSource.test.ts
```

Expected: pass.

### Task 5: Add Worker Client For Settle-Time Aggregation

**Files:**

- Create: `src/layers/footprintAggregation.worker.ts`
- Create: `src/layers/footprintWorkerClient.ts`
- Create: `src/layers/footprintWorkerClient.test.ts`

- [ ] **Step 1: Write failing worker client tests using an injected worker**

Create `src/layers/footprintWorkerClient.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { FootprintWorkerClient } from './footprintWorkerClient'

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postedMessages: unknown[] = []

  postMessage(message: unknown) {
    this.postedMessages.push(message)
  }

  terminate = vi.fn()
}

describe('FootprintWorkerClient', () => {
  it('resolves only the latest aggregation request', async () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)
    const first = client.aggregate({
      points: [],
      zoom: 10,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
    })
    const second = client.aggregate({
      points: [],
      zoom: 11,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
    })

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 2, points: [] },
      }),
    )

    await expect(second).resolves.toEqual([])
    await expect(first).rejects.toThrow('superseded')
  })

  it('terminates the worker on dispose', () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.dispose()

    expect(worker.terminate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run worker client tests and confirm failure**

Run:

```powershell
npm test -- --run src/layers/footprintWorkerClient.test.ts
```

Expected: fail because `src/layers/footprintWorkerClient.ts` does not exist.

- [ ] **Step 3: Implement the worker script**

Create `src/layers/footprintAggregation.worker.ts`:

```ts
import { aggregateFootprintPoints } from './footprintAggregation'
import type { FootprintPoint, LngLatBounds } from './footprintTypes'

type WorkerRequest = {
  requestId: number
  points: FootprintPoint[]
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, points, zoom, cellSizePx, viewportBounds } = event.data
  self.postMessage({
    requestId,
    points: aggregateFootprintPoints({
      points,
      zoom,
      cellSizePx,
      viewportBounds,
    }),
  })
}
```

- [ ] **Step 4: Implement the worker client**

Create `src/layers/footprintWorkerClient.ts`:

```ts
import type { AggregatedFootprintPoint, FootprintPoint, LngLatBounds } from './footprintTypes'

type AggregateInput = {
  points: FootprintPoint[]
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
}

type PendingRequest = {
  requestId: number
  resolve: (points: AggregatedFootprintPoint[]) => void
  reject: (error: Error) => void
}

export class FootprintWorkerClient {
  private nextRequestId = 1
  private pendingRequest: PendingRequest | null = null
  private readonly worker: Worker

  constructor(
    workerFactory: () => Worker = () =>
      new Worker(new URL('./footprintAggregation.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.worker = workerFactory()
    this.worker.onmessage = (event: MessageEvent<{ requestId: number; points: AggregatedFootprintPoint[] }>) => {
      if (!this.pendingRequest || event.data.requestId !== this.pendingRequest.requestId) return
      const pending = this.pendingRequest
      this.pendingRequest = null
      pending.resolve(event.data.points)
    }
    this.worker.onerror = () => {
      this.rejectPending(new Error('Footprint aggregation worker failed'))
    }
  }

  aggregate(input: AggregateInput): Promise<AggregatedFootprintPoint[]> {
    this.rejectPending(new Error('Footprint aggregation request superseded'))
    const requestId = this.nextRequestId
    this.nextRequestId += 1

    return new Promise((resolve, reject) => {
      this.pendingRequest = { requestId, resolve, reject }
      this.worker.postMessage({ requestId, ...input })
    })
  }

  dispose() {
    this.rejectPending(new Error('Footprint aggregation worker disposed'))
    this.worker.terminate()
  }

  private rejectPending(error: Error) {
    if (!this.pendingRequest) return
    const pending = this.pendingRequest
    this.pendingRequest = null
    pending.reject(error)
  }
}
```

- [ ] **Step 5: Run worker tests and confirm pass**

Run:

```powershell
npm test -- --run src/layers/footprintWorkerClient.test.ts
```

Expected: pass.

### Task 6: Add Loca Runtime Types And Layer Wrapper

**Files:**

- Create: `src/types/loca.d.ts`
- Create: `src/layers/locaFootprintLayer.ts`
- Create: `src/layers/locaFootprintLayer.test.ts`
- Modify: `src/services/amapLoader.ts`

- [ ] **Step 1: Write failing layer wrapper tests**

Create `src/layers/locaFootprintLayer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { createFootprintGeoJson, createLocaFootprintLayer } from './locaFootprintLayer'

describe('createFootprintGeoJson', () => {
  it('converts aggregated points into GeoJSON features', () => {
    expect(
      createFootprintGeoJson([
        {
          id: 'a',
          longitude: 121.5,
          latitude: 31.2,
          count: 3,
          minAccuracy: 5,
          startTimestampSeconds: 1,
          endTimestampSeconds: 2,
        },
      ]),
    ).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'a',
            count: 3,
            minAccuracy: 5,
            startTimestampSeconds: 1,
            endTimestampSeconds: 2,
          },
          geometry: {
            type: 'Point',
            coordinates: [121.5, 31.2],
          },
        },
      ],
    })
  })
})

describe('createLocaFootprintLayer', () => {
  it('updates source data and destroys the container', () => {
    const setSource = vi.fn()
    const setStyle = vi.fn()
    const destroy = vi.fn()
    const add = vi.fn()
    const map = {}
    const Loca = {
      Container: vi.fn(() => ({ add, destroy })),
      PointLayer: vi.fn(() => ({ setSource, setStyle })),
      GeoJSONSource: vi.fn((options: unknown) => options),
    } as unknown as typeof globalThis.Loca

    const layer = createLocaFootprintLayer(Loca, map as AMap.Map)
    layer.update([])
    layer.destroy()

    expect(Loca.Container).toHaveBeenCalledWith({ map })
    expect(setStyle).toHaveBeenCalled()
    expect(setSource).toHaveBeenCalled()
    expect(add).toHaveBeenCalled()
    expect(destroy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run layer wrapper tests and confirm failure**

Run:

```powershell
npm test -- --run src/layers/locaFootprintLayer.test.ts
```

Expected: fail because `src/layers/locaFootprintLayer.ts` does not exist.

- [ ] **Step 3: Add minimal Loca declarations**

Create `src/types/loca.d.ts`:

```ts
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
```

- [ ] **Step 4: Implement the Loca footprint wrapper**

Create `src/layers/locaFootprintLayer.ts`:

```ts
import type { AggregatedFootprintPoint } from './footprintTypes'

export function createFootprintGeoJson(points: AggregatedFootprintPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      properties: {
        id: point.id,
        count: point.count,
        minAccuracy: point.minAccuracy,
        startTimestampSeconds: point.startTimestampSeconds,
        endTimestampSeconds: point.endTimestampSeconds,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [point.longitude, point.latitude] as [number, number],
      },
    })),
  }
}

export function createLocaFootprintLayer(LocaRuntime: typeof Loca, map: AMap.Map) {
  const container = new LocaRuntime.Container({ map })
  const pointLayer = new LocaRuntime.PointLayer({
    zIndex: 20,
    opacity: 0.9,
    visible: true,
    blend: 'lighter',
  })

  pointLayer.setStyle({
    unit: 'px',
    radius: (_index, feature) => Math.min(5, 1.5 + Math.log2((feature.properties.count ?? 1) + 1)),
    color: 'rgba(255, 225, 154, 0.92)',
    borderWidth: 0,
    blurWidth: 5,
  })
  container.add(pointLayer)

  return {
    update(points: AggregatedFootprintPoint[]) {
      pointLayer.setSource(new LocaRuntime.GeoJSONSource({ data: createFootprintGeoJson(points) }))
    },
    destroy() {
      container.destroy()
    },
  }
}
```

- [ ] **Step 5: Load Loca 2.0 from the AMap loader**

Modify `src/services/amapLoader.ts`:

```ts
  return AMapLoader.load({
    key: config.key,
    version: '2.0',
    plugins: ['AMap.Geolocation', 'AMap.Scale'],
    Loca: {
      version: '2.0.0',
    },
  }) as Promise<AMapNamespace>
```

- [ ] **Step 6: Run layer wrapper tests and confirm pass**

Run:

```powershell
npm test -- --run src/layers/locaFootprintLayer.test.ts
```

Expected: pass.

### Task 7: Wire The Layer Into AmapCanvas

**Files:**

- Modify: `src/components/AmapCanvas.tsx`
- Modify: `src/types/amap.d.ts`
- Create: `src/components/AmapCanvas.footprints.test.tsx`

- [ ] **Step 1: Extend local AMap event and container type declarations**

Modify `src/types/amap.d.ts`:

```ts
    on(eventName: string, callback: () => void): void
    off(eventName: string, callback: () => void): void
```

Keep the existing signatures as-is if they already match this shape. No event object is needed for this phase.

- [ ] **Step 2: Write a focused wiring test**

Create `src/components/AmapCanvas.footprints.test.tsx` with module mocks for `loadFootprintPoints`, `FootprintWorkerClient`, and `createLocaFootprintLayer`. The test should render `AmapCanvas` with configured AMap credentials, trigger the mocked `moveend` callback, and assert that the Loca layer receives aggregated points only after the settle event.

Use this test shape:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('AmapCanvas footprint layer wiring', () => {
  it('updates footprint points after a map settle event', async () => {
    const moveEndHandlers: Array<() => void> = []
    const zoomEndHandlers: Array<() => void> = []
    const update = vi.fn()

    vi.doMock('../layers/footprintDataSource', () => ({
      loadFootprintPoints: vi.fn(async () => [
        {
          id: '1',
          timestampSeconds: 1,
          longitude: 121.5,
          latitude: 31.2,
          accuracy: 5,
          speed: -1,
          distance: 0,
          heading: 0,
          altitude: 0,
          locType: 1,
          isBackForeground: 1,
          stepType: 0,
        },
      ]),
    }))
    vi.doMock('../layers/footprintWorkerClient', () => ({
      FootprintWorkerClient: vi.fn(() => ({
        aggregate: vi.fn(async () => [
          {
            id: 'bucket',
            longitude: 121.5,
            latitude: 31.2,
            count: 1,
            minAccuracy: 5,
            startTimestampSeconds: 1,
            endTimestampSeconds: 1,
          },
        ]),
        dispose: vi.fn(),
      })),
    }))
    vi.doMock('../layers/locaFootprintLayer', () => ({
      createLocaFootprintLayer: vi.fn(() => ({
        update,
        destroy: vi.fn(),
      })),
    }))
    vi.doMock('../services/amapLoader', () => ({
      loadAmap: vi.fn(async () => ({
        Map: vi.fn(function Map() {
          return {
            addControl: vi.fn(),
            destroy: vi.fn(),
            resize: vi.fn(),
            on: vi.fn((eventName: string, callback: () => void) => {
              if (eventName === 'moveend') moveEndHandlers.push(callback)
              if (eventName === 'zoomend') zoomEndHandlers.push(callback)
            }),
            off: vi.fn(),
            getZoom: vi.fn(() => 10),
            getCenter: vi.fn(() => ({ getLng: () => 121.5, getLat: () => 31.2 })),
            lnglatToPixel: vi.fn(() => ({ x: 0, y: 0 })),
            lngLatToContainer: vi.fn(() => ({ x: 0, y: 0 })),
            containerToLngLat: vi.fn(() => ({ getLng: () => 121, getLat: () => 31 })),
            setZoomAndCenter: vi.fn(),
            setPitch: vi.fn(),
            setRotation: vi.fn(),
            setStatus: vi.fn(),
            getPitch: vi.fn(() => 0),
            getRotation: vi.fn(() => 0),
          }
        }),
        Scale: vi.fn(),
        Geolocation: vi.fn(),
        Bounds: vi.fn(),
        plugin: vi.fn((_name: string, callback: () => void) => callback()),
      })),
      AMapNamespace: {},
    }))

    const { AmapCanvas } = await import('./AmapCanvas')

    render(
      <AmapCanvas
        config={{
          key: 'key',
          securityJsCode: 'security',
          isConfigured: true,
          missingKeys: [],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: { southWest: [73.3, 17.8], northEast: [135.1, 53.7] },
          renderBounds: { southWest: [-180, -85.05112878], northEast: [180, 85.05112878] },
          themes: [{ id: 'whitesmoke', name: 'whitesmoke', style: 'amap://styles/whitesmoke' }],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    await waitFor(() => expect(moveEndHandlers).toHaveLength(1))
    moveEndHandlers[0]()

    await waitFor(() => expect(update).toHaveBeenCalled())
  })
})
```

If this test conflicts with existing module cache behavior, use `vi.resetModules()` in `afterEach`.

- [ ] **Step 3: Run wiring test and confirm failure**

Run:

```powershell
npm test -- --run src/components/AmapCanvas.footprints.test.tsx
```

Expected: fail because `AmapCanvas` has not created the footprint layer.

- [ ] **Step 4: Add settle-time footprint orchestration**

Modify `src/components/AmapCanvas.tsx`:

```ts
import { loadFootprintPoints } from '../layers/footprintDataSource'
import { FootprintWorkerClient } from '../layers/footprintWorkerClient'
import { createLocaFootprintLayer } from '../layers/locaFootprintLayer'
import type { FootprintPoint, LngLatBounds } from '../layers/footprintTypes'
```

Add refs:

```ts
  const footprintLayerRef = useRef<ReturnType<typeof createLocaFootprintLayer> | null>(null)
  const footprintWorkerRef = useRef<FootprintWorkerClient | null>(null)
  const footprintPointsRef = useRef<FootprintPoint[]>([])
  const footprintSettleTimerRef = useRef<number | null>(null)
  const footprintAbortControllerRef = useRef<AbortController | null>(null)
```

After map creation and `setStatus('ready')`, initialize local data if `window.Loca` exists:

```ts
        if (window.Loca) {
          footprintLayerRef.current = createLocaFootprintLayer(window.Loca, map)
          footprintWorkerRef.current = new FootprintWorkerClient()
          footprintAbortControllerRef.current = new AbortController()
          loadFootprintPoints(import.meta.env.VITE_FOOTPRINT_DATA_URL, footprintAbortControllerRef.current.signal)
            .then((points) => {
              if (disposed) return
              footprintPointsRef.current = points
              scheduleFootprintUpdate(map, mapNodeRef.current)
            })
            .catch((error: unknown) => {
              if (!disposed && import.meta.env.DEV) console.warn(error)
            })
        }
```

Add settle handlers:

```ts
        const updateFootprintsAfterSettle = () => scheduleFootprintUpdate(map, mapNodeRef.current)
        map.on('moveend', updateFootprintsAfterSettle)
        map.on('zoomend', updateFootprintsAfterSettle)
```

Add cleanup:

```ts
      if (footprintSettleTimerRef.current !== null) {
        window.clearTimeout(footprintSettleTimerRef.current)
        footprintSettleTimerRef.current = null
      }
      footprintAbortControllerRef.current?.abort()
      footprintAbortControllerRef.current = null
      footprintWorkerRef.current?.dispose()
      footprintWorkerRef.current = null
      footprintLayerRef.current?.destroy()
      footprintLayerRef.current = null
      footprintPointsRef.current = []
```

Add helper functions inside the component:

```ts
  function scheduleFootprintUpdate(map: AMap.Map, container: HTMLElement | null) {
    if (!container || !footprintLayerRef.current || !footprintWorkerRef.current) return
    if (footprintSettleTimerRef.current !== null) {
      window.clearTimeout(footprintSettleTimerRef.current)
    }
    footprintSettleTimerRef.current = window.setTimeout(() => {
      const viewportBounds = getPaddedViewportBounds(map, container, 0.25)
      footprintWorkerRef.current
        ?.aggregate({
          points: footprintPointsRef.current,
          zoom: map.getZoom(),
          cellSizePx: 8,
          viewportBounds,
        })
        .then((points) => {
          footprintLayerRef.current?.update(points)
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message.includes('superseded')) return
          if (import.meta.env.DEV) console.warn(error)
        })
    }, 160)
  }
```

Add a module-level helper below `toAmapBounds`:

```ts
function getPaddedViewportBounds(
  map: AMap.Map,
  container: HTMLElement,
  paddingRatio: number,
): LngLatBounds {
  const paddingX = container.clientWidth * paddingRatio
  const paddingY = container.clientHeight * paddingRatio
  const corners = [
    map.containerToLngLat({ x: -paddingX, y: -paddingY }),
    map.containerToLngLat({ x: container.clientWidth + paddingX, y: container.clientHeight + paddingY }),
  ]
  const lngs = corners.map((corner) => corner.getLng())
  const lats = corners.map((corner) => corner.getLat())

  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  }
}
```

- [ ] **Step 5: Run wiring test and confirm pass**

Run:

```powershell
npm test -- --run src/components/AmapCanvas.footprints.test.tsx
```

Expected: pass.

### Task 8: Update Layer Documentation

**Files:**

- Modify: `src/layers/README.md`
- Modify: `README.md`

- [ ] **Step 1: Update `src/layers/README.md`**

Replace its point-layer note with:

```md
- `pointLayer`: Loca-rendered footprint glow points. Raw points are parsed once, then screen-space aggregated after `moveend` and `zoomend`; React does not render individual points.
```

- [ ] **Step 2: Update `README.md`**

Add a short local data paragraph:

```md
Optional local footprint samples can be served from `public/local/` by setting
`VITE_FOOTPRINT_DATA_URL=/local/backUpData-all.csv`. Keep personal exports in
`external/` and run `npm run prepare:footprints` to copy the ignored sample into
the ignored local public folder.
```

- [ ] **Step 3: Run documentation-adjacent tests**

Run:

```powershell
npm test -- --run src/config/toolingIgnore.test.ts
```

Expected: pass. If the ignore test expects a fixed list, extend it to include `external/` and `public/local/`.

### Task 9: Full Verification

**Files:**

- No additional files.

- [ ] **Step 1: Run focused layer tests**

Run:

```powershell
npm test -- --run src/layers/footprintCsv.test.ts src/layers/footprintAggregation.test.ts src/layers/footprintDataSource.test.ts src/layers/footprintWorkerClient.test.ts src/layers/locaFootprintLayer.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 2: Run full tests**

Run:

```powershell
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code 0.

- [ ] **Step 4: Run build**

Run:

```powershell
npm run build
```

Expected: exit code 0.

- [ ] **Step 5: Browser verification with local data**

Run:

```powershell
npm run prepare:footprints
npm run dev -- --host 127.0.0.1 --port 5173
```

Open the app and verify:

- The AMap base surface renders.
- Glow points appear after the map settles.
- Dragging and zooming remain smooth while moving.
- Points refresh after `moveend` and `zoomend`.
- The map stays 2D with no compass.
- The console has no AMap or Loca runtime errors.
