import { useCallback, useEffect, useRef, useState } from 'react'

import { AMAP_THEMES, type AmapConfig } from '../config/amap'
import {
  calculateMinimumZoomForLatitudeCoverage,
  clampMapCenterToLatitudeBounds,
  installBoundedMapDrag,
} from '../config/mapDragBounds'
import { DEFAULT_MAP_CAMERA, resetMapCamera, type MapBounds } from '../config/mapCamera'
import {
  calculateSingleWorldMapPaneLayout,
  measureAmapWorldPixelWidthAtZoom,
} from '../config/mapPaneLayout'
import { calculateBoundedZoomCenter, installBoundedMapZoom, zoomByStep } from '../config/mapZoomBounds'
import { createCanvasFootprintLayer } from '../layers/canvasFootprintLayer'
import { loadFootprintPoints } from '../layers/footprintDataSource'
import type { FootprintPoint } from '../layers/footprintTypes'
import { loadAmap, type AMapNamespace } from '../services/amapLoader'
import { MapControls } from './MapControls'

type AmapCanvasProps = {
  config: AmapConfig
  onPanelWidthChange?: (width: number) => void
}

type MapStatus = 'missing-config' | 'loading' | 'ready' | 'error'

export function AmapCanvas({ config, onPanelWidthChange }: AmapCanvasProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMap.Map | null>(null)
  const amapRef = useRef<AMapNamespace | null>(null)
  const geolocationRef = useRef<AMap.Geolocation | null>(null)
  const disposeDragRef = useRef<(() => void) | null>(null)
  const disposeZoomRef = useRef<(() => void) | null>(null)
  const disposeZoomClampRef = useRef<(() => void) | null>(null)
  const footprintLayerRef = useRef<ReturnType<typeof createCanvasFootprintLayer> | null>(null)
  const footprintPointsRef = useRef<FootprintPoint[]>([])
  const footprintFrameRef = useRef<number | null>(null)
  const footprintSettleTimerRef = useRef<number | null>(null)
  const footprintAbortControllerRef = useRef<AbortController | null>(null)
  const footprintUpdateVersionRef = useRef(0)
  const [status, setStatus] = useState<MapStatus>(
    config.isConfigured ? 'loading' : 'missing-config',
  )
  const [errorMessage, setErrorMessage] = useState('')

  const themes = config.themes.length ? config.themes : AMAP_THEMES
  const mapTheme = themes[0]

  const clampViewAfterZoom = useCallback(() => {
    window.setTimeout(() => {
      if (!mapRef.current || !mapNodeRef.current) return
      clampMapCenterToLatitudeBounds(mapRef.current, mapNodeRef.current, config.renderBounds)
    }, 450)
    window.setTimeout(() => {
      if (!mapRef.current || !mapNodeRef.current) return
      clampMapCenterToLatitudeBounds(mapRef.current, mapNodeRef.current, config.renderBounds)
    }, 720)
  }, [config.renderBounds])

  const updatePaneLayout = useCallback(
    (map: AMap.Map, container: HTMLElement) => {
      const minimumZoom = calculateMinimumZoomForLatitudeCoverage(container.clientHeight)
      const worldWidthPx = measureAmapWorldPixelWidthAtZoom(map, minimumZoom)
      const layout = calculateSingleWorldMapPaneLayout({
        viewportWidth: window.innerWidth,
        worldWidthPx,
      })

      onPanelWidthChange?.(layout.sidePanelWidth)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          map.resize()
          const currentZoom = map.getZoom()
          if (currentZoom < minimumZoom) {
            const center = map.getCenter()
            map.setZoomAndCenter(
              minimumZoom,
              calculateBoundedZoomCenter({
                center: [center.getLng(), center.getLat()],
                currentZoom,
                targetZoom: minimumZoom,
                focalPoint: {
                  x: container.clientWidth / 2,
                  y: container.clientHeight / 2,
                },
                viewportSize: {
                  width: container.clientWidth,
                  height: container.clientHeight,
                },
                bounds: config.renderBounds,
              }),
              true,
            )
          }
          clampMapCenterToLatitudeBounds(map, container, config.renderBounds)
        })
      })
    },
    [config.renderBounds, onPanelWidthChange],
  )

  const scheduleFootprintUpdate = useCallback((map: AMap.Map, container: HTMLElement | null) => {
    if (!container || !footprintLayerRef.current) return

    const updateVersion = footprintUpdateVersionRef.current + 1
    footprintUpdateVersionRef.current = updateVersion

    if (footprintSettleTimerRef.current !== null) {
      window.clearTimeout(footprintSettleTimerRef.current)
    }

    footprintSettleTimerRef.current = window.setTimeout(() => {
      if (footprintUpdateVersionRef.current !== updateVersion) return

      footprintLayerRef.current?.update(footprintPointsRef.current, map, container)
    }, 160)
  }, [])

  const requestFootprintFrameUpdate = useCallback(
    (map: AMap.Map, container: HTMLElement | null) => {
      if (!container || !footprintLayerRef.current || footprintFrameRef.current !== null) return

      footprintFrameRef.current = window.requestAnimationFrame(() => {
        footprintFrameRef.current = null
        footprintLayerRef.current?.update(footprintPointsRef.current, map, container)
      })
    },
    [],
  )

  useEffect(() => {
    if (!config.isConfigured || !mapNodeRef.current) {
      setStatus('missing-config')
      onPanelWidthChange?.(0)
      return
    }

    let disposed = false
    let removeFootprintSettleHandlers: (() => void) | null = null

    setStatus('loading')
    setErrorMessage('')

    loadAmap(config)
      .then((AMap) => {
        if (disposed || !mapNodeRef.current) return

        amapRef.current = AMap
        const initialZoom = calculateMinimumZoomForLatitudeCoverage(mapNodeRef.current.clientHeight)
        const map = new AMap.Map(mapNodeRef.current, {
          center: config.defaultCenter,
          zoom: initialZoom,
          zooms: [initialZoom, 20],
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
        disposeDragRef.current = installBoundedMapDrag(map, mapNodeRef.current, config.renderBounds)
        disposeZoomRef.current = installBoundedMapZoom(map, mapNodeRef.current, config.renderBounds)
        const clampLatitudeBounds = () => {
          clampViewAfterZoom()
        }
        map.on('zoomend', clampLatitudeBounds)
        disposeZoomClampRef.current = () => map.off('zoomend', clampLatitudeBounds)

        const updateFootprintsOnFrame = () => requestFootprintFrameUpdate(map, mapNodeRef.current)
        const updateFootprintsAfterSettle = () => scheduleFootprintUpdate(map, mapNodeRef.current)
        map.on('mapmove', updateFootprintsOnFrame)
        map.on('zoomchange', updateFootprintsOnFrame)
        map.on('complete', updateFootprintsAfterSettle)
        map.on('moveend', updateFootprintsAfterSettle)
        map.on('zoomend', updateFootprintsAfterSettle)
        removeFootprintSettleHandlers = () => {
          map.off('mapmove', updateFootprintsOnFrame)
          map.off('zoomchange', updateFootprintsOnFrame)
          map.off('complete', updateFootprintsAfterSettle)
          map.off('moveend', updateFootprintsAfterSettle)
          map.off('zoomend', updateFootprintsAfterSettle)
        }

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
        updatePaneLayout(map, mapNodeRef.current)
        if (import.meta.env.DEV) {
          window.__ENROUTE_MAP__ = map
        }
        setStatus('ready')

        footprintLayerRef.current = createCanvasFootprintLayer(mapNodeRef.current)
        footprintAbortControllerRef.current = new AbortController()
        loadFootprintPoints(
          import.meta.env.VITE_FOOTPRINT_DATA_URL,
          footprintAbortControllerRef.current.signal,
        )
          .then((points) => {
            if (disposed) return
            footprintPointsRef.current = points
            scheduleFootprintUpdate(map, mapNodeRef.current)
          })
          .catch((error: unknown) => {
            if (!disposed && import.meta.env.DEV) console.warn(error)
          })
      })
      .catch((error: unknown) => {
        if (disposed) return
        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : '高德地图加载失败')
      })

    return () => {
      disposed = true
      footprintUpdateVersionRef.current += 1
      geolocationRef.current = null
      removeFootprintSettleHandlers?.()
      if (footprintSettleTimerRef.current !== null) {
        window.clearTimeout(footprintSettleTimerRef.current)
        footprintSettleTimerRef.current = null
      }
      if (footprintFrameRef.current !== null) {
        window.cancelAnimationFrame(footprintFrameRef.current)
        footprintFrameRef.current = null
      }
      footprintAbortControllerRef.current?.abort()
      footprintAbortControllerRef.current = null
      footprintLayerRef.current?.destroy()
      footprintLayerRef.current = null
      footprintPointsRef.current = []
      if (import.meta.env.DEV) {
        delete window.__ENROUTE_MAP__
      }
      disposeZoomClampRef.current?.()
      disposeZoomClampRef.current = null
      disposeZoomRef.current?.()
      disposeZoomRef.current = null
      disposeDragRef.current?.()
      disposeDragRef.current = null
      mapRef.current?.destroy()
      mapRef.current = null
      amapRef.current = null
    }
  }, [
    clampViewAfterZoom,
    config,
    mapTheme.style,
    onPanelWidthChange,
    requestFootprintFrameUpdate,
    scheduleFootprintUpdate,
    updatePaneLayout,
  ])

  useEffect(() => {
    function updateLayoutAfterResize() {
      if (!mapRef.current || !mapNodeRef.current) return
      updatePaneLayout(mapRef.current, mapNodeRef.current)
      scheduleFootprintUpdate(mapRef.current, mapNodeRef.current)
    }

    window.addEventListener('resize', updateLayoutAfterResize)

    return () => {
      window.removeEventListener('resize', updateLayoutAfterResize)
    }
  }, [scheduleFootprintUpdate, updatePaneLayout])

  function resetView() {
    if (!mapRef.current || !amapRef.current) return
    resetMapCamera(mapRef.current, toAmapBounds(amapRef.current, config.defaultBounds))
  }

  function zoomIn() {
    if (!mapRef.current || !mapNodeRef.current) return
    zoomByStep(mapRef.current, mapNodeRef.current, config.renderBounds, 1)
  }

  function zoomOut() {
    if (!mapRef.current || !mapNodeRef.current) return
    zoomByStep(mapRef.current, mapNodeRef.current, config.renderBounds, -1)
  }

  function locate() {
    geolocationRef.current?.getCurrentPosition()
  }

  return (
    <section
      className="map-stage"
      aria-label="在途 EnRoute 地图工作区"
    >
      <div className="amap-surface" ref={mapNodeRef} />

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

function toAmapBounds(AMap: AMapNamespace, bounds: MapBounds) {
  return new AMap.Bounds(bounds.southWest, bounds.northEast)
}

