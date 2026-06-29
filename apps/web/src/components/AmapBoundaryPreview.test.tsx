import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AmapConfig } from '../config/amap'

const configuredAmap: AmapConfig = {
  key: 'test-key',
  securityJsCode: 'test-security-code',
  isConfigured: true,
  missingKeys: [],
  defaultCenter: [104.195397, 35.86166],
  defaultZoom: 4.2,
  defaultBounds: {
    southWest: [73.3, 17.8],
    northEast: [135.1, 53.7],
  },
  renderBounds: {
    southWest: [-180, -85.05112878],
    northEast: [180, 85.05112878],
  },
  themes: [{ id: 'whitesmoke', name: 'whitesmoke', style: 'amap://styles/whitesmoke' }],
  features: ['bg', 'road', 'building'],
  showLabel: false,
}

function lngLat(lng: number, lat: number) {
  return {
    getLng: () => lng,
    getLat: () => lat,
  }
}

describe('AmapBoundaryPreview', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('draws the default AMap district boundary and reports geometry size', async () => {
    const setFitView = vi.fn()
    const polygonSetMap = vi.fn()
    const districtSearch = vi.fn((
      _keyword: string,
      callback: (status: string, result: unknown) => void,
    ) => {
      callback('complete', {
        districtList: [{
          name: '浦东新区',
          adcode: '310115',
          center: lngLat(121.5, 31.2),
          boundaries: [
            [lngLat(121, 31), lngLat(122, 31), lngLat(121, 31)],
            [lngLat(121, 32), lngLat(122, 32), lngLat(121, 32)],
          ],
        }],
      })
    })
    const districtSetLevel = vi.fn()
    const polygonConstructor = vi.fn(function Polygon(this: { setMap: typeof polygonSetMap }) {
      this.setMap = polygonSetMap
    })

    vi.doMock('../services/amapLoader', () => ({
      loadAmap: vi.fn(async () => ({
        Map: class Map {
          addControl = vi.fn()
          destroy = vi.fn()
          setFitView = setFitView
        },
        Scale: class Scale {},
        Polygon: polygonConstructor,
        DistrictSearch: vi.fn(function DistrictSearch(this: {
          search: typeof districtSearch
          setLevel: typeof districtSetLevel
        }) {
          this.search = districtSearch
          this.setLevel = districtSetLevel
        }),
      })),
    }))

    const { AmapBoundaryPreview } = await import('./AmapBoundaryPreview')
    render(<AmapBoundaryPreview config={configuredAmap} />)

    await waitFor(() => expect(districtSearch).toHaveBeenCalledWith('310115', expect.any(Function)))
    expect(districtSetLevel).toHaveBeenCalledWith('district')
    expect(polygonConstructor).toHaveBeenCalledTimes(2)
    expect(setFitView).toHaveBeenCalled()
    expect(await screen.findByText('2 条边界')).toBeInTheDocument()
    expect(screen.getByText('6 个点')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '浦东新区' })).toBeInTheDocument()
  })

  it('shows the missing AMap configuration keys without loading the map', async () => {
    const { AmapBoundaryPreview } = await import('./AmapBoundaryPreview')
    render(<AmapBoundaryPreview config={{
      ...configuredAmap,
      key: '',
      securityJsCode: '',
      isConfigured: false,
      missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
    }} />)

    expect(screen.getByText('需要配置高德地图密钥')).toBeInTheDocument()
    expect(screen.getByText('VITE_AMAP_KEY')).toBeInTheDocument()
    expect(screen.getByText('VITE_AMAP_SECURITY_CODE')).toBeInTheDocument()
  })
})
