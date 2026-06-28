import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl, { type LayerSpecification } from 'mapbox-gl'

import {
  createFootprintCircleLayer,
  createFootprintVectorTileSource,
  DEFAULT_FOOTPRINT_TILE_URL,
  FOOTPRINT_CIRCLE_LAYER_ID,
  FOOTPRINT_VECTOR_SOURCE_ID,
  MAX_FOOTPRINT_TILE_ZOOM,
  type FootprintVectorTileRange,
} from '../layers/footprintVectorTileSource'
import {
  DEFAULT_FOOTPRINT_STYLE,
  normalizeFootprintStyle,
  type FootprintStyle,
} from '../layers/footprintStyle'
import { DEFAULT_MAPBOX_STYLE_URL, type MapStylePreference } from '../mapStyleOptions'
import type { TimeRangeSelection } from '../time/timeRange'
import { MapControls } from './MapControls'

type MapboxCanvasProps = {
  accessToken?: string
  styleUrl?: string
  projection?: MapboxProjection
  language?: MapboxLanguage
  tileUrl?: string
  timeRange: TimeRangeSelection
  onFootprintMetricsChange?: (metrics: FootprintMetrics) => void
  adminRegionUnlockEnabled?: boolean
  debugPanelVisible?: boolean
  placeLabelsVisible?: boolean
  adminBoundariesVisible?: boolean
  mapStyle?: MapStylePreference
  mapLanguage?: MapboxLanguagePreference
  onPlaceLabelsVisibleChange?: (visible: boolean) => void
  onAdminBoundariesVisibleChange?: (visible: boolean) => void
  onMapStyleChange?: (style: MapStylePreference) => void
  onMapProjectionChange?: (projection: MapboxProjection) => void
  onMapLanguageChange?: (language: MapboxLanguagePreference) => void
}

export type FootprintMetrics = {
  selectedCount: number
  totalDistanceMeters: number
  averageDistanceMetersPerDay: number
  selectedBounds?: FootprintLngLatBounds | null
}

type FootprintLngLatBounds = {
  southWest: [number, number]
  northEast: [number, number]
}

type MapboxCanvasEnv = {
  VITE_MAPBOX_ACCESS_TOKEN?: string
  VITE_MAPBOX_STYLE_URL?: string
  VITE_MAPBOX_PROJECTION?: string
  VITE_FOOTPRINT_TILE_URL?: string
  VITE_FOOTPRINT_METRICS_URL?: string
  VITE_FOOTPRINT_TILE_DEBUG_URL?: string
}

type MapboxProjection = 'globe' | 'mercator'
type MapboxLanguage = 'zh-Hans' | 'en'
type MapboxLanguagePreference = 'auto' | MapboxLanguage
type EnRouteMapboxOptions = ConstructorParameters<typeof mapboxgl.Map>[0] & {
  language?: MapboxLanguage
  worldview: 'CN'
}

type MapStatus = 'missing-token' | 'loading' | 'ready' | 'error'

type FootprintTileDebugMetrics = {
  tileZoom: number
  cameraZoom?: number
  requestedTileCount: number
  populatedTileCount: number
  readyTileCount: number
  dirtyTileCount: number
  rawCount: number
  representativeCount: number
  renderRatio: number
}

type FootprintTileDebugViewport = {
  z: number
  west: number
  south: number
  east: number
  north: number
  tiles?: string[]
}

type BaseMapVisibilityLayerKind = 'place-label' | 'admin-boundary'
type BaseMapVisibilityRecord = {
  id: string
  kind: BaseMapVisibilityLayerKind
  originalVisibility: 'visible' | 'none'
  lastVisibilityOverride?: 'none'
}
type BaseMapConfigPropertyName =
  | 'showPlaceLabels'
  | 'showPointOfInterestLabels'
  | 'showRoadLabels'
  | 'showTransitLabels'
  | 'showAdminBoundaries'

