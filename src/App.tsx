import './App.css'

import { useCallback, useMemo, useState, type CSSProperties } from 'react'

import { getAmapConfig, type AmapConfig } from './config/amap'
import { AmapCanvas } from './components/AmapCanvas'

type AppProps = {
  amapConfig?: AmapConfig
}

function App({ amapConfig }: AppProps) {
  const resolvedAmapConfig = useMemo(() => amapConfig ?? getAmapConfig(), [amapConfig])
  const [panelWidth, setPanelWidth] = useState(0)
  const handlePanelWidthChange = useCallback((width: number) => {
    setPanelWidth(width)
  }, [])

  return (
    <main
      className={`app-shell${panelWidth > 0 ? ' has-data-panel' : ''}`}
      style={{ '--data-panel-width': `${panelWidth}px` } as CSSProperties}
    >
      <aside className="data-panel" aria-label="在途 EnRoute 数据面板" />
      <AmapCanvas config={resolvedAmapConfig} onPanelWidthChange={handlePanelWidthChange} />
    </main>
  )
}

export default App
