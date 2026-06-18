import { describe, expect, it } from 'vitest'

import { getAmapConfig } from './amap'

describe('getAmapConfig', () => {
  it('marks the config as missing when credentials are blank', () => {
    const config = getAmapConfig({
      VITE_AMAP_KEY: '',
      VITE_AMAP_SECURITY_CODE: '',
    })

    expect(config.isConfigured).toBe(false)
    expect(config.missingKeys).toEqual([
      'VITE_AMAP_KEY',
      'VITE_AMAP_SECURITY_CODE',
    ])
  })

  it('returns a configured AMap setup when credentials are present', () => {
    const config = getAmapConfig({
      VITE_AMAP_KEY: 'test-key',
      VITE_AMAP_SECURITY_CODE: 'test-security-code',
    })

    expect(config.isConfigured).toBe(true)
    expect(config.key).toBe('test-key')
    expect(config.securityJsCode).toBe('test-security-code')
    expect(config.defaultCenter).toEqual([104.195397, 35.86166])
    expect(config.defaultZoom).toBe(4.2)
    expect(config.defaultBounds).toEqual({
      southWest: [73.3, 17.8],
      northEast: [135.1, 53.7],
    })
    expect(config.themes).toEqual([
      { id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' },
    ])
    expect(config.features).toEqual(['bg', 'road', 'building'])
    expect(config.showLabel).toBe(false)
  })
})
