import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TimeRangeSelection } from '../time/timeRange'

type MockMapRecord = {
  options: Record<string, unknown>
  sources: Record<string, unknown>
  layers: unknown[]
  removedLayers: string[]
  removedSources: string[]
  paintProperties: Array<[string, string, unknown]>
  removeCalls: number
  emit: (eventName: string) => void
}

const selectedRange: TimeRangeSelection = {
  mode: 'day',
  start: '2026-06-19',
  end: '2026-06-19',
  anchorDate: '2026-06-19',
}

const allRange: TimeRangeSelection = {
  mode: 'custom',
  start: '2022-03-01',
  end: '2026-06-19',
  anchorDate: '2026-06-19',
  label: 'All',
  isOpenEnded: true,
}

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
  vi.doUnmock('mapbox-gl')
  vi.doUnmock('../layers/footprintDataSource')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('MapboxCanvas footprint vector tiles', () => {
  it('initializes Mapbox as a fixed 2D mercator map at max zoom 18 and adds the footprint vector circle layer', async () => {
    const { mapRecords, footprintDataSourceImported } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        styleUrl="mapbox://styles/enroute/test"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={selectedRange}
      />,
    )

    expect(mapRecords).toHaveLength(1)
    expect(mapRecords[0].options).toMatchObject({
      dragRotate: false,
      maxPitch: 0,
      maxZoom: 18,
      minPitch: 0,
      pitch: 0,
      projection: 'mercator',
      renderWorldCopies: true,
      style: 'mapbox://styles/enroute/test',
      touchPitch: false,
      touchZoomRotate: false,
    })

    act(() => mapRecords[0].emit('load'))

    expect(mapRecords[0].sources.footprints).toMatchObject({
      type: 'vector',
      maxzoom: 18,
      tiles: [
        expectedMapboxTileUrl('?start=2026-06-19&end=2026-06-19'),
      ],
    })
    expect(mapRecords[0].layers[0]).toMatchObject({
      id: 'footprints-circle',
      type: 'circle',
      source: 'footprints',
      'source-layer': 'footprints',
      paint: expect.objectContaining({
        'circle-radius': 1.5,
        'circle-color': '#123f35',
        'circle-opacity': 0.82,
      }),
    })
    expect(JSON.stringify(mapRecords[0].layers[0])).not.toContain('heatmap')
    expect(JSON.stringify(mapRecords[0].layers[0])).not.toContain('cluster')
    expect(JSON.stringify(mapRecords[0].layers[0])).not.toContain('count')
    expect(footprintDataSourceImported()).toBe(false)
  })

  it('uses range=all for open ended footprint tile requests', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
      />,
    )

    act(() => mapRecords[0].emit('load'))

    expect(mapRecords[0].sources.footprints).toMatchObject({
      maxzoom: 18,
      tiles: [expectedMapboxTileUrl('?range=all')],
    })
  })

  it('uses the default footprint tile endpoint when no tile URL is configured', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
      />,
    )

    act(() => mapRecords[0].emit('load'))

    expect(mapRecords[0].sources.footprints).toMatchObject({
      tiles: [
        expectedMapboxTileUrl('?start=2026-06-19&end=2026-06-19'),
      ],
    })
  })

  it('requests metrics for the selected time range without importing the snapshot data source', async () => {
    const { mapRecords, footprintDataSourceImported } = mockMapboxRuntime()
    const fetchMock = mockMetricsFetch({
      selectedCount: 3,
      totalDistanceMeters: 400,
      averageDistanceMetersPerDay: 400,
    })
    const onFootprintMetricsChange = vi.fn()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={selectedRange}
        onFootprintMetricsChange={onFootprintMetricsChange}
      />,
    )

    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/footprints/metrics?start=2026-06-19&end=2026-06-19',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(onFootprintMetricsChange).toHaveBeenLastCalledWith({
      selectedCount: 3,
      totalDistanceMeters: 400,
      averageDistanceMetersPerDay: 400,
    })
    expect(footprintDataSourceImported()).toBe(false)
  })

  it('requests all-range metrics and refreshes metrics when the time range changes', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const fetchMock = mockMetricsFetch(
      {
        selectedCount: 4,
        totalDistanceMeters: 1399,
        averageDistanceMetersPerDay: 699.5,
      },
      {
        selectedCount: 3,
        totalDistanceMeters: 400,
        averageDistanceMetersPerDay: 400,
      },
    )
    const onFootprintMetricsChange = vi.fn()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { rerender } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        onFootprintMetricsChange={onFootprintMetricsChange}
      />,
    )
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    const nextRange: TimeRangeSelection = {
      mode: 'day',
      start: '2026-06-19',
      end: '2026-06-19',
      anchorDate: '2026-06-19',
    }
    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={nextRange}
        onFootprintMetricsChange={onFootprintMetricsChange}
      />,
    )
    await act(async () => {})

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/footprints/metrics?range=all',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/footprints/metrics?start=2026-06-19&end=2026-06-19',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(onFootprintMetricsChange).toHaveBeenLastCalledWith({
      selectedCount: 3,
      totalDistanceMeters: 400,
      averageDistanceMetersPerDay: 400,
    })
  })

  it('reloads the footprint source URL without recreating the Mapbox map when time changes', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { rerender } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={selectedRange}
      />,
    )
    act(() => mapRecords[0].emit('load'))

    const nextRange: TimeRangeSelection = {
      mode: 'day',
      start: '2026-06-20',
      end: '2026-06-20',
      anchorDate: '2026-06-20',
    }
    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={nextRange}
      />,
    )

    expect(mapRecords).toHaveLength(1)
    expect(mapRecords[0].removeCalls).toBe(0)
    expect(mapRecords[0].removedLayers).toEqual(['footprints-circle'])
    expect(mapRecords[0].removedSources).toEqual(['footprints'])
    expect(mapRecords[0].sources.footprints).toMatchObject({
      tiles: [
        expectedMapboxTileUrl('?start=2026-06-20&end=2026-06-20'),
      ],
    })
  })

  it('updates footprint paint properties without reloading vector tile source when style changes', async () => {
    vi.useFakeTimers()
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={selectedRange}
      />,
    )
    act(() => mapRecords[0].emit('load'))

    const settingsButton = document.querySelector('.map-toolbar__settings .map-toolbar__button')
    expect(settingsButton).toBeInstanceOf(HTMLButtonElement)

    fireEvent.click(settingsButton as HTMLButtonElement)

    const popover = document.querySelector('.footprint-style-popover')
    expect(popover).toBeInstanceOf(HTMLElement)
    const [sizeInput, opacityInput, colorInput] = Array.from(
      (popover as HTMLElement).querySelectorAll('input'),
    )

    fireEvent.change(sizeInput, { target: { value: '2.4' } })
    fireEvent.change(opacityInput, { target: { value: '0.64' } })
    fireEvent.change(colorInput, { target: { value: '#4f7cff' } })
    act(() => {
      vi.advanceTimersByTime(180)
    })

    expect(popover).toBeInTheDocument()
    expect(mapRecords[0].removedLayers).toEqual([])
    expect(mapRecords[0].removedSources).toEqual([])
    expect(mapRecords[0].sources.footprints).toMatchObject({
      tiles: [expectedMapboxTileUrl('?start=2026-06-19&end=2026-06-19')],
    })
    expect(mapRecords[0].paintProperties).toEqual([
      ['footprints-circle', 'circle-radius', 2.4],
      ['footprints-circle', 'circle-color', '#4f7cff'],
      ['footprints-circle', 'circle-opacity', 0.64],
    ])
  })

  it('shows a clear placeholder instead of creating a map when the token is missing', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(<MapboxCanvas accessToken="" timeRange={selectedRange} />)

    expect(mapRecords).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('Mapbox')
    expect(screen.getByText(/VITE_MAPBOX_ACCESS_TOKEN/)).toBeInTheDocument()
  })
})

