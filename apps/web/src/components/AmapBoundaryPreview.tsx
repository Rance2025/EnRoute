import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AMAP_THEMES, type AmapConfig } from '../config/amap'
import {
  extractDistrictBoundaryPaths,
  summarizeDistrictBoundary,
  type AmapBoundaryPath,
} from '../layers/amapDistrictBoundary'
import { loadAmap, type AMapNamespace } from '../services/amapLoader'

type PreviewLevel = AMap.DistrictSearchLevel

type PreviewSample = {
  label: string
  keyword: string
  level: PreviewLevel
  zoom: number
}

type PreviewStatus = 'missing-config' | 'loading-map' | 'ready' | 'loading-boundary' | 'error'

type BoundaryPreviewResult = {
  name: string
  adcode: string
  paths: AmapBoundaryPath[]
  summary: {
    ringCount: number
    pointCount: number
  }
}

const PREVIEW_SAMPLES: PreviewSample[] = [
  { label: '上海市', keyword: '310000', level: 'province', zoom: 8 },
  { label: '浦东新区', keyword: '310115', level: 'district', zoom: 10 },
  { label: '杭州市', keyword: '330100', level: 'city', zoom: 9 },
  { label: '西湖区', keyword: '330106', level: 'district', zoom: 11 },
  { label: '四川省', keyword: '510000', level: 'province', zoom: 6 },
  { label: '阿坝州', keyword: '513200', level: 'city', zoom: 8 },
]

const DEFAULT_SAMPLE = PREVIEW_SAMPLES[1]
const PREVIEW_STROKE = '#0057d9'
const PREVIEW_FILL = '#0057d9'

export function AmapBoundaryPreview({ config }: { config: AmapConfig }) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMap.Map | null>(null)
  const amapRef = useRef<AMapNamespace | null>(null)
  const polygonsRef = useRef<AMap.Polygon[]>([])
  const requestIdRef = useRef(0)
  const [status, setStatus] = useState<PreviewStatus>(
    config.isConfigured ? 'loading-map' : 'missing-config',
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [sample, setSample] = useState<PreviewSample>(DEFAULT_SAMPLE)
  const [result, setResult] = useState<BoundaryPreviewResult | null>(null)

  const themes = config.themes.length ? config.themes : AMAP_THEMES
  const mapTheme = themes[0]

  const clearPolygons = useCallback(() => {
    for (const polygon of polygonsRef.current) {
      polygon.setMap(null)
    }
    polygonsRef.current = []
  }, [])

  const queryBoundary = useCallback((nextSample: PreviewSample) => {
    const AMap = amapRef.current
    const map = mapRef.current

    if (!AMap || !map) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setStatus('loading-boundary')
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
        clearPolygons()
        setResult(null)
        setErrorMessage(`高德行政区查询失败：${searchStatus}`)
        setStatus('error')
        return
      }

      const district = searchResult.districtList?.[0]
      const paths = extractDistrictBoundaryPaths(district?.boundaries)

      if (!district || paths.length === 0) {
        clearPolygons()
        setResult(null)
        setErrorMessage('高德未返回可绘制边界')
        setStatus('error')
        return
      }

      clearPolygons()
      const nextPolygons = paths.map((path) => {
        const polygon = new AMap.Polygon({
          path,
          strokeColor: PREVIEW_STROKE,
          strokeOpacity: 0.9,
          strokeWeight: 1.6,
          fillColor: PREVIEW_FILL,
          fillOpacity: 0.08,
          bubble: true,
          cursor: 'default',
          zIndex: 28,
        })
        polygon.setMap(map)
        return polygon
      })
      polygonsRef.current = nextPolygons
      map.setFitView(nextPolygons, false, [72, 72, 72, 72], 600)
      setResult({
        name: district.name ?? nextSample.label,
        adcode: district.adcode ?? nextSample.keyword,
        paths,
        summary: summarizeDistrictBoundary(paths),
      })
      setStatus('ready')
    })
  }, [clearPolygons])

  useEffect(() => {
    if (!config.isConfigured || !mapNodeRef.current) {
      setStatus('missing-config')
      return
    }

    let disposed = false
    setStatus('loading-map')
    setErrorMessage('')

    loadAmap(config)
      .then((AMap) => {
        if (disposed || !mapNodeRef.current) return

        amapRef.current = AMap
        const map = new AMap.Map(mapNodeRef.current, {
          center: config.defaultCenter,
          zoom: DEFAULT_SAMPLE.zoom,
          zooms: [3, 18],
          mapStyle: mapTheme.style,
          features: ['bg', 'road', 'point'],
          viewMode: '2D',
          pitch: 0,
          rotation: 0,
          pitchEnable: false,
          rotateEnable: false,
          showLabel: true,
          resizeEnable: true,
        })
        map.addControl(new AMap.Scale({ position: 'LB' }))
        mapRef.current = map
        setStatus('ready')
        queryBoundary(DEFAULT_SAMPLE)
      })
      .catch((error: unknown) => {
        if (disposed) return

        setErrorMessage(error instanceof Error ? error.message : '高德地图加载失败')
        setStatus('error')
      })

    return () => {
      disposed = true
      requestIdRef.current += 1
      clearPolygons()
      mapRef.current?.destroy()
      mapRef.current = null
      amapRef.current = null
    }
  }, [clearPolygons, config, mapTheme.style, queryBoundary])

  const previewRows = useMemo(() => {
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
      { label: '层级', value: getLevelLabel(sample.level) },
    ]
  }, [result, sample.level])

  const handleSampleChange = (nextSample: PreviewSample) => {
    setSample(nextSample)
    queryBoundary(nextSample)
  }

  return (
    <main className="amap-boundary-preview">
      <div className="amap-boundary-preview__map" ref={mapNodeRef} />
      <aside className="glass-panel glass-panel--solid glass-panel--compact amap-boundary-preview__panel">
        <header>
          <span>高德边界质量预览</span>
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
          {previewRows.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
        {status === 'loading-map' || status === 'loading-boundary' ? (
          <p className="amap-boundary-preview__status">加载中</p>
        ) : null}
        {status === 'error' ? (
          <p className="amap-boundary-preview__error" role="alert">{errorMessage}</p>
        ) : null}
        {status === 'missing-config' ? (
          <div className="amap-boundary-preview__missing" role="status">
            <strong>需要配置高德地图密钥</strong>
            {config.missingKeys.map((key) => (
              <span key={key}>{key}</span>
            ))}
          </div>
        ) : null}
      </aside>
    </main>
  )
}

function getLevelLabel(level: PreviewLevel) {
  if (level === 'province') return '省级'
  if (level === 'city') return '市级'
  if (level === 'district') return '区县'
  if (level === 'country') return '国家'

  return level
}
