import { memo, useCallback, useEffect, useRef, useState } from 'react'

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
import { loadFootprintPoints } from '../layers/footprintDataSource'
import { createMassFootprintLayer } from '../layers/massFootprintLayer'
import type { FootprintPoint } from '../layers/footprintTypes'
import {
  DEFAULT_FOOTPRINT_STYLE,
  normalizeFootprintStyle,
  type FootprintStyle,
} from '../layers/footprintStyle'
import {
  calculateFootprintLngLatBounds,
  filterFootprintPointsByTimeRange,
} from '../layers/footprintSelectors'
import { loadAmap, type AMapNamespace } from '../services/amapLoader'
import type { TimeRangeSelection } from '../time/timeRange'
import { MapControls } from './MapControls'

type AmapCanvasProps = {
  config: AmapConfig
  timeRange: TimeRangeSelection
  onPanelWidthChange?: (width: number) => void
}

type MapStatus = 'missing-config' | 'loading' | 'ready' | 'error'

const FOOTPRINT_STYLE_STORAGE_KEY = 'enroute.footprintStyle'
const MAP_CAMERA_DURATION_MS = 900
const FIT_FOOTPRINT_AVOID: [number, number, number, number] = [72, 72, 72, 72]

function AmapCanvasComponent({ config, timeRange, onPanelWidthChange }: AmapCanvasProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMap.Map | null>(null)
  const amapRef = useRef<AMapNamespace | null>(null)
  const disposeDragRef = useRef<(() => void) | null>(null)
  const disposeZoomRef = useRef<(() => void) | null>(null)
  const disposeZoomClampRef = useRef<(() => void) | null>(null)
  const footprintLayerRef = useRef<ReturnType<typeof createMassFootprintLayer> | null>(null)
  const footprintAbortControllerRef = useRef<AbortController | null>(null)
  const footprintPointsRef = useRef<FootprintPoint[] | null>(null)
  const displayedFootprintPointsRef = useRef<FootprintPoint[]>([])
  const timeRangeRef = useRef(timeRange)
  const zoomClampTimersRef = useRef<number[]>([])
  const [status, setStatus] = useState<MapStatus>(
    config.isConfigured ? 'loading' : 'missing-config',
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [footprintStyle, setFootprintStyle] = useState<FootprintStyle>(readStoredFootprintStyle)
  const footprintStyleRef = useRef(footprintStyle)

  const themes = config.themes.length ? config.themes : AMAP_THEMES
  const mapTheme = themes[0]

  useEffect(() => {
    timeRangeRef.current = timeRange
  }, [timeRange])

  const destroyFootprintLayer = useCallback(() => {
    footprintLayerRef.current?.destroy()
    footprintLayerRef.current = null
  }, [])

  const updateDisplayedFootprints = useCallback((points: FootprintPoint[] | null, range: TimeRangeSelection) => {
    const nextDisplayedPoints = points ? filterFootprintPointsByTimeRange(points, range) : []
    displayedFootprintPointsRef.current = nextDisplayedPoints
    footprintLayerRef.current?.update(nextDisplayedPoints)
  }, [])

  const updateFootprintStyle = useCallback((nextFootprintStyle: FootprintStyle) => {
    const normalizedFootprintStyle = normalizeFootprintStyle(nextFootprintStyle)
    if (areFootprintStylesEqual(footprintStyleRef.current, normalizedFootprintStyle)) return

    footprintStyleRef.current = normalizedFootprintStyle
    writeStoredFootprintStyle(normalizedFootprintStyle)
    footprintLayerRef.current?.scheduleStyleUpdate(normalizedFootprintStyle)
    setFootprintStyle(normalizedFootprintStyle)
  }, [])

  const clearZoomClampTimers = useCallback(() => {
    for (const timer of zoomClampTimersRef.current) {
      window.clearTimeout(timer)
    }
    zoomClampTimersRef.current = []
  }, [])

  const clampViewAfterZoom = useCallback(() => {
    clearZoomClampTimers()
    zoomClampTimersRef.current = [450, 720].map((delay) =>
      window.setTimeout(() => {
        if (!mapRef.current || !mapNodeRef.current) return
        clampMapCenterToLatitudeBounds(mapRef.current, mapNodeRef.current, config.renderBounds)
      }, delay),
    )
  }, [clearZoomClampTimers, config.renderBounds])

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

  useEffect(() => {
    if (!config.isConfigured || !mapNodeRef.current) {
      setStatus('missing-config')
      onPanelWidthChange?.(0)
      return
    }

    let disposed = false

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

        mapRef.current = map
        updatePaneLayout(map, mapNodeRef.current)
        if (import.meta.env.DEV) {
          window.__ENROUTE_MAP__ = map
        }
        setStatus('ready')

        footprintAbortControllerRef.current = new AbortController()
        loadFootprintPoints(
          import.meta.env.VITE_FOOTPRINT_API_URL,
          footprintAbortControllerRef.current.signal,
        )
          .then((points) => {
            if (disposed) return
            footprintPointsRef.current = points
            updateDisplayedFootprints(points, timeRangeRef.current)
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
      footprintAbortControllerRef.current?.abort()
      footprintAbortControllerRef.current = null
      clearZoomClampTimers()
      destroyFootprintLayer()
      footprintPointsRef.current = null
      displayedFootprintPointsRef.current = []
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
    destroyFootprintLayer,
    updatePaneLayout,
    clearZoomClampTimers,
    updateDisplayedFootprints,
  ])

  useEffect(() => {
    if (status !== 'ready' || !amapRef.current || !mapRef.current) return

    const layer = createMassFootprintLayer(
      amapRef.current,
      mapRef.current,
      footprintStyleRef.current,
    )
    footprintLayerRef.current = layer
    if (footprintPointsRef.current) {
      updateDisplayedFootprints(footprintPointsRef.current, timeRangeRef.current)
    }

    return () => {
      if (footprintLayerRef.current === layer) {
        destroyFootprintLayer()
      }
    }
  }, [destroyFootprintLayer, status, updateDisplayedFootprints])

  useEffect(() => {
    updateDisplayedFootprints(footprintPointsRef.current, timeRange)
  }, [timeRange, updateDisplayedFootprints])

  useEffect(() => {
    function updateLayoutAfterResize() {
      if (!mapRef.current || !mapNodeRef.current) return
      updatePaneLayout(mapRef.current, mapNodeRef.current)
    }

    window.addEventListener('resize', updateLayoutAfterResize)

    return () => {
      window.removeEventListener('resize', updateLayoutAfterResize)
    }
  }, [updatePaneLayout])

  function showWorldMap() {
    if (!mapRef.current || !mapNodeRef.current) return
    const minimumZoom = calculateMinimumZoomForLatitudeCoverage(mapNodeRef.current.clientHeight)
    mapRef.current.setPitch(DEFAULT_MAP_CAMERA.pitch, true)
    mapRef.current.setRotation(DEFAULT_MAP_CAMERA.rotation, true)
    mapRef.current.setZoomAndCenter(
      minimumZoom,
      [config.defaultCenter[0], calculateWorldCenterLatitude(config.renderBounds)],
      false,
      MAP_CAMERA_DURATION_MS,
    )
    clampViewAfterZoom()
  }

  function fitDisplayedFootprints() {
    if (!mapRef.current || !amapRef.current) return
    const bounds = calculateFootprintLngLatBounds(displayedFootprintPointsRef.current)
    if (!bounds) return

    resetMapCamera(
      mapRef.current,
      toAmapBounds(amapRef.current, bounds),
      FIT_FOOTPRINT_AVOID,
    )
  }

  function zoomIn() {
    if (!mapRef.current || !mapNodeRef.current) return
    zoomByStep(mapRef.current, mapNodeRef.current, config.renderBounds, 1)
  }

  function zoomOut() {
    if (!mapRef.current || !mapNodeRef.current) return
    zoomByStep(mapRef.current, mapNodeRef.current, config.renderBounds, -1)
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
            onFitFootprints={fitDisplayedFootprints}
            onShowWorld={showWorldMap}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            footprintStyle={footprintStyle}
            onFootprintStyleChange={updateFootprintStyle}
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

export const AmapCanvas = memo(AmapCanvasComponent)

function toAmapBounds(AMap: AMapNamespace, bounds: MapBounds) {
  return new AMap.Bounds(bounds.southWest, bounds.northEast)
}

function calculateWorldCenterLatitude(bounds: MapBounds) {
  return (bounds.southWest[1] + bounds.northEast[1]) / 2
}

function readStoredFootprintStyle() {
  try {
    const storedStyle = window.localStorage.getItem(FOOTPRINT_STYLE_STORAGE_KEY)
    if (!storedStyle) return DEFAULT_FOOTPRINT_STYLE

    return normalizeFootprintStyle(JSON.parse(storedStyle) as Partial<FootprintStyle>)
  } catch {
    return DEFAULT_FOOTPRINT_STYLE
  }
}

function writeStoredFootprintStyle(footprintStyle: FootprintStyle) {
  try {
    window.localStorage.setItem(
      FOOTPRINT_STYLE_STORAGE_KEY,
      JSON.stringify(normalizeFootprintStyle(footprintStyle)),
    )
  } catch {
    // Storage can be unavailable in privacy modes; the live map style should still work.
  }
}

function areFootprintStylesEqual(left: FootprintStyle, right: FootprintStyle) {
  return left.pixelSize === right.pixelSize &&
    left.color === right.color &&
    left.opacity === right.opacity
}

