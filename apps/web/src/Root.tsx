import { lazy, Suspense } from 'react'

import App from './App'
import { resolveAmapBoundaryPreviewMode } from './amapBoundaryPreviewMode'
import { getAmapConfig } from './config/amap'

const LazyAmapBoundaryPreview = lazy(() => import('./components/AmapBoundaryPreview').then((module) => ({
  default: module.AmapBoundaryPreview,
})))
const LazyMapboxAmapBoundaryPreview = lazy(() => import('./components/MapboxAmapBoundaryPreview').then((module) => ({
  default: module.MapboxAmapBoundaryPreview,
})))

export function Root() {
  const amapBoundaryPreviewMode = resolveAmapBoundaryPreviewMode(window.location.search)

  return (
    <Suspense fallback={null}>
      {amapBoundaryPreviewMode === 'amap' ? (
        <LazyAmapBoundaryPreview config={getAmapConfig()} />
      ) : amapBoundaryPreviewMode === 'mapbox' ? (
        <LazyMapboxAmapBoundaryPreview amapConfig={getAmapConfig()} />
      ) : (
        <App />
      )}
    </Suspense>
  )
}
