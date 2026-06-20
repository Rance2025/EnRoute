import { createFootprintRenderSnapshot } from './footprintAggregation'
import type { FootprintPoint, LngLatBounds, WorldPixelPoint } from './footprintTypes'
import type { TimeRangeTimestamps } from '../time/timeRange'

type WorkerRequest = {
  type: 'aggregate'
  requestId: number
  timeRange: TimeRangeTimestamps
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

  const { requestId, timeRange, zoom, cellSizePx, viewportBounds, viewportNorthWestWorldPixel } = event.data

  self.postMessage({
    requestId,
    snapshot: createFootprintRenderSnapshot({
      points,
      timeRange,
      zoom,
      cellSizePx,
      viewportBounds,
      viewportNorthWestWorldPixel,
    }),
  })
}
