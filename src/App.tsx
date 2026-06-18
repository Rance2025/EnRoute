import './App.css'

import { getAmapConfig, type AmapConfig } from './config/amap'
import { AmapCanvas } from './components/AmapCanvas'

type AppProps = {
  amapConfig?: AmapConfig
}

function App({ amapConfig = getAmapConfig() }: AppProps) {
  return (
    <main className="app-shell">
      <AmapCanvas config={amapConfig} />
    </main>
  )
}

export default App
