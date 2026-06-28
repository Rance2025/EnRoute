import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'

import type { AmapConfig } from '../config/amap'
import {
  createDistrictBoundaryGeoJson,
  extractDistrictBoundaryPaths,
  summarizeDistrictBoundary,
  type AmapBoundaryPath,
  type DistrictBoundaryFeatureCollection,
} from '../layers/amapDistrictBoundary'
import { DEFAULT_MAPBOX_STYLE_URL } from '../mapStyleOptions'
import { loadAmap, type AMapNamespace } from '../services/amapLoader'

type PreviewLevel = AMap.DistrictSearchLevel

type PreviewSample = {
  label: string
  keyword: string
  level: PreviewLevel
}

type PreviewStatus = 'missing-config' | 'missing-token' | 'loading' | 'ready' | 'error'

type BoundaryOverlayResult = {
  name: string
  adcode: string
  level: PreviewLevel
  paths: AmapBoundaryPath[]
  summary: {
    ringCount: number
    pointCount: number
  }
}

const MAPBOX_BOUNDARY_SOURCE_ID = 'amap-boundary-preview'
const MAPBOX_BOUNDARY_FILL_LAYER_ID = 'amap-boundary-preview-fill'
const MAPBOX_BOUNDARY_LINE_LAYER_ID = 'amap-boundary-preview-line'
const DEFAULT_CENTER: [number, number] = [121.5, 31.2]
const PREVIEW_SAMPLES: PreviewSample[] = [
  { label: '浦东新区', keyword: '310115', level: 'district' },
  { label: '上海市', keyword: '310000', level: 'province' },
  { label: '杭州市', keyword: '330100', level: 'city' },
  { label: '西湖区', keyword: '330106', level: 'district' },
  { label: '四川省', keyword: '510000', level: 'province' },
  { label: '阿坝州', keyword: '513200', level: 'city' },
]
const DEFAULT_SAMPLE = PREVIEW_SAMPLES[0]

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
  const [sample, setSample] = useState(DEFAULT_SAMPLE)
  const [runtimeStatus, setRuntimeStatus] = useState<Exclude<PreviewStatus, 'missing-config' | 'missing-token'>>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<BoundaryOverlayResult | null>(null)
  const resolvedMapboxToken = resolveMapboxToken(mapboxAccessToken)
  const status: PreviewStatus = !amapConfig.isConfigured
    ? 'missing-config'
    : !resolvedMapboxToken
      ? 'missing-token'
      : runtimeStatus

  const queryBoundary = useCallback((nextSample: PreviewSample) => {
    const AMap = amapRef.current
    const map = mapRef.current
    if (!AMap || !map || !mapReadyRef.current) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setRuntimeStatus('loading')
    setErrorMessage('')

    const districtSearch = new AMap.DistrictSearch({
      level: nextSample.level,
      subdistrict: 0,
      extensions: 'all',
    })
    districtSearch.setLevel(nextSample.level)
    districtSearch.search(nextSample.keyword, (searchStatus, searchResult) => {
      if (requestId !== requestIdRef.current) return

      if (searchStatus !== 'complete' || typeof searchResult === 'string') {
        setRuntimeStatus('error')
        setErrorMessage(`高德行政区查询失败：${searchStatus}`)
        return
      }

      const district = searchResult.districtList?.[0]
      const paths = extractDistrictBoundaryPaths(district?.boundaries)

      if (!district || paths.length === 0) {
        setRuntimeStatus('error')
        setErrorMessage('高德未返回可绘制边界')
        return
      }

      const geoJson = createDistrictBoundaryGeoJson({
        name: district.name ?? nextSample.label,
        adcode: district.adcode ?? nextSample.keyword,
        level: nextSample.level,
        paths,
      })
      upsertBoundaryOverlay(map, geoJson)
      map.fitBounds(calculatePathBounds(paths), {
        padding: 96,
        duration: 700,
      })
      setResult({
        name: district.name ?? nextSample.label,
        adcode: district.adcode ?? nextSample.keyword,
        level: nextSample.level,
        paths,
        summary: summarizeDistrictBoundary(paths),
      })
      setRuntimeStatus('ready')
    })
  }, [])

  useEffect(() => {
    if (!amapConfig.isConfigured) {
      return
    }

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
      if (amapRef.current) queryBoundary(DEFAULT_SAMPLE)
    }

    map.on('load', handleMapReady)
    map.on('style.load', handleMapReady)

    loadAmap(amapConfig as AmapConfig)
      .then((AMap) => {
        if (disposed) return

        amapRef.current = AMap
        if (mapReadyRef.current) queryBoundary(DEFAULT_SAMPLE)
      })
      .catch((error: unknown) => {
        if (disposed) return

        setRuntimeStatus('error')
        setErrorMessage(error instanceof Error ? error.message : '高德地图服务加载失败')
      })

    return () => {
      disposed = true
      requestIdRef.current += 1
      mapReadyRef.current = false
      map.remove()
      mapRef.current = null
      amapRef.current = null
    }
  }, [amapConfig, queryBoundary, resolvedMapboxToken, styleUrl])

  const rows = useMemo(() => {
    if (!result) {
      return [
        { label: '边界', value: '--' },
        { label: '点数', value: '--' },
        { label: '层级', value: getLevelLabel(sample.level) },
      ]
    }

    return [
      { label: '边界', value: `${result.summary.ringCount} 条边界` },
      { label: '点数', value: `${result.summary.pointCount} 个点` },
      { label: '层级', value: getLevelLabel(result.level) },
    ]
  }, [result, sample.level])

  const handleSampleChange = (nextSample: PreviewSample) => {
    setSample(nextSample)
    queryBoundary(nextSample)
  }

  return (
    <main className="amap-boundary-preview mapbox-amap-boundary-preview">
      <div className="amap-boundary-preview__map mapbox-amap-boundary-preview__map" ref={mapNodeRef} />
      <aside className="glass-panel glass-panel--solid glass-panel--compact amap-boundary-preview__panel">
        <header>
          <span>高德边界叠加到 Mapbox</span>
          <h1>{result?.name ?? sample.label}</h1>
          <p>{result?.adcode ?? sample.keyword}</p>
        </header>
        <div className="amap-boundary-preview__samples" role="group" aria-label="预览地区">
          {PREVIEW_SAMPLES.map((previewSample) => (
            <button
              key={previewSample.keyword}
              type="button"
              aria-pressed={sample.keyword === previewSample.keyword}
              onClick={() => handleSampleChange(previewSample)}
            >
              {previewSample.label}
            </button>
          ))}
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
        {status === 'error' ? (
          <p className="amap-boundary-preview__error" role="alert">{errorMessage}</p>
        ) : null}
      </aside>
    </main>
  )
}

