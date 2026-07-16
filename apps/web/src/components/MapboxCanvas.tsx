import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl, { type LayerSpecification } from 'mapbox-gl'

import {
  ADMIN_REGION_FILL_LAYER_ID,
  ADMIN_REGION_LINE_LAYER_ID,
  ADMIN_REGION_SELECTION_FILL_LAYER_ID,
  ADMIN_REGION_VECTOR_SOURCE_ID,
  createAdminRegionFillFilter,
  createAdminRegionFillLayer,
  createAdminRegionLineFilter,
  createAdminRegionLineLayer,
  createAdminRegionSelectionFillFilter,
  createAdminRegionSelectionFillLayer,
  createAdminRegionVectorTileSource,
  DEFAULT_ADMIN_REGION_FILL_OPACITY,
  DEFAULT_ADMIN_REGION_TILE_URL,
  MAX_ADMIN_REGION_TILE_ZOOM,
  normalizeAdminRegionFillOpacity,
  type AdminRegionDepth,
} from '../layers/adminRegionVectorTileSource'
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
import { measureMapFocusPadding } from '../config/mapFocusViewport'
import { DEFAULT_MAPBOX_STYLE_URL, type MapStylePreference } from '../mapStyleOptions'
import type {
  FootprintDistanceSeries,
  FootprintLngLatBounds,
  FootprintMetrics,
} from '../layers/footprintTypes'
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
  adminRegionActiveOnly?: boolean
  adminRegionVisibleIds?: string[] | null
  adminRegionLinesVisible?: boolean
  adminRegionFillOpacity?: number
  footprintStyleControlsVisible?: boolean
  footprintsVisible?: boolean
  selectedAdminRegion?: {
    regionId: string
    bounds: { west: number, south: number, east: number, north: number }
  } | null
  adminRegionDepth?: AdminRegionDepth
  debugPanelVisible?: boolean
  placeLabelsVisible?: boolean
  adminBoundariesVisible?: boolean
  mapStyle?: MapStylePreference
  mapLanguage?: MapboxLanguagePreference
  onPlaceLabelsVisibleChange?: (visible: boolean) => void
  onAdminBoundariesVisibleChange?: (visible: boolean) => void
  onAdminRegionLinesVisibleChange?: (visible: boolean) => void
  onAdminRegionFillOpacityChange?: (opacity: number) => void
  onMapStyleChange?: (style: MapStylePreference) => void
  onMapProjectionChange?: (projection: MapboxProjection) => void
  onMapLanguageChange?: (language: MapboxLanguagePreference) => void
}

export type { FootprintMetrics } from '../layers/footprintTypes'

type MapboxCanvasEnv = {
  VITE_MAPBOX_ACCESS_TOKEN?: string
  VITE_MAPBOX_STYLE_URL?: string
  VITE_MAPBOX_PROJECTION?: string
  VITE_FOOTPRINT_TILE_URL?: string
  VITE_FOOTPRINT_METRICS_URL?: string
  VITE_FOOTPRINT_TILE_DEBUG_URL?: string
  VITE_ADMIN_REGION_TILE_URL?: string
  VITE_ADMIN_REGION_ACTIVE_URL?: string
}

type MapboxProjection = 'globe' | 'mercator'
type MapboxLanguage = 'zh-Hans' | 'en'
type MapboxLanguagePreference = 'auto' | MapboxLanguage
type MapFocusBounds = [[number, number], [number, number]]
type LanguageConfigurableMap = mapboxgl.Map & {
  setLanguage?: (language?: MapboxLanguage) => mapboxgl.Map
}
type EnRouteMapboxOptions = ConstructorParameters<typeof mapboxgl.Map>[0] & {
  language?: MapboxLanguage
  worldview: 'CN'
}

