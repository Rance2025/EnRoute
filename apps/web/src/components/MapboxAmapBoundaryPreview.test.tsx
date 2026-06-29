import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function lngLat(lng: number, lat: number) {
  return {
    getLng: () => lng,
    getLat: () => lat,
  }
}

type MockMapOptions = {
  addSource: ReturnType<typeof vi.fn>
  addLayer: ReturnType<typeof vi.fn>
  fitBounds: ReturnType<typeof vi.fn>
  setData?: ReturnType<typeof vi.fn>
  setPaintProperty?: ReturnType<typeof vi.fn>
}

function installMapboxMock({
  addSource,
  addLayer,
  fitBounds,
  setData,
  setPaintProperty,
}: MockMapOptions) {
  const mapEvents = new Map<string, Array<() => void>>()
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const layers = new Set<string>()

  vi.doMock('mapbox-gl', () => ({
    default: {
      accessToken: '',
      Map: vi.fn(function Map(this: {
        on: (eventName: string, callback: () => void) => void
        off: () => void
        remove: () => void
        isStyleLoaded: () => boolean
        getSource: (id: string) => unknown
        getLayer: (id: string) => unknown
        addSource: typeof addSource
        addLayer: typeof addLayer
        fitBounds: typeof fitBounds
        setPaintProperty: ReturnType<typeof vi.fn>
      }) {
        this.on = (eventName, callback) => {
          mapEvents.set(eventName, [...(mapEvents.get(eventName) ?? []), callback])
        }
        this.off = vi.fn()
        this.remove = vi.fn()
        this.isStyleLoaded = () => true
        this.getSource = (id) => sources.get(id)
        this.getLayer = (id) => (layers.has(id) ? { id } : undefined)
        this.addSource = vi.fn((id, source) => {
          sources.set(id, { setData: setData ?? vi.fn() })
          addSource(id, source)
        })
        this.addLayer = vi.fn((layer) => {
          layers.add(layer.id)
          addLayer(layer)
        })
        this.fitBounds = fitBounds
        this.setPaintProperty = setPaintProperty ?? vi.fn()
      }),
    },
  }))

  return {
    triggerLoad() {
      mapEvents.get('load')?.forEach((callback) => callback())
    },
    triggerStyleLoad() {
      mapEvents.get('style.load')?.forEach((callback) => callback())
    },
  }
}

function installAmapMock(
  districtSearch: ReturnType<typeof vi.fn>,
) {
  vi.doMock('../services/amapLoader', () => ({
    loadAmap: vi.fn(async () => ({
      DistrictSearch: vi.fn(function DistrictSearch(this: {
        search: typeof districtSearch
        setLevel: ReturnType<typeof vi.fn>
      }) {
        this.search = districtSearch
        this.setLevel = vi.fn()
      }),
    })),
  }))
}

