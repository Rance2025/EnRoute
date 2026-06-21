import './App.css'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  BarChart3,
  CalendarDays,
  Footprints,
  List,
  MapPinned,
  Shapes,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'

import { AccountingPage } from './components/AccountingPage'
import { AmapCanvas, type FootprintMetrics } from './components/AmapCanvas'
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
import { getAmapConfig, type AmapConfig } from './config/amap'
import {
  readNavigationStyle,
  writeNavigationStyle,
  type NavigationStyle,
} from './navigationPreferences'
import {
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

function getViewportSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

function App({ amapConfig }: AppProps) {
  const resolvedAmapConfig = useMemo(() => amapConfig ?? getAmapConfig(), [amapConfig])
  const topNavigationTabsRef = useRef<HTMLDivElement | null>(null)
  const topNavigationButtonRefs = useRef<Record<AppView, HTMLButtonElement | null>>({
    overview: null,
    map: null,
    accounting: null,
    schedule: null,
  })
  const [view, setView] = useState<AppView>('map')
  const [navigationStyle, setNavigationStyle] = useState<NavigationStyle>(readNavigationStyle)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [topNavigationThumb, setTopNavigationThumb] = useState<TopNavigationThumbMetrics>({
    left: 0,
    width: 0,
  })
  const [secondaryNavSelection, setSecondaryNavSelection] = useState<SecondaryNavSelection>(
    defaultSecondaryNavSelection,
  )
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRangeSelection>(
    createTodaySelection,
  )
  const [footprintMetrics, setFootprintMetrics] = useState<FootprintMetrics>({
    selectedCount: 0,
    totalDistanceMeters: 0,
    averageDistanceMetersPerDay: 0,
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
  }, [navigationStyle, view, viewportSize])

  const dataPanelWidth = calculateUnifiedDataPanelWidth({
    view,
    viewportSize,
  })
  const secondaryNavItems = secondaryNavItemsByView[view]
  const activeSecondaryNavId = secondaryNavSelection[view]
  const activeSecondaryNavItem = secondaryNavItems.find((item) => item.id === activeSecondaryNavId)
    ?? secondaryNavItems[0]
  const mapMetricItems = useMemo<TimeContextMetricItem[]>(() => [
    { label: '足迹总数', value: formatMetricCount(footprintMetrics.selectedCount) },
    { label: '总距离', value: formatDistanceMeters(footprintMetrics.totalDistanceMeters) },
    { label: '日均距离', value: formatAverageDistanceMeters(footprintMetrics.averageDistanceMetersPerDay) },
  ], [
    footprintMetrics.averageDistanceMetersPerDay,
    footprintMetrics.selectedCount,
    footprintMetrics.totalDistanceMeters,
  ])

  return (
    <main
      className={`app-shell app-shell--${view}${dataPanelWidth > 0 ? ' has-data-panel' : ''}`}
      style={{ '--data-panel-width': `${dataPanelWidth}px` } as CSSProperties}
    >
      <nav
        className={`app-nav app-nav--${navigationStyle}`}
        aria-label="主导航"
        style={
          {
            '--top-nav-thumb-left': `${topNavigationThumb.left}px`,
            '--top-nav-thumb-width': `${topNavigationThumb.width}px`,
          } as CSSProperties
        }
      >
        <div ref={topNavigationTabsRef} className="app-nav__tabs" role="group" aria-label="页面">
          <span className="app-nav__thumb" aria-hidden="true" />
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
        secondaryContextLabel={activeSecondaryNavItem?.label}
        view={view}
        selection={selectedTimeRange}
        onSelectionChange={setSelectedTimeRange}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <nav className="secondary-nav-rail" aria-label="二级导航">
        <div className="secondary-nav-rail__items">
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
                <Icon size={18} strokeWidth={1.85} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {view === 'map' ? (
        <AmapCanvas
          config={resolvedAmapConfig}
          timeRange={selectedTimeRange}
          onFootprintMetricsChange={setFootprintMetrics}
          adminRegionUnlockEnabled={activeSecondaryNavId === 'regions'}
        />
      ) : view === 'accounting' ? (
        <section className="main-workspace" aria-label="在途 EnRoute 主工作区">
          <AccountingPage
            section={activeSecondaryNavId === 'stats' ? 'analytics' : 'workspace'}
            timeRange={selectedTimeRange}
            onSectionChange={(nextSection) =>
              setSecondaryNavSelection((current) => ({
                ...current,
                accounting: nextSection === 'analytics' ? 'stats' : 'ledger',
              }))
            }
          />
        </section>
      ) : (
        <PlaceholderWorkspace view={view} />
      )}

      {isSettingsOpen ? (
        <div className="settings-dialog">
          <button
            type="button"
            className="settings-dialog__backdrop"
            aria-label="关闭设置"
            onClick={() => setIsSettingsOpen(false)}
          />
          <section
            className="settings-dialog__panel"
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
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App

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
  const Icon = item.icon
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
      {item.kind === 'brand' ? (
        <>
          <span>在途</span>
          <span>EnRoute</span>
        </>
      ) : (
        <>
          {Icon ? <Icon size={18} strokeWidth={1.9} aria-hidden="true" /> : null}
          {navigationStyle === 'mixed' ? (
            <span className="app-nav__label">{item.label}</span>
          ) : null}
        </>
      )}
    </button>
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
