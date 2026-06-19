import AMapLoader from '@amap/amap-jsapi-loader'

import type { AmapConfig } from '../config/amap'

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      securityJsCode: string
    }
  }
}

export type AMapNamespace = typeof AMap

let amapLoadPromise: Promise<AMapNamespace> | null = null

export function loadAmap(config: AmapConfig): Promise<AMapNamespace> {
  if (!config.isConfigured) {
    throw new Error(`Missing AMap config: ${config.missingKeys.join(', ')}`)
  }

  window._AMapSecurityConfig = {
    securityJsCode: config.securityJsCode,
  }

  if (amapLoadPromise) {
    return amapLoadPromise
  }

  amapLoadPromise = (AMapLoader.load({
    key: config.key,
    version: '2.0',
    plugins: ['AMap.Geolocation', 'AMap.Scale'],
  }) as Promise<AMapNamespace>).catch((error: unknown) => {
    amapLoadPromise = null
    throw error
  })

  return amapLoadPromise
}
