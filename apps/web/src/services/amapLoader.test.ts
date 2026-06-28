import AMapLoader from '@amap/amap-jsapi-loader'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AmapConfig } from '../config/amap'

vi.mock('@amap/amap-jsapi-loader', () => ({
  default: {
    load: vi.fn(),
  },
}))

const loadMock = vi.mocked(AMapLoader.load)

const configuredConfig: AmapConfig = {
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
  themes: [],
  features: ['bg', 'road', 'building'],
  showLabel: false,
}

const missingConfig: AmapConfig = {
  ...configuredConfig,
  key: '',
  securityJsCode: '',
  isConfigured: false,
  missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
}

async function importAmapLoader() {
  return import('./amapLoader')
}

describe('loadAmap', () => {
  beforeEach(() => {
    vi.resetModules()
    loadMock.mockReset()
    delete window._AMapSecurityConfig
  })

  it('reuses one AMap loader promise for concurrent configured calls', async () => {
    const amap = {} as typeof AMap
    loadMock.mockReturnValue(Promise.resolve(amap))
    const { loadAmap } = await importAmapLoader()

    const firstLoad = loadAmap(configuredConfig)
    const secondLoad = loadAmap(configuredConfig)

    expect(firstLoad).toBe(secondLoad)
    await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([amap, amap])
    expect(loadMock).toHaveBeenCalledTimes(1)
    expect(loadMock).toHaveBeenCalledWith({
      key: 'test-key',
      version: '2.0',
      plugins: ['AMap.Adaptor', 'AMap.Scale', 'AMap.Geolocation', 'AMap.DistrictSearch'],
    })
    expect(window._AMapSecurityConfig).toEqual({
      securityJsCode: 'test-security-code',
    })
  })

  it('clears the cached promise after rejection so a later call can retry', async () => {
    const firstError = new Error('loader failed')
    const amap = {} as typeof AMap
    loadMock
      .mockReturnValueOnce(Promise.reject(firstError))
      .mockReturnValueOnce(Promise.resolve(amap))
    const { loadAmap } = await importAmapLoader()

    await expect(loadAmap(configuredConfig)).rejects.toThrow('loader failed')
    await expect(loadAmap(configuredConfig)).resolves.toBe(amap)

    expect(loadMock).toHaveBeenCalledTimes(2)
  })

  it('throws for missing config before calling the AMap loader', async () => {
    const { loadAmap } = await importAmapLoader()

    expect(() => loadAmap(missingConfig)).toThrow(
      'Missing AMap config: VITE_AMAP_KEY, VITE_AMAP_SECURITY_CODE',
    )

    expect(loadMock).not.toHaveBeenCalled()
    expect(window._AMapSecurityConfig).toBeUndefined()
  })
})
