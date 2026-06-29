import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'

import type { AmapConfig } from '../config/amap'
import {
  createDistrictBoundaryGeoJson,
  extractDistrictBoundaryPaths,
  type AmapBoundaryPath,
  type DistrictBoundaryFeatureCollection,
} from '../layers/amapDistrictBoundary'
import type { AdminRegionGeometry, AdminRegionLevel } from '../layers/adminRegionTypes'
import { transformGcj02ToWgs84Coordinate } from '../layers/footprintCoordinates'
import { DEFAULT_MAPBOX_STYLE_URL } from '../mapStyleOptions'
import { loadAmap, type AMapNamespace } from '../services/amapLoader'

type PreviewSource = 'amap' | 'local' | 'osm'
type PreviewCoordinateSystem = 'gcj02' | 'wgs84'
type PreviewStatus = 'missing-config' | 'missing-token' | 'loading' | 'ready' | 'unavailable' | 'error'

type SourceOption = {
  id: PreviewSource
  label: string
  color: string
}

type LevelOption = {
  level: AdminRegionLevel
  label: string
}

type PreviewRegion = {
  id: string
  name: string
  level: AdminRegionLevel
  geometry: AdminRegionGeometry
}

type AvailablePreviewApiResponse = {
  source: PreviewSource
  level: AdminRegionLevel
  available: true
  coordinateSystem: PreviewCoordinateSystem
  reason: null
  regions: PreviewRegion[]
}

type UnavailablePreviewApiResponse = {
  source: PreviewSource
  level: AdminRegionLevel
  available: false
  coordinateSystem: null
  reason: string | null
  regions: []
}

type PreviewApiResponse = AvailablePreviewApiResponse | UnavailablePreviewApiResponse

type BoundaryOverlayResult = {
  source: PreviewSource
  sourceLabel: string
  sourceCoordinateSystem: PreviewCoordinateSystem
  renderCoordinateSystem: PreviewCoordinateSystem
  level: AdminRegionLevel
  regions: Array<{ id: string; name: string }>
  summary: {
    regionCount: number
    ringCount: number
    pointCount: number
  }
}

type PreviewFeature = DistrictBoundaryFeatureCollection['features'][number] & {
  properties: DistrictBoundaryFeatureCollection['features'][number]['properties'] & {
    source?: PreviewSource
  }
}

type PreviewFeatureCollection = {
  type: 'FeatureCollection'
  features: PreviewFeature[]
}

type AmapDistrictNode = AMap.DistrictSearchDistrict & {
  districtList?: AmapDistrictNode[]
}

type PreviewSelection = {
  source: PreviewSource
  level: AdminRegionLevel
}

const MAPBOX_BOUNDARY_SOURCE_ID = 'amap-boundary-preview'
const MAPBOX_BOUNDARY_FILL_LAYER_ID = 'amap-boundary-preview-fill'
const MAPBOX_BOUNDARY_LINE_LAYER_ID = 'amap-boundary-preview-line'
const DEFAULT_CENTER: [number, number] = [121.5, 31.2]
const EMPTY_FEATURE_COLLECTION: PreviewFeatureCollection = { type: 'FeatureCollection', features: [] }
const SHANGHAI_DISTRICT_ADCODES = [
  '310101',
  '310104',
  '310105',
  '310106',
  '310107',
  '310109',
  '310110',
  '310112',
  '310113',
  '310114',
  '310115',
  '310116',
  '310117',
  '310118',
  '310120',
  '310151',
]
const SOURCE_OPTIONS: SourceOption[] = [
  { id: 'amap', label: '高德', color: '#0057d9' },
  { id: 'local', label: '本地', color: '#0b7f55' },
  { id: 'osm', label: 'OSM', color: '#bd6a00' },
]
const LEVEL_OPTIONS: LevelOption[] = [
  { level: 2, label: '2 省级' },
  { level: 3, label: '3 市级' },
  { level: 4, label: '4 区县' },
  { level: 5, label: '5 街镇' },
]
const DEFAULT_SOURCE: PreviewSource = 'amap'
const DEFAULT_LEVEL: AdminRegionLevel = 4
const DEFAULT_SELECTION: PreviewSelection = {
  source: DEFAULT_SOURCE,
  level: DEFAULT_LEVEL,
}

