import { describe, expect, it, vi } from 'vitest'

import { FootprintWorkerClient } from './footprintWorkerClient'
import type { FootprintPoint } from './footprintTypes'

const points: FootprintPoint[] = [
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
]

const viewportNorthWestWorldPixel = { x: 100, y: 200 }
const timeRange = {
  startTimestampSeconds: 1,
  endTimestampSeconds: 2,
  dayCount: 1,
}
const emptySnapshot = {
  points: [],
  metrics: {
    selectedCount: 0,
    totalDistanceMeters: 0,
    averageDistanceMetersPerDay: 0,
  },
  selectedBounds: null,
}

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
  it('stores raw points once and only sends viewport inputs for aggregation', async () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.setPoints(points)
    const aggregation = client.aggregate({
      timeRange,
      zoom: 10,
      cellSizePx: 1,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
      viewportNorthWestWorldPixel,
    })

    expect(worker.postedMessages).toEqual([
      {
        type: 'set-points',
        points,
      },
      {
        type: 'aggregate',
        requestId: 1,
        timeRange,
        zoom: 10,
        cellSizePx: 1,
        viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
        viewportNorthWestWorldPixel,
      },
    ])

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 1, snapshot: emptySnapshot },
      }),
    )

    await expect(aggregation).resolves.toEqual(emptySnapshot)
  })

  it('resolves only the latest aggregation request after the active worker job finishes', async () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.setPoints(points)

    const first = client.aggregate({
      timeRange,
      zoom: 10,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })
    const firstExpectation = expect(first).rejects.toThrow('superseded')
    const second = client.aggregate({
      timeRange,
      zoom: 11,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })

    expect(worker.terminate).not.toHaveBeenCalled()
    expect(worker.postedMessages).toEqual([
      {
        type: 'set-points',
        points,
      },
      {
        type: 'aggregate',
        requestId: 1,
        timeRange,
        zoom: 10,
        cellSizePx: 10,
        viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
        viewportNorthWestWorldPixel,
      },
    ])

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 1, snapshot: emptySnapshot },
      }),
    )
    expect(worker.postedMessages[2]).toMatchObject({
      type: 'aggregate',
      requestId: 2,
      zoom: 11,
    })

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 2, snapshot: emptySnapshot },
      }),
    )

    await expect(second).resolves.toEqual(emptySnapshot)
    await firstExpectation
  })

  it('coalesces multiple superseded aggregation requests without restarting the worker', async () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.setPoints(points)
    const first = client.aggregate({
      timeRange,
      zoom: 10,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })
    const firstExpectation = expect(first).rejects.toThrow('superseded')
    const second = client.aggregate({
      timeRange,
      zoom: 11,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })
    const secondExpectation = expect(second).rejects.toThrow('superseded')
    const third = client.aggregate({
      timeRange,
      zoom: 12,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })

    expect(worker.terminate).not.toHaveBeenCalled()
    expect(worker.postedMessages).toEqual([
      {
        type: 'set-points',
        points,
      },
      {
        type: 'aggregate',
        requestId: 1,
        timeRange,
        zoom: 10,
        cellSizePx: 10,
        viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
        viewportNorthWestWorldPixel,
      },
    ])

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 1, snapshot: emptySnapshot },
      }),
    )

    expect(worker.postedMessages).toHaveLength(3)
    expect(worker.postedMessages[2]).toMatchObject({
      type: 'aggregate',
      requestId: 3,
      zoom: 12,
    })

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 3, snapshot: emptySnapshot },
      }),
    )

    await expect(third).resolves.toEqual(emptySnapshot)
    await firstExpectation
    await secondExpectation
  })

  it('clears active worker state after an error so later requests can run', async () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.setPoints(points)
    const failed = client.aggregate({
      timeRange,
      zoom: 10,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })

    worker.onerror?.(new ErrorEvent('error'))

    await expect(failed).rejects.toThrow('failed')

    const recovered = client.aggregate({
      timeRange,
      zoom: 11,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })

    expect(worker.postedMessages[2]).toMatchObject({
      type: 'aggregate',
      requestId: 2,
      zoom: 11,
    })

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 2, snapshot: emptySnapshot },
      }),
    )

    await expect(recovered).resolves.toEqual(emptySnapshot)
  })

  it('terminates the worker on dispose', () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.dispose()

    expect(worker.terminate).toHaveBeenCalled()
  })
})
