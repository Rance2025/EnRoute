import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TimeRangeSelection } from '../time/timeRange'

type MockMapRecord = {
  options: Record<string, unknown>
  sources: Record<string, unknown>
  layers: unknown[]
  layoutProperties: Array<[string, string, unknown]>
  configProperties: Array<[string, string, unknown]>
  configPropertyValues: Map<string, unknown>
  setStyleCalls: unknown[]
  removedLayers: string[]
  removedSources: string[]
  paintProperties: Array<[string, string, unknown]>
  fitBoundsCalls: Array<[unknown, unknown]>
  flyToCalls: unknown[]
  easeToCalls: unknown[]
  stopCalls: number
  removeCalls: number
  emit: (eventName: string) => void
  setZoom: (zoom: number) => void
  setCenter: (center: [number, number]) => void
  setBounds: (bounds: { west: number, south: number, east: number, north: number }) => void
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
  it('uses the configured EnRoute Mapbox style as the default base style', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
      />,
    )

    expect(mapRecords[0].options).toMatchObject({
      style: 'mapbox://styles/oies0/cmqw4e7m7001101qo7kmvdwry',
    })
  })

  it('initializes Mapbox as a fixed globe map at max zoom 16 and adds the footprint vector circle layer', async () => {
    const { mapRecords, footprintDataSourceImported } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { container } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        styleUrl="mapbox://styles/enroute/test"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={selectedRange}
      />,
    )

    const mapStage = container.querySelector('.map-stage')

    expect(mapRecords).toHaveLength(1)
    expect(mapStage).toHaveClass('map-stage--loading')
    expect(mapStage).not.toHaveClass('map-stage--ready')
    expect(mapRecords[0].options).toMatchObject({
      dragRotate: false,
      maxPitch: 0,
      maxZoom: 16,
      minPitch: 0,
      pitch: 0,
      projection: 'globe',
      renderWorldCopies: false,
      style: 'mapbox://styles/enroute/test',
      touchPitch: false,
      touchZoomRotate: false,
      worldview: 'CN',
      zoom: 1.75,
    })
    expect(mapRecords[0].options).not.toHaveProperty('language')

    act(() => mapRecords[0].emit('load'))

    expect(mapStage).toHaveClass('map-stage--ready')
    expect(mapStage).not.toHaveClass('map-stage--loading')
    expect(mapRecords[0].sources.footprints).toMatchObject({
      type: 'vector',
      maxzoom: 16,
      tiles: [
        expectedMapboxTileUrl('?start=2026-06-19&end=2026-06-19'),
      ],
    })
    const footprintLayer = mapRecords[0].layers.find((layer) => (
      typeof layer === 'object' &&
      layer !== null &&
      'id' in layer &&
      layer.id === 'footprints-circle'
    ))

    expect(footprintLayer).toMatchObject({
      id: 'footprints-circle',
      type: 'circle',
      source: 'footprints',
      'source-layer': 'footprints',
      paint: expect.objectContaining({
        'circle-radius': 0.75,
        'circle-color': '#123f35',
        'circle-opacity': 0.82,
      }),
    })
    expect(JSON.stringify(footprintLayer)).not.toContain('heatmap')
    expect(JSON.stringify(footprintLayer)).not.toContain('cluster')
    expect(JSON.stringify(footprintLayer)).not.toContain('count')
    expect(footprintDataSourceImported()).toBe(false)
  })

  it('waits for Mapbox style readiness before adding the footprint source after load', async () => {
    const { mapRecords } = mockMapboxRuntime({ styleReadyAfterStyleLoad: true })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={selectedRange}
      />,
    )

    act(() => mapRecords[0].emit('load'))

    expect(mapRecords[0].sources.footprints).toBeUndefined()
    expect(mapRecords[0].layers.some((layer) => (
      typeof layer === 'object' &&
      layer !== null &&
      'id' in layer &&
      layer.id === 'footprints-circle'
    ))).toBe(false)

    act(() => mapRecords[0].emit('style.load'))

    expect(mapRecords[0].sources.footprints).toMatchObject({
      type: 'vector',
      maxzoom: 16,
      tiles: [
        expectedMapboxTileUrl('?start=2026-06-19&end=2026-06-19'),
      ],
    })
    expect(mapRecords[0].layers.some((layer) => (
      typeof layer === 'object' &&
      layer !== null &&
      'id' in layer &&
      layer.id === 'footprints-circle'
    ))).toBe(true)
  })

  it('switches Mapbox styles in place and restores footprint layers after the new style loads', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { rerender } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        styleUrl="mapbox://styles/oies0/cmqv3payf000r01s79tjjh7bh"
        timeRange={selectedRange}
        placeLabelsVisible={false}
        adminBoundariesVisible={false}
      />,
    )
    act(() => mapRecords[0].emit('load'))

    expect(mapRecords).toHaveLength(1)
    expect(mapRecords[0].sources.footprints).toBeDefined()

    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        styleUrl="mapbox://styles/oies0/cmqvb5b20001e01s72ia82lz5"
        timeRange={selectedRange}
        placeLabelsVisible={false}
        adminBoundariesVisible={false}
      />,
    )

    expect(mapRecords).toHaveLength(1)
    expect(mapRecords[0].setStyleCalls).toEqual([
      'mapbox://styles/oies0/cmqvb5b20001e01s72ia82lz5',
    ])

    mapRecords[0].removedLayers = []
    mapRecords[0].removedSources = []
    mapRecords[0].layoutProperties = []
    mapRecords[0].configProperties = []
    act(() => mapRecords[0].emit('style.load'))

    expect(mapRecords[0].sources.footprints).toMatchObject({
      type: 'vector',
      maxzoom: 16,
    })
    expect(mapRecords[0].layers.some((layer) => (
      typeof layer === 'object' &&
      layer !== null &&
      'id' in layer &&
      layer.id === 'footprints-circle'
    ))).toBe(true)
    expect(mapRecords[0].configProperties).toEqual([
      ['basemap', 'showPlaceLabels', false],
      ['basemap', 'showPointOfInterestLabels', false],
      ['basemap', 'showRoadLabels', false],
      ['basemap', 'showTransitLabels', false],
      ['basemap', 'showAdminBoundaries', false],
    ])
  })

  it('starts slow globe rotation from the default world view after the initial load', async () => {
    vi.useFakeTimers()
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        projection="globe"
        timeRange={selectedRange}
      />,
    )

    mapRecords[0].setCenter([12, 34])
    expect(mapRecords[0].easeToCalls).toEqual([])

    act(() => mapRecords[0].emit('load'))

    expect(mapRecords[0].easeToCalls).toEqual([
      {
        center: [10.8, 34],
        bearing: 0,
        pitch: 0,
        duration: 1000,
        easing: expect.any(Function),
      },
    ])

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(mapRecords[0].easeToCalls).toHaveLength(2)
  })

  it('uses mercator projection and world copies when configured as a flat map', async () => {
    const { mapRecords } = mockMapboxRuntime()
    vi.stubEnv('VITE_MAPBOX_PROJECTION', 'mercator')
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
      />,
    )

    expect(mapRecords).toHaveLength(1)
    expect(mapRecords[0].options).toMatchObject({
      projection: 'mercator',
      renderWorldCopies: true,
      zoom: 2.2,
    })
  })

  it('uses an explicit Mapbox display language while keeping China worldview fixed', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { rerender } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        language="zh-Hans"
        timeRange={selectedRange}
      />,
    )

    expect(mapRecords).toHaveLength(1)
    expect(mapRecords[0].options).toMatchObject({
      language: 'zh-Hans',
      worldview: 'CN',
    })

    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        language="en"
        timeRange={selectedRange}
      />,
    )

    expect(mapRecords).toHaveLength(2)
    expect(mapRecords[0].removeCalls).toBe(1)
    expect(mapRecords[1].options).toMatchObject({
      language: 'en',
      worldview: 'CN',
    })
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
      maxzoom: 16,
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

  it('fits the map to selected footprint bounds from metrics when focusing footprints', async () => {
    const { mapRecords } = mockMapboxRuntime()
    mockMetricsFetch({
      selectedCount: 3,
      totalDistanceMeters: 400,
      averageDistanceMetersPerDay: 400,
      selectedBounds: {
        southWest: [118, 30],
        northEast: [121.5, 31.3],
      },
    })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
      />,
    )

    act(() => mapRecords[0].emit('load'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: '聚焦当前足迹' }))

    expect(mapRecords[0].fitBoundsCalls).toEqual([
      [
        [
          [118, 30],
          [121.5, 31.3],
        ],
        { duration: 900, padding: 96 },
      ],
    ])
  })

  it('zooms the globe out to zoom 1.75 while keeping the current center before starting slow rotation', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        projection="globe"
        timeRange={selectedRange}
      />,
    )

    mapRecords[0].setCenter([12, 34])
    fireEvent.click(screen.getByRole('button', { name: '显示世界地图' }))

    expect(mapRecords[0].flyToCalls).toEqual([
      {
        center: [12, 34],
        zoom: 1.75,
        bearing: 0,
        pitch: 0,
      },
    ])
    expect(mapRecords[0].easeToCalls).toEqual([])

    act(() => mapRecords[0].emit('zoomstart'))
    act(() => mapRecords[0].emit('moveend'))

    expect(mapRecords[0].easeToCalls).toEqual([
      {
        center: [10.8, 34],
        bearing: 0,
        pitch: 0,
        duration: 1000,
        easing: expect.any(Function),
      },
    ])
  })

  it('stops globe rotation when the user zooms after entering the world view', async () => {
    vi.useFakeTimers()
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        projection="globe"
        timeRange={selectedRange}
      />,
    )

    mapRecords[0].setCenter([12, 34])
    fireEvent.click(screen.getByRole('button', { name: '显示世界地图' }))
    act(() => mapRecords[0].emit('moveend'))
    expect(mapRecords[0].easeToCalls).toHaveLength(1)

    act(() => mapRecords[0].emit('zoomstart'))
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(mapRecords[0].easeToCalls).toHaveLength(1)
  })

  it('pauses globe rotation before dragging and resumes after drag release', async () => {
    vi.useFakeTimers()
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { container } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        projection="globe"
        timeRange={selectedRange}
      />,
    )

    mapRecords[0].setCenter([12, 34])
    fireEvent.click(screen.getByRole('button', { name: '显示世界地图' }))
    act(() => mapRecords[0].emit('moveend'))
    expect(mapRecords[0].easeToCalls).toHaveLength(1)

    const mapSurface = container.querySelector('.mapbox-surface')
    expect(mapSurface).toBeInstanceOf(HTMLElement)

    fireEvent.pointerDown(mapSurface as HTMLElement)
    expect(mapRecords[0].stopCalls).toBe(1)

    act(() => mapRecords[0].emit('dragstart'))
    expect(mapRecords[0].stopCalls).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mapRecords[0].easeToCalls).toHaveLength(1)

    act(() => mapRecords[0].emit('dragend'))
    expect(mapRecords[0].easeToCalls).toHaveLength(2)
  })

  it('shows footprint tile debug metrics for the current Mapbox viewport', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const fetchMock = mockMetricsAndDebugFetch({
      ok: true,
      json: async () => ({
        tileZoom: 8,
        requestedTileCount: 12,
        populatedTileCount: 5,
        readyTileCount: 4,
        dirtyTileCount: 1,
        rawCount: 1200,
        representativeCount: 320,
        renderRatio: 0.266666,
      }),
    })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        debugPanelVisible
      />,
    )

    mapRecords[0].setZoom(8.6)
    mapRecords[0].setBounds({ west: 120, south: 30, east: 122, north: 32 })
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/map/tiles/footprints/debug?z=8&west=120&south=30&east=122&north=32&range=all',
      expect.objectContaining({ method: 'GET' }),
    )
    const rows = Array.from(document.querySelectorAll('.footprint-debug-panel__row'))

    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.textContent)).toEqual([
      '相机/瓦片层级8.6 / 8',
      '瓦片12 / 5 / 1',
      '实际点数1,200',
      '代表点数320',
      '渲染率26.7%',
    ])
    expect(screen.getByLabelText('足迹渲染调试')).not.toHaveTextContent('z8')
    expect(screen.getByLabelText('足迹渲染调试')).not.toHaveTextContent('视口瓦片')
    expect(screen.getByLabelText('足迹渲染调试')).not.toHaveTextContent('命中瓦片')
    expect(screen.getByLabelText('足迹渲染调试')).not.toHaveTextContent('脏瓦片')
  })

  it('clamps footprint tile debug metrics requests to z16', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const fetchMock = mockMetricsAndDebugFetch({
      ok: true,
      json: async () => ({
        tileZoom: 16,
        requestedTileCount: 1,
        populatedTileCount: 1,
        readyTileCount: 1,
        dirtyTileCount: 0,
        rawCount: 12,
        representativeCount: 6,
        renderRatio: 0.5,
      }),
    })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        debugPanelVisible
      />,
    )

    mapRecords[0].setZoom(17.8)
    mapRecords[0].setBounds({ west: 120, south: 30, east: 122, north: 32 })
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/map/tiles/footprints/debug?z=16&west=120&south=30&east=122&north=32&range=all',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('uses the single root tile for globe z0 debug metrics', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const fetchMock = mockMetricsAndDebugFetch({
      ok: true,
      json: async () => ({
        tileZoom: 0,
        requestedTileCount: 1,
        populatedTileCount: 1,
        readyTileCount: 1,
        dirtyTileCount: 0,
        rawCount: 120,
        representativeCount: 40,
        renderRatio: 0.333333,
      }),
    })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        projection="globe"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        debugPanelVisible
      />,
    )

    mapRecords[0].setZoom(0.8)
    mapRecords[0].setBounds({ west: 30, south: 10, east: 60, north: 40 })
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    const debugUrl = getLastDebugRequestUrl(fetchMock)
    expect(debugUrl.searchParams.get('z')).toBe('0')
    expect(debugUrl.searchParams.get('tiles')).toBe('0/0')
    expect(debugUrl.searchParams.has('west')).toBe(false)
    expect(debugUrl.searchParams.has('south')).toBe(false)
    expect(debugUrl.searchParams.has('east')).toBe(false)
    expect(debugUrl.searchParams.has('north')).toBe(false)
  })

  it('derives globe z1 debug tiles from the map center instead of unstable bounds', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const fetchMock = mockMetricsAndDebugFetch({
      ok: true,
      json: async () => ({
        tileZoom: 1,
        requestedTileCount: 4,
        populatedTileCount: 1,
        readyTileCount: 1,
        dirtyTileCount: 0,
        rawCount: 40441,
        representativeCount: 235,
        renderRatio: 0.005811,
      }),
    })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        projection="globe"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        debugPanelVisible
      />,
    )

    mapRecords[0].setZoom(1.8)
    mapRecords[0].setCenter([90, 35])
    mapRecords[0].setBounds({ west: -180, south: -40, east: 0, north: 90 })
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    const debugUrl = getLastDebugRequestUrl(fetchMock)
    expect(debugUrl.searchParams.get('z')).toBe('1')
    expect(debugUrl.searchParams.get('tiles')).toBe('0/0,1/0,0/1,1/1')
    expect(debugUrl.searchParams.has('west')).toBe(false)
    expect(debugUrl.searchParams.has('south')).toBe(false)
    expect(debugUrl.searchParams.has('east')).toBe(false)
    expect(debugUrl.searchParams.has('north')).toBe(false)
  })

  it('keeps bounds-based debug metrics for globe z2 and above', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const fetchMock = mockMetricsAndDebugFetch({
      ok: true,
      json: async () => ({
        tileZoom: 2,
        requestedTileCount: 4,
        populatedTileCount: 1,
        readyTileCount: 1,
        dirtyTileCount: 0,
        rawCount: 900,
        representativeCount: 45,
        renderRatio: 0.05,
      }),
    })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        projection="globe"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        debugPanelVisible
      />,
    )

    mapRecords[0].setZoom(2.2)
    mapRecords[0].setCenter([90, 35])
    mapRecords[0].setBounds({ west: 20, south: -10, east: 150, north: 80 })
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    const debugUrl = getLastDebugRequestUrl(fetchMock)
    expect(debugUrl.searchParams.get('z')).toBe('2')
    expect(debugUrl.searchParams.has('tiles')).toBe(false)
    expect(debugUrl.searchParams.get('west')).toBe('20')
    expect(debugUrl.searchParams.get('south')).toBe('-10')
    expect(debugUrl.searchParams.get('east')).toBe('150')
    expect(debugUrl.searchParams.get('north')).toBe('80')
  })

  it('keeps the last successful debug metrics while a refresh fails', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const fetchMock = mockMetricsAndDebugFetch({
      ok: true,
      json: async () => ({
        tileZoom: 8,
        requestedTileCount: 12,
        populatedTileCount: 5,
        readyTileCount: 4,
        dirtyTileCount: 1,
        rawCount: 1200,
        representativeCount: 320,
        renderRatio: 0.266666,
      }),
    }, {
      ok: false,
      status: 503,
      json: async () => ({}),
    })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        debugPanelVisible
      />,
    )

    mapRecords[0].setZoom(8.6)
    mapRecords[0].setBounds({ west: 120, south: 30, east: 122, north: 32 })
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('瓦片12 / 5 / 1')

    act(() => mapRecords[0].emit('moveend'))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('瓦片12 / 5 / 1')
    expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('8.6 / 8')
    expect(screen.getByLabelText('足迹渲染调试')).not.toHaveTextContent('--')
  })

  it('ignores stale debug metrics that resolve after a newer refresh', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const staleRequest = createDeferredResponse({
      tileZoom: 8,
      requestedTileCount: 12,
      populatedTileCount: 5,
      readyTileCount: 4,
      dirtyTileCount: 1,
      rawCount: 1200,
      representativeCount: 320,
      renderRatio: 0.266666,
    })
    const freshRequest = createDeferredResponse({
      tileZoom: 9,
      requestedTileCount: 7,
      populatedTileCount: 6,
      readyTileCount: 6,
      dirtyTileCount: 0,
      rawCount: 900,
      representativeCount: 450,
      renderRatio: 0.5,
    })
    const fetchMock = vi.fn()
      .mockImplementation((url: string) => {
        if (url.includes('/api/footprints/metrics')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              selectedCount: 0,
              totalDistanceMeters: 0,
              averageDistanceMetersPerDay: 0,
              selectedBounds: null,
            }),
          })
        }

        return fetchMock.mock.calls.filter(([calledUrl]) => String(calledUrl).includes('/api/map/tiles/footprints/debug')).length === 1
          ? staleRequest.promise
          : freshRequest.promise
      })
    vi.stubGlobal('fetch', fetchMock)
    const { MapboxCanvas } = await import('./MapboxCanvas')

    render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        tileUrl="/api/map/tiles/footprints/{z}/{x}/{y}.mvt"
        timeRange={allRange}
        debugPanelVisible
      />,
    )

    mapRecords[0].setZoom(8.6)
    mapRecords[0].setBounds({ west: 120, south: 30, east: 122, north: 32 })
    act(() => mapRecords[0].emit('load'))
    await act(async () => {})

    mapRecords[0].setZoom(9.2)
    act(() => mapRecords[0].emit('moveend'))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await act(async () => {
      freshRequest.resolve()
    })

    expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('相机/瓦片层级9.2 / 9')
    expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('瓦片7 / 6 / 0')

    await act(async () => {
      staleRequest.resolve()
    })

    expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('相机/瓦片层级9.2 / 9')
    expect(screen.getByLabelText('足迹渲染调试')).toHaveTextContent('瓦片7 / 6 / 0')
    expect(screen.getByLabelText('足迹渲染调试')).not.toHaveTextContent('瓦片12 / 5 / 1')
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
      ['footprints-circle', 'circle-radius', 1.2],
      ['footprints-circle', 'circle-color', '#4f7cff'],
      ['footprints-circle', 'circle-opacity', 0.64],
    ])
  })

  it('hides and restores Mapbox place label and administrative boundary style layers without overriding style defaults', async () => {
    const { mapRecords } = mockMapboxRuntime()
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { rerender } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible
        adminBoundariesVisible
      />,
    )
    act(() => mapRecords[0].emit('load'))

    expect(mapRecords[0].layoutProperties).toEqual([])

    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible={false}
        adminBoundariesVisible={false}
      />,
    )

    expect(mapRecords[0].layoutProperties.slice(-5)).toEqual([
      ['country-label', 'visibility', 'none'],
      ['settlement-label', 'visibility', 'none'],
      ['road-label', 'visibility', 'none'],
      ['admin-1-boundary', 'visibility', 'none'],
      ['admin-0-boundary', 'visibility', 'none'],
    ])

    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible
        adminBoundariesVisible
      />,
    )

    expect(mapRecords[0].layoutProperties.slice(-5)).toEqual([
      ['country-label', 'visibility', 'visible'],
      ['settlement-label', 'visibility', 'visible'],
      ['road-label', 'visibility', 'none'],
      ['admin-1-boundary', 'visibility', 'visible'],
      ['admin-0-boundary', 'visibility', 'none'],
    ])
  })

  it('uses Mapbox Standard basemap config only to hide or restore style-defined visibility', async () => {
    const { mapRecords } = mockMapboxRuntime({ layers: [] })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { rerender } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible
        adminBoundariesVisible
      />,
    )
    act(() => mapRecords[0].emit('load'))

    expect(mapRecords[0].configProperties).toEqual([])

    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible={false}
        adminBoundariesVisible={false}
      />,
    )

    expect(mapRecords[0].configProperties.slice(-5)).toEqual([
      ['basemap', 'showPlaceLabels', false],
      ['basemap', 'showPointOfInterestLabels', false],
      ['basemap', 'showRoadLabels', false],
      ['basemap', 'showTransitLabels', false],
      ['basemap', 'showAdminBoundaries', false],
    ])

    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible
        adminBoundariesVisible
      />,
    )

    expect(mapRecords[0].configProperties.slice(-5)).toEqual([
      ['basemap', 'showPlaceLabels', true],
      ['basemap', 'showPointOfInterestLabels', false],
      ['basemap', 'showRoadLabels', false],
      ['basemap', 'showTransitLabels', false],
      ['basemap', 'showAdminBoundaries', true],
    ])
  })

  it('restores style-defined labels and administrative boundaries after starting with both disabled', async () => {
    const { mapRecords } = mockMapboxRuntime({ syncBaseMapLayerVisibilityFromConfig: true })
    const { MapboxCanvas } = await import('./MapboxCanvas')

    const { rerender } = render(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible={false}
        adminBoundariesVisible={false}
      />,
    )
    act(() => mapRecords[0].emit('style.load'))

    expect(getMockLayerVisibility(mapRecords[0], 'country-label')).toBe('none')
    expect(getMockLayerVisibility(mapRecords[0], 'settlement-label')).toBe('none')
    expect(getMockLayerVisibility(mapRecords[0], 'admin-1-boundary')).toBe('none')

    act(() => mapRecords[0].emit('load'))

    rerender(
      <MapboxCanvas
        accessToken="test-mapbox-token"
        timeRange={selectedRange}
        placeLabelsVisible
        adminBoundariesVisible
      />,
    )

    expect(getMockLayerVisibility(mapRecords[0], 'country-label')).toBe('visible')
    expect(getMockLayerVisibility(mapRecords[0], 'settlement-label')).toBe('visible')
    expect(getMockLayerVisibility(mapRecords[0], 'road-label')).toBe('none')
    expect(getMockLayerVisibility(mapRecords[0], 'admin-1-boundary')).toBe('visible')
    expect(getMockLayerVisibility(mapRecords[0], 'admin-0-boundary')).toBe('none')
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

function mockMapboxRuntime(runtimeOptions: {
  layers?: unknown[]
  syncBaseMapLayerVisibilityFromConfig?: boolean
  styleReadyAfterStyleLoad?: boolean
} = {}) {
  const mapRecords: MockMapRecord[] = []
  let footprintDataSourceWasImported = false
  const standardBasemapConfig = new Map<string, unknown>([
    ['showPlaceLabels', true],
    ['showPointOfInterestLabels', false],
    ['showRoadLabels', false],
    ['showTransitLabels', false],
    ['showAdminBoundaries', true],
  ])

  class MockMap {
    private readonly record: MockMapRecord
    private readonly handlers = new Map<string, Array<() => void>>()
    private styleReady = !runtimeOptions.styleReadyAfterStyleLoad
    private zoom = 2.2
    private center: [number, number] = [104.195397, 35.86166]
    private bounds = { west: -180, south: -85, east: 180, north: 85 }

    constructor(options: Record<string, unknown>) {
      this.record = {
        options,
        sources: {},
        layers: runtimeOptions.layers ?? [
          {
            id: 'background',
            type: 'background',
          },
          {
            id: 'country-label',
            type: 'symbol',
            layout: {
              'text-field': ['get', 'name'],
              visibility: 'visible',
            },
          },
          {
            id: 'settlement-label',
            type: 'symbol',
            layout: {
              'text-field': ['get', 'name'],
            },
          },
          {
            id: 'road-label',
            type: 'symbol',
            layout: {
              'symbol-placement': 'line',
              'text-field': ['get', 'name'],
              visibility: 'none',
            },
          },
          {
            id: 'admin-1-boundary',
            type: 'line',
            source: 'composite',
            'source-layer': 'admin',
            layout: {
              visibility: 'visible',
            },
          },
          {
            id: 'admin-0-boundary',
            type: 'line',
            source: 'composite',
            'source-layer': 'admin',
            layout: {
              visibility: 'none',
            },
          },
          {
            id: 'road-line',
            type: 'line',
            source: 'composite',
            'source-layer': 'road',
          },
        ],
        layoutProperties: [],
        configProperties: [],
        configPropertyValues: new Map(standardBasemapConfig),
        setStyleCalls: [],
        removedLayers: [],
        removedSources: [],
        paintProperties: [],
        fitBoundsCalls: [],
        flyToCalls: [],
        easeToCalls: [],
        stopCalls: 0,
        removeCalls: 0,
        emit: (eventName: string) => {
          if (eventName === 'style.load') {
            this.styleReady = true
          }

          for (const handler of this.handlers.get(eventName) ?? []) handler()
        },
        setZoom: (zoom: number) => {
          this.zoom = zoom
        },
        setCenter: (center: [number, number]) => {
          this.center = center
        },
        setBounds: (bounds: { west: number, south: number, east: number, north: number }) => {
          this.bounds = bounds
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
      if (!this.styleReady) {
        throw new Error('Style is not done loading')
      }

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

    getStyle() {
      return {
        layers: this.record.layers,
      }
    }

    isStyleLoaded() {
      return this.styleReady
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

    setLayoutProperty(layerId: string, propertyName: string, value: unknown) {
      this.record.layoutProperties.push([layerId, propertyName, value])
      this.record.layers = this.record.layers.map((layer) => {
        if (
          typeof layer !== 'object' ||
          layer === null ||
          !('id' in layer) ||
          layer.id !== layerId
        ) {
          return layer
        }

        return {
          ...layer,
          layout: {
            ...('layout' in layer && typeof layer.layout === 'object' && layer.layout !== null
              ? layer.layout
              : {}),
            [propertyName]: value,
          },
        }
      })
    }

    setConfigProperty(importId: string, configName: string, value: unknown) {
      this.record.configProperties.push([importId, configName, value])
      this.record.configPropertyValues.set(configName, value)

      if (runtimeOptions.syncBaseMapLayerVisibilityFromConfig) {
        syncMockBaseMapLayerVisibilityFromConfig(this.record, configName, value)
      }
    }

    getConfigProperty(importId: string, configName: string) {
      if (importId !== 'basemap') return undefined

      return this.record.configPropertyValues.get(configName)
    }

    setStyle(styleUrl: string) {
      this.record.setStyleCalls.push(styleUrl)
    }

    getZoom() {
      return this.zoom
    }

    getBounds() {
      return {
        getWest: () => this.bounds.west,
        getSouth: () => this.bounds.south,
        getEast: () => this.bounds.east,
        getNorth: () => this.bounds.north,
      }
    }

    resize() {}
    zoomIn() {}
    zoomOut() {}
    fitBounds(bounds: unknown, options: unknown) {
      this.record.fitBoundsCalls.push([bounds, options])
    }
    flyTo(options: unknown) {
      this.record.flyToCalls.push(options)
    }
    easeTo(options: unknown) {
      this.record.easeToCalls.push(options)
      if (
        typeof options === 'object' &&
        options !== null &&
        'center' in options &&
        Array.isArray(options.center)
      ) {
        this.center = options.center as [number, number]
      }
    }
    getCenter() {
      return {
        lng: this.center[0],
        lat: this.center[1],
      }
    }
    jumpTo() {}
    stop() {
      this.record.stopCalls += 1
    }
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

function getMockLayerVisibility(
  record: MockMapRecord,
  layerId: string,
): 'visible' | 'none' | undefined {
  const layer = record.layers.find((currentLayer) => (
    typeof currentLayer === 'object' &&
    currentLayer !== null &&
    'id' in currentLayer &&
    currentLayer.id === layerId
  ))

  if (
    typeof layer !== 'object' ||
    layer === null ||
    !('layout' in layer) ||
    typeof layer.layout !== 'object' ||
    layer.layout === null ||
    !('visibility' in layer.layout)
  ) {
    return layer ? 'visible' : undefined
  }

  return layer.layout.visibility === 'none' ? 'none' : 'visible'
}

function syncMockBaseMapLayerVisibilityFromConfig(
  record: MockMapRecord,
  configName: string,
  value: unknown,
) {
  const visible = value !== false

  record.layers = record.layers.map((layer) => {
    if (
      typeof layer !== 'object' ||
      layer === null ||
      !('id' in layer) ||
      typeof layer.id !== 'string'
    ) {
      return layer
    }

    if (!mockBaseMapConfigControlsLayer(configName, layer.id)) return layer

    return {
      ...layer,
      layout: {
        ...('layout' in layer && typeof layer.layout === 'object' && layer.layout !== null
          ? layer.layout
          : {}),
        visibility: visible ? 'visible' : 'none',
      },
    }
  })
}

function mockBaseMapConfigControlsLayer(configName: string, layerId: string) {
  if (configName === 'showPlaceLabels') {
    return layerId === 'country-label' || layerId === 'settlement-label'
  }

  if (configName === 'showRoadLabels') {
    return layerId === 'road-label'
  }

  if (configName === 'showAdminBoundaries') {
    return layerId === 'admin-1-boundary' || layerId === 'admin-0-boundary'
  }

  return false
}

function expectedMapboxTileUrl(query: string) {
  return `${window.location.origin}/api/map/tiles/footprints/{z}/{x}/{y}.mvt${query}`
}

function mockMetricsFetch(...metricsResponses: Array<{
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
  selectedBounds?: {
    southWest: [number, number]
    northEast: [number, number]
  } | null
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

function mockMetricsAndDebugFetch(...debugResponses: Array<{
  ok: boolean
  status?: number
  json: () => Promise<Record<string, unknown>>
}>) {
  let debugResponseIndex = 0
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/api/footprints/metrics')) {
      return {
        ok: true,
        json: async () => ({
          selectedCount: 0,
          totalDistanceMeters: 0,
          averageDistanceMetersPerDay: 0,
          selectedBounds: null,
        }),
      }
    }

    const response = debugResponses[Math.min(debugResponseIndex, debugResponses.length - 1)]
    debugResponseIndex += 1
    return response
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function getLastDebugRequestUrl(fetchMock: ReturnType<typeof vi.fn>) {
  const debugCall = fetchMock.mock.calls
    .map(([calledUrl]) => String(calledUrl))
    .filter((calledUrl) => calledUrl.includes('/api/map/tiles/footprints/debug'))
    .at(-1)

  if (!debugCall) {
    throw new Error('Missing debug request')
  }

  return new URL(debugCall, window.location.origin)
}

function createDeferredResponse(body: Record<string, unknown>) {
  let resolveResponse!: () => void
  const promise = new Promise<{ ok: true, json: () => Promise<Record<string, unknown>> }>((resolve) => {
    resolveResponse = () => {
      resolve({
        ok: true,
        json: async () => body,
      })
    }
  })

  return {
    promise,
    resolve: resolveResponse,
  }
}
