import type {
  FootprintRenderSnapshot,
  FootprintPoint,
  LngLatBounds,
  WorldPixelPoint,
} from './footprintTypes'
import type { TimeRangeTimestamps } from '../time/timeRange'

type AggregateInput = {
  timeRange: TimeRangeTimestamps
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
  snapshot: FootprintRenderSnapshot
}

type PendingRequest = {
  requestId: number
  promise: Promise<FootprintRenderSnapshot>
  resolve: (snapshot: FootprintRenderSnapshot) => void
  reject: (error: Error) => void
}

export class FootprintWorkerClient {
  private nextRequestId = 1
  private activeRequestId: number | null = null
  private pendingRequest: PendingRequest | null = null
  private queuedInput: AggregateInput | null = null
  private readonly worker: Worker

  constructor(
    workerFactory: () => Worker = () =>
      new Worker(new URL('./footprintAggregation.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.worker = workerFactory()
    this.installWorkerHandlers()
  }

  private installWorkerHandlers() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId !== this.activeRequestId) return

      this.activeRequestId = null
      if (this.queuedInput) {
        const queuedInput = this.queuedInput
        this.queuedInput = null
        this.postAggregateRequest(queuedInput)
        return
      }

      const pendingRequest = this.pendingRequest
      if (!pendingRequest || event.data.requestId !== pendingRequest.requestId) return
      this.pendingRequest = null
      pendingRequest.resolve(event.data.snapshot)
    }
    this.worker.onerror = () => {
      this.activeRequestId = null
      this.queuedInput = null
      this.rejectPending(new Error('Footprint aggregation worker failed'))
    }
  }

  setPoints(points: FootprintPoint[]) {
    this.worker.postMessage({
      type: 'set-points',
      points,
    } satisfies SetPointsRequest)
  }

  aggregate(input: AggregateInput): Promise<FootprintRenderSnapshot> {
    if (this.activeRequestId !== null) {
      this.rejectPending(new Error('Footprint aggregation request superseded'))
      this.pendingRequest = this.createPendingRequest(input)
      this.queuedInput = input
      return this.pendingRequest.promise
    }

    return this.createPendingRequest(input).promise
  }

  dispose() {
    this.rejectPending(new Error('Footprint aggregation worker disposed'))
    this.activeRequestId = null
    this.queuedInput = null
    this.worker.terminate()
  }

  private createPendingRequest(input: AggregateInput): PendingRequest {
    const requestId = this.nextRequestId
    this.nextRequestId += 1

    let resolveRequest: (snapshot: FootprintRenderSnapshot) => void = () => {}
    let rejectRequest: (error: Error) => void = () => {}
    const promise = new Promise<FootprintRenderSnapshot>((resolve, reject) => {
      resolveRequest = resolve
      rejectRequest = reject
    })
    const pendingRequest: PendingRequest = {
      requestId,
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
    }
    this.pendingRequest = pendingRequest

    if (this.activeRequestId === null) {
      this.postAggregateRequest(input)
    }

    return pendingRequest
  }

  private postAggregateRequest(input: AggregateInput) {
    if (!this.pendingRequest) return

    this.activeRequestId = this.pendingRequest.requestId
    this.worker.postMessage({
      type: 'aggregate',
      requestId: this.pendingRequest.requestId,
      ...input,
    } satisfies AggregateRequest)
  }

  private rejectPending(error: Error) {
    if (!this.pendingRequest) return

    const pendingRequest = this.pendingRequest
    this.pendingRequest = null
    pendingRequest.reject(error)
  }
}
