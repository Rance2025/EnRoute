import './App.css'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { AccountingPage } from './components/AccountingPage'
import { AmapCanvas } from './components/AmapCanvas'
import { TimeContextPanel } from './components/TimeContextPanel'
import { getAmapConfig, type AmapConfig } from './config/amap'
import { calculateFallbackSingleWorldPaneLayout } from './config/mapPaneLayout'

type AppProps = {
  amapConfig?: AmapConfig
}

export type AppView = 'overview' | 'map' | 'schedule' | 'accounting'

type ViewOption = {
  view: AppView
  label: string
  enabled: boolean
}

const viewOptions: ViewOption[] = [
  { view: 'overview', label: '概览', enabled: false },
  { view: 'map', label: '地图', enabled: true },
  { view: 'schedule', label: '日程', enabled: false },
  { view: 'accounting', label: '记账', enabled: true },
]

function getViewportSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

function App({ amapConfig }: AppProps) {
  const resolvedAmapConfig = useMemo(() => amapConfig ?? getAmapConfig(), [amapConfig])
  const [view, setView] = useState<AppView>('map')
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
      document.body.classList.toggle(`is-${option.view}-view`, view === option.view)
    }

    return () => {
      for (const option of viewOptions) {
        document.body.classList.remove(`is-${option.view}-view`)
      }
    }
  }, [view])

  const dataPanelWidth = Math.max(mapPanelWidth, fallbackLayout.sidePanelWidth)

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
        <div className="app-nav__tabs" role="group" aria-label="页面">
          {viewOptions.map((option) => (
            <button
              type="button"
              key={option.view}
              aria-pressed={view === option.view}
              disabled={!option.enabled}
              onClick={() => {
                if (option.enabled) {
                  setView(option.view)
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </nav>

      <TimeContextPanel view={view} />

      {view === 'map' ? (
        <AmapCanvas config={resolvedAmapConfig} onPanelWidthChange={handlePanelWidthChange} />
      ) : (
        <section className="main-workspace" aria-label="在途 EnRoute 主工作区">
          <AccountingPage />
        </section>
      )}
    </main>
  )
}

export default App
