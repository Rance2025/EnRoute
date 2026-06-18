import './App.css'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { AccountingPage } from './components/AccountingPage'
import { AmapCanvas } from './components/AmapCanvas'
import { getAmapConfig, type AmapConfig } from './config/amap'

type AppProps = {
  amapConfig?: AmapConfig
}

type AppView = 'map' | 'accounting'

function App({ amapConfig }: AppProps) {
  const resolvedAmapConfig = useMemo(() => amapConfig ?? getAmapConfig(), [amapConfig])
  const [view, setView] = useState<AppView>('map')
  const [panelWidth, setPanelWidth] = useState(0)
  const handlePanelWidthChange = useCallback((width: number) => {
    setPanelWidth(width)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('is-map-view', view === 'map')
    document.body.classList.toggle('is-accounting-view', view === 'accounting')

    return () => {
      document.body.classList.remove('is-map-view', 'is-accounting-view')
    }
  }, [view])

  const dataPanelWidth = view === 'map' ? panelWidth : 0

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
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
            地图
          </button>
          <button
            type="button"
            aria-pressed={view === 'accounting'}
            onClick={() => setView('accounting')}
          >
            记账
          </button>
        </div>
      </nav>

      {view === 'map' ? (
        <>
          <aside className="data-panel" aria-label="在途 EnRoute 数据面板" />
          <AmapCanvas
            config={resolvedAmapConfig}
            onPanelWidthChange={handlePanelWidthChange}
          />
        </>
      ) : (
        <AccountingPage />
      )}
    </main>
  )
}

export default App
