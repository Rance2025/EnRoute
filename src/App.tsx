import './App.css'

import { useEffect, useState } from 'react'

import { getAmapConfig, type AmapConfig } from './config/amap'
import { AmapCanvas } from './components/AmapCanvas'
import { AccountingPage } from './components/AccountingPage'

type AppProps = {
  amapConfig?: AmapConfig
}

type AppView = 'map' | 'accounting'

function App({ amapConfig = getAmapConfig() }: AppProps) {
  const [view, setView] = useState<AppView>('map')

  useEffect(() => {
    document.body.classList.toggle('is-map-view', view === 'map')
    document.body.classList.toggle('is-accounting-view', view === 'accounting')

    return () => {
      document.body.classList.remove('is-map-view', 'is-accounting-view')
    }
  }, [view])

  return (
    <main className={`app-shell app-shell--${view}`}>
      <nav className="app-nav" aria-label="主导航">
        <div className="app-nav__brand" aria-label="在途 EnRoute">
          <span>在途</span>
          <span>EnRoute</span>
        </div>
        <div className="app-nav__tabs" role="group" aria-label="页面">
          <button
            type="button"
            aria-pressed={view === 'map'}
            onClick={() => setView('map')}
          >
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

      {view === 'map' ? <AmapCanvas config={amapConfig} /> : <AccountingPage />}
    </main>
  )
}

export default App
