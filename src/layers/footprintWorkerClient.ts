import type {
  AggregatedFootprintPoint,
  FootprintPoint,
  LngLatBounds,
  WorldPixelPoint,
} from './footprintTypes'

type AggregateInput = {
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
  viewportNorthWestWorldPixel: WorldPixelPoint
}

type SetPointsRequest = {
  type: 'set-points'
  points: FootprintPoint[]
}

type AggregateRequest = AggregateInput & {
  type: 'aggregate'
  requestId: number
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
  private storedPoints: FootprintPoint[] = []
  private readonly workerFactory: () => Worker
  private worker: Worker

  constructor(
    workerFactory: () => Worker = () =>
      new Worker(new URL('./footprintAggregation.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.workerFactory = workerFactory
    this.worker = this.workerFactory()
    this.installWorkerHandlers()
  }

  private installWorkerHandlers() {
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

  setPoints(points: FootprintPoint[]) {
    this.storedPoints = points
    this.worker.postMessage({
      type: 'set-points',
      points,
    } satisfies SetPointsRequest)
  }

  aggregate(input: AggregateInput): Promise<AggregatedFootprintPoint[]> {
    if (this.pendingRequest) {
      this.rejectPending(new Error('Footprint aggregation request superseded'))
      this.worker.terminate()
      this.worker = this.workerFactory()
      this.installWorkerHandlers()
      this.worker.postMessage({
        type: 'set-points',
        points: this.storedPoints,
      } satisfies SetPointsRequest)
    }

    const requestId = this.nextRequestId
    this.nextRequestId += 1

    return new Promise((resolve, reject) => {
      this.pendingRequest = { requestId, resolve, reject }
      this.worker.postMessage({ type: 'aggregate', requestId, ...input } satisfies AggregateRequest)
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