describe('MapboxAmapBoundaryPreview', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('queries AMap Shanghai level 4 boundaries and overlays them as WGS84 Mapbox GeoJSON', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const districtSearch = vi.fn((
      keyword: string,
      callback: (status: string, result: unknown) => void,
    ) => {
      callback('complete', {
        districtList: [{
          name: keyword === '310100' ? '上海市' : '浦东新区',
          adcode: keyword,
          districtList: keyword === '310000'
            ? []
            : [
                {
                  name: '浦东新区',
                  adcode: '310115',
                  boundaries: [
                    [
                      lngLat(116.403372, 39.917931),
                      lngLat(116.404372, 39.917931),
                      lngLat(116.403372, 39.918931),
                    ],
                  ],
                },
              ],
          boundaries: [
            [
              lngLat(116.403372, 39.917931),
              lngLat(116.404372, 39.917931),
              lngLat(116.403372, 39.918931),
            ],
          ],
        }],
      })
    })
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds })
    installAmapMock(districtSearch)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()

    await waitFor(() => expect(districtSearch).toHaveBeenCalledWith('310100', expect.any(Function)))
    expect(screen.getByRole('button', { name: '高德' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '4 区县' })).toHaveAttribute('aria-pressed', 'true')
    const overlayData = addSource.mock.calls[0]?.[1]?.data
    expect(addSource).toHaveBeenCalledWith('amap-boundary-preview', expect.objectContaining({
      type: 'geojson',
      data: expect.objectContaining({
        type: 'FeatureCollection',
      }),
    }))
    expect(overlayData.features[0].geometry.coordinates[0][0][0]).toEqual([
      expect.closeTo(116.397128, 6),
      expect.closeTo(39.916527, 6),
    ])
    expect(addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'amap-boundary-preview-fill',
      type: 'fill',
      source: 'amap-boundary-preview',
    }))
    expect(addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'amap-boundary-preview-line',
      type: 'line',
      source: 'amap-boundary-preview',
    }))
    expect(await screen.findByText('1 个区块')).toBeInTheDocument()
    expect(screen.getByText('3 个点')).toBeInTheDocument()
    expect(screen.getByText('WGS84（源 GCJ-02）')).toBeInTheDocument()
  })

  it('loads local Shanghai level 4 regions through the preview API and converts GCJ-02 to WGS84', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    installAmapMock(vi.fn())
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: 'gcj02',
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    fireEvent.click(await screen.findByRole('button', { name: '本地' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions/preview/shanghai?source=local&level=4',
      expect.objectContaining({ method: 'GET' }),
    ))
    const overlayData = addSource.mock.calls[0]?.[1]?.data ?? setData.mock.calls.at(-1)?.[0]
    expect(overlayData.features[0].properties.source).toBe('local')
    expect(overlayData.features[0].geometry.coordinates[0][0][0]).toEqual([
      expect.closeTo(116.397128, 6),
      expect.closeTo(39.916527, 6),
    ])
    expect(await screen.findByText('浦东新区')).toBeInTheDocument()
    expect(screen.getByText('WGS84（源 GCJ-02）')).toBeInTheDocument()
  })

  it('shows OSM level 5 through the preview API without GCJ conversion', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    installAmapMock(vi.fn())
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'osm',
      level: 5,
      available: true,
      coordinateSystem: 'wgs84',
      reason: null,
      regions: [{
        id: 'osm:14179226',
        name: '三林镇',
        level: 5,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [121.399, 31.199],
            [121.401, 31.199],
            [121.401, 31.201],
            [121.399, 31.201],
            [121.399, 31.199],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    fireEvent.click(await screen.findByRole('button', { name: 'OSM' }))
    fireEvent.click(screen.getByRole('button', { name: '5 街镇' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions/preview/shanghai?source=osm&level=5',
      expect.objectContaining({ method: 'GET' }),
    ))
    const overlayData = setData.mock.calls.at(-1)?.[0] ?? addSource.mock.calls[0]?.[1]?.data
    expect(overlayData.features[0].properties.source).toBe('osm')
    expect(overlayData.features[0].geometry.coordinates[0][0][0]).toEqual([121.399, 31.199])
    expect(await screen.findByText('三林镇')).toBeInTheDocument()
    expect(screen.getByText('WGS84')).toBeInTheDocument()
  })

  it('rejects an available API preview that omits the source coordinate system', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    installAmapMock(vi.fn())
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: null,
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    fireEvent.click(await screen.findByRole('button', { name: '本地' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('行政区划预览 API 响应格式无效')
    const clearedOverlayData = setData.mock.calls.at(-1)?.[0] ?? addSource.mock.calls.at(-1)?.[1]?.data
    expect(clearedOverlayData).toEqual({ type: 'FeatureCollection', features: [] })
    expect(screen.queryByText('WGS84')).not.toBeInTheDocument()
  })

  it('clears stale overlay and reports unavailable AMap level 5', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const districtSearch = vi.fn((
      _keyword: string,
      callback: (status: string, result: unknown) => void,
    ) => {
      callback('complete', {
        districtList: [{
          name: '上海市',
          adcode: '310100',
          boundaries: [
            [
              lngLat(116.403372, 39.917931),
              lngLat(116.404372, 39.917931),
              lngLat(116.403372, 39.918931),
            ],
          ],
        }],
      })
    })
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    installAmapMock(districtSearch)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    await screen.findByText('16 个区块')
    fireEvent.click(screen.getByRole('button', { name: '5 街镇' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('高德 DistrictSearch 不提供街道级边界'))
    expect(setData).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] })
    expect(screen.queryByText('16 个区块')).not.toBeInTheDocument()
  })

  it('keeps local and OSM previews usable when AMap config is missing', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    const loadAmap = vi.fn()
    vi.doMock('../services/amapLoader', () => ({ loadAmap }))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: 'gcj02',
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: '',
        securityJsCode: '',
        isConfigured: false,
        missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    expect(await screen.findByText('需要配置高德地图密钥')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '本地' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions/preview/shanghai?source=local&level=4',
      expect.objectContaining({ method: 'GET' }),
    ))
    const overlayData = setData.mock.calls.at(-1)?.[0] ?? addSource.mock.calls.at(-1)?.[1]?.data
    expect(overlayData.features[0].properties.source).toBe('local')
    expect(await screen.findByText('浦东新区')).toBeInTheDocument()
    expect(loadAmap).not.toHaveBeenCalled()
  })

  it('keeps the current local selection when Mapbox style load fires after a source switch', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const districtSearch = vi.fn((
      keyword: string,
      callback: (status: string, result: unknown) => void,
    ) => {
      callback('complete', {
        districtList: [{
          name: keyword === '310100' ? '上海市' : '浦东新区',
          adcode: keyword,
          districtList: [
            {
              name: '浦东新区',
              adcode: '310115',
              boundaries: [[
                lngLat(116.403372, 39.917931),
                lngLat(116.404372, 39.917931),
                lngLat(116.403372, 39.918931),
              ]],
            },
          ],
          boundaries: [[
            lngLat(116.403372, 39.917931),
            lngLat(116.404372, 39.917931),
            lngLat(116.403372, 39.918931),
          ]],
        }],
      })
    })
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    installAmapMock(districtSearch)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: 'gcj02',
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    await screen.findByText('1 个区块')
    fireEvent.click(screen.getByRole('button', { name: '本地' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions/preview/shanghai?source=local&level=4',
      expect.objectContaining({ method: 'GET' }),
    ))
    await screen.findByText('本地 / 1 个区块')
    const amapCallCount = districtSearch.mock.calls.length

    mapbox.triggerStyleLoad()

    expect(districtSearch).toHaveBeenCalledTimes(amapCallCount)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '本地' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not let late AMap loading overwrite the current local selection', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const districtSearch = vi.fn((
      _keyword: string,
      callback: (status: string, result: unknown) => void,
    ) => {
      callback('complete', {
        districtList: [{
          name: '上海市',
          adcode: '310100',
          boundaries: [[
            lngLat(116.403372, 39.917931),
            lngLat(116.404372, 39.917931),
            lngLat(116.403372, 39.918931),
          ]],
        }],
      })
    })
    let resolveAmap!: (AMap: unknown) => void
    const amapPromise = new Promise((resolve) => {
      resolveAmap = resolve
    })
    vi.doMock('../services/amapLoader', () => ({
      loadAmap: vi.fn(() => amapPromise),
    }))
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: 'gcj02',
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    fireEvent.click(await screen.findByRole('button', { name: '本地' }))
    await screen.findByText('本地 / 1 个区块')

    await act(async () => {
      resolveAmap({
        DistrictSearch: vi.fn(function DistrictSearch(this: {
          search: typeof districtSearch
          setLevel: ReturnType<typeof vi.fn>
        }) {
          this.search = districtSearch
          this.setLevel = vi.fn()
        }),
      })
      await amapPromise
    })

    expect(districtSearch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '本地' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('本地 / 1 个区块')).toBeInTheDocument()
  })

  it('updates Mapbox paint colors when switching overlay sources', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const setPaintProperty = vi.fn()
    const districtSearch = vi.fn((
      keyword: string,
      callback: (status: string, result: unknown) => void,
    ) => {
      callback('complete', {
        districtList: [{
          name: keyword === '310100' ? '上海市' : '浦东新区',
          adcode: keyword,
          districtList: [
            {
              name: '浦东新区',
              adcode: '310115',
              boundaries: [[
                lngLat(116.403372, 39.917931),
                lngLat(116.404372, 39.917931),
                lngLat(116.403372, 39.918931),
              ]],
            },
          ],
          boundaries: [[
            lngLat(116.403372, 39.917931),
            lngLat(116.404372, 39.917931),
            lngLat(116.403372, 39.918931),
          ]],
        }],
      })
    })
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData, setPaintProperty })
    installAmapMock(districtSearch)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: 'gcj02',
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    await screen.findByText('1 个区块')
    fireEvent.click(screen.getByRole('button', { name: '本地' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(setPaintProperty).toHaveBeenCalledWith('amap-boundary-preview-fill', 'fill-color', '#0b7f55')
    expect(setPaintProperty).toHaveBeenCalledWith('amap-boundary-preview-line', 'line-color', '#0b7f55')
  })

  it('invalidates a pending local preview when switching back to AMap without AMap config', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    const loadAmap = vi.fn()
    vi.doMock('../services/amapLoader', () => ({
      loadAmap,
    }))
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    let resolveLocal!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveLocal = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: '',
        securityJsCode: '',
        isConfigured: false,
        missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    await screen.findByText('需要配置高德地图密钥')
    fireEvent.click(await screen.findByRole('button', { name: '本地' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions/preview/shanghai?source=local&level=4',
      expect.objectContaining({ method: 'GET' }),
    ))
    fireEvent.click(screen.getByRole('button', { name: '高德' }))

    await act(async () => {
      resolveLocal(new Response(JSON.stringify({
        source: 'local',
        level: 4,
        available: true,
        coordinateSystem: 'gcj02',
        reason: null,
        regions: [{
          id: '310115',
          name: '浦东新区',
          level: 4,
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [116.403372, 39.917931],
              [116.404372, 39.917931],
              [116.403372, 39.918931],
              [116.403372, 39.917931],
            ]],
          },
        }],
      }), { status: 200 }))
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: '高德' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('本地 / 1 个区块')).not.toBeInTheDocument()
    expect(screen.queryByText('浦东新区')).not.toBeInTheDocument()
    expect(screen.getByText('需要配置高德地图密钥')).toBeInTheDocument()
    expect(loadAmap).not.toHaveBeenCalled()
  })

  it('keeps a current local preview when the late AMap loader fails', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    let rejectAmap!: (error: Error) => void
    const amapPromise = new Promise((_resolve, reject) => {
      rejectAmap = reject
    })
    vi.doMock('../services/amapLoader', () => ({
      loadAmap: vi.fn(() => amapPromise),
    }))
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: 'gcj02',
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    mapbox.triggerLoad()
    fireEvent.click(await screen.findByRole('button', { name: '本地' }))
    await screen.findByText('本地 / 1 个区块')

    await act(async () => {
      rejectAmap(new Error('AMap unavailable'))
      try {
        await amapPromise
      } catch {
        // The component should handle the loader failure internally.
      }
    })

    expect(screen.getByRole('button', { name: '本地' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('本地 / 1 个区块')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads a local selection made before Mapbox reports the style ready', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const setData = vi.fn()
    let resolveAmap!: (AMap: unknown) => void
    const amapPromise = new Promise((resolve) => {
      resolveAmap = resolve
    })
    vi.doMock('../services/amapLoader', () => ({
      loadAmap: vi.fn(() => amapPromise),
    }))
    const mapbox = installMapboxMock({ addSource, addLayer, fitBounds, setData })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: 'local',
      level: 4,
      available: true,
      coordinateSystem: 'gcj02',
      reason: null,
      regions: [{
        id: '310115',
        name: '浦东新区',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [116.403372, 39.917931],
            [116.404372, 39.917931],
            [116.403372, 39.918931],
            [116.403372, 39.917931],
          ]],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { MapboxAmapBoundaryPreview } = await import('./MapboxAmapBoundaryPreview')
    render(<MapboxAmapBoundaryPreview
      amapConfig={{
        key: 'test-key',
        securityJsCode: 'test-security-code',
        isConfigured: true,
        missingKeys: [],
      }}
      mapboxAccessToken="test-mapbox-token"
    />)

    fireEvent.click(await screen.findByRole('button', { name: '本地' }))
    expect(fetchMock).not.toHaveBeenCalled()

    mapbox.triggerLoad()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions/preview/shanghai?source=local&level=4',
      expect.objectContaining({ method: 'GET' }),
    ))
    expect(await screen.findByText('本地 / 1 个区块')).toBeInTheDocument()

    await act(async () => {
      resolveAmap({
        DistrictSearch: vi.fn(function DistrictSearch(this: {
          search: ReturnType<typeof vi.fn>
          setLevel: ReturnType<typeof vi.fn>
        }) {
          this.search = vi.fn()
          this.setLevel = vi.fn()
        }),
      })
      await amapPromise
    })
  })
})
