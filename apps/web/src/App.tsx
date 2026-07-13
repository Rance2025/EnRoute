import './App.css'

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  BarChart3,
  CalendarDays,
  Footprints,
  List,
  MapPinned,
  Shapes,
  Settings,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'

import type { FootprintMetrics } from './layers/footprintTypes'
import type { AdminRegionDepth } from './layers/adminRegionVectorTileSource'
import {
  formatAverageDistanceMeters,
  formatDistanceMeters,
  formatMetricCount,
} from './components/mapMetricFormat'
import { SegmentedControl, type SegmentedOption } from './components/SegmentedControl'
import { TimeContextPanel, type TimeContextMetricItem } from './components/TimeContextPanel'
import {
  calculateUnifiedDataPanelWidth,
  type AppView,
} from './appLayout'
import type { AmapConfig } from './config/amap'
import {
  readMapAdminBoundariesVisible,
  readAdminRegionLinesVisible,
  readMapLanguage,
  readMapProjection,
  readMapDebugPanelVisible,
  readMapPlaceLabelsVisible,
  readMapStyle,
  readNavigationStyle,
  readAppTheme,
  readGlassPanelOpacity,
  writeAppTheme,
  writeGlassPanelOpacity,
  writeMapAdminBoundariesVisible,
  writeAdminRegionLinesVisible,
  writeMapLanguage,
  writeMapProjection,
  writeMapDebugPanelVisible,
  writeMapPlaceLabelsVisible,
  writeMapStyle,
  writeNavigationStyle,
  type AppTheme,
  GLASS_PANEL_OPACITY_MAX,
  GLASS_PANEL_OPACITY_MIN,
  GLASS_PANEL_OPACITY_STEP,
  formatGlassPanelOpacity,
  normalizeGlassPanelOpacity,
  type MapLanguagePreference,
  type MapStylePreference,
  type MapProjectionPreference,
  type NavigationStyle,
} from './navigationPreferences'
import { resolveMapStyleOption } from './mapStyleOptions'
import {
  countElapsedInclusiveDays,
  createCurrentSelection,
  createTodaySelection,
  type TimeRangeSelection,
} from './time/timeRange'

type AppProps = {
  amapConfig?: AmapConfig
}

type SecondaryNavId = 'footprints' | 'regions' | 'stats' | 'ledger'
type SecondaryNavItem = {
  id: SecondaryNavId
  label: string
  icon: LucideIcon
}
type SecondaryNavSelection = Record<AppView, SecondaryNavId>
type TopNavigationItem = {
  value: AppView
  label: string
  icon?: LucideIcon
  kind: 'brand' | 'page'
}
type TopNavigationThumbMetrics = {
  left: number
  width: number
}
type TopNavigationPointerPosition = TopNavigationThumbMetrics & {
  view: AppView
}
type TopNavigationDragPosition = TopNavigationPointerPosition & {
  previewLeft: number
  previewWidth: number
}
type SettingsPageId = 'general' | 'map' | 'accounting' | 'schedule'
type RightContextRow = {
  label: string
  value: string
}

const DEFAULT_ADMIN_REGION_DEPTH: AdminRegionDepth = 1
const adminRegionDepthOptions: Array<{ value: AdminRegionDepth, label: string }> = [
  { value: 1, label: '国家' },
  { value: 2, label: '中国省级' },
  { value: 3, label: '中国市级' },
  { value: 4, label: '中国区县' },
]

const topNavigationItems: TopNavigationItem[] = [
  { value: 'overview', label: '在途 EnRoute', kind: 'brand' },
  { value: 'map', label: '地图', icon: MapPinned, kind: 'page' },
  { value: 'accounting', label: '记账', icon: Wallet, kind: 'page' },
  { value: 'schedule', label: '日程', icon: CalendarDays, kind: 'page' },
]
const navigationStyleOptions: Array<SegmentedOption<NavigationStyle>> = [
  { value: 'icon', label: '纯 icon' },
  { value: 'mixed', label: '图文混合' },
]

const settingsPageItems: Array<{ id: SettingsPageId; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'map', label: '地图' },
  { id: 'accounting', label: '记账' },
  { id: 'schedule', label: '日程' },
]

function getSettingsPageForView(view: AppView): SettingsPageId {
  if (view === 'map') return 'map'
  if (view === 'accounting') return 'accounting'
  if (view === 'schedule') return 'schedule'

  return 'general'
}

