import './App.css'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { AccountingPage } from './components/AccountingPage'
import { AmapCanvas } from './components/AmapCanvas'
import { SegmentedControl, type SegmentedOption } from './components/SegmentedControl'
import { TimeContextPanel } from './components/TimeContextPanel'
import { getAmapConfig, type AmapConfig } from './config/amap'
import { calculateFallbackSingleWorldPaneLayout } from './config/mapPaneLayout'
import {
  createTodaySelection,
  type CalendarDisplayMode,
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
  const [calendarMode, setCalendarMode] = useState<CalendarDisplayMode>('week')
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
          onChange={setView}
        />
      </nav>

      <TimeContextPanel
        view={view}
        selection={selectedTimeRange}
        calendarMode={calendarMode}
        onCalendarModeChange={setCalendarMode}
        onSelectionChange={setSelectedTimeRange}
      />

      {view === 'map' ? (
        <AmapCanvas config={resolvedAmapConfig} onPanelWidthChange={handlePanelWidthChange} />
      ) : (
        <section className="main-workspace" aria-label="在途 EnRoute 主工作区">
          <AccountingPage timeRange={selectedTimeRange} />
        </section>
      )}
    </main>
  )
}

export default App
