import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'

import {
  createFootprintCircleLayer,
  createFootprintVectorTileSource,
  DEFAULT_FOOTPRINT_TILE_URL,
  FOOTPRINT_CIRCLE_LAYER_ID,
  FOOTPRINT_VECTOR_SOURCE_ID,
  type FootprintVectorTileRange,
} from '../layers/footprintVectorTileSource'
import {
  DEFAULT_FOOTPRINT_STYLE,
  normalizeFootprintStyle,
  type FootprintStyle,
} from '../layers/footprintStyle'
import type { TimeRangeSelection } from '../time/timeRange'
import { MapControls } from './MapControls'

type MapboxCanvasProps = {
  accessToken?: string
  styleUrl?: string
  tileUrl?: string
  timeRange: TimeRangeSelection
  onFootprintMetricsChange?: (metrics: FootprintMetrics) => void
  adminRegionUnlockEnabled?: boolean
  debugPanelVisible?: boolean
}

export type FootprintMetrics = {
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
}

type MapboxCanvasEnv = {
  VITE_MAPBOX_ACCESS_TOKEN?: string
  VITE_MAPBOX_STYLE_URL?: string
  VITE_FOOTPRINT_TILE_URL?: string
  VITE_FOOTPRINT_METRICS_URL?: string
}

type MapStatus = 'missing-token' | 'loading' | 'ready' | 'error'

const DEFAULT_MAPBOX_STYLE_URL = 'mapbox://styles/mapbox/light-v11'
const DEFAULT_FOOTPRINT_METRICS_URL = '/api/footprints/metrics'
const DEFAULT_MAP_CENTER: [number, number] = [104.195397, 35.86166]
const DEFAULT_MAP_ZOOM = 2.2
const FOOTPRINT_STYLE_STORAGE_KEY = 'enroute.footprintStyle'
const EMPTY_FOOTPRINT_METRICS: FootprintMetrics = {
  selectedCount: 0,
  totalDistanceMeters: 0,
  averageDistanceMetersPerDay: 0,
}