function mockMapboxRuntime() {
  const mapRecords: MockMapRecord[] = []
  let footprintDataSourceWasImported = false

  class MockMap {
    private readonly record: MockMapRecord
    private readonly handlers = new Map<string, Array<() => void>>()

    constructor(options: Record<string, unknown>) {
      this.record = {
        options,
        sources: {},
        layers: [],
        removedLayers: [],
        removedSources: [],
        paintProperties: [],
        removeCalls: 0,
        emit: (eventName: string) => {
          for (const handler of this.handlers.get(eventName) ?? []) handler()
        },
      }
      mapRecords.push(this.record)
    }

    on(eventName: string, handler: () => void) {
      this.handlers.set(eventName, [...(this.handlers.get(eventName) ?? []), handler])
      return this
    }

    off(eventName: string, handler: () => void) {
      this.handlers.set(
        eventName,
        (this.handlers.get(eventName) ?? []).filter((currentHandler) => currentHandler !== handler),
      )
      return this
    }

    addSource(id: string, source: unknown) {
      this.record.sources[id] = source
    }

    addLayer(layer: unknown) {
      this.record.layers.push(layer)
    }

    getLayer(id: string) {
      return this.record.layers.find((layer) => (
        typeof layer === 'object' &&
        layer !== null &&
        'id' in layer &&
        layer.id === id
      ))
    }

    getSource(id: string) {
      return this.record.sources[id]
    }

    removeLayer(id: string) {
      this.record.removedLayers.push(id)
      this.record.layers = this.record.layers.filter((layer) => (
        typeof layer !== 'object' ||
        layer === null ||
        !('id' in layer) ||
        layer.id !== id
      ))
    }

    removeSource(id: string) {
      this.record.removedSources.push(id)
      delete this.record.sources[id]
    }

    setPaintProperty(layerId: string, propertyName: string, value: unknown) {
      this.record.paintProperties.push([layerId, propertyName, value])
    }

    resize() {}
    zoomIn() {}
    zoomOut() {}
    fitBounds() {}
    jumpTo() {}
    remove() {
      this.record.removeCalls += 1
    }
  }

  vi.doMock('mapbox-gl', () => ({
    default: {
      accessToken: '',
      Map: MockMap,
    },
  }))
  vi.doMock('../layers/footprintDataSource', () => {
    footprintDataSourceWasImported = true

    return {
      loadFootprintSnapshot: vi.fn(),
    }
  })

  return {
    mapRecords,
    footprintDataSourceImported: () => footprintDataSourceWasImported,
  }
}

function expectedMapboxTileUrl(query: string) {
  return `${window.location.origin}/api/map/tiles/footprints/{z}/{x}/{y}.mvt${query}`
}

function mockMetricsFetch(...metricsResponses: Array<{
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
}>) {
  let responseIndex = 0
  const fetchMock = vi.fn(async () => {
    const metrics = metricsResponses[Math.min(responseIndex, metricsResponses.length - 1)]
    responseIndex += 1

    return {
      ok: true,
      json: async () => metrics,
    }
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
