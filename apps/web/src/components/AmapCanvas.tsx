import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { AMAP_THEMES, type AmapConfig } from '../config/amap'
import {
  clampMapCenterToLatitudeBounds,
  installBoundedMapDrag,
} from '../config/mapDragBounds'
import {
  calculateWorldCenter,
  DEFAULT_MAP_CAMERA,
  resetMapCamera,
  type MapBounds,
} from '../config/mapCamera'
import { measureAmapWorldPixelWidthAtZoom } from '../config/mapPaneLayout'
import {
  AMAP_MIN_ZOOM,
  calculateMinimumZoomForViewportCoverage,
  projectLngLat,
} from '../config/mercator'
import { installBoundedMapZoom, zoomByStep } from '../config/mapZoomBounds'
import { loadFootprintSnapshot, type FootprintRenderDebug } from '../layers/footprintDataSource'
import { createMassFootprintLayer } from '../layers/massFootprintLayer'
import type { FootprintLngLatBounds } from '../layers/footprintTypes'
import {
  DEFAULT_FOOTPRINT_STYLE,
  normalizeFootprintStyle,
  type FootprintStyle,
} from '../layers/footprintStyle'
import { loadAmap, type AMapNamespace } from '../services/amapLoader'
import { createTimeRangeTimestamps, type TimeRangeSelection } from '../time/timeRange'
import { MapControls } from './MapControls'
import { formatMetricCount } from './mapMetricFormat'

type AmapCanvasProps = {
  config: AmapConfig
  timeRange: TimeRangeSelection
  onFootprintMetricsChange?: (metrics: FootprintMetrics) => void
}

export type FootprintMetrics = {
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
}

type MapStatus = 'missing-config' | 'loading' | 'ready' | 'error'

const FOOTPRINT_STYLE_STORAGE_KEY = 'enroute.footprintStyle'
const FOOTPRINT_SAMPLING_CELL_SIZE_PX = 0.5
const MAP_CAMERA_DURATION_MS = 900
const FIT_FOOTPRINT_AVOID: [number, number, number, number] = [72, 72, 72, 72]
const FULL_WORLD_VIEWPORT_TOLERANCE_PX = 1
const EMPTY_FOOTPRINT_METRICS: FootprintMetrics = {
  selectedCount: 0,
  totalDistanceMeters: 0,
  averageDistanceMetersPerDay: 0,
}
const EMPTY_FOOTPRINT_DEBUG: FootprintRenderDebug = {
  rawCount: 0,
  renderedCount: 0,
  renderRatio: 0,
}