const DEFAULT_MAPBOX_PROJECTION: MapboxProjection = 'globe'
const DEFAULT_FOOTPRINT_METRICS_URL = '/api/footprints/metrics'
const DEFAULT_FOOTPRINT_TILE_DEBUG_URL = '/api/map/tiles/footprints/debug'
const DEFAULT_MAP_CENTER: [number, number] = [104.195397, 35.86166]
const DEFAULT_MAP_ZOOM = 2.2
const GLOBE_WORLD_ZOOM = 1.75
const GLOBE_ROTATION_STEP_DEGREES = 1.2
const GLOBE_ROTATION_INTERVAL_MS = 1000
const MAX_MERCATOR_LATITUDE = 85.05112878
const MAP_FIT_BOUNDS_DURATION_MS = 900
const MAP_FIT_BOUNDS_PADDING_PX = 96
const FOOTPRINT_STYLE_STORAGE_KEY = 'enroute.footprintStyle'
const EMPTY_FOOTPRINT_METRICS: FootprintMetrics = {
  selectedCount: 0,
  totalDistanceMeters: 0,
  averageDistanceMetersPerDay: 0,
}

function MapboxCanvasComponent({
  accessToken,
  styleUrl,
  projection,
  language,
  tileUrl,
  timeRange,
  onFootprintMetricsChange,
  adminRegionUnlockEnabled = false,
  debugPanelVisible = false,
  placeLabelsVisible = true,
  adminBoundariesVisible = true,
  mapStyle,
  mapLanguage = 'auto',
  onPlaceLabelsVisibleChange,
  onAdminBoundariesVisibleChange,
  onMapStyleChange,
  onMapProjectionChange,
  onMapLanguageChange,
}: MapboxCanvasProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [footprintStyle, setFootprintStyle] = useState<FootprintStyle>(readStoredFootprintStyle)
  const [cameraZoom, setCameraZoom] = useState<number | undefined>(undefined)
  const [tileDebugMetrics, setTileDebugMetrics] = useState<FootprintTileDebugMetrics | null>(null)
  const [styleReady, setStyleReady] = useState(false)
  const footprintStyleRef = useRef(footprintStyle)
  const selectedFootprintBoundsRef = useRef<FootprintLngLatBounds | null>(null)
  const baseMapVisibilityRecordsRef = useRef<BaseMapVisibilityRecord[]>([])
  const hiddenBaseMapConfigOverridesRef = useRef<Set<BaseMapConfigPropertyName>>(new Set())
  const originalBaseMapConfigValuesRef = useRef<Map<BaseMapConfigPropertyName, unknown>>(new Map())
  const resolvedStyleUrlRef = useRef('')
  const globeRotationTimerRef = useRef<number | undefined>(undefined)
  const globeRotationStartHandlerRef = useRef<(() => void) | undefined>(undefined)
  const globeRotationPendingWorldViewRef = useRef(false)
  const globeRotationRequestedRef = useRef(false)
  const globeRotationDraggingRef = useRef(false)

  const resolvedAccessToken = resolveConfigValue(
    accessToken,
    (import.meta.env as MapboxCanvasEnv).VITE_MAPBOX_ACCESS_TOKEN,
  )
  const resolvedStyleUrl = resolveConfigValue(
    styleUrl,
    (import.meta.env as MapboxCanvasEnv).VITE_MAPBOX_STYLE_URL,
    DEFAULT_MAPBOX_STYLE_URL,
  )
  const latestResolvedStyleUrlRef = useRef(resolvedStyleUrl)
  const resolvedProjection = resolveMapboxProjection(
    projection,
    (import.meta.env as MapboxCanvasEnv).VITE_MAPBOX_PROJECTION,
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
  const resolvedTileDebugUrl = resolveConfigValue(
    undefined,
    (import.meta.env as MapboxCanvasEnv).VITE_FOOTPRINT_TILE_DEBUG_URL,
    DEFAULT_FOOTPRINT_TILE_DEBUG_URL,
  )
  const footprintTileRange = useMemo(
    () => createFootprintTileRange(timeRange),
    [timeRange],
  )

  useEffect(() => {
    latestResolvedStyleUrlRef.current = resolvedStyleUrl
  }, [resolvedStyleUrl])

  const refreshFootprintLayer = useCallback((
    range: FootprintVectorTileRange,
    currentTileUrl: string,
  ) => {
    const map = mapRef.current

    if (!map || !map.isStyleLoaded()) return

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

    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-radius', nextFootprintStyle.pixelSize / 2)
    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-color', nextFootprintStyle.color)
    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-opacity', nextFootprintStyle.opacity)
  }, [])

  const updateBaseMapLayerVisibility = useCallback(() => {
    const map = mapRef.current

    if (!map) return

    if (baseMapVisibilityRecordsRef.current.length === 0) {
      baseMapVisibilityRecordsRef.current = collectBaseMapVisibilityRecords(map)
    }

    updateBaseMapConfigOverride(
      map,
      hiddenBaseMapConfigOverridesRef.current,
      originalBaseMapConfigValuesRef.current,
      'showPlaceLabels',
      placeLabelsVisible,
    )
    updateBaseMapConfigOverride(
      map,
      hiddenBaseMapConfigOverridesRef.current,
      originalBaseMapConfigValuesRef.current,
      'showPointOfInterestLabels',
      placeLabelsVisible,
    )
    updateBaseMapConfigOverride(
      map,
      hiddenBaseMapConfigOverridesRef.current,
      originalBaseMapConfigValuesRef.current,
      'showRoadLabels',
      placeLabelsVisible,
    )
    updateBaseMapConfigOverride(
      map,
      hiddenBaseMapConfigOverridesRef.current,
      originalBaseMapConfigValuesRef.current,
      'showTransitLabels',
      placeLabelsVisible,
    )
    updateBaseMapConfigOverride(
      map,
      hiddenBaseMapConfigOverridesRef.current,
      originalBaseMapConfigValuesRef.current,
      'showAdminBoundaries',
      adminBoundariesVisible,
    )

    for (const record of baseMapVisibilityRecordsRef.current) {
      const isVisible = record.kind === 'place-label'
        ? placeLabelsVisible
        : adminBoundariesVisible

      if (!map.getLayer(record.id)) continue
      if (isVisible && record.lastVisibilityOverride === undefined) continue

      const nextVisibility = isVisible ? record.originalVisibility : 'none'

      map.setLayoutProperty(record.id, 'visibility', nextVisibility)
      record.lastVisibilityOverride = isVisible ? undefined : 'none'
    }
  }, [adminBoundariesVisible, placeLabelsVisible])

  const resetBaseMapVisibilityState = useCallback(() => {
    baseMapVisibilityRecordsRef.current = []
    hiddenBaseMapConfigOverridesRef.current.clear()
    originalBaseMapConfigValuesRef.current.clear()
  }, [])

  const clearGlobeRotationTimer = useCallback(() => {
    if (globeRotationTimerRef.current === undefined) return

    window.clearInterval(globeRotationTimerRef.current)
    globeRotationTimerRef.current = undefined
  }, [])

  const clearPendingGlobeRotationStart = useCallback((map: mapboxgl.Map | null) => {
    if (map && globeRotationStartHandlerRef.current) {
      map.off('moveend', globeRotationStartHandlerRef.current)
    }

    globeRotationStartHandlerRef.current = undefined
    globeRotationPendingWorldViewRef.current = false
  }, [])

  const stopGlobeRotation = useCallback(() => {
    const map = mapRef.current
    globeRotationRequestedRef.current = false
    globeRotationDraggingRef.current = false
    clearPendingGlobeRotationStart(map)
    clearGlobeRotationTimer()
  }, [clearGlobeRotationTimer, clearPendingGlobeRotationStart])

  const startGlobeRotation = useCallback(() => {
    const map = mapRef.current
    if (!map || resolvedProjection !== 'globe') return

    globeRotationRequestedRef.current = true
    clearPendingGlobeRotationStart(map)
    clearGlobeRotationTimer()
    if (globeRotationDraggingRef.current) return

    const rotateGlobeOnce = () => {
      const center = map.getCenter()

      map.easeTo({
        center: [normalizeLongitude(center.lng - GLOBE_ROTATION_STEP_DEGREES), center.lat],
        bearing: 0,
        pitch: 0,
        duration: GLOBE_ROTATION_INTERVAL_MS,
        easing: (time: number) => time,
      })
    }

    rotateGlobeOnce()
    globeRotationTimerRef.current = window.setInterval(rotateGlobeOnce, GLOBE_ROTATION_INTERVAL_MS)
  }, [clearGlobeRotationTimer, clearPendingGlobeRotationStart, resolvedProjection])

  const startGlobeRotationAfterMove = useCallback(() => {
    const map = mapRef.current
    if (!map || resolvedProjection !== 'globe') return

    globeRotationRequestedRef.current = true
    clearPendingGlobeRotationStart(map)
    clearGlobeRotationTimer()

    const handleMoveEnd = () => {
      map.off('moveend', handleMoveEnd)
      globeRotationStartHandlerRef.current = undefined
      globeRotationPendingWorldViewRef.current = false
      if (!globeRotationRequestedRef.current || globeRotationDraggingRef.current) return

      startGlobeRotation()
    }

    globeRotationStartHandlerRef.current = handleMoveEnd
    globeRotationPendingWorldViewRef.current = true
    map.on('moveend', handleMoveEnd)
  }, [clearGlobeRotationTimer, clearPendingGlobeRotationStart, resolvedProjection, startGlobeRotation])

  useEffect(() => {
    onFootprintMetricsChange?.(EMPTY_FOOTPRINT_METRICS)
  }, [onFootprintMetricsChange])

  useEffect(() => {
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
          selectedFootprintBoundsRef.current = metrics.selectedBounds ?? null
          onFootprintMetricsChange?.(metrics)
        }
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          selectedFootprintBoundsRef.current = null
          onFootprintMetricsChange?.(EMPTY_FOOTPRINT_METRICS)
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
    setStyleReady(false)
    mapboxgl.accessToken = resolvedAccessToken
    resolvedStyleUrlRef.current = latestResolvedStyleUrlRef.current

    const reportInitializationError = (error: unknown) => {
      window.setTimeout(() => {
        if (disposed) return

        setErrorMessage(error instanceof Error ? error.message : 'Mapbox 地图初始化失败')
        setStatus('error')
      }, 0)
    }

    try {
      const mapNode = mapNodeRef.current
      resetBaseMapVisibilityState()
      const mapOptions: EnRouteMapboxOptions = {
        container: mapNode,
        style: latestResolvedStyleUrlRef.current,
        center: DEFAULT_MAP_CENTER,
        zoom: resolvedProjection === 'globe' ? GLOBE_WORLD_ZOOM : DEFAULT_MAP_ZOOM,
        maxZoom: MAX_FOOTPRINT_TILE_ZOOM,
        minPitch: 0,
        maxPitch: 0,
        pitch: 0,
        bearing: 0,
        dragRotate: false,
        touchZoomRotate: false,
        touchPitch: false,
        projection: resolvedProjection,
        renderWorldCopies: resolvedProjection === 'mercator',
        fadeDuration: 0,
        worldview: 'CN',
      }
      if (language) {
        mapOptions.language = language
      }

      const map = new mapboxgl.Map(mapOptions)
      mapRef.current = map

      const handleLoad = () => {
        if (disposed) return

        setStatus('ready')
        setStyleReady(map.isStyleLoaded())
        if (resolvedProjection === 'globe') {
          startGlobeRotation()
        }
      }
      const handleStyleLoad = () => {
        if (disposed) return

        setStyleReady(true)
        setStatus('ready')
      }
      const handleError = (event: ErrorEvent | { error?: unknown }) => {
        if (disposed) return

        const nextError = 'error' in event ? event.error : undefined
        setErrorMessage(nextError instanceof Error ? nextError.message : 'Mapbox 地图加载失败')
        setStatus('error')
      }
      const handleZoomStart = () => {
        if (globeRotationPendingWorldViewRef.current) return

        stopGlobeRotation()
      }
      const handlePointerDown = () => {
        if (!globeRotationRequestedRef.current) return

        map.stop()
      }
      const handleDragStart = () => {
        if (!globeRotationRequestedRef.current) return

        globeRotationDraggingRef.current = true
        clearGlobeRotationTimer()
      }
      const handleDragEnd = () => {
        if (!globeRotationDraggingRef.current) return

        globeRotationDraggingRef.current = false
        if (!globeRotationRequestedRef.current) return

        startGlobeRotation()
      }

      map.on('load', handleLoad)
      map.on('style.load', handleStyleLoad)
      map.on('error', handleError)
      map.on('zoomstart', handleZoomStart)
      map.on('dragstart', handleDragStart)
      map.on('dragend', handleDragEnd)
      mapNode.addEventListener('pointerdown', handlePointerDown, { capture: true })

      return () => {
        disposed = true
        mapNode.removeEventListener('pointerdown', handlePointerDown, { capture: true })
        stopGlobeRotation()
        map.off('load', handleLoad)
        map.off('style.load', handleStyleLoad)
        map.off('error', handleError)
        map.off('zoomstart', handleZoomStart)
        map.off('dragstart', handleDragStart)
        map.off('dragend', handleDragEnd)
        map.remove()
        mapRef.current = null
      }
    } catch (error: unknown) {
      reportInitializationError(error)
    }
  }, [
    clearGlobeRotationTimer,
    resolvedAccessToken,
    language,
    resolvedProjection,
    resetBaseMapVisibilityState,
    startGlobeRotation,
    stopGlobeRotation,
  ])

  useEffect(() => {
    const map = mapRef.current

    if (!map || status !== 'ready') return
    if (resolvedStyleUrlRef.current === resolvedStyleUrl) return

    resolvedStyleUrlRef.current = resolvedStyleUrl
    setStatus('loading')
    setStyleReady(false)
    resetBaseMapVisibilityState()
    map.setStyle(resolvedStyleUrl)
  }, [resetBaseMapVisibilityState, resolvedStyleUrl, status])

  useEffect(() => {
    if (status !== 'ready' || !styleReady) return

    refreshFootprintLayer(footprintTileRange, resolvedTileUrl)
  }, [footprintTileRange, refreshFootprintLayer, resolvedTileUrl, status, styleReady])

  useEffect(() => {
    if (status !== 'ready' || !styleReady) return

    updateBaseMapLayerVisibility()
  }, [
    adminBoundariesVisible,
    placeLabelsVisible,
    styleReady,
    status,
    updateBaseMapLayerVisibility,
  ])

  useEffect(() => {
    if (!debugPanelVisible || status !== 'ready') {
      return
    }

    const map = mapRef.current
    if (!map) return

    setCameraZoom(map.getZoom())

    let abortController: AbortController | null = null

    const refreshTileDebugMetrics = () => {
      const debugUrl = createFootprintTileDebugUrl(
        resolvedTileDebugUrl,
        footprintTileRange,
        getCurrentFootprintTileDebugViewport(map, resolvedProjection),
      )

      abortController?.abort()
      const currentAbortController = new AbortController()
      abortController = currentAbortController

      fetch(debugUrl, {
        method: 'GET',
        signal: currentAbortController.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Footprint tile debug request failed: ${response.status}`)
          }

          return response.json() as Promise<FootprintTileDebugMetrics>
        })
        .then((metrics) => {
          if (!currentAbortController.signal.aborted) {
            setTileDebugMetrics(metrics)
          }
        })
        .catch(() => {})
    }

    const refreshCameraZoom = () => {
      setCameraZoom(map.getZoom())
    }

    refreshTileDebugMetrics()
    const refreshTileDebugMetricsAfterMove = () => {
      refreshTileDebugMetrics()
      refreshCameraZoom()
    }

    map.on('moveend', refreshTileDebugMetricsAfterMove)
    map.on('zoomend', refreshTileDebugMetrics)
    map.on('zoom', refreshCameraZoom)

    return () => {
      abortController?.abort()
      map.off('moveend', refreshTileDebugMetricsAfterMove)
      map.off('zoomend', refreshTileDebugMetrics)
      map.off('zoom', refreshCameraZoom)
    }
  }, [debugPanelVisible, footprintTileRange, resolvedProjection, resolvedTileDebugUrl, status])

  const updateFootprintStyle = useCallback((nextFootprintStyle: FootprintStyle) => {
    const normalizedFootprintStyle = normalizeFootprintStyle(nextFootprintStyle)

    footprintStyleRef.current = normalizedFootprintStyle
    writeStoredFootprintStyle(normalizedFootprintStyle)
    setFootprintStyle(normalizedFootprintStyle)
    updateFootprintLayerPaint(normalizedFootprintStyle)
  }, [updateFootprintLayerPaint])

  const showWorldMap = useCallback(() => {
    const map = mapRef.current
    const currentCenter = map?.getCenter()

    if (resolvedProjection === 'globe') {
      startGlobeRotationAfterMove()
    } else {
      stopGlobeRotation()
    }

    map?.flyTo({
      center: currentCenter ? [currentCenter.lng, currentCenter.lat] : DEFAULT_MAP_CENTER,
      zoom: resolvedProjection === 'globe' ? GLOBE_WORLD_ZOOM : DEFAULT_MAP_ZOOM,
      bearing: 0,
      pitch: 0,
    })
  }, [resolvedProjection, startGlobeRotationAfterMove, stopGlobeRotation])

  const fitDisplayedFootprints = useCallback(() => {
    const bounds = selectedFootprintBoundsRef.current
    if (!bounds) return

    stopGlobeRotation()
    mapRef.current?.fitBounds(
      [bounds.southWest, bounds.northEast],
      {
        duration: MAP_FIT_BOUNDS_DURATION_MS,
        padding: MAP_FIT_BOUNDS_PADDING_PX,
      },
    )
  }, [stopGlobeRotation])

  const locate = useCallback(() => {
    if (!navigator.geolocation) return

    stopGlobeRotation()
    navigator.geolocation.getCurrentPosition((position) => {
      mapRef.current?.flyTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: 14,
      })
    })
  }, [stopGlobeRotation])

  const zoomIn = useCallback(() => {
    stopGlobeRotation()
    mapRef.current?.zoomIn()
  }, [stopGlobeRotation])

  const zoomOut = useCallback(() => {
    stopGlobeRotation()
    mapRef.current?.zoomOut()
  }, [stopGlobeRotation])

  return (
    <section
      className={`map-stage map-stage--${status}`}
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
        placeLabelsVisible={placeLabelsVisible}
        adminBoundariesVisible={adminBoundariesVisible}
        mapStyle={mapStyle}
        mapProjection={resolvedProjection}
        mapLanguage={mapLanguage}
        onPlaceLabelsVisibleChange={onPlaceLabelsVisibleChange}
        onAdminBoundariesVisibleChange={onAdminBoundariesVisibleChange}
        onMapStyleChange={onMapStyleChange}
        onMapProjectionChange={onMapProjectionChange}
        onMapLanguageChange={onMapLanguageChange}
      />
      {adminRegionUnlockEnabled ? (
        <div className="map-message map-message--compat" role="status">
          <h2>行政区划图层迁移中</h2>
          <p>当前 Mapbox 底座已切换到足迹 MVT 瓦片，行政区划图层会在后续独立迁移。</p>
        </div>
      ) : null}
        {debugPanelVisible ? (
          <FootprintDebugPanel
            debugMetrics={status === 'ready' ? tileDebugMetrics : null}
            cameraZoom={cameraZoom}
          />
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

function createFootprintTileDebugUrl(
  debugUrl: string,
  range: FootprintVectorTileRange,
  viewport: FootprintTileDebugViewport,
) {
  const params = new URLSearchParams()
  params.set('z', String(viewport.z))
  if (viewport.tiles) {
    params.set('tiles', viewport.tiles.join(','))
  } else {
    params.set('west', formatCoordinateParam(viewport.west))
    params.set('south', formatCoordinateParam(viewport.south))
    params.set('east', formatCoordinateParam(viewport.east))
    params.set('north', formatCoordinateParam(viewport.north))
  }

  if (range.range === 'all') {
    params.set('range', 'all')
  } else {
    params.set('start', range.start)
    params.set('end', range.end)
  }

  return `${debugUrl}?${params.toString()}`
}

function getCurrentFootprintTileDebugViewport(
  map: mapboxgl.Map,
  projection: MapboxProjection,
): FootprintTileDebugViewport {
  const bounds = map.getBounds()
  const z = Math.max(0, Math.min(MAX_FOOTPRINT_TILE_ZOOM, Math.floor(map.getZoom())))

  if (projection === 'globe' && z <= 1) {
    return {
      z,
      west: -180,
      south: -85,
      east: 180,
      north: 85,
      tiles: getGlobeWorldDebugTiles(map, z),
    }
  }

  return {
    z,
    west: bounds?.getWest() ?? -180,
    south: bounds?.getSouth() ?? -85,
    east: bounds?.getEast() ?? 180,
    north: bounds?.getNorth() ?? 85,
  }
}

function getGlobeWorldDebugTiles(map: mapboxgl.Map, z: number) {
  if (z === 0) return ['0/0']

  const center = map.getCenter()
  const z1Tiles = [
    { x: 0, y: 0, west: -180, south: 0, east: 0, north: MAX_MERCATOR_LATITUDE },
    { x: 1, y: 0, west: 0, south: 0, east: 180, north: MAX_MERCATOR_LATITUDE },
    { x: 0, y: 1, west: -180, south: -MAX_MERCATOR_LATITUDE, east: 0, north: 0 },
    { x: 1, y: 1, west: 0, south: -MAX_MERCATOR_LATITUDE, east: 180, north: 0 },
  ]

  return z1Tiles
    .filter((tile) => globeHemisphereIntersectsTile(center.lng, center.lat, tile))
    .map(({ x, y }) => `${x}/${y}`)
}

function globeHemisphereIntersectsTile(
  centerLongitude: number,
  centerLatitude: number,
  tile: { west: number, south: number, east: number, north: number },
) {
  const closestLongitude = closestLongitudeInRange(
    normalizeLongitude(centerLongitude),
    tile.west,
    tile.east,
  )
  const centerLatitudeRadians = degreesToRadians(
    Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, centerLatitude)),
  )
  const deltaLongitudeRadians = degreesToRadians(normalizeLongitude(closestLongitude - centerLongitude))
  const latitudeTerm = Math.sin(centerLatitudeRadians)
  const longitudeTerm = Math.cos(centerLatitudeRadians) * Math.cos(deltaLongitudeRadians)
  const bestLatitudeRadians = Math.max(
    degreesToRadians(tile.south),
    Math.min(degreesToRadians(tile.north), Math.atan2(latitudeTerm, longitudeTerm)),
  )
  const maxDotProduct = (
    latitudeTerm * Math.sin(bestLatitudeRadians) +
    longitudeTerm * Math.cos(bestLatitudeRadians)
  )

  return maxDotProduct > 1e-6
}

function closestLongitudeInRange(longitude: number, west: number, east: number) {
  if (longitude >= west && longitude <= east) return longitude

  return Math.abs(normalizeLongitude(longitude - west)) <= Math.abs(normalizeLongitude(longitude - east))
    ? west
    : east
}

function degreesToRadians(value: number) {
  return value * Math.PI / 180
}

function formatCoordinateParam(value: number) {
  if (Number.isInteger(value)) return String(value)

  return String(Number(value.toFixed(6)))
}

function normalizeLongitude(longitude: number) {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180

  return Number(normalized.toFixed(6))
}

function createMapboxTileUrl(tileUrl: string) {
  if (/^https?:\/\//i.test(tileUrl)) return tileUrl

  const normalizedTileUrl = tileUrl.startsWith('/') ? tileUrl : `/${tileUrl}`

  return `${window.location.origin}${normalizedTileUrl}`
}

function collectBaseMapVisibilityRecords(map: mapboxgl.Map): BaseMapVisibilityRecord[] {
  const styleLayers = map.getStyle().layers ?? []

  return styleLayers.flatMap((layer) => {
    const kind = getBaseMapVisibilityLayerKind(layer)

    if (!kind) return []

    return [{
      id: layer.id,
      kind,
      originalVisibility: layer.layout?.visibility === 'none' ? 'none' : 'visible',
    }]
  })
}

function getBaseMapVisibilityLayerKind(
  layer: LayerSpecification,
): BaseMapVisibilityLayerKind | null {
  if (isPlaceLabelLayer(layer)) return 'place-label'
  if (isAdministrativeBoundaryLayer(layer)) return 'admin-boundary'

  return null
}

function isPlaceLabelLayer(layer: LayerSpecification) {
  return layer.type === 'symbol' && hasLayoutProperty(layer, 'text-field')
}

function isAdministrativeBoundaryLayer(layer: LayerSpecification) {
  if (layer.type !== 'line') return false

  const id = layer.id.toLowerCase()
  const sourceLayer = getSourceLayer(layer).toLowerCase()

  return (
    id.includes('admin') ||
    id.includes('boundary') ||
    sourceLayer.includes('admin') ||
    sourceLayer.includes('boundary')
  )
}

function hasLayoutProperty(layer: LayerSpecification, propertyName: string) {
  return Boolean(
    layer.layout &&
    typeof layer.layout === 'object' &&
    propertyName in layer.layout
  )
}

function getSourceLayer(layer: LayerSpecification) {
  if ('source-layer' in layer && typeof layer['source-layer'] === 'string') {
    return layer['source-layer']
  }

  return ''
}

function setBaseMapConfigProperty(
  map: mapboxgl.Map,
  configName: BaseMapConfigPropertyName,
  value: unknown,
) {
  try {
    map.setConfigProperty('basemap', configName, value)
  } catch {
    // Custom non-Standard styles may not expose a configurable basemap import.
  }
}

function getBaseMapConfigProperty(
  map: mapboxgl.Map,
  configName: BaseMapConfigPropertyName,
) {
  try {
    return map.getConfigProperty('basemap', configName)
  } catch {
    return undefined
  }
}

function updateBaseMapConfigOverride(
  map: mapboxgl.Map,
  hiddenOverrides: Set<BaseMapConfigPropertyName>,
  originalValues: Map<BaseMapConfigPropertyName, unknown>,
  configName: BaseMapConfigPropertyName,
  visible: boolean,
) {
  if (!visible) {
    if (!hiddenOverrides.has(configName) && !originalValues.has(configName)) {
      originalValues.set(configName, getBaseMapConfigProperty(map, configName))
    }

    setBaseMapConfigProperty(map, configName, false)
    hiddenOverrides.add(configName)
    return
  }

  if (!hiddenOverrides.has(configName)) return

  setBaseMapConfigProperty(map, configName, originalValues.get(configName))
  hiddenOverrides.delete(configName)
}

function resolveConfigValue(
  explicitValue: string | undefined,
  envValue: string | undefined,
  fallback = '',
) {
  if (explicitValue !== undefined) return explicitValue.trim()

  return envValue?.trim() || fallback
}

function resolveMapboxProjection(
  explicitValue: MapboxProjection | undefined,
  envValue: string | undefined,
): MapboxProjection {
  const nextProjection = (explicitValue ?? envValue)?.trim().toLowerCase()

  return nextProjection === 'mercator' ? 'mercator' : DEFAULT_MAPBOX_PROJECTION
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

function FootprintDebugPanel({
  debugMetrics,
  cameraZoom,
}: {
  debugMetrics: FootprintTileDebugMetrics | null
  cameraZoom?: number
}) {
  return (
    <aside className="footprint-debug-panel" aria-label="足迹渲染调试">
      <div className="footprint-debug-panel__row">
        <span>相机/瓦片层级</span>
        <strong>
          {cameraZoom != null ? cameraZoom.toFixed(1) : '--'}
          {' / '}
          {debugMetrics ? formatDebugCount(debugMetrics.tileZoom) : '--'}
        </strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>瓦片</span>
        <strong>
          {debugMetrics
            ? [
                debugMetrics.requestedTileCount,
                debugMetrics.populatedTileCount,
                debugMetrics.dirtyTileCount,
              ].map(formatDebugCount).join(' / ')
            : '--'}
        </strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>实际点数</span>
        <strong>{debugMetrics ? formatDebugCount(debugMetrics.rawCount) : '--'}</strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>代表点数</span>
        <strong>{debugMetrics ? formatDebugCount(debugMetrics.representativeCount) : '--'}</strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>渲染率</span>
        <strong>{debugMetrics ? formatDebugRatio(debugMetrics.renderRatio) : '--'}</strong>
      </div>
    </aside>
  )
}

function formatDebugCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatDebugRatio(value: number) {
  return `${(value * 100).toFixed(1)}%`
}