export function MapboxAmapBoundaryPreview({
  amapConfig,
  mapboxAccessToken,
  styleUrl = DEFAULT_MAPBOX_STYLE_URL,
}: {
  amapConfig: Pick<AmapConfig, 'key' | 'securityJsCode' | 'isConfigured' | 'missingKeys'>
  mapboxAccessToken?: string
  styleUrl?: string
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const amapRef = useRef<AMapNamespace | null>(null)
  const mapReadyRef = useRef(false)
  const requestIdRef = useRef(0)
  const selectionRef = useRef<PreviewSelection>(DEFAULT_SELECTION)
  const [selection, setSelection] = useState<PreviewSelection>(DEFAULT_SELECTION)
  const [runtimeStatus, setRuntimeStatus] = useState<Exclude<PreviewStatus, 'missing-config' | 'missing-token'>>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<BoundaryOverlayResult | null>(null)
  const resolvedMapboxToken = resolveMapboxToken(mapboxAccessToken)
  const { source, level } = selection
  const status: PreviewStatus = !resolvedMapboxToken
      ? 'missing-token'
      : source === 'amap' && !amapConfig.isConfigured
        ? 'missing-config'
        : runtimeStatus

  const clearOverlay = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    upsertBoundaryOverlay(map, EMPTY_FEATURE_COLLECTION, getSourceColor(selectionRef.current.source))
  }, [])

  const applyFeatureCollection = useCallback((
    geoJson: PreviewFeatureCollection,
    nextResult: BoundaryOverlayResult,
  ) => {
    const map = mapRef.current
    if (!map) return

    upsertBoundaryOverlay(map, geoJson, getSourceColor(nextResult.source))
    const bounds = calculateGeoJsonBounds(geoJson)
    if (bounds) {
      map.fitBounds(bounds, {
        padding: 96,
        duration: 700,
      })
    }
    setResult(nextResult)
    setRuntimeStatus('ready')
  }, [])

  const showUnavailable = useCallback((message: string) => {
    requestIdRef.current += 1
    setResult(null)
    setRuntimeStatus('unavailable')
    setErrorMessage(message)
    clearOverlay()
  }, [clearOverlay])

  const queryAmapPreview = useCallback(async (
    nextLevel: AdminRegionLevel,
    requestId: number,
  ) => {
    const AMap = amapRef.current
    if (!AMap) return

    if (nextLevel === 5) {
      if (requestId !== requestIdRef.current) return
      showUnavailable('高德 DistrictSearch 不提供街道级边界。')
      return
    }

    const districts = await loadAmapShanghaiDistricts(AMap, nextLevel)
    if (requestId !== requestIdRef.current) return

    const geoJson = createAmapDistrictsGeoJson(districts, nextLevel)
    if (geoJson.features.length === 0) {
      showUnavailable('高德未返回可绘制的上海边界。')
      return
    }

    applyFeatureCollection(geoJson, {
      source: 'amap',
      sourceLabel: getSourceLabel('amap'),
      sourceCoordinateSystem: 'gcj02',
      renderCoordinateSystem: 'wgs84',
      level: nextLevel,
      regions: districts.map((district) => ({
        id: district.adcode ?? '',
        name: district.name ?? '未命名区域',
      })),
      summary: summarizeFeatureCollection(geoJson),
    })
  }, [applyFeatureCollection, showUnavailable])

  const queryApiPreview = useCallback(async (
    nextSource: Exclude<PreviewSource, 'amap'>,
    nextLevel: AdminRegionLevel,
    requestId: number,
  ) => {
    const response = await fetch(createPreviewApiUrl(nextSource, nextLevel), {
      method: 'GET',
    })
    if (!response.ok) {
      throw new Error(`行政区划预览 API 返回 ${response.status}`)
    }
    const payload = await response.json()
    if (!isPreviewApiResponse(payload)) {
      throw new Error('行政区划预览 API 响应格式无效')
    }
    if (requestId !== requestIdRef.current) return

    if (!payload.available) {
      showUnavailable(payload.reason ?? '当前来源没有这个层级的数据。')
      return
    }

    const geoJson = createAdminRegionFeatureCollection(payload)
    if (geoJson.features.length === 0) {
      showUnavailable('当前来源返回了空边界。')
      return
    }

    applyFeatureCollection(geoJson, {
      source: nextSource,
      sourceLabel: getSourceLabel(nextSource),
      sourceCoordinateSystem: payload.coordinateSystem,
      renderCoordinateSystem: 'wgs84',
      level: nextLevel,
      regions: payload.regions.map((region) => ({
        id: region.id,
        name: region.name,
      })),
      summary: summarizeFeatureCollection(geoJson),
    })
  }, [applyFeatureCollection, showUnavailable])

  const queryPreview = useCallback((nextSource: PreviewSource, nextLevel: AdminRegionLevel) => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (nextSource === 'amap' && !amapConfig.isConfigured) {
      setResult(null)
      setRuntimeStatus('unavailable')
      setErrorMessage('需要配置高德地图密钥后才能查看高德边界。')
      clearOverlay()
      return
    }

    setRuntimeStatus('loading')
    setErrorMessage('')
    setResult(null)

    if (nextSource === 'amap' && !amapRef.current) {
      clearOverlay()
      return
    }

    const run = nextSource === 'amap'
      ? queryAmapPreview(nextLevel, requestId)
      : queryApiPreview(nextSource, nextLevel, requestId)

    run.catch((error: unknown) => {
      if (requestId !== requestIdRef.current) return
      setResult(null)
      setRuntimeStatus('error')
      setErrorMessage(error instanceof Error ? error.message : '行政区划边界加载失败')
      clearOverlay()
    })
  }, [amapConfig.isConfigured, clearOverlay, queryAmapPreview, queryApiPreview])

  useEffect(() => {
    if (!resolvedMapboxToken || !mapNodeRef.current) {
      return
    }

    let disposed = false
    mapboxgl.accessToken = resolvedMapboxToken

    const map = new mapboxgl.Map({
      container: mapNodeRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: 8,
      minZoom: 0,
      maxZoom: 16,
      pitch: 0,
      bearing: 0,
      minPitch: 0,
      maxPitch: 0,
      dragRotate: false,
      touchZoomRotate: false,
      touchPitch: false,
      projection: 'mercator',
      worldview: 'CN',
    } as mapboxgl.MapboxOptions & { worldview: 'CN' })
    mapRef.current = map

    const handleMapReady = () => {
      if (disposed || !map.isStyleLoaded()) return

      mapReadyRef.current = true
      if (selectionRef.current.source !== 'amap' || amapRef.current || !amapConfig.isConfigured) {
        queryPreview(selectionRef.current.source, selectionRef.current.level)
      }
    }

    map.on('load', handleMapReady)
    map.on('style.load', handleMapReady)

    if (amapConfig.isConfigured) {
      loadAmap(amapConfig as AmapConfig)
        .then((AMap) => {
          if (disposed) return

          amapRef.current = AMap
          if (mapReadyRef.current) {
            queryPreview(selectionRef.current.source, selectionRef.current.level)
          }
        })
        .catch((error: unknown) => {
          if (disposed) return
          if (selectionRef.current.source !== 'amap') return

          setRuntimeStatus('error')
          setErrorMessage(error instanceof Error ? error.message : '高德地图服务加载失败')
        })
    }

    return () => {
      disposed = true
      requestIdRef.current += 1
      mapReadyRef.current = false
      map.remove()
      mapRef.current = null
      amapRef.current = null
    }
  }, [amapConfig, queryPreview, resolvedMapboxToken, styleUrl])

  const rows = useMemo(() => {
    if (!result) {
      return [
        { label: '区块', value: '--' },
        { label: '边界', value: '--' },
        { label: '点数', value: '--' },
        { label: '坐标', value: '--' },
      ]
    }

    return [
      { label: '区块', value: `${result.summary.regionCount} 个区块` },
      { label: '边界', value: `${result.summary.ringCount} 条边界` },
      { label: '点数', value: `${result.summary.pointCount} 个点` },
      { label: '坐标', value: formatCoordinateSystemSummary(result) },
    ]
  }, [result])

  const selectedTitle = result?.regions.length === 1
    ? result.regions[0].name
    : result
      ? `上海 level ${result.level}`
      : `上海 level ${level}`
  const selectedSubtitle = result
    ? `${result.sourceLabel} / ${result.regions.length} 个区块`
    : `${getSourceLabel(source)} / ${getLevelText(level)}`

  const handleSourceChange = (nextSource: PreviewSource) => {
    const nextSelection = { ...selectionRef.current, source: nextSource }
    selectionRef.current = nextSelection
    setSelection(nextSelection)
    queryPreview(nextSelection.source, nextSelection.level)
  }

  const handleLevelChange = (nextLevel: AdminRegionLevel) => {
    const nextSelection = { ...selectionRef.current, level: nextLevel }
    selectionRef.current = nextSelection
    setSelection(nextSelection)
    queryPreview(nextSelection.source, nextSelection.level)
  }

  return (
    <main className="amap-boundary-preview mapbox-amap-boundary-preview">
      <div className="amap-boundary-preview__map mapbox-amap-boundary-preview__map" ref={mapNodeRef} />
      <aside className="glass-panel glass-panel--solid glass-panel--compact amap-boundary-preview__panel">
        <header>
          <span>上海行政边界来源对比</span>
          <h1>{selectedTitle}</h1>
          <p>{selectedSubtitle}</p>
        </header>
        <div className="amap-boundary-preview__control-group">
          <span>来源</span>
          <div className="amap-boundary-preview__samples" role="group" aria-label="边界来源">
            {SOURCE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={source === option.id}
                onClick={() => handleSourceChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="amap-boundary-preview__control-group">
          <span>层级</span>
          <div className="amap-boundary-preview__samples" role="group" aria-label="上海行政层级">
            {LEVEL_OPTIONS.map((option) => (
              <button
                key={option.level}
                type="button"
                aria-pressed={level === option.level}
                onClick={() => handleLevelChange(option.level)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="amap-boundary-preview__rows">
          {rows.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
        {status === 'loading' ? <p className="amap-boundary-preview__status">加载中</p> : null}
        {status === 'missing-token' ? (
          <p className="amap-boundary-preview__error" role="alert">需要配置 Mapbox token</p>
        ) : null}
        {status === 'missing-config' ? (
          <div className="amap-boundary-preview__missing" role="status">
            <strong>需要配置高德地图密钥</strong>
            {amapConfig.missingKeys.map((key) => (
              <span key={key}>{key}</span>
            ))}
          </div>
        ) : null}
        {status === 'unavailable' || status === 'error' ? (
          <p className="amap-boundary-preview__error" role="alert">{errorMessage}</p>
        ) : null}
      </aside>
    </main>
  )
}

function createPreviewApiUrl(source: Exclude<PreviewSource, 'amap'>, level: AdminRegionLevel) {
  const params = new URLSearchParams({
    source,
    level: String(level),
  })
  return `/api/admin-regions/preview/shanghai?${params.toString()}`
}

function loadAmapShanghaiDistricts(
  AMap: AMapNamespace,
  level: AdminRegionLevel,
): Promise<AmapDistrictNode[]> {
  if (level === 2) {
    return searchAmapDistrict(AMap, '310000', 'province').then((district) => district ? [district] : [])
  }
  if (level === 3) {
    return searchAmapDistrict(AMap, '310100', 'city').then((district) => district ? [district] : [])
  }

  return searchAmapDistrict(AMap, '310100', 'city', 1)
    .then(async (parentDistrict) => {
      const childrenWithBoundaries = parentDistrict?.districtList
        ?.filter((district) => extractDistrictBoundaryPaths(district.boundaries).length > 0) ?? []
      if (childrenWithBoundaries.length > 0) return childrenWithBoundaries

      const districts = await Promise.all(
        SHANGHAI_DISTRICT_ADCODES.map((adcode) => searchAmapDistrict(AMap, adcode, 'district')),
      )
      return districts.filter((district): district is AmapDistrictNode => district !== null)
    })
}

function searchAmapDistrict(
  AMap: AMapNamespace,
  keyword: string,
  level: AMap.DistrictSearchLevel,
  subdistrict = 0,
): Promise<AmapDistrictNode | null> {
  return new Promise((resolve, reject) => {
    const districtSearch = new AMap.DistrictSearch({
      level,
      subdistrict,
      extensions: 'all',
    })
    districtSearch.setLevel(level)
    districtSearch.search(keyword, (searchStatus, searchResult) => {
      if (searchStatus !== 'complete' || typeof searchResult === 'string') {
        reject(new Error(`高德行政区查询失败：${searchStatus}`))
        return
      }

      resolve((searchResult.districtList?.[0] as AmapDistrictNode | undefined) ?? null)
    })
  })
}

function createAmapDistrictsGeoJson(
  districts: AmapDistrictNode[],
  level: AdminRegionLevel,
): PreviewFeatureCollection {
  return mergeFeatureCollections(
    districts.map((district) => {
      const paths = extractDistrictBoundaryPaths(district.boundaries)
      return createDistrictBoundaryGeoJson({
        name: district.name ?? '未命名区域',
        adcode: district.adcode ?? '',
        level: toAmapLevel(level),
        paths,
        targetCoordinateSystem: 'wgs84',
      })
    }),
    'amap',
  )
}

function createAdminRegionFeatureCollection(payload: PreviewApiResponse): PreviewFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: payload.regions.map((region) => {
      const geometry = payload.coordinateSystem === 'gcj02'
        ? transformGeometryToWgs84(region.geometry)
        : region.geometry

      return {
        type: 'Feature' as const,
        properties: {
          name: region.name,
          adcode: region.id,
          level: toAmapLevel(region.level),
          source: payload.source,
          ringCount: countGeometryRings(geometry),
          pointCount: countGeometryPoints(geometry),
        },
        geometry: normalizeToMultiPolygonGeometry(geometry),
      }
    }).filter((feature) => feature.geometry.coordinates.length > 0),
  }
}

function mergeFeatureCollections(
  collections: PreviewFeatureCollection[],
  source: PreviewSource,
): PreviewFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collections
      .flatMap((collection) => collection.features)
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          source,
        },
      }))
      .filter((feature) => feature.geometry.coordinates.length > 0),
  }
}

