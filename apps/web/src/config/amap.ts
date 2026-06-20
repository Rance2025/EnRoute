export type AmapEnv = {
  VITE_AMAP_KEY?: string
  VITE_AMAP_SECURITY_CODE?: string
}

export type AmapTheme = {
  id: string
  name: string
  style: string
}

export type AmapConfig = {
  key: string
  securityJsCode: string
  isConfigured: boolean
  missingKeys: string[]
  defaultCenter: [number, number]
  defaultZoom: number
  defaultBounds: {
    southWest: [number, number]
    northEast: [number, number]
  }
  renderBounds: {
    southWest: [number, number]
    northEast: [number, number]
  }
  themes: AmapTheme[]
  features: Array<'bg' | 'point' | 'road' | 'building'>
  showLabel: boolean
}

export const AMAP_THEMES: AmapTheme[] = [
  { id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' },
]

export const DEFAULT_AMAP_CENTER: [number, number] = [104.195397, 35.86166]
export const DEFAULT_AMAP_ZOOM = 4.2
export const DEFAULT_CHINA_BOUNDS: AmapConfig['defaultBounds'] = {
  southWest: [73.3, 17.8],
  northEast: [135.1, 53.7],
}
export const DEFAULT_RENDER_BOUNDS: AmapConfig['renderBounds'] = {
  southWest: [-180, -85.05112878],
  northEast: [180, 85.05112878],
}
export const DEFAULT_AMAP_FEATURES: AmapConfig['features'] = ['bg', 'road', 'building']

export function getAmapConfig(env: AmapEnv = import.meta.env as AmapEnv): AmapConfig {
  const key = env.VITE_AMAP_KEY?.trim() ?? ''
  const securityJsCode = env.VITE_AMAP_SECURITY_CODE?.trim() ?? ''
  const missingKeys = [
    ['VITE_AMAP_KEY', key],
    ['VITE_AMAP_SECURITY_CODE', securityJsCode],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  return {
    key,
    securityJsCode,
    isConfigured: missingKeys.length === 0,
    missingKeys,
    defaultCenter: DEFAULT_AMAP_CENTER,
    defaultZoom: DEFAULT_AMAP_ZOOM,
    defaultBounds: DEFAULT_CHINA_BOUNDS,
    renderBounds: DEFAULT_RENDER_BOUNDS,
    themes: AMAP_THEMES,
    features: DEFAULT_AMAP_FEATURES,
    showLabel: false,
  }
}