function upsertBoundaryOverlay(
  map: mapboxgl.Map,
  geoJson: DistrictBoundaryFeatureCollection,
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

  if (!map.getLayer(MAPBOX_BOUNDARY_FILL_LAYER_ID)) {
    map.addLayer({
      id: MAPBOX_BOUNDARY_FILL_LAYER_ID,
      type: 'fill',
      source: MAPBOX_BOUNDARY_SOURCE_ID,
      paint: {
        'fill-color': '#0057d9',
        'fill-opacity': 0.08,
      },
    })
  }

  if (!map.getLayer(MAPBOX_BOUNDARY_LINE_LAYER_ID)) {
    map.addLayer({
      id: MAPBOX_BOUNDARY_LINE_LAYER_ID,
      type: 'line',
      source: MAPBOX_BOUNDARY_SOURCE_ID,
      paint: {
        'line-color': '#0057d9',
        'line-opacity': 0.92,
        'line-width': 1.6,
      },
    })
  }
}

function calculatePathBounds(paths: AmapBoundaryPath[]) {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  for (const path of paths) {
    for (const [lng, lat] of path) {
      west = Math.min(west, lng)
      south = Math.min(south, lat)
      east = Math.max(east, lng)
      north = Math.max(north, lat)
    }
  }

  return [
    [west, south],
    [east, north],
  ] as [[number, number], [number, number]]
}

function getLevelLabel(level: PreviewLevel) {
  if (level === 'province') return '省级'
  if (level === 'city') return '市级'
  if (level === 'district') return '区县'
  if (level === 'country') return '国家'

  return level
}

function resolveMapboxToken(explicitToken: string | undefined) {
  return explicitToken?.trim() ||
    (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() ||
    ''
}