function transformGeometryToWgs84(geometry: AdminRegionGeometry): AdminRegionGeometry {
  return mapGeometryCoordinates(geometry, ([longitude, latitude]) => {
    const transformedCoordinate = transformGcj02ToWgs84Coordinate({ longitude, latitude })
    return [transformedCoordinate.longitude, transformedCoordinate.latitude]
  })
}

function mapGeometryCoordinates(
  geometry: AdminRegionGeometry,
  transformCoordinate: (coordinate: [number, number]) => [number, number],
): AdminRegionGeometry {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => ring.map(transformCoordinate)),
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(transformCoordinate))),
  }
}

function normalizeToMultiPolygonGeometry(geometry: AdminRegionGeometry): PreviewFeatureCollection['features'][number]['geometry'] {
  const coordinates = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.coordinates

  return {
    type: 'MultiPolygon',
    coordinates: coordinates
      .map((polygon) => polygon
        .map(normalizeLinearRing)
        .filter((ring): ring is AmapBoundaryPath => ring !== null))
      .filter((polygon) => polygon.length > 0),
  }
}

function normalizeLinearRing(path: AmapBoundaryPath): AmapBoundaryPath | null {
  if (path.length < 3) return null
  const closedPath = isSameCoordinate(path[0], path[path.length - 1])
    ? path
    : [...path, path[0]]
  const uniquePointCount = new Set(closedPath.map(([lng, lat]) => `${lng},${lat}`)).size

  return closedPath.length >= 4 && uniquePointCount >= 3 ? closedPath : null
}

