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
