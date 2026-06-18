import { useEffect, useRef, useState } from 'react'

import { AMAP_THEMES, type AmapConfig } from '../config/amap'
import { DEFAULT_MAP_CAMERA, resetMapCamera, zoomByStep } from '../config/mapCamera'
import { loadAmap, type AMapNamespace } from '../services/amapLoader'
import { MapControls } from './MapControls'

type AmapCanvasProps = {
  config: AmapConfig
}

type MapStatus = 'missing-config' | 'loading' | 'ready' | 'error'

export function AmapCanvas({ config }: AmapCanvasProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMap.Map | null>(null)
  const amapRef = useRef<AMapNamespace | null>(null)
  const geolocationRef = useRef<AMap.Geolocation | null>(null)
  const [status, setStatus] = useState<MapStatus>(
    config.isConfigured ? 'loading' : 'missing-config',
  )
  const [errorMessage, setErrorMessage] = useState('')

  const themes = config.themes.length ? config.themes : AMAP_THEMES
  const mapTheme = themes[0]

  useEffect(() => {
    if (!config.isConfigured || !mapNodeRef.current) {
      setStatus('missing-config')
      return
    }

    let disposed = false

    setStatus('loading')
    setErrorMessage('')

    loadAmap(config)
      .then((AMap) => {
        if (disposed || !mapNodeRef.current) return

        amapRef.current = AMap
        const map = new AMap.Map(mapNodeRef.current, {
          center: config.defaultCenter,
          zoom: config.defaultZoom,
          mapStyle: mapTheme.style,
          features: config.features,
          viewMode: DEFAULT_MAP_CAMERA.viewMode,
          pitch: DEFAULT_MAP_CAMERA.pitch,
          rotation: DEFAULT_MAP_CAMERA.rotation,
          pitchEnable: DEFAULT_MAP_CAMERA.pitchEnable,
          rotateEnable: DEFAULT_MAP_CAMERA.rotateEnable,
          showLabel: config.showLabel,
          resizeEnable: true,
          jogEnable: true,
          animateEnable: true,
        })

        map.addControl(new AMap.Scale({ position: 'LB' }))
        map.setLimitBounds(toAmapBounds(AMap, config.defaultBounds))

        AMap.plugin('AMap.Geolocation', () => {
          if (disposed) return
          geolocationRef.current = new AMap.Geolocation({
            enableHighAccuracy: true,
            timeout: 8000,
            zoomToAccuracy: true,
            position: {
              right: '24px',
              bottom: '136px',
            },
          })
        })

        mapRef.current = map
        if (import.meta.env.DEV) {
          window.__ENROUTE_MAP__ = map
        }
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (disposed) return
        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : '高德地图加载失败')
      })

    return () => {
      disposed = true
      geolocationRef.current = null
      if (import.meta.env.DEV) {
        delete window.__ENROUTE_MAP__
      }
      mapRef.current?.destroy()
      mapRef.current = null
      amapRef.current = null
    }
  }, [config, mapTheme.style])

  function resetView() {
    if (!mapRef.current || !amapRef.current) return
    resetMapCamera(mapRef.current, toAmapBounds(amapRef.current, config.defaultBounds))
  }

  function zoomIn() {
    if (!mapRef.current) return
    zoomByStep(mapRef.current, 1)
  }

  function zoomOut() {
    if (!mapRef.current) return
    zoomByStep(mapRef.current, -1)
  }

  function locate() {
    geolocationRef.current?.getCurrentPosition()
  }

  return (
    <section className="map-stage" aria-label="在途 EnRoute 地图">
      <div className="amap-surface" ref={mapNodeRef} />

      <header className="brand-header" aria-label="在途 EnRoute">
        <h1>
          <span>在途</span>
          <span>EnRoute</span>
        </h1>
      </header>

      {config.isConfigured ? (
        <>
          <MapControls
            onLocate={locate}
            onReset={resetView}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
          {status === 'error' ? (
            <div className="map-message" role="alert">
              <h2>地图加载失败</h2>
              <p>{errorMessage}</p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="map-message" role="status">
          <h2>需要配置高德地图密钥</h2>
          <p>在项目根目录创建 `.env.local`，填入下面两个变量后重新启动开发服务器。</p>
          <pre>{config.missingKeys.join('\n')}</pre>
        </div>
      )}
    </section>
  )
}

function toAmapBounds(AMap: AMapNamespace, bounds: AmapConfig['defaultBounds']) {
  return new AMap.Bounds(bounds.southWest, bounds.northEast)
}