function summarizeFeatureCollection(geoJson: PreviewFeatureCollection) {
  return geoJson.features.reduce(
    (summary, feature) => ({
      regionCount: summary.regionCount + 1,
      ringCount: summary.ringCount + feature.properties.ringCount,
      pointCount: summary.pointCount + feature.properties.pointCount,
    }),
    { regionCount: 0, ringCount: 0, pointCount: 0 },
  )
}

function countGeometryRings(geometry: AdminRegionGeometry) {
  return geometry.type === 'Polygon'
    ? geometry.coordinates.length
    : geometry.coordinates.reduce((total, polygon) => total + polygon.length, 0)
}

function countGeometryPoints(geometry: AdminRegionGeometry) {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.reduce((total, ring) => total + ring.length, 0)
  }

  return geometry.coordinates.reduce(
    (total, polygon) => total + polygon.reduce((polygonTotal, ring) => polygonTotal + ring.length, 0),
    0,
  )
}

function upsertBoundaryOverlay(
  map: mapboxgl.Map,
  geoJson: PreviewFeatureCollection,
  color: string,
) {
  const source = map.getSource(MAPBOX_BOUNDARY_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined

  if (source) {
    source.setData(geoJson)
  } else {
    map.addSource(MAPBOX_BOUNDARY_SOURCE_ID, {
      type: 'geojson',
      data: geoJson,
    })
  }

  if (map.getLayer(MAPBOX_BOUNDARY_FILL_LAYER_ID)) {
    map.setPaintProperty(MAPBOX_BOUNDARY_FILL_LAYER_ID, 'fill-color', color)
  } else {
    map.addLayer({
      id: MAPBOX_BOUNDARY_FILL_LAYER_ID,
      type: 'fill',
      source: MAPBOX_BOUNDARY_SOURCE_ID,
      paint: {
        'fill-color': color,
        'fill-opacity': 0.08,
      },
    })
  }

  if (map.getLayer(MAPBOX_BOUNDARY_LINE_LAYER_ID)) {
    map.setPaintProperty(MAPBOX_BOUNDARY_LINE_LAYER_ID, 'line-color', color)
  } else {
    map.addLayer({
      id: MAPBOX_BOUNDARY_LINE_LAYER_ID,
      type: 'line',
      source: MAPBOX_BOUNDARY_SOURCE_ID,
      paint: {
        'line-color': color,
        'line-opacity': 0.92,
        'line-width': 1.6,
      },
    })
  }
}

function calculateGeoJsonBounds(geoJson: PreviewFeatureCollection) {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  for (const feature of geoJson.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          west = Math.min(west, lng)
          south = Math.min(south, lat)
          east = Math.max(east, lng)
          north = Math.max(north, lat)
        }
      }
    }
  }

  if (![west, south, east, north].every(Number.isFinite)) {
    return null
  }

  return [
    [west, south],
    [east, north],
  ] as [[number, number], [number, number]]
}

