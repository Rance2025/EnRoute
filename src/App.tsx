import './App.css'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { AccountingPage } from './components/AccountingPage'
import { AmapCanvas, type FootprintMetrics } from './components/AmapCanvas'
import {
  formatAverageDistanceMeters,
  formatDistanceMeters,
  formatMetricCount,
} from './components/mapMetricFormat'
import { SegmentedControl, type SegmentedOption } from './components/SegmentedControl'
import { TimeContextPanel, type TimeContextMetricItem } from './components/TimeContextPanel'
import { getAmapConfig, type AmapConfig } from './config/amap'
import { calculateFallbackSingleWorldPaneLayout } from './config/mapPaneLayout'
import {
  createCurrentSelection,
  createTodaySelection,
  type TimeRangeSelection,
} from './time/timeRange'

type AppProps = {
  amapConfig?: AmapConfig
}

export type AppView = 'overview' | 'map' | 'schedule' | 'accounting'

const viewOptions: Array<SegmentedOption<AppView>> = [
  { value: 'overview', label: '概览', disabled: true },
  { value: 'map', label: '地图' },
  { value: 'schedule', label: '日程', disabled: true },
  { value: 'accounting', label: '记账' },
]

function calculateUnifiedPanelFallbackWidth(viewportWidth: number) {
  return Math.round(Math.min(Math.max(viewportWidth * 0.26, 320), 420))
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
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRangeSelection>(
    createTodaySelection,
  )
  const [footprintMetrics, setFootprintMetrics] = useState<FootprintMetrics>({
    selectedCount: 0,
    totalDistanceMeters: 0,
    averageDistanceMetersPerDay: 0,
  })
  const [mapPanelWidth, setMapPanelWidth] = useState(0)
  const [viewportSize, setViewportSize] = useState(getViewportSize)
  const fallbackLayout = useMemo(
    () =>
      calculateFallbackSingleWorldPaneLayout({
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
      }),
    [viewportSize.height, viewportSize.width],
  )
  const handlePanelWidthChange = useCallback((width: number) => {
    setMapPanelWidth(width)
  }, [])
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

  const measuredDataPanelWidth = Math.max(mapPanelWidth, fallbackLayout.sidePanelWidth)
  const dataPanelWidth =
    view === 'map'
      ? measuredDataPanelWidth
      : Math.max(measuredDataPanelWidth, calculateUnifiedPanelFallbackWidth(viewportSize.width))
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
        view={view}
        selection={selectedTimeRange}
        onSelectionChange={setSelectedTimeRange}
      />

      {view === 'map' ? (
        <AmapCanvas
          config={resolvedAmapConfig}
          timeRange={selectedTimeRange}
          onFootprintMetricsChange={setFootprintMetrics}
          onPanelWidthChange={handlePanelWidthChange}
        />
      ) : (
        <section className="main-workspace" aria-label="在途 EnRoute 主工作区">
          <AccountingPage timeRange={selectedTimeRange} />
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
