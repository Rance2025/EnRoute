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
        zoom: 10,
        cellSizePx: 1,
        viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
        viewportNorthWestWorldPixel,
      },
    ])

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 1, points: [] },
      }),
    )

    await expect(aggregation).resolves.toEqual([])
  })

  it('resolves only the latest aggregation request', async () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.setPoints(points)

    const first = client.aggregate({
      zoom: 10,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })
    const firstExpectation = expect(first).rejects.toThrow('superseded')
    const second = client.aggregate({
      zoom: 11,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 2, points: [] },
      }),
    )

    await expect(second).resolves.toEqual([])
    await firstExpectation
  })

  it('restarts the worker when replacing a pending aggregation request', async () => {
    const firstWorker = new FakeWorker()
    const secondWorker = new FakeWorker()
    const workers = [firstWorker, secondWorker]
    const client = new FootprintWorkerClient(() => workers.shift() as unknown as Worker)

    client.setPoints(points)
    const first = client.aggregate({
      zoom: 10,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })
    const firstExpectation = expect(first).rejects.toThrow('superseded')
    const second = client.aggregate({
      zoom: 11,
      cellSizePx: 10,
      viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
      viewportNorthWestWorldPixel,
    })

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)
    expect(secondWorker.postedMessages).toEqual([
      {
        type: 'set-points',
        points,
      },
      {
        type: 'aggregate',
        requestId: 2,
        zoom: 11,
        cellSizePx: 10,
        viewportBounds: { west: 0, south: 0, east: 1, north: 1 },
        viewportNorthWestWorldPixel,
      },
    ])

    secondWorker.onmessage?.(
      new MessageEvent('message', {
        data: { requestId: 2, points: [] },
      }),
    )

    await expect(second).resolves.toEqual([])
    await firstExpectation
  })

  it('terminates the worker on dispose', () => {
    const worker = new FakeWorker()
    const client = new FootprintWorkerClient(() => worker as unknown as Worker)

    client.dispose()

    expect(worker.terminate).toHaveBeenCalled()
  })
})