function MapboxCanvasComponent({
  accessToken,
  styleUrl,
  tileUrl,
  timeRange,
  onFootprintMetricsChange,
  adminRegionUnlockEnabled = false,
  debugPanelVisible = false,
}: MapboxCanvasProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [footprintStyle, setFootprintStyle] = useState<FootprintStyle>(readStoredFootprintStyle)
  const footprintStyleRef = useRef(footprintStyle)

  const resolvedAccessToken = resolveConfigValue(
    accessToken,
    (import.meta.env as MapboxCanvasEnv).VITE_MAPBOX_ACCESS_TOKEN,
  )
  const resolvedStyleUrl = resolveConfigValue(
    styleUrl,
    (import.meta.env as MapboxCanvasEnv).VITE_MAPBOX_STYLE_URL,
    DEFAULT_MAPBOX_STYLE_URL,
  )
  const resolvedTileUrl = resolveConfigValue(
    tileUrl,
    (import.meta.env as MapboxCanvasEnv).VITE_FOOTPRINT_TILE_URL,
    DEFAULT_FOOTPRINT_TILE_URL,
  )
  const resolvedMetricsUrl = resolveConfigValue(
    undefined,
    (import.meta.env as MapboxCanvasEnv).VITE_FOOTPRINT_METRICS_URL,
    DEFAULT_FOOTPRINT_METRICS_URL,
  )
  const footprintTileRange = useMemo(
    () => createFootprintTileRange(timeRange),
    [timeRange],
  )

  const refreshFootprintLayer = useCallback((
    range: FootprintVectorTileRange,
    currentTileUrl: string,
  ) => {
    const map = mapRef.current

    if (!map) return

    if (map.getLayer(FOOTPRINT_CIRCLE_LAYER_ID)) {
      map.removeLayer(FOOTPRINT_CIRCLE_LAYER_ID)
    }

    if (map.getSource(FOOTPRINT_VECTOR_SOURCE_ID)) {
      map.removeSource(FOOTPRINT_VECTOR_SOURCE_ID)
    }

    map.addSource(
      FOOTPRINT_VECTOR_SOURCE_ID,
      createFootprintVectorTileSource({
        ...range,
        tileUrl: createMapboxTileUrl(currentTileUrl),
      }),
    )
    map.addLayer(createFootprintCircleLayer(footprintStyleRef.current))
  }, [])

  const updateFootprintLayerPaint = useCallback((nextFootprintStyle: FootprintStyle) => {
    const map = mapRef.current

    if (!map?.getLayer(FOOTPRINT_CIRCLE_LAYER_ID)) return

    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-radius', nextFootprintStyle.pixelSize)
    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-color', nextFootprintStyle.color)
    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-opacity', nextFootprintStyle.opacity)
  }, [])

  useEffect(() => {
    onFootprintMetricsChange?.(EMPTY_FOOTPRINT_METRICS)
  }, [onFootprintMetricsChange])

  useEffect(() => {
    if (!onFootprintMetricsChange) return

    const abortController = new AbortController()

    fetch(createFootprintMetricsUrl(resolvedMetricsUrl, footprintTileRange), {
      method: 'GET',
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Footprint metrics request failed: ${response.status}`)
        }

        return response.json() as Promise<FootprintMetrics>
      })
      .then((metrics) => {
        if (!abortController.signal.aborted) {
          onFootprintMetricsChange(metrics)
        }
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          onFootprintMetricsChange(EMPTY_FOOTPRINT_METRICS)
        }
      })

    return () => {
      abortController.abort()
    }
  }, [footprintTileRange, onFootprintMetricsChange, resolvedMetricsUrl])

  useEffect(() => {
    if (!resolvedAccessToken || !mapNodeRef.current) {
      setStatus('missing-token')
      return
    }

    let disposed = false

    setStatus('loading')
    setErrorMessage('')
    mapboxgl.accessToken = resolvedAccessToken

    const reportInitializationError = (error: unknown) => {
      window.setTimeout(() => {
        if (disposed) return

        setErrorMessage(error instanceof Error ? error.message : 'Mapbox 地图初始化失败')
        setStatus('error')
      }, 0)
    }

    try {
      const map = new mapboxgl.Map({
        container: mapNodeRef.current,
        style: resolvedStyleUrl,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        maxZoom: 18,
        minPitch: 0,
        maxPitch: 0,
        pitch: 0,
        bearing: 0,
        dragRotate: false,
        touchZoomRotate: false,
        touchPitch: false,
        projection: 'mercator',
        renderWorldCopies: true,
      })
      mapRef.current = map

      const handleLoad = () => {
        if (disposed) return

        setStatus('ready')
      }
      const handleError = (event: ErrorEvent | { error?: unknown }) => {
        if (disposed) return

        const nextError = 'error' in event ? event.error : undefined
        setErrorMessage(nextError instanceof Error ? nextError.message : 'Mapbox 地图加载失败')
        setStatus('error')
      }

      map.on('load', handleLoad)
      map.on('error', handleError)

      return () => {
        disposed = true
        map.off('load', handleLoad)
        map.off('error', handleError)
        map.remove()
        mapRef.current = null
      }
    } catch (error: unknown) {
      reportInitializationError(error)
    }
  }, [resolvedAccessToken, resolvedStyleUrl])

  useEffect(() => {
    if (status !== 'ready') return

    refreshFootprintLayer(footprintTileRange, resolvedTileUrl)
  }, [footprintTileRange, refreshFootprintLayer, resolvedTileUrl, status])

  const updateFootprintStyle = useCallback((nextFootprintStyle: FootprintStyle) => {
    const normalizedFootprintStyle = normalizeFootprintStyle(nextFootprintStyle)

    footprintStyleRef.current = normalizedFootprintStyle
    writeStoredFootprintStyle(normalizedFootprintStyle)
    setFootprintStyle(normalizedFootprintStyle)
    updateFootprintLayerPaint(normalizedFootprintStyle)
  }, [updateFootprintLayerPaint])

  const showWorldMap = useCallback(() => {
    mapRef.current?.flyTo({
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      bearing: 0,
      pitch: 0,
    })
  }, [])

  const fitDisplayedFootprints = useCallback(() => {
    showWorldMap()
  }, [showWorldMap])

  const locate = useCallback(() => {
    if (!navigator.geolocation) return

    navigator.geolocation.getCurrentPosition((position) => {
      mapRef.current?.flyTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: 14,
      })
    })
  }, [])

  const zoomIn = useCallback(() => {
    mapRef.current?.zoomIn()
  }, [])

  const zoomOut = useCallback(() => {
    mapRef.current?.zoomOut()
  }, [])

  return (
    <section
      className="map-stage"
      aria-label="在途 EnRoute 地图工作区"
    >
      <div className="amap-surface mapbox-surface" ref={mapNodeRef} />
      <MapControls
        onFitFootprints={fitDisplayedFootprints}
        onLocate={locate}
        onShowWorld={showWorldMap}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        footprintStyle={footprintStyle}
        onFootprintStyleChange={updateFootprintStyle}
      />
      {adminRegionUnlockEnabled ? (
        <div className="map-message map-message--compat" role="status">
          <h2>行政区划图层迁移中</h2>
          <p>当前 Mapbox 底座已切换到足迹 MVT 瓦片，行政区划图层会在后续独立迁移。</p>
        </div>
      ) : null}
      {debugPanelVisible ? (
        <FootprintDebugPanel />
      ) : null}
      {status === 'missing-token' ? (
        <div className="map-message" role="status">
          <h2>需要配置 Mapbox 访问令牌</h2>
          <p>在 `.env.local` 中配置 Mapbox 令牌后，位置页会加载 MVT 足迹瓦片。</p>
          <pre>VITE_MAPBOX_ACCESS_TOKEN</pre>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="map-message" role="alert">
          <h2>Mapbox 地图加载失败</h2>
          <p>{errorMessage}</p>
        </div>
      ) : null}
    </section>
  )
}

export const MapboxCanvas = memo(MapboxCanvasComponent)

function createFootprintTileRange(timeRange: TimeRangeSelection): FootprintVectorTileRange {
  if (timeRange.isOpenEnded) {
    return { range: 'all' }
  }

  return {
    start: timeRange.start,
    end: timeRange.end,
  }
}

function createFootprintMetricsUrl(
  metricsUrl: string,
  range: FootprintVectorTileRange,
) {
  const params = new URLSearchParams()

  if (range.range === 'all') {
    params.set('range', 'all')
  } else {
    params.set('start', range.start)
    params.set('end', range.end)
  }

  return `${metricsUrl}?${params.toString()}`
}

function createMapboxTileUrl(tileUrl: string) {
  if (/^https?:\/\//i.test(tileUrl)) return tileUrl

  const normalizedTileUrl = tileUrl.startsWith('/') ? tileUrl : `/${tileUrl}`

  return `${window.location.origin}${normalizedTileUrl}`
}

function resolveConfigValue(
  explicitValue: string | undefined,
  envValue: string | undefined,
  fallback = '',
) {
  if (explicitValue !== undefined) return explicitValue.trim()

  return envValue?.trim() || fallback
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

function FootprintDebugPanel() {
  return (
    <aside className="footprint-debug-panel" aria-label="足迹渲染调试">
      <div className="footprint-debug-panel__row">
        <span>渲染方式</span>
        <strong>MVT</strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>瓦片层级</span>
        <strong>0-18</strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>客户端采样</span>
        <strong>无</strong>
      </div>
    </aside>
  )
}
