import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function lngLat(lng: number, lat: number) {
  return {
    getLng: () => lng,
    getLat: () => lat,
  }
}

describe('MapboxAmapBoundaryPreview', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('queries AMap district boundaries and overlays them as Mapbox GeoJSON layers', async () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    const fitBounds = vi.fn()
    const districtSearch = vi.fn((
      _keyword: string,
      callback: (status: string, result: unknown) => void,
    ) => {
      callback('complete', {
        districtList: [{
          name: '浦东新区',
          adcode: '310115',
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
    const mapEvents = new Map<string, Array<() => void>>()

    vi.doMock('mapbox-gl', () => ({
      default: {
        accessToken: '',
        Map: vi.fn(function Map(this: {
          on: (eventName: string, callback: () => void) => void
          off: () => void
          remove: () => void
          isStyleLoaded: () => boolean
          getSource: () => unknown
          getLayer: () => unknown
          addSource: typeof addSource
          addLayer: typeof addLayer
          fitBounds: typeof fitBounds
        }) {
          this.on = (eventName, callback) => {
            mapEvents.set(eventName, [...(mapEvents.get(eventName) ?? []), callback])
          }
          this.off = vi.fn()
          this.remove = vi.fn()
          this.isStyleLoaded = () => true
          this.getSource = () => undefined
          this.getLayer = () => undefined
          this.addSource = addSource
          this.addLayer = addLayer
          this.fitBounds = fitBounds
        }),
      },
    }))
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

    mapEvents.get('load')?.forEach((callback) => callback())

    await waitFor(() => expect(districtSearch).toHaveBeenCalledWith('310115', expect.any(Function)))
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
    const overlayRing = overlayData.features[0].geometry.coordinates[0][0]
    const west = Math.min(...overlayRing.map(([lng]) => lng))
    const south = Math.min(...overlayRing.map(([, lat]) => lat))
    const east = Math.max(...overlayRing.map(([lng]) => lng))
    const north = Math.max(...overlayRing.map(([, lat]) => lat))
    expect(fitBounds).toHaveBeenCalledWith(
      [
        [west, south],
        [east, north],
      ],
      expect.objectContaining({ padding: 96 }),
    )
    expect(await screen.findByText('1 条边界')).toBeInTheDocument()
    expect(screen.getByText('3 个点')).toBeInTheDocument()
  })
})