const appThemeOptions: Array<{
  value: AppTheme
  label: string
  swatches: [string, string, string]
}> = [
  {
    value: 'mist',
    label: '青瓷灰',
    swatches: ['#eef4f2', '#ccd6d7', '#f2f8f7'],
  },
]
const secondaryNavItemsByView: Record<AppView, SecondaryNavItem[]> = {
  overview: [],
  map: [
    { id: 'footprints', label: '足迹', icon: Footprints },
    { id: 'regions', label: '区域', icon: Shapes },
    { id: 'stats', label: '统计', icon: BarChart3 },
  ],
  schedule: [],
  accounting: [
    { id: 'ledger', label: '流水', icon: List },
    { id: 'stats', label: '统计', icon: BarChart3 },
  ],
}
const defaultSecondaryNavSelection: SecondaryNavSelection = {
  overview: 'stats',
  map: 'footprints',
  schedule: 'stats',
  accounting: 'ledger',
}
const LazyMapboxCanvas = lazy(() => import('./components/MapboxCanvas').then((module) => ({ default: module.MapboxCanvas })))
const LazyAccountingPage = lazy(() => import('./components/AccountingPage').then((module) => ({ default: module.AccountingPage })))

function getViewportSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

function getTopNavigationDragPosition(
  clientX: number,
  tabsElement: HTMLDivElement,
  buttonRefs: Record<AppView, HTMLButtonElement | null>,
): TopNavigationDragPosition | undefined {
  const tabsRect = tabsElement.getBoundingClientRect()

  if (tabsRect.width <= 0) return undefined

  const boundedClientX = Math.min(Math.max(clientX, tabsRect.left), tabsRect.right)
  let closestPosition: TopNavigationDragPosition | undefined
  let closestDistance = Number.POSITIVE_INFINITY
  const positions = topNavigationItems
    .map((item) => {
      const buttonElement = buttonRefs[item.value]

      if (!buttonElement) return undefined

      const buttonRect = buttonElement.getBoundingClientRect()

      return {
        view: item.value,
        left: buttonRect.left - tabsRect.left,
        width: buttonRect.width,
        center: buttonRect.left + buttonRect.width / 2,
      }
    })
    .filter((position): position is TopNavigationPointerPosition & { center: number } => Boolean(position))

  for (const position of positions) {
    const distance = Math.abs(boundedClientX - position.center)

    if (distance < closestDistance) {
      closestDistance = distance
      closestPosition = {
        view: position.view,
        left: position.left,
        width: position.width,
        previewLeft: position.left,
        previewWidth: position.width,
      }
    }
  }

  if (!closestPosition) return undefined

  const nextPositionIndex = positions.findIndex((position) => boundedClientX <= position.center)
  const rightPosition = positions[nextPositionIndex] ?? positions.at(-1)
  const leftPosition = positions[Math.max(nextPositionIndex - 1, 0)] ?? positions[0]

  if (!leftPosition || !rightPosition || leftPosition === rightPosition) {
    return {
      ...closestPosition,
      previewLeft: Math.min(
        Math.max(boundedClientX - tabsRect.left - closestPosition.width / 2, 0),
        Math.max(tabsRect.width - closestPosition.width, 0),
      ),
      previewWidth: closestPosition.width,
    }
  }

  const centerDistance = rightPosition.center - leftPosition.center
  const progress = centerDistance <= 0
    ? 0
    : Math.min(Math.max((boundedClientX - leftPosition.center) / centerDistance, 0), 1)
  const previewWidth = leftPosition.width
    + (rightPosition.width - leftPosition.width) * progress
  const previewLeft = leftPosition.left
    + (rightPosition.left - leftPosition.left) * progress

  return {
    ...closestPosition,
    previewLeft: Math.min(
      Math.max(previewLeft, 0),
      Math.max(tabsRect.width - previewWidth, 0),
    ),
    previewWidth,
  }
}

