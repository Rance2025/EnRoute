import { Crosshair, LocateFixed, Minus, Plus } from 'lucide-react'

type MapControlsProps = {
  onLocate: () => void
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function MapControls({
  onLocate,
  onReset,
  onZoomIn,
  onZoomOut,
}: MapControlsProps) {
  return (
    <div className="map-toolbar" aria-label="地图工具">
      <button type="button" aria-label="定位当前位置" title="定位当前位置" onClick={onLocate}>
        <LocateFixed size={18} strokeWidth={1.8} />
      </button>
      <button type="button" aria-label="重置视角" title="重置视角" onClick={onReset}>
        <Crosshair size={18} strokeWidth={1.8} />
      </button>
      <button type="button" aria-label="放大地图" title="放大地图" onClick={onZoomIn}>
        <Plus size={18} strokeWidth={1.8} />
      </button>
      <button type="button" aria-label="缩小地图" title="缩小地图" onClick={onZoomOut}>
        <Minus size={18} strokeWidth={1.8} />
      </button>
    </div>
  )
}
