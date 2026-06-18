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

export async function loadAmap(config: AmapConfig): Promise<AMapNamespace> {
  if (!config.isConfigured) {
    throw new Error(`Missing AMap config: ${config.missingKeys.join(', ')}`)
  }

  window._AMapSecurityConfig = {
    securityJsCode: config.securityJsCode,
  }

  return AMapLoader.load({
    key: config.key,
    version: '2.0',
    plugins: ['AMap.Geolocation', 'AMap.ControlBar', 'AMap.Scale'],
  }) as Promise<AMapNamespace>
}
