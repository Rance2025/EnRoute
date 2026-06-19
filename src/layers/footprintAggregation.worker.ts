import { aggregateFootprintPoints } from './footprintAggregation'
import type { FootprintPoint, LngLatBounds, WorldPixelPoint } from './footprintTypes'

type WorkerRequest = {
  type: 'aggregate'
  requestId: number
  zoom: number
  cellSizePx: number
  viewportBounds: LngLatBounds
  viewportNorthWestWorldPixel: WorldPixelPoint
} | {
  type: 'set-points'
  points: FootprintPoint[]
}

let points: FootprintPoint[] = []

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'set-points') {
    points = event.data.points
    return
  }

  const { requestId, zoom, cellSizePx, viewportBounds, viewportNorthWestWorldPixel } = event.data

  self.postMessage({
    requestId,
    points: aggregateFootprintPoints({
      points,
      zoom,
      cellSizePx,
      viewportBounds,
      viewportNorthWestWorldPixel,
    }),
  })
}