function AmapCanvasComponent({
  config,
  timeRange,
  onFootprintMetricsChange,
}: AmapCanvasProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMap.Map | null>(null)
  const amapRef = useRef<AMapNamespace | null>(null)
  const geolocationRef = useRef<AMap.Geolocation | null>(null)
  const disposeDragRef = useRef<(() => void) | null>(null)
  const disposeZoomRef = useRef<(() => void) | null>(null)
  const disposeZoomClampRef = useRef<(() => void) | null>(null)
  const footprintLayerRef = useRef<ReturnType<typeof createMassFootprintLayer> | null>(null)
  const footprintAbortControllerRef = useRef<AbortController | null>(null)
  const footprintRequestIdRef = useRef(0)
  const selectedFootprintBoundsRef = useRef<FootprintLngLatBounds | null>(null)
  const timeRangeRef = useRef(timeRange)
  const zoomClampTimersRef = useRef<number[]>([])
  const isWorldViewLockedRef = useRef(true)
  const [status, setStatus] = useState<MapStatus>(
    config.isConfigured ? 'loading' : 'missing-config',
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [footprintStyle, setFootprintStyle] = useState<FootprintStyle>(readStoredFootprintStyle)
  const [footprintDebug, setFootprintDebug] = useState<FootprintRenderDebug>(
    EMPTY_FOOTPRINT_DEBUG,
  )
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

  const updateDisplayedFootprints = useCallback((range: TimeRangeSelection) => {
    if (!mapRef.current || !mapNodeRef.current || !footprintLayerRef.current) {
      selectedFootprintBoundsRef.current = null
      footprintLayerRef.current?.update([])
      setFootprintDebug(EMPTY_FOOTPRINT_DEBUG)
      onFootprintMetricsChange?.(EMPTY_FOOTPRINT_METRICS)
      return
    }

    const viewport = calculateCurrentViewportSampleInput(mapRef.current, mapNodeRef.current)
    const requestId = footprintRequestIdRef.current + 1
    footprintRequestIdRef.current = requestId
    footprintAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    footprintAbortControllerRef.current = abortController

    loadFootprintSnapshot(import.meta.env.VITE_FOOTPRINT_API_URL, {
      timeRange: createTimeRangeTimestamps(range),
      zoom: viewport.zoom,
      cellSizePx: FOOTPRINT_SAMPLING_CELL_SIZE_PX,
      viewportBounds: viewport.bounds,
      viewportNorthWestWorldPixel: viewport.northWestWorldPixel,
    }, abortController.signal)
      .then((snapshot) => {
        if (requestId !== footprintRequestIdRef.current) return

        selectedFootprintBoundsRef.current = snapshot.selectedBounds
        footprintLayerRef.current?.update(snapshot.points)
        setFootprintDebug(snapshot.debug)
        onFootprintMetricsChange?.(snapshot.metrics)
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return

        if (import.meta.env.DEV) {
          console.warn(error)
        }
      })
  }, [onFootprintMetricsChange])

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
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          map.resize()
          const currentZoom = map.getZoom()
          const minimumZoom = calculateMinimumZoomForViewportCoverage({
            viewportWidth: container.clientWidth,
            viewportHeight: container.clientHeight,
          })
          const zoomIsAwayFromMinimum = currentZoom < minimumZoom || currentZoom > minimumZoom
          if (isWorldViewLockedRef.current && zoomIsAwayFromMinimum) {
            map.setZoomAndCenter(
              minimumZoom,
              calculateWorldCenter(config.renderBounds),
              true,
            )
          }
          clampMapCenterToLatitudeBounds(map, container, config.renderBounds)
        })
      })
    },
    [config.renderBounds],
  )

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
        const initialZoom = calculateMinimumZoomForViewportCoverage({
          viewportWidth: mapNodeRef.current.clientWidth,
          viewportHeight: mapNodeRef.current.clientHeight,
        })
        const initialCenter = calculateWorldCenter(config.renderBounds)
        const map = new AMap.Map(mapNodeRef.current, {
          center: initialCenter,
          zoom: initialZoom,
          zooms: [AMAP_MIN_ZOOM, 20],
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

        AMap.plugin('AMap.Geolocation', () => {
          if (disposed) return
          geolocationRef.current = new AMap.Geolocation({
            enableHighAccuracy: true,
            timeout: 8000,
            zoomToAccuracy: true,
          })
        })

        mapRef.current = map
        updatePaneLayout(map, mapNodeRef.current)
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
      footprintRequestIdRef.current += 1
      footprintAbortControllerRef.current?.abort()
      footprintAbortControllerRef.current = null
      clearZoomClampTimers()
      destroyFootprintLayer()
      selectedFootprintBoundsRef.current = null
      setFootprintDebug(EMPTY_FOOTPRINT_DEBUG)
      onFootprintMetricsChange?.(EMPTY_FOOTPRINT_METRICS)
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
    destroyFootprintLayer,
    updatePaneLayout,
    clearZoomClampTimers,
    updateDisplayedFootprints,
    onFootprintMetricsChange,
  ])

  useEffect(() => {
    if (status !== 'ready' || !amapRef.current || !mapRef.current) return

    const layer = createMassFootprintLayer(
      amapRef.current,
      mapRef.current,
      footprintStyleRef.current,
    )
    footprintLayerRef.current = layer
    updateDisplayedFootprints(timeRangeRef.current)

    return () => {
      if (footprintLayerRef.current === layer) {
        destroyFootprintLayer()
      }
    }
  }, [destroyFootprintLayer, status, updateDisplayedFootprints])

  useEffect(() => {
    updateDisplayedFootprints(timeRange)
  }, [timeRange, updateDisplayedFootprints])

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return
    const map = mapRef.current
    const updateAfterViewportSettles = () => {
      updateDisplayedFootprints(timeRangeRef.current)
    }

    map.on('moveend', updateAfterViewportSettles)
    map.on('zoomend', updateAfterViewportSettles)

    return () => {
      map.off('moveend', updateAfterViewportSettles)
      map.off('zoomend', updateAfterViewportSettles)
    }
  }, [status, updateDisplayedFootprints])

  useEffect(() => {
    function updateLayoutAfterResize() {
      if (!mapRef.current || !mapNodeRef.current) return
      updatePaneLayout(mapRef.current, mapNodeRef.current)
      updateDisplayedFootprints(timeRangeRef.current)
    }

    window.addEventListener('resize', updateLayoutAfterResize)

    return () => {
      window.removeEventListener('resize', updateLayoutAfterResize)
    }
  }, [updateDisplayedFootprints, updatePaneLayout])

  function showWorldMap() {
    if (!mapRef.current || !mapNodeRef.current) return
    const minimumZoom = calculateMinimumZoomForViewportCoverage({
      viewportWidth: mapNodeRef.current.clientWidth,
      viewportHeight: mapNodeRef.current.clientHeight,
    })
    mapRef.current.setPitch(DEFAULT_MAP_CAMERA.pitch, true)
    mapRef.current.setRotation(DEFAULT_MAP_CAMERA.rotation, true)
    isWorldViewLockedRef.current = true
    mapRef.current.setZoomAndCenter(
      minimumZoom,
      calculateWorldCenter(config.renderBounds),
      false,
      MAP_CAMERA_DURATION_MS,
    )
    clampViewAfterZoom()
  }

  function fitDisplayedFootprints() {
    if (!mapRef.current || !amapRef.current) return
    const bounds = selectedFootprintBoundsRef.current
    if (!bounds) return

    isWorldViewLockedRef.current = false
    resetMapCamera(
      mapRef.current,
      toAmapBounds(amapRef.current, bounds),
      FIT_FOOTPRINT_AVOID,
    )
  }

  function locate() {
    isWorldViewLockedRef.current = false
    geolocationRef.current?.getCurrentPosition()
  }

  function zoomIn() {
    if (!mapRef.current || !mapNodeRef.current) return
    isWorldViewLockedRef.current = false
    zoomByStep(mapRef.current, mapNodeRef.current, config.renderBounds, 1)
  }

  function zoomOut() {
    if (!mapRef.current || !mapNodeRef.current) return
    isWorldViewLockedRef.current = false
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
            onLocate={locate}
            onShowWorld={showWorldMap}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            footprintStyle={footprintStyle}
            onFootprintStyleChange={updateFootprintStyle}
          />
          {status === 'ready' ? <FootprintDebugPanel debug={footprintDebug} /> : null}
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

function readStoredFootprintStyle() {
  try {
    const storedStyle = window.localStorage.getItem(FOOTPRINT_STYLE_STORAGE_KEY)
    if (!storedStyle) return DEFAULT_FOOTPRINT_STYLE

    return normalizeFootprintStyle(JSON.parse(storedStyle) as Partial<FootprintStyle>)
  } catch {
    return DEFAULT_FOOTPRINT_STYLE
  }
}

function calculateCurrentViewportSampleInput(map: AMap.Map, container: HTMLElement) {
  const zoom = map.getZoom()
  const northWest = map.containerToLngLat({ x: 0, y: 0 })
  const southEast = map.containerToLngLat({
    x: container.clientWidth,
    y: container.clientHeight,
  })
  const northWestLngLat: [number, number] = [northWest.getLng(), northWest.getLat()]
  const southEastLngLat: [number, number] = [southEast.getLng(), southEast.getLat()]
  const viewportCoversFullWorld =
    container.clientWidth >=
    measureAmapWorldPixelWidthAtZoom(map, zoom) - FULL_WORLD_VIEWPORT_TOLERANCE_PX

  return {
    zoom,
    bounds: {
      west: viewportCoversFullWorld ? -180 : northWestLngLat[0],
      north: northWestLngLat[1],
      east: viewportCoversFullWorld ? 180 : southEastLngLat[0],
      south: southEastLngLat[1],
    },
    northWestWorldPixel: projectLngLat(northWestLngLat, zoom),
  }
}

function FootprintDebugPanel({ debug }: { debug: FootprintRenderDebug }) {
  return (
    <aside className="footprint-debug-panel" aria-label="足迹渲染调试">
      <div className="footprint-debug-panel__row">
        <span>渲染点数</span>
        <strong>{formatMetricCount(debug.renderedCount)}</strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>实际点数</span>
        <strong>{formatMetricCount(debug.rawCount)}</strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>渲染比例</span>
        <strong>{formatRenderRatio(debug.renderRatio)}</strong>
      </div>
    </aside>
  )
}

function formatRenderRatio(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0)
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

