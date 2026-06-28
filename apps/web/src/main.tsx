import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'mapbox-gl/dist/mapbox-gl.css'
import './index.css'
import App from './App.tsx'
import { shouldRenderAmapBoundaryPreview } from './amapBoundaryPreviewRouting.ts'
import { AmapBoundaryPreview } from './components/AmapBoundaryPreview.tsx'
import { getAmapConfig } from './config/amap.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shouldRenderAmapBoundaryPreview(window.location.search) ? (
      <AmapBoundaryPreview config={getAmapConfig()} />
    ) : (
      <App />
    )}
  </StrictMode>,
)
