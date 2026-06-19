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