function isPreviewApiResponse(payload: unknown): payload is PreviewApiResponse {
  if (typeof payload !== 'object' || payload === null) return false
  const candidate = payload as Partial<PreviewApiResponse>

  return (
    isPreviewSource(candidate.source) &&
    isAdminRegionLevel(candidate.level) &&
    typeof candidate.available === 'boolean' &&
    (candidate.coordinateSystem === null || candidate.coordinateSystem === 'gcj02' || candidate.coordinateSystem === 'wgs84') &&
    (!candidate.available || candidate.coordinateSystem !== null) &&
    (candidate.reason === null || typeof candidate.reason === 'string') &&
    Array.isArray(candidate.regions) &&
    candidate.regions.every(isPreviewRegion)
  )
}

function isPreviewRegion(value: unknown): value is PreviewRegion {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PreviewRegion>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isAdminRegionLevel(candidate.level) &&
    isAdminRegionGeometry(candidate.geometry)
  )
}

function isPreviewSource(value: unknown): value is PreviewSource {
  return value === 'amap' || value === 'local' || value === 'osm'
}

function isAdminRegionLevel(value: unknown): value is AdminRegionLevel {
  return value === 2 || value === 3 || value === 4 || value === 5
}

function isAdminRegionGeometry(value: unknown): value is AdminRegionGeometry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AdminRegionGeometry>
  return (
    (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') &&
    Array.isArray(candidate.coordinates)
  )
}

