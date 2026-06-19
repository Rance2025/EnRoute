import type { AggregatedFootprintPoint, FootprintPoint, LngLatBounds } from './footprintTypes'

type AggregateInput = {
  points: FootprintPoint[]
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
}

type WorkerResponse = {
  requestId: number
  points: AggregatedFootprintPoint[]
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
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (!this.pendingRequest || event.data.requestId !== this.pendingRequest.requestId) return

      const pendingRequest = this.pendingRequest
      this.pendingRequest = null
      pendingRequest.resolve(event.data.points)
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

    const pendingRequest = this.pendingRequest
    this.pendingRequest = null
    pendingRequest.reject(error)
  }
}