function App(props: AppProps) {
  void props.amapConfig

  const topNavigationTabsRef = useRef<HTMLDivElement | null>(null)
  const isTopNavigationDraggingRef = useRef(false)
  const topNavigationButtonRefs = useRef<Record<AppView, HTMLButtonElement | null>>({
    overview: null,
    map: null,
    accounting: null,
    schedule: null,
  })
  const [view, setView] = useState<AppView>('map')
  const [navigationStyle, setNavigationStyle] = useState<NavigationStyle>(readNavigationStyle)
  const [appTheme, setAppTheme] = useState<AppTheme>(readAppTheme)
  const [glassPanelOpacity, setGlassPanelOpacity] = useState(readGlassPanelOpacity)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState<SettingsPageId>('general')
  const [isMapDebugPanelVisible, setIsMapDebugPanelVisible] = useState(
    readMapDebugPanelVisible,
  )
  const [areMapPlaceLabelsVisible, setAreMapPlaceLabelsVisible] = useState(
    readMapPlaceLabelsVisible,
  )
  const [areMapAdminBoundariesVisible, setAreMapAdminBoundariesVisible] = useState(
    readMapAdminBoundariesVisible,
  )
  const [areAdminRegionLinesVisible, setAreAdminRegionLinesVisible] = useState(
    readAdminRegionLinesVisible,
  )
  const [mapProjection, setMapProjection] = useState<MapProjectionPreference>(
    readMapProjection,
  )
  const [mapStyle, setMapStyle] = useState<MapStylePreference>(readMapStyle)
  const [mapLanguage, setMapLanguage] = useState<MapLanguagePreference>(readMapLanguage)
  const [topNavigationThumb, setTopNavigationThumb] = useState<TopNavigationThumbMetrics>({
    left: 0,
    width: 0,
  })
  const [topNavigationTabsWidth, setTopNavigationTabsWidth] = useState(0)
  const [isTopNavigationDragging, setIsTopNavigationDragging] = useState(false)
  const [topNavigationPreviewThumb, setTopNavigationPreviewThumb] =
    useState<TopNavigationThumbMetrics | null>(null)
  const [secondaryNavSelection, setSecondaryNavSelection] = useState<SecondaryNavSelection>(
    defaultSecondaryNavSelection,
  )
  const [adminRegionDepth, setAdminRegionDepth] = useState<AdminRegionDepth>(
    DEFAULT_ADMIN_REGION_DEPTH,
  )
  const [adminRegionActiveOnly, setAdminRegionActiveOnly] = useState(false)
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRangeSelection>(
    createTodaySelection,
  )
  const [footprintMetrics, setFootprintMetrics] = useState<FootprintMetrics>({
    selectedCount: 0,
    totalDistanceMeters: 0,
    averageDistanceMetersPerDay: 0,
    distanceSeries: {
      granularity: 'day',
      unit: 'day',
      buckets: [],
    },
  })
  const [viewportSize, setViewportSize] = useState(getViewportSize)
  const handleViewChange = useCallback((nextView: AppView) => {
    setView(nextView)

    if (
      nextView === 'accounting' &&
      view !== 'accounting' &&
      timeSelectionsAreEqual(selectedTimeRange, createTodaySelection())
    ) {
      setSelectedTimeRange({
        ...createCurrentSelection('month'),
        anchorDate: createTodaySelection().anchorDate,
      })
    }
  }, [selectedTimeRange, view])
  const handleNavigationStyleChange = useCallback((nextStyle: NavigationStyle) => {
    setNavigationStyle(nextStyle)
    writeNavigationStyle(nextStyle)
  }, [])
  const handleAppThemeChange = useCallback((nextTheme: AppTheme) => {
    setAppTheme(nextTheme)
    writeAppTheme(nextTheme)
  }, [])
  const handleGlassPanelOpacityChange = useCallback((rawOpacity: string) => {
    const nextOpacity = normalizeGlassPanelOpacity(Number(rawOpacity))

    setGlassPanelOpacity(nextOpacity)
    writeGlassPanelOpacity(nextOpacity)
  }, [])
  const handleMapDebugPanelVisibleChange = useCallback((nextVisible: boolean) => {
    setIsMapDebugPanelVisible(nextVisible)
    writeMapDebugPanelVisible(nextVisible)
  }, [])
  const handleMapPlaceLabelsVisibleChange = useCallback((nextVisible: boolean) => {
    setAreMapPlaceLabelsVisible(nextVisible)
    writeMapPlaceLabelsVisible(nextVisible)
  }, [])
  const handleMapAdminBoundariesVisibleChange = useCallback((nextVisible: boolean) => {
    setAreMapAdminBoundariesVisible(nextVisible)
    writeMapAdminBoundariesVisible(nextVisible)
  }, [])
  const handleAdminRegionLinesVisibleChange = useCallback((nextVisible: boolean) => {
    setAreAdminRegionLinesVisible(nextVisible)
    writeAdminRegionLinesVisible(nextVisible)
  }, [])
  const handleMapProjectionChange = useCallback((nextProjection: MapProjectionPreference) => {
    setMapProjection(nextProjection)
    writeMapProjection(nextProjection)
  }, [])
  const handleMapStyleChange = useCallback((nextStyle: MapStylePreference) => {
    setMapStyle(nextStyle)
    writeMapStyle(nextStyle)
  }, [])
  const handleMapLanguageChange = useCallback((nextLanguage: MapLanguagePreference) => {
    setMapLanguage(nextLanguage)
    writeMapLanguage(nextLanguage)
  }, [])
  const previewTopNavigationPointerPosition = useCallback((clientX: number) => {
    const tabsElement = topNavigationTabsRef.current

    if (!tabsElement) return

    const position = getTopNavigationDragPosition(
      clientX,
      tabsElement,
      topNavigationButtonRefs.current,
    )

    if (position) {
      setTopNavigationPreviewThumb({
        left: position.previewLeft,
        width: position.previewWidth,
      })
    }
  }, [])
  const commitTopNavigationPointerPosition = useCallback((clientX: number) => {
    const tabsElement = topNavigationTabsRef.current

    if (!tabsElement) return

    const position = getTopNavigationDragPosition(
      clientX,
      tabsElement,
      topNavigationButtonRefs.current,
    )

    if (position) {
      handleViewChange(position.view)
    }
  }, [handleViewChange])
  const handleTopNavigationPointerDown = useCallback(
    (event: PointerEvent<HTMLSpanElement>) => {
      isTopNavigationDraggingRef.current = true
      setIsTopNavigationDragging(true)
      topNavigationTabsRef.current?.setPointerCapture?.(event.pointerId)
      previewTopNavigationPointerPosition(event.clientX)
    },
    [previewTopNavigationPointerPosition],
  )
  const handleTopNavigationPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isTopNavigationDraggingRef.current) return
      previewTopNavigationPointerPosition(event.clientX)
    },
    [previewTopNavigationPointerPosition],
  )
  const endTopNavigationDrag = useCallback(
    (event: PointerEvent<HTMLDivElement | HTMLSpanElement>) => {
      if (isTopNavigationDraggingRef.current) {
        commitTopNavigationPointerPosition(event.clientX)
      }

      isTopNavigationDraggingRef.current = false
      setIsTopNavigationDragging(false)
      setTopNavigationPreviewThumb(null)

      if (topNavigationTabsRef.current?.hasPointerCapture?.(event.pointerId)) {
        topNavigationTabsRef.current.releasePointerCapture(event.pointerId)
      }
    },
    [commitTopNavigationPointerPosition],
  )
  const handleTopNavigationKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLSpanElement>) => {
      const currentIndex = Math.max(
        topNavigationItems.findIndex((item) => item.value === view),
        0,
      )
      let nextView: AppView | undefined

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextView = topNavigationItems[Math.min(currentIndex + 1, topNavigationItems.length - 1)]?.value
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextView = topNavigationItems[Math.max(currentIndex - 1, 0)]?.value
      }

      if (event.key === 'Home') {
        nextView = topNavigationItems[0]?.value
      }

      if (event.key === 'End') {
        nextView = topNavigationItems.at(-1)?.value
      }

      if (nextView) {
        event.preventDefault()
        handleViewChange(nextView)
      }
    },
    [handleViewChange, view],
  )

  useEffect(() => {
    function updateViewportSize() {
      setViewportSize(getViewportSize())
    }

    window.addEventListener('resize', updateViewportSize)

    return () => {
      window.removeEventListener('resize', updateViewportSize)
    }
  }, [])

  useEffect(() => {
    for (const item of topNavigationItems) {
      document.body.classList.toggle(`is-${item.value}-view`, view === item.value)
    }

    return () => {
      for (const item of topNavigationItems) {
        document.body.classList.remove(`is-${item.value}-view`)
      }
    }
  }, [view])

  useEffect(() => {
    if (!isSettingsOpen) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsSettingsOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSettingsOpen])

  useLayoutEffect(() => {
    const tabsElement = topNavigationTabsRef.current
    const activeButton = topNavigationButtonRefs.current[view]

    if (!tabsElement || !activeButton) return

    const tabsRect = tabsElement.getBoundingClientRect()
    const activeRect = activeButton.getBoundingClientRect()

    setTopNavigationThumb({
      left: activeRect.left - tabsRect.left,
      width: activeRect.width,
    })
    setTopNavigationTabsWidth(tabsRect.width)
  }, [navigationStyle, view, viewportSize])

  const dataPanelWidth = calculateUnifiedDataPanelWidth({
    view,
    viewportSize,
  })
  const rightPanelWidth = dataPanelWidth
  const secondaryNavItems = secondaryNavItemsByView[view]
  const activeSecondaryNavId = secondaryNavSelection[view]
  const activeSecondaryNavItem = secondaryNavItems.find((item) => item.id === activeSecondaryNavId)
    ?? secondaryNavItems[0]
  const mapMetricItems = useMemo<TimeContextMetricItem[]>(() => [
    { label: '足迹总数', value: formatMetricCount(footprintMetrics.selectedCount) },
    { label: '总距离', value: formatDistanceMeters(footprintMetrics.totalDistanceMeters) },
    { label: '日均距离', value: formatAverageDistanceMeters(footprintMetrics.averageDistanceMetersPerDay) },
    { label: '范围天数', value: `${countElapsedInclusiveDays(selectedTimeRange)} 天` },
  ], [
    footprintMetrics.averageDistanceMetersPerDay,
    footprintMetrics.selectedCount,
    footprintMetrics.totalDistanceMeters,
    selectedTimeRange,
  ])
  const selectedMapStyle = useMemo(() => resolveMapStyleOption(mapStyle), [mapStyle])

  return (
    <main
      className={`app-shell app-shell--${view} app-shell--theme-${appTheme}${dataPanelWidth > 0 ? ' has-data-panel' : ''}`}
      style={{
        '--data-panel-width': `${dataPanelWidth}px`,
        '--right-panel-width': `${rightPanelWidth}px`,
        '--glass-panel-opacity': formatGlassPanelOpacity(glassPanelOpacity),
      } as CSSProperties}
    >
      <div className="app-board">
      <nav
        className={`glass-panel glass-panel--solid glass-panel--pill app-nav app-nav--${navigationStyle}`}
        aria-label="主导航"
      >
        <div
          ref={topNavigationTabsRef}
          className={`app-nav__tabs${isTopNavigationDragging ? ' is-dragging' : ''}`}
          role="group"
          aria-label="页面"
          style={
            {
              '--top-nav-thumb-left': `${topNavigationThumb.left}px`,
              '--top-nav-thumb-width': `${topNavigationThumb.width}px`,
              '--top-nav-tabs-width': `${topNavigationTabsWidth}px`,
              ...(topNavigationPreviewThumb
                ? {
                    '--top-nav-thumb-preview-left': `${topNavigationPreviewThumb.left}px`,
                    '--top-nav-thumb-preview-width': `${topNavigationPreviewThumb.width}px`,
                  }
                : {}),
            } as CSSProperties
          }
          onPointerMove={handleTopNavigationPointerMove}
          onPointerUp={endTopNavigationDrag}
          onPointerCancel={endTopNavigationDrag}
        >
          <span
            className={`app-nav__thumb${isTopNavigationDragging ? ' is-dragging' : ''}`}
            role="slider"
            tabIndex={0}
            aria-label="页面滑块"
            aria-valuemin={0}
            aria-valuemax={topNavigationItems.length - 1}
            aria-valuenow={Math.max(
              topNavigationItems.findIndex((item) => item.value === view),
              0,
            )}
            aria-valuetext={topNavigationItems.find((item) => item.value === view)?.label}
            onPointerDown={handleTopNavigationPointerDown}
            onKeyDown={handleTopNavigationKeyDown}
          >
            <span className="app-nav__active-items" aria-hidden="true">
              {topNavigationItems.map((item) => (
                <span
                  className={[
                    'app-nav__active-item',
                    `app-nav__active-item--${item.kind}`,
                    item.kind === 'page' ? `app-nav__active-item--${navigationStyle}` : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={item.value}
                >
                  <TopNavigationContent item={item} navigationStyle={navigationStyle} />
                </span>
              ))}
            </span>
          </span>
          {topNavigationItems.map((item) => (
            <TopNavigationButton
              key={item.value}
              item={item}
              buttonRef={(element) => {
                topNavigationButtonRefs.current[item.value] = element
              }}
              isActive={item.value === view}
              navigationStyle={navigationStyle}
              onSelect={handleViewChange}
            />
          ))}
        </div>
      </nav>

      <TimeContextPanel
        metricItems={view === 'map' ? mapMetricItems : undefined}
        distanceSeries={view === 'map' ? footprintMetrics.distanceSeries : undefined}
        secondaryContextLabel={activeSecondaryNavItem?.label}
        view={view}
        selection={selectedTimeRange}
        onSelectionChange={setSelectedTimeRange}
      />

      <aside className="right-context-panel" aria-label="右侧上下文栏">
        <nav className="secondary-nav-rail" aria-label="二级导航">
          <div className="glass-panel glass-panel--solid glass-panel--pill secondary-nav-rail__items">
            {secondaryNavItems.map((item) => {
              const Icon = item.icon
              const isActive = item.id === activeSecondaryNavId

              return (
                <button
                  key={item.id}
                  type="button"
                  className={isActive ? 'secondary-nav-rail__button is-active' : 'secondary-nav-rail__button'}
                  aria-pressed={isActive}
                  title={item.label}
                  onClick={() =>
                    setSecondaryNavSelection((current) => ({
                      ...current,
                      [view]: item.id,
                    }))
                  }
                >
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              )
            })}
            <button
              type="button"
              className="right-context-settings-button"
              aria-label="打开设置"
              title="设置"
              onClick={() => {
                setSettingsPage(getSettingsPageForView(view))
                setIsSettingsOpen(true)
              }}
            >
              <Settings size={17} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
        </nav>
        <div className="right-context-panel__stack" aria-label="右侧信息面板">
          <section className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__summary" aria-label="当前分区摘要">
            <span className="right-context-panel__eyebrow">当前分区</span>
            <strong>{activeSecondaryNavItem?.label ?? '概览'}</strong>
            <p>{getRightContextSummary(view, activeSecondaryNavId)}</p>
          </section>
          <section className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__legend" aria-label="图层与状态">
            <span className="right-context-panel__eyebrow">
              {view === 'map' ? '图层与状态' : '工作区状态'}
            </span>
            <div className="right-context-panel__rows">
              {getRightContextRows(view, activeSecondaryNavId, footprintMetrics).map((row) => (
                <div className="right-context-panel__row" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
            {view === 'map' && activeSecondaryNavId === 'regions' ? (
              <AdminRegionDepthControl
                depth={adminRegionDepth}
                activeOnly={adminRegionActiveOnly}
                onDepthChange={setAdminRegionDepth}
                onActiveOnlyChange={setAdminRegionActiveOnly}
              />
            ) : null}
          </section>
        </div>
      </aside>

      {view === 'map' ? (
        <Suspense fallback={<MapLoadingFallback />}>
          <LazyMapboxCanvas
            timeRange={selectedTimeRange}
            onFootprintMetricsChange={setFootprintMetrics}
            adminRegionUnlockEnabled={activeSecondaryNavId === 'regions'}
            adminRegionActiveOnly={adminRegionActiveOnly}
            adminRegionDepth={adminRegionDepth}
            debugPanelVisible={isMapDebugPanelVisible}
            placeLabelsVisible={areMapPlaceLabelsVisible}
            adminBoundariesVisible={areMapAdminBoundariesVisible}
            adminRegionLinesVisible={areAdminRegionLinesVisible}
            onPlaceLabelsVisibleChange={handleMapPlaceLabelsVisibleChange}
            onAdminBoundariesVisibleChange={handleMapAdminBoundariesVisibleChange}
            onAdminRegionLinesVisibleChange={handleAdminRegionLinesVisibleChange}
            projection={mapProjection}
            styleUrl={selectedMapStyle.url}
            language={mapLanguage === 'auto' ? undefined : mapLanguage}
            mapStyle={mapStyle}
            mapLanguage={mapLanguage}
            onMapStyleChange={handleMapStyleChange}
            onMapProjectionChange={handleMapProjectionChange}
            onMapLanguageChange={handleMapLanguageChange}
          />
        </Suspense>
      ) : view === 'accounting' ? (
        <section className="main-workspace" aria-label="在途 EnRoute 主工作区">
          <Suspense fallback={null}>
            <LazyAccountingPage
              section={activeSecondaryNavId === 'stats' ? 'analytics' : 'workspace'}
              timeRange={selectedTimeRange}
              onSectionChange={(nextSection) =>
                setSecondaryNavSelection((current) => ({
                  ...current,
                  accounting: nextSection === 'analytics' ? 'stats' : 'ledger',
                }))
              }
            />
          </Suspense>
        </section>
      ) : (
        <PlaceholderWorkspace view={view} />
      )}

      </div>

      {isSettingsOpen ? (
        <div className="settings-dialog">
          <button
            type="button"
            className="settings-dialog__backdrop"
            aria-label="关闭设置"
            onClick={() => setIsSettingsOpen(false)}
          />
          <section
            className="glass-panel glass-panel--solid glass-panel--compact settings-dialog__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
          >
            <header className="settings-dialog__header">
              <div>
                <span>应用偏好</span>
                <h2 id="settings-dialog-title">设置</h2>
              </div>
              <button
                type="button"
                className="settings-dialog__close"
                aria-label="关闭设置"
                onClick={() => setIsSettingsOpen(false)}
              >
                <X size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </header>
            <div className="settings-dialog__body">
              <nav className="settings-dialog__tabs" aria-label="设置分页">
                {settingsPageItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      item.id === settingsPage
                        ? 'settings-dialog__tab is-active'
                        : 'settings-dialog__tab'
                    }
                    aria-pressed={item.id === settingsPage}
                    onClick={() => setSettingsPage(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <div className="settings-dialog__content">
                {settingsPage === 'general' ? (
                  <>
                    <section className="settings-dialog__section" aria-label="顶部导航样式">
                      <span>顶部导航样式</span>
                      <SegmentedControl
                        ariaLabel="顶部导航样式"
                        className="settings-navigation-tabs"
                        options={navigationStyleOptions}
                        value={navigationStyle}
                        onChange={handleNavigationStyleChange}
                      />
                    </section>
                    <section className="settings-dialog__section" aria-label="界面色调">
                      <span>界面色调</span>
                      <div className="settings-theme-options" role="group" aria-label="界面色调">
                        {appThemeOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={
                              option.value === appTheme
                                ? 'settings-theme-option is-active'
                                : 'settings-theme-option'
                            }
                            aria-pressed={option.value === appTheme}
                            onClick={() => handleAppThemeChange(option.value)}
                          >
                            <span className="settings-theme-option__swatches" aria-hidden="true">
                              {option.swatches.map((color) => (
                                <span
                                  key={color}
                                  className="settings-theme-option__swatch"
                                  style={{ '--theme-swatch-color': color } as CSSProperties}
                                />
                              ))}
                            </span>
                            <span className="settings-theme-option__label">{option.label}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="settings-dialog__section" aria-label="玻璃面板透明程度设置">
                      <span>磨砂玻璃透明程度</span>
                      <label className="settings-range-row">
                        <input
                          type="range"
                          aria-label="磨砂玻璃透明程度"
                          min={GLASS_PANEL_OPACITY_MIN}
                          max={GLASS_PANEL_OPACITY_MAX}
                          step={GLASS_PANEL_OPACITY_STEP}
                          value={formatGlassPanelOpacity(glassPanelOpacity)}
                          onChange={(event) =>
                            handleGlassPanelOpacityChange(event.currentTarget.value)
                          }
                        />
                        <span className="settings-range-row__value">
                          {formatGlassPanelOpacity(glassPanelOpacity)}
                        </span>
                      </label>
                    </section>
                  </>
                ) : null}
                {settingsPage === 'map' ? (
                  <section className="settings-dialog__section" aria-label="地图显示">
                    <span>地图显示</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isMapDebugPanelVisible}
                      className={
                        isMapDebugPanelVisible
                          ? 'settings-switch-row is-active'
                          : 'settings-switch-row'
                      }
                      onClick={() =>
                        handleMapDebugPanelVisibleChange(!isMapDebugPanelVisible)
                      }
                    >
                      <span>显示地图统计浮窗</span>
                      <span className="settings-switch-row__control" aria-hidden="true" />
                    </button>
                  </section>
                ) : null}
                {settingsPage === 'accounting' ? (
                  <section className="settings-dialog__section" aria-label="记账设置">
                    <span>记账设置</span>
                    <p className="settings-dialog__empty">暂无可配置项</p>
                  </section>
                ) : null}
                {settingsPage === 'schedule' ? (
                  <section className="settings-dialog__section" aria-label="日程设置">
                    <span>日程设置</span>
                    <p className="settings-dialog__empty">暂无可配置项</p>
                  </section>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App

function AdminRegionDepthControl({
  depth,
  activeOnly,
  onDepthChange,
  onActiveOnlyChange,
}: {
  depth: AdminRegionDepth
  activeOnly: boolean
  onDepthChange: (depth: AdminRegionDepth) => void
  onActiveOnlyChange: (activeOnly: boolean) => void
}) {
  return (
    <div className="admin-region-control-panel">
      <div className="right-context-panel__depth-control admin-region-depth-control" role="group" aria-label="行政区划层级">
        {adminRegionDepthOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === depth}
            onClick={() => onDepthChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activeOnly}
        className={
          activeOnly
            ? 'settings-switch-row admin-region-active-filter-switch is-active'
            : 'settings-switch-row admin-region-active-filter-switch'
        }
        onClick={() => onActiveOnlyChange(!activeOnly)}
      >
        <span>仅显示当前时间有足迹的区域</span>
        <span className="settings-switch-row__control" aria-hidden="true" />
      </button>
    </div>
  )
}

function timeSelectionsAreEqual(
  currentSelection: TimeRangeSelection,
  nextSelection: TimeRangeSelection,
) {
  return (
    currentSelection.mode === nextSelection.mode &&
    currentSelection.start === nextSelection.start &&
    currentSelection.end === nextSelection.end &&
    currentSelection.anchorDate === nextSelection.anchorDate &&
    currentSelection.label === nextSelection.label
  )
}

function getRightContextSummary(view: AppView, activeSecondaryNavId: SecondaryNavId) {
  if (view === 'map') {
    if (activeSecondaryNavId === 'regions') return '行政区划查看与解锁状态集中在这里，地图中心保持最大可视面积。'
    if (activeSecondaryNavId === 'stats') return '当前时间范围内的位置统计会以轻量信息面板承载。'

    return '足迹点与轨迹作为主图层显示，右侧只保留辅助状态与筛选入口。'
  }

  if (view === 'accounting') {
    if (activeSecondaryNavId === 'stats') return '记账统计占用中间工作区，右侧保留切换和状态摘要。'

    return '流水录入与账户分析在中间展开，右侧不再形成整块大侧栏。'
  }

  return '该页面沿用同一套全局三栏壳层，后续内容可以按分区逐步接入。'
}

function getRightContextRows(
  view: AppView,
  activeSecondaryNavId: SecondaryNavId,
  footprintMetrics: FootprintMetrics,
): RightContextRow[] {
  if (view === 'map') {
    return [
      {
        label: activeSecondaryNavId === 'regions' ? '区划面' : '足迹点',
        value: activeSecondaryNavId === 'regions'
          ? '按需解锁'
          : formatMetricCount(footprintMetrics.selectedCount),
      },
      {
        label: '距离',
        value: formatDistanceMeters(footprintMetrics.totalDistanceMeters),
      },
      {
        label: '渲染方式',
        value: activeSecondaryNavId === 'regions' ? '边界层' : 'WebGL 点层',
      },
    ]
  }

  if (view === 'accounting') {
    return [
      { label: '模式', value: activeSecondaryNavId === 'stats' ? '统计' : '流水' },
      { label: '范围', value: '跟随左侧' },
      { label: '状态', value: '本地原型' },
    ]
  }

  return [
    { label: '布局', value: '三栏固定' },
    { label: '左栏', value: '时间范围' },
    { label: '右栏', value: '辅助面板' },
  ]
}

function TopNavigationButton({
  item,
  buttonRef,
  isActive,
  navigationStyle,
  onSelect,
}: {
  item: TopNavigationItem
  buttonRef: (element: HTMLButtonElement | null) => void
  isActive: boolean
  navigationStyle: NavigationStyle
  onSelect: (view: AppView) => void
}) {
  const buttonClassName = [
    'app-nav__button',
    `app-nav__button--${item.kind}`,
    item.kind === 'page' ? `app-nav__button--${navigationStyle}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={buttonRef}
      type="button"
      className={buttonClassName}
      aria-label={item.label}
      aria-pressed={isActive}
      title={item.label}
      onClick={() => onSelect(item.value)}
    >
      <TopNavigationContent item={item} navigationStyle={navigationStyle} />
    </button>
  )
}

function TopNavigationContent({
  item,
  navigationStyle,
}: {
  item: TopNavigationItem
  navigationStyle: NavigationStyle
}) {
  const Icon = item.icon

  if (item.kind === 'brand') {
    return (
      <>
        <span>在途</span>
        <span>EnRoute</span>
      </>
    )
  }

  return (
    <>
      {Icon ? <Icon size={18} strokeWidth={1.9} aria-hidden="true" /> : null}
      {navigationStyle === 'mixed' ? (
        <span className="app-nav__label">{item.label}</span>
      ) : null}
    </>
  )
}

function PlaceholderWorkspace({ view }: { view: Exclude<AppView, 'map' | 'accounting'> }) {
  const label = view === 'overview'
    ? '在途 EnRoute 概览工作区'
    : '在途 EnRoute 日程工作区'
  const title = view === 'overview' ? '概览' : '日程'

  return (
    <section className="main-workspace main-workspace--placeholder" aria-label={label}>
      <div className="workspace-placeholder">
        <span>在途 EnRoute</span>
        <h1>{title}</h1>
      </div>
    </section>
  )
}

function MapLoadingFallback() {
  return (
    <section
      className="map-stage map-stage--loading"
      aria-label="在途 EnRoute 地图工作区"
    />
  )
}