declare global {
  interface Window {
    __ENROUTE_MAPBOX__?: mapboxgl.Map
  }
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

type AdminRegionTileDebugMetrics = {
  tileZoom: number
  visibleTileCount: number
  regionDepth: AdminRegionDepth
}

type FootprintTileDebugViewport = {
  z: number
  west: number
  south: number
  east: number
  north: number
  tiles?: string[]
}

type MapboxDebugTileCoordinate = {
  canonical?: {
    z?: number
    x?: number
    y?: number
  }
}

type MapboxFootprintSourceCache = {
  getVisibleCoordinates?: () => MapboxDebugTileCoordinate[]
}

type MapboxMapWithDebugSourceCache = mapboxgl.Map & {
  getStyleSourceCache?: (sourceId: string) => MapboxFootprintSourceCache | undefined
  style?: {
    getSourceCache?: (sourceId: string) => MapboxFootprintSourceCache | undefined
    _mergedSourceCaches?: Record<string, MapboxFootprintSourceCache | undefined>
    _sourceCaches?: Record<string, MapboxFootprintSourceCache | undefined>
  }
}

type AdminRegionFeatureLike = {
  properties?: {
    region_id?: unknown
  } | null
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
const DEFAULT_ADMIN_REGION_ACTIVE_URL = '/api/admin-regions/active'
const DEFAULT_ADMIN_REGION_FOCUS_ID = 'world'
const DEFAULT_ADMIN_REGION_DEPTH: AdminRegionDepth = 1
const DEFAULT_MAP_CENTER: [number, number] = [104.195397, 35.86166]
const DEFAULT_MAP_ZOOM = 2.2
const GLOBE_WORLD_ZOOM = 1.75
const FLAT_WORLD_CENTER: [number, number] = [60, 20]
const FLAT_WORLD_ZOOM = 1.5
const GLOBE_ROTATION_STEP_DEGREES = 1.2
const GLOBE_ROTATION_INTERVAL_MS = 1000
const MAP_FIT_BOUNDS_DURATION_MS = 900
const ADMIN_REGION_SELECTION_FIT_BOUNDS_DURATION_MS = 600
const MAP_STYLE_MUTATION_READY_RETRY_INTERVAL_MS = 80
const MAP_STYLE_MUTATION_READY_RETRY_LIMIT = 60
const FOOTPRINT_STYLE_STORAGE_KEY = 'enroute.footprintStyle'
const EMPTY_FOOTPRINT_METRICS: FootprintMetrics = {
  selectedCount: 0,
  totalDistanceMeters: 0,
  averageDistanceMetersPerDay: 0,
  distanceSeries: createEmptyDistanceSeries(),
}

function createEmptyDistanceSeries(): FootprintDistanceSeries {
  return {
    granularity: 'day',
    unit: 'day',
    buckets: [],
  }
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
  adminRegionActiveOnly = false,
  adminRegionVisibleIds,
  adminRegionLinesVisible = true,
  adminRegionFillOpacity = DEFAULT_ADMIN_REGION_FILL_OPACITY,
  footprintStyleControlsVisible = true,
  footprintsVisible = true,
  selectedAdminRegion = null,
  adminRegionDepth = DEFAULT_ADMIN_REGION_DEPTH,
  debugPanelVisible = false,
  placeLabelsVisible = true,
  adminBoundariesVisible = true,
  mapStyle,
  mapLanguage = 'auto',
  onPlaceLabelsVisibleChange,
  onAdminBoundariesVisibleChange,
  onAdminRegionLinesVisibleChange,
  onAdminRegionFillOpacityChange,
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
  const [adminRegionDebugMetrics, setAdminRegionDebugMetrics] = useState<AdminRegionTileDebugMetrics | null>(null)
  const [focusedAdminRegionId, setFocusedAdminRegionId] = useState(DEFAULT_ADMIN_REGION_FOCUS_ID)
  const [styleReady, setStyleReady] = useState(false)
  const [styleMutationReady, setStyleMutationReady] = useState(false)
  const [styleLoadRevision, setStyleLoadRevision] = useState(0)
  const footprintStyleRef = useRef(footprintStyle)
  const styleReadyRef = useRef(false)
  const styleMutationReadyRef = useRef(false)
  const languageRef = useRef(language)
  const appliedLanguageRef = useRef<MapboxLanguage | undefined>(undefined)
  const activeAdminRegionIdsRef = useRef<{
    depth: AdminRegionDepth
    regionIds: string[]
  } | null>(null)
  const adminRegionActiveOnlyRef = useRef(adminRegionActiveOnly)
  const adminRegionVisibleIdsRef = useRef(adminRegionVisibleIds)
  const adminRegionLinesVisibleRef = useRef(adminRegionLinesVisible)
  const adminRegionFillOpacityRef = useRef(
    normalizeAdminRegionFillOpacity(adminRegionFillOpacity),
  )
  const footprintsVisibleRef = useRef(footprintsVisible)
  const appliedLayerVisibilityRef = useRef({
    styleLoadRevision: -1,
    adminRegionLinesVisible: true,
    footprintsVisible: true,
  })
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
  const initialGlobeRotationStartedRef = useRef(false)

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
  const resolvedAdminRegionTileUrl = resolveConfigValue(
    undefined,
    (import.meta.env as MapboxCanvasEnv).VITE_ADMIN_REGION_TILE_URL,
    DEFAULT_ADMIN_REGION_TILE_URL,
  )
  const resolvedAdminRegionActiveUrl = resolveConfigValue(
    undefined,
    (import.meta.env as MapboxCanvasEnv).VITE_ADMIN_REGION_ACTIVE_URL,
    DEFAULT_ADMIN_REGION_ACTIVE_URL,
  )
  const footprintTileRange = useMemo(
    () => createFootprintTileRange(timeRange),
    [timeRange],
  )

  useEffect(() => {
    adminRegionActiveOnlyRef.current = adminRegionActiveOnly
    adminRegionVisibleIdsRef.current = adminRegionVisibleIds
  }, [adminRegionActiveOnly, adminRegionVisibleIds])

  useEffect(() => {
    footprintsVisibleRef.current = footprintsVisible
  }, [footprintsVisible])

  useEffect(() => {
    adminRegionLinesVisibleRef.current = adminRegionLinesVisible
  }, [adminRegionLinesVisible])

  useEffect(() => {
    const nextOpacity = normalizeAdminRegionFillOpacity(adminRegionFillOpacity)
    adminRegionFillOpacityRef.current = nextOpacity

    const map = mapRef.current
    if (
      status !== 'ready' ||
      !styleMutationReady ||
      !map?.getLayer(ADMIN_REGION_FILL_LAYER_ID)
    ) {
      return
    }

    map.setPaintProperty(ADMIN_REGION_FILL_LAYER_ID, 'fill-opacity', nextOpacity)
  }, [adminRegionFillOpacity, status, styleMutationReady])

  useEffect(() => {
    latestResolvedStyleUrlRef.current = resolvedStyleUrl
  }, [resolvedStyleUrl])

  useEffect(() => {
    languageRef.current = language
  }, [language])

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
    map.addLayer({
      ...createFootprintCircleLayer(footprintStyleRef.current),
      layout: {
        visibility: footprintsVisibleRef.current ? 'visible' : 'none',
      },
    })
  }, [])

  const updateFootprintLayerPaint = useCallback((nextFootprintStyle: FootprintStyle) => {
    const map = mapRef.current

    if (!map?.getLayer(FOOTPRINT_CIRCLE_LAYER_ID)) return

    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-radius', nextFootprintStyle.pixelSize / 2)
    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-color', nextFootprintStyle.color)
    map.setPaintProperty(FOOTPRINT_CIRCLE_LAYER_ID, 'circle-opacity', nextFootprintStyle.opacity)
  }, [])

  const removeAdminRegionLayers = useCallback(() => {
    const map = mapRef.current

    if (!map) return

    if (map.getLayer(ADMIN_REGION_SELECTION_FILL_LAYER_ID)) {
      map.removeLayer(ADMIN_REGION_SELECTION_FILL_LAYER_ID)
    }
    if (map.getLayer(ADMIN_REGION_LINE_LAYER_ID)) {
      map.removeLayer(ADMIN_REGION_LINE_LAYER_ID)
    }
    if (map.getLayer(ADMIN_REGION_FILL_LAYER_ID)) {
      map.removeLayer(ADMIN_REGION_FILL_LAYER_ID)
    }
    if (map.getSource(ADMIN_REGION_VECTOR_SOURCE_ID)) {
      map.removeSource(ADMIN_REGION_VECTOR_SOURCE_ID)
    }
  }, [])

  const refreshAdminRegionLayers = useCallback((
    currentTileUrl: string,
    depth: AdminRegionDepth,
    focusRegionId: string,
    regionIds: string[] | null,
  ) => {
    const map = mapRef.current

    if (!map) return

    removeAdminRegionLayers()
    map.addSource(
      ADMIN_REGION_VECTOR_SOURCE_ID,
      createAdminRegionVectorTileSource({
        tileUrl: createMapboxTileUrl(currentTileUrl),
        focusRegionId,
        depth,
      }),
    )
    const activeRegionIds = regionIds ?? undefined
    map.addLayer(createAdminRegionFillLayer(
      activeRegionIds,
      adminRegionFillOpacityRef.current,
    ))
    map.addLayer({
      ...createAdminRegionLineLayer(activeRegionIds),
      layout: {
        visibility: adminRegionLinesVisibleRef.current ? 'visible' : 'none',
      },
    })
    map.addLayer(createAdminRegionSelectionFillLayer())
  }, [removeAdminRegionLayers])

  const resolveAdminRegionVisibleIds = useCallback((depth: AdminRegionDepth): string[] | null => {
    const externalRegionIds = adminRegionVisibleIdsRef.current

    if (externalRegionIds !== undefined) return externalRegionIds
    if (!adminRegionActiveOnlyRef.current) return null

    const activeRegionIds = activeAdminRegionIdsRef.current
    return activeRegionIds?.depth === depth ? activeRegionIds.regionIds : []
  }, [])

  const applyAdminRegionLayerFilters = useCallback((regionIds: string[] | null) => {
    const map = mapRef.current

    if (!map) return

    const activeRegionIds = regionIds ?? undefined
    if (map.getLayer(ADMIN_REGION_FILL_LAYER_ID)) {
      map.setFilter(ADMIN_REGION_FILL_LAYER_ID, createAdminRegionFillFilter(activeRegionIds))
    }
    if (map.getLayer(ADMIN_REGION_LINE_LAYER_ID)) {
      map.setFilter(ADMIN_REGION_LINE_LAYER_ID, createAdminRegionLineFilter(activeRegionIds))
    }
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

  const fitBoundsInVisibleViewport = useCallback((
    bounds: MapFocusBounds,
    duration: number,
  ) => {
    const map = mapRef.current
    const mapNode = mapNodeRef.current
    if (!map || !mapNode) return

    map.fitBounds(bounds, {
      padding: measureMapFocusPadding(mapNode),
      duration,
    })
  }, [])

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
    styleReadyRef.current = false
    styleMutationReadyRef.current = false
    initialGlobeRotationStartedRef.current = false
    setStyleReady(false)
    setStyleMutationReady(false)
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
        minZoom: 0,
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
      if (languageRef.current) {
        mapOptions.language = languageRef.current
      }
      appliedLanguageRef.current = languageRef.current

      const map = new mapboxgl.Map(mapOptions)
      mapRef.current = map
      if (import.meta.env.DEV) {
        window.__ENROUTE_MAPBOX__ = map
      }

      const retryStyleMutationReady = (attempt = 0) => {
        if (disposed || styleMutationReadyRef.current) return
        if (map.isStyleLoaded()) {
          styleMutationReadyRef.current = true
          setStyleMutationReady(true)
          setStyleLoadRevision((revision) => revision + 1)
          return
        }
        if (attempt >= MAP_STYLE_MUTATION_READY_RETRY_LIMIT) return

        window.setTimeout(() => retryStyleMutationReady(attempt + 1), MAP_STYLE_MUTATION_READY_RETRY_INTERVAL_MS)
      }

      const syncStyleReady = (eventStyleReady = false) => {
        const canMutateStyle = map.isStyleLoaded()
        if (!eventStyleReady && !canMutateStyle && !styleReadyRef.current) {
          styleReadyRef.current = false
          styleMutationReadyRef.current = false
          setStyleReady(false)
          setStyleMutationReady(false)
          return false
        }

        const hasFootprintLayer = Boolean(
          map.getSource(FOOTPRINT_VECTOR_SOURCE_ID) &&
          map.getLayer(FOOTPRINT_CIRCLE_LAYER_ID),
        )

        const wasStyleReady = styleReadyRef.current

        if (!wasStyleReady || !hasFootprintLayer) {
          setStyleLoadRevision((revision) => revision + 1)
        }

        styleReadyRef.current = true
        setStyleReady(true)
        if (canMutateStyle) {
          styleMutationReadyRef.current = true
          setStyleMutationReady(true)
        } else if (eventStyleReady) {
          retryStyleMutationReady()
        }
        setStatus('ready')
        if (!wasStyleReady && resolvedProjection === 'globe') {
          if (!initialGlobeRotationStartedRef.current) {
            initialGlobeRotationStartedRef.current = true
            startGlobeRotation()
          } else if (globeRotationRequestedRef.current) {
            startGlobeRotation()
          }
        }
        return true
      }

      const handleLoad = () => {
        if (disposed) return

        syncStyleReady()
      }
      const handleStyleLoad = () => {
        if (disposed) return

        syncStyleReady(true)
      }
      const handleStyleImportLoad = () => {
        if (disposed) return

        syncStyleReady(true)
      }
      const handleIdle = () => {
        if (disposed) return

        syncStyleReady()
      }
      const handleError = (event: ErrorEvent | { error?: unknown }) => {
        if (disposed) return

        if (isNonFatalMapboxSourceError(event)) {
          console.warn(event)
          return
        }

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
      map.on('style.import.load', handleStyleImportLoad)
      map.on('idle', handleIdle)
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
        map.off('style.import.load', handleStyleImportLoad)
        map.off('idle', handleIdle)
        map.off('error', handleError)
        map.off('zoomstart', handleZoomStart)
        map.off('dragstart', handleDragStart)
        map.off('dragend', handleDragEnd)
        map.remove()
        mapRef.current = null
        if (import.meta.env.DEV) {
          delete window.__ENROUTE_MAPBOX__
        }
        styleReadyRef.current = false
        styleMutationReadyRef.current = false
      }
    } catch (error: unknown) {
      reportInitializationError(error)
    }
  }, [
    clearGlobeRotationTimer,
    resolvedAccessToken,
    resolvedProjection,
    resetBaseMapVisibilityState,
    startGlobeRotation,
    stopGlobeRotation,
  ])

  useEffect(() => {
    const map = mapRef.current as LanguageConfigurableMap | null

    if (!map || status !== 'ready') return
    if (appliedLanguageRef.current === language) return

    map.setLanguage?.(language)
    appliedLanguageRef.current = language
  }, [language, status])

  useEffect(() => {
    const map = mapRef.current

    if (!map || status !== 'ready') return
    if (resolvedStyleUrlRef.current === resolvedStyleUrl) return

    resolvedStyleUrlRef.current = resolvedStyleUrl
    setStatus('loading')
    styleReadyRef.current = false
    styleMutationReadyRef.current = false
    setStyleReady(false)
    setStyleMutationReady(false)
    resetBaseMapVisibilityState()
    map.setStyle(resolvedStyleUrl)
  }, [resetBaseMapVisibilityState, resolvedStyleUrl, status])

  useEffect(() => {
    if (status !== 'ready' || !styleMutationReady) return

    refreshFootprintLayer(footprintTileRange, resolvedTileUrl)
  }, [
    footprintTileRange,
    refreshFootprintLayer,
    resolvedTileUrl,
    status,
    styleLoadRevision,
    styleMutationReady,
  ])

  useEffect(() => {
    if (status !== 'ready' || !styleMutationReady) return

    if (!adminRegionUnlockEnabled) {
      removeAdminRegionLayers()
      return
    }

    refreshAdminRegionLayers(
      resolvedAdminRegionTileUrl,
      adminRegionDepth,
      focusedAdminRegionId,
      resolveAdminRegionVisibleIds(adminRegionDepth),
    )
  }, [
    adminRegionDepth,
    adminRegionUnlockEnabled,
    focusedAdminRegionId,
    refreshAdminRegionLayers,
    removeAdminRegionLayers,
    resolveAdminRegionVisibleIds,
    resolvedAdminRegionTileUrl,
    status,
    styleLoadRevision,
    styleMutationReady,
  ])

  useEffect(() => {
    if (
      status !== 'ready' ||
      !styleMutationReady ||
      !adminRegionUnlockEnabled ||
      !adminRegionActiveOnly ||
      adminRegionVisibleIds !== undefined
    ) {
      activeAdminRegionIdsRef.current = null
      return
    }

    const abortController = new AbortController()
    activeAdminRegionIdsRef.current = { depth: adminRegionDepth, regionIds: [] }
    applyAdminRegionLayerFilters([])

    fetch(createAdminRegionActiveUrl(
      resolvedAdminRegionActiveUrl,
      footprintTileRange,
      adminRegionDepth,
    ), {
      method: 'GET',
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Active admin-region request failed: ${response.status}`)
        }

        return response.json() as Promise<unknown>
      })
      .then((payload) => {
        if (!abortController.signal.aborted) {
          const regionIds = readActiveAdminRegionIds(payload)

          activeAdminRegionIdsRef.current = { depth: adminRegionDepth, regionIds }
          applyAdminRegionLayerFilters(regionIds)
        }
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          activeAdminRegionIdsRef.current = { depth: adminRegionDepth, regionIds: [] }
          applyAdminRegionLayerFilters([])
        }
      })

    return () => {
      abortController.abort()
    }
  }, [
    adminRegionActiveOnly,
    adminRegionDepth,
    adminRegionUnlockEnabled,
    adminRegionVisibleIds,
    applyAdminRegionLayerFilters,
    footprintTileRange,
    resolvedAdminRegionActiveUrl,
    status,
    styleMutationReady,
  ])

  useEffect(() => {
    if (status !== 'ready' || !styleMutationReady || !adminRegionUnlockEnabled) return

    applyAdminRegionLayerFilters(resolveAdminRegionVisibleIds(adminRegionDepth))
  }, [
    adminRegionActiveOnly,
    adminRegionDepth,
    adminRegionUnlockEnabled,
    adminRegionVisibleIds,
    applyAdminRegionLayerFilters,
    resolveAdminRegionVisibleIds,
    status,
    styleLoadRevision,
    styleMutationReady,
  ])

  useEffect(() => {
    const map = mapRef.current

    if (status !== 'ready' || !styleMutationReady || !map) return

    const applied = appliedLayerVisibilityRef.current
    const isStyleReload = applied.styleLoadRevision !== styleLoadRevision

    if (
      map.getLayer(FOOTPRINT_CIRCLE_LAYER_ID) &&
      (footprintsVisible !== applied.footprintsVisible || (isStyleReload && !footprintsVisible))
    ) {
      map.setLayoutProperty(
        FOOTPRINT_CIRCLE_LAYER_ID,
        'visibility',
        footprintsVisible ? 'visible' : 'none',
      )
    }
    if (
      map.getLayer(ADMIN_REGION_LINE_LAYER_ID) &&
      (adminRegionLinesVisible !== applied.adminRegionLinesVisible || (isStyleReload && !adminRegionLinesVisible))
    ) {
      map.setLayoutProperty(
        ADMIN_REGION_LINE_LAYER_ID,
        'visibility',
        adminRegionLinesVisible ? 'visible' : 'none',
      )
    }
    appliedLayerVisibilityRef.current = {
      styleLoadRevision,
      adminRegionLinesVisible,
      footprintsVisible,
    }
  }, [
    adminRegionLinesVisible,
    footprintsVisible,
    status,
    styleLoadRevision,
    styleMutationReady,
  ])

  useEffect(() => {
    const map = mapRef.current

    if (status !== 'ready' || !styleMutationReady || !map) return

    if (map.getLayer(ADMIN_REGION_SELECTION_FILL_LAYER_ID)) {
      map.setFilter(
        ADMIN_REGION_SELECTION_FILL_LAYER_ID,
        createAdminRegionSelectionFillFilter(selectedAdminRegion?.regionId),
      )
    }
    if (selectedAdminRegion) {
      const { west, south, east, north } = selectedAdminRegion.bounds
      fitBoundsInVisibleViewport(
        [[west, south], [east, north]],
        ADMIN_REGION_SELECTION_FIT_BOUNDS_DURATION_MS,
      )
    }
  }, [
    fitBoundsInVisibleViewport,
    selectedAdminRegion,
    status,
    styleLoadRevision,
    styleMutationReady,
  ])

  useEffect(() => {
    const map = mapRef.current

    if (status !== 'ready' || !styleMutationReady || !adminRegionUnlockEnabled || !map) return

    const handleAdminRegionClick = (event: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [ADMIN_REGION_FILL_LAYER_ID, ADMIN_REGION_LINE_LAYER_ID],
      }) as AdminRegionFeatureLike[]
      const regionId = features.find((feature) => feature.properties?.region_id)?.properties?.region_id

      if (typeof regionId !== 'string' || !regionId) return

      setFocusedAdminRegionId(DEFAULT_ADMIN_REGION_FOCUS_ID)
    }

    map.on('click', ADMIN_REGION_FILL_LAYER_ID, handleAdminRegionClick)
    map.on('click', ADMIN_REGION_LINE_LAYER_ID, handleAdminRegionClick)

    return () => {
      map.off('click', ADMIN_REGION_FILL_LAYER_ID, handleAdminRegionClick)
      map.off('click', ADMIN_REGION_LINE_LAYER_ID, handleAdminRegionClick)
    }
  }, [
    adminRegionUnlockEnabled,
    status,
    styleLoadRevision,
    styleMutationReady,
  ])

  useEffect(() => {
    if (status !== 'ready' || !styleReady) return

    updateBaseMapLayerVisibility()
  }, [
    adminBoundariesVisible,
    placeLabelsVisible,
    styleLoadRevision,
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

    if (adminRegionUnlockEnabled) {
      setTileDebugMetrics(null)

      const refreshAdminRegionDebugMetrics = () => {
        setCameraZoom(map.getZoom())
        setAdminRegionDebugMetrics(getCurrentAdminRegionTileDebugMetrics(map, adminRegionDepth))
      }

      refreshAdminRegionDebugMetrics()

      map.on('moveend', refreshAdminRegionDebugMetrics)
      map.on('zoomend', refreshAdminRegionDebugMetrics)
      map.on('zoom', refreshAdminRegionDebugMetrics)

      return () => {
        map.off('moveend', refreshAdminRegionDebugMetrics)
        map.off('zoomend', refreshAdminRegionDebugMetrics)
        map.off('zoom', refreshAdminRegionDebugMetrics)
      }
    }

    setAdminRegionDebugMetrics(null)

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
  }, [
    adminRegionDepth,
    adminRegionUnlockEnabled,
    debugPanelVisible,
    footprintTileRange,
    resolvedProjection,
    resolvedTileDebugUrl,
    status,
  ])

  const updateFootprintStyle = useCallback((nextFootprintStyle: FootprintStyle) => {
    const normalizedFootprintStyle = normalizeFootprintStyle(nextFootprintStyle)

    footprintStyleRef.current = normalizedFootprintStyle
    writeStoredFootprintStyle(normalizedFootprintStyle)
    setFootprintStyle(normalizedFootprintStyle)
    updateFootprintLayerPaint(normalizedFootprintStyle)
  }, [updateFootprintLayerPaint])

  const showWorldMap = useCallback(() => {
    const map = mapRef.current

    if (resolvedProjection === 'globe') {
      const currentCenter = map?.getCenter()
      startGlobeRotationAfterMove()

      map?.flyTo({
        center: currentCenter ? [currentCenter.lng, currentCenter.lat] : DEFAULT_MAP_CENTER,
        zoom: GLOBE_WORLD_ZOOM,
        bearing: 0,
        pitch: 0,
      })
      return
    }

    stopGlobeRotation()
    map?.flyTo({
      center: FLAT_WORLD_CENTER,
      zoom: FLAT_WORLD_ZOOM,
      bearing: 0,
      pitch: 0,
    })
  }, [resolvedProjection, startGlobeRotationAfterMove, stopGlobeRotation])

  const fitDisplayedFootprints = useCallback(() => {
    const bounds = selectedFootprintBoundsRef.current
    if (!bounds) return

    stopGlobeRotation()
    fitBoundsInVisibleViewport(
      [bounds.southWest, bounds.northEast],
      MAP_FIT_BOUNDS_DURATION_MS,
    )
  }, [fitBoundsInVisibleViewport, stopGlobeRotation])

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
        adminRegionLinesVisible={adminRegionLinesVisible}
        adminRegionControlsVisible={adminRegionUnlockEnabled}
        adminRegionFillOpacity={adminRegionFillOpacity}
        footprintStyleControlsVisible={footprintStyleControlsVisible}
        mapStyle={mapStyle}
        mapProjection={resolvedProjection}
        mapLanguage={mapLanguage}
        onPlaceLabelsVisibleChange={onPlaceLabelsVisibleChange}
        onAdminBoundariesVisibleChange={onAdminBoundariesVisibleChange}
        onAdminRegionLinesVisibleChange={onAdminRegionLinesVisibleChange}
        onAdminRegionFillOpacityChange={onAdminRegionFillOpacityChange}
        onMapStyleChange={onMapStyleChange}
        onMapProjectionChange={onMapProjectionChange}
        onMapLanguageChange={onMapLanguageChange}
      />
        {debugPanelVisible && adminRegionUnlockEnabled ? (
          <AdminRegionDebugPanel
            debugMetrics={status === 'ready' ? adminRegionDebugMetrics : null}
            cameraZoom={cameraZoom}
          />
        ) : null}
        {debugPanelVisible && !adminRegionUnlockEnabled ? (
          <FootprintDebugPanel
            debugMetrics={status === 'ready' ? tileDebugMetrics : null}
            cameraZoom={cameraZoom}
          />
        ) : null}
      {status === 'missing-token' ? (
        <div className="glass-panel glass-panel--solid glass-panel--compact map-message" role="status">
          <h2>需要配置 Mapbox 访问令牌</h2>
          <p>在 `.env.local` 中配置 Mapbox 令牌后，位置页会加载 MVT 足迹瓦片。</p>
          <pre>VITE_MAPBOX_ACCESS_TOKEN</pre>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="glass-panel glass-panel--solid glass-panel--compact map-message" role="alert">
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

function createAdminRegionActiveUrl(
  activeUrl: string,
  range: FootprintVectorTileRange,
  depth: AdminRegionDepth,
) {
  const params = new URLSearchParams()
  params.set('depth', String(depth))

  if (range.range === 'all') {
    params.set('range', 'all')
  } else {
    params.set('start', range.start)
    params.set('end', range.end)
  }

  return `${activeUrl}?${params.toString()}`
}

function readActiveAdminRegionIds(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('regionIds' in payload)) return []

  const regionIds = (payload as { regionIds?: unknown }).regionIds
  if (!Array.isArray(regionIds)) return []

  return [...new Set(regionIds.filter((regionId): regionId is string => (
    typeof regionId === 'string' && regionId.trim().length > 0
  )))]
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
  const visibleTileTarget = getVisibleFootprintTileDebugTarget(map)
  const z = visibleTileTarget?.z
    ?? Math.max(0, Math.min(MAX_FOOTPRINT_TILE_ZOOM, Math.floor(map.getZoom())))

  if (projection === 'globe' && z < 2) {
    return {
      z,
      west: -180,
      south: -85,
      east: 180,
      north: 85,
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

function getVisibleFootprintTileDebugTarget(map: mapboxgl.Map) {
  const sourceCache = getMapboxSourceCache(map, FOOTPRINT_VECTOR_SOURCE_ID)
  const visibleCoordinates = sourceCache?.getVisibleCoordinates?.() ?? []
  const tileKeysByZoom = new Map<number, Set<string>>()

  for (const coordinate of visibleCoordinates) {
    const z = coordinate.canonical?.z
    const x = coordinate.canonical?.x
    const y = coordinate.canonical?.y

    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z == null ||
      x == null ||
      y == null ||
      z < 0 ||
      x < 0 ||
      y < 0
    ) {
      continue
    }

    if (!tileKeysByZoom.has(z)) {
      tileKeysByZoom.set(z, new Set())
    }
    tileKeysByZoom.get(z)?.add(`${x}/${y}`)
  }

  const z = Array.from(tileKeysByZoom.keys()).sort((a, b) => b - a)[0]
  if (z == null) return undefined

  return {
    z: Math.min(z, MAX_FOOTPRINT_TILE_ZOOM),
    tiles: Array.from(tileKeysByZoom.get(z) ?? []).sort(compareTileKeys),
  }
}

function getCurrentAdminRegionTileDebugMetrics(
  map: mapboxgl.Map,
  regionDepth: AdminRegionDepth,
): AdminRegionTileDebugMetrics {
  const visibleTileTarget = getVisibleAdminRegionTileDebugTarget(map)

  return {
    tileZoom: visibleTileTarget?.z
      ?? Math.max(0, Math.min(MAX_ADMIN_REGION_TILE_ZOOM, Math.floor(map.getZoom()))),
    visibleTileCount: visibleTileTarget?.tiles.length ?? 0,
    regionDepth,
  }
}

function getVisibleAdminRegionTileDebugTarget(map: mapboxgl.Map) {
  const sourceCache = getMapboxSourceCache(map, ADMIN_REGION_VECTOR_SOURCE_ID)
  const visibleCoordinates = sourceCache?.getVisibleCoordinates?.() ?? []
  const tileKeysByZoom = new Map<number, Set<string>>()

  for (const coordinate of visibleCoordinates) {
    const z = coordinate.canonical?.z
    const x = coordinate.canonical?.x
    const y = coordinate.canonical?.y

    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z == null ||
      x == null ||
      y == null ||
      z < 0 ||
      x < 0 ||
      y < 0
    ) {
      continue
    }

    const clampedZ = Math.min(z, MAX_ADMIN_REGION_TILE_ZOOM)
    if (!tileKeysByZoom.has(clampedZ)) {
      tileKeysByZoom.set(clampedZ, new Set())
    }
    tileKeysByZoom.get(clampedZ)?.add(`${x}/${y}`)
  }

  const z = Array.from(tileKeysByZoom.keys()).sort((a, b) => b - a)[0]
  if (z == null) return undefined

  return {
    z,
    tiles: Array.from(tileKeysByZoom.get(z) ?? []).sort(compareTileKeys),
  }
}

function getMapboxSourceCache(
  map: mapboxgl.Map,
  sourceId: string,
): MapboxFootprintSourceCache | undefined {
  const debugMap = map as MapboxMapWithDebugSourceCache

  return (
    debugMap.getStyleSourceCache?.(sourceId) ??
    debugMap.style?.getSourceCache?.(sourceId) ??
    debugMap.style?._mergedSourceCaches?.[sourceId] ??
    debugMap.style?._sourceCaches?.[sourceId]
  )
}

function compareTileKeys(left: string, right: string) {
  const [leftX = 0, leftY = 0] = left.split('/').map(Number)
  const [rightX = 0, rightY = 0] = right.split('/').map(Number)

  return leftX - rightX || leftY - rightY
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

function isNonFatalMapboxSourceError(event: ErrorEvent | { error?: unknown }) {
  if (!('sourceId' in event)) return false

  return event.sourceId === FOOTPRINT_VECTOR_SOURCE_ID || event.sourceId === ADMIN_REGION_VECTOR_SOURCE_ID
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
  if (layer.source === ADMIN_REGION_VECTOR_SOURCE_ID) return false

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
    <aside className="glass-panel glass-panel--solid glass-panel--compact footprint-debug-panel" aria-label="足迹渲染调试">
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

function AdminRegionDebugPanel({
  debugMetrics,
  cameraZoom,
}: {
  debugMetrics: AdminRegionTileDebugMetrics | null
  cameraZoom?: number
}) {
  return (
    <aside className="glass-panel glass-panel--solid glass-panel--compact footprint-debug-panel" aria-label="足迹渲染调试">
      <div className="footprint-debug-panel__row">
        <span>相机/瓦片层级</span>
        <strong>
          {cameraZoom != null ? cameraZoom.toFixed(1) : '--'}
          {' / '}
          {debugMetrics ? formatDebugCount(debugMetrics.tileZoom) : '--'}
        </strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>区域级别</span>
        <strong>{debugMetrics ? formatDebugCount(debugMetrics.regionDepth) : '--'}</strong>
      </div>
      <div className="footprint-debug-panel__row">
        <span>可见瓦片</span>
        <strong>{debugMetrics ? formatDebugCount(debugMetrics.visibleTileCount) : '--'}</strong>
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
