import './App.css'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  BarChart3,
  Footprints,
  List,
  Shapes,
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

const viewOptions: Array<SegmentedOption<AppView>> = [
  { value: 'overview', label: '概览', disabled: true },
  { value: 'map', label: '地图' },
  { value: 'schedule', label: '日程', disabled: true },
  { value: 'accounting', label: '记账' },
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
  const [view, setView] = useState<AppView>('map')
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
    for (const option of viewOptions) {
      document.body.classList.toggle(`is-${option.value}-view`, view === option.value)
    }

    return () => {
      for (const option of viewOptions) {
        document.body.classList.remove(`is-${option.value}-view`)
      }
    }
  }, [view])

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
      <nav className="app-nav" aria-label="主导航">
        <div className="app-nav__brand" aria-label="在途 EnRoute">
          <span>在途</span>
          <span>EnRoute</span>
        </div>
        <SegmentedControl
          ariaLabel="页面"
          className="app-nav__tabs"
          options={viewOptions}
          value={view}
          onChange={handleViewChange}
        />
      </nav>

      <TimeContextPanel
        metricItems={view === 'map' ? mapMetricItems : undefined}
        secondaryContextLabel={activeSecondaryNavItem?.label}
        view={view}
        selection={selectedTimeRange}
        onSelectionChange={setSelectedTimeRange}
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
      ) : (
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
      )}
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