function toAmapLevel(level: AdminRegionLevel): AMap.DistrictSearchLevel {
  if (level === 2) return 'province'
  if (level === 3) return 'city'
  return 'district'
}

function getLevelText(level: AdminRegionLevel) {
  return LEVEL_OPTIONS.find((option) => option.level === level)?.label ?? String(level)
}

function getSourceLabel(source: PreviewSource) {
  return SOURCE_OPTIONS.find((option) => option.id === source)?.label ?? source
}

function getSourceColor(source: PreviewSource) {
  return SOURCE_OPTIONS.find((option) => option.id === source)?.color ?? '#0057d9'
}

function getCoordinateSystemLabel(coordinateSystem: PreviewCoordinateSystem) {
  return coordinateSystem === 'gcj02' ? 'GCJ-02' : 'WGS84'
}

function formatCoordinateSystemSummary(result: Pick<BoundaryOverlayResult, 'renderCoordinateSystem' | 'sourceCoordinateSystem'>) {
  const renderLabel = getCoordinateSystemLabel(result.renderCoordinateSystem)
  const sourceLabel = getCoordinateSystemLabel(result.sourceCoordinateSystem)

  return renderLabel === sourceLabel ? renderLabel : `${renderLabel}（源 ${sourceLabel}）`
}

function isSameCoordinate([leftLng, leftLat]: AMap.LngLatLike, [rightLng, rightLat]: AMap.LngLatLike) {
  return leftLng === rightLng && leftLat === rightLat
}

function resolveMapboxToken(explicitToken: string | undefined) {
  return explicitToken?.trim() ||
    (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() ||
    ''
}
