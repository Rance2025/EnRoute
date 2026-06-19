import type { CSSProperties } from 'react'
import { useId, useState } from 'react'
import { Crosshair, LocateFixed, Minus, Plus, Settings2 } from 'lucide-react'
import {
  FOOTPRINT_OPACITY_MAX,
  FOOTPRINT_OPACITY_MIN,
  FOOTPRINT_OPACITY_STEP,
  FOOTPRINT_PIXEL_SIZE_MAX,
  FOOTPRINT_PIXEL_SIZE_MIN,
  FOOTPRINT_PIXEL_SIZE_STEP,
  normalizeFootprintColor,
  normalizeFootprintOpacity,
  normalizeFootprintPixelSize,
  type FootprintStyle,
} from '../layers/footprintStyle'

export type { FootprintStyle }

type MapControlsProps = {
  onLocate: () => void
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  footprintStyle: FootprintStyle
  onFootprintStyleChange: (style: FootprintStyle) => void
}

const FOOTPRINT_COLOR_SWATCHES = ['#123f35', '#4f7cff', '#b8544c']

export function MapControls({
  onLocate,
  onReset,
  onZoomIn,
  onZoomOut,
  footprintStyle,
  onFootprintStyleChange,
}: MapControlsProps) {
  const [isFootprintStyleOpen, setIsFootprintStyleOpen] = useState(false)
  const sizeInputId = useId()
  const opacityInputId = useId()
  const colorInputId = useId()

  function updatePixelSize(value: string) {
    const nextPixelSize = Number.parseFloat(value)
    if (!Number.isFinite(nextPixelSize)) return

    onFootprintStyleChange({
      ...footprintStyle,
      pixelSize: normalizeFootprintPixelSize(nextPixelSize),
    })
  }

  function updateColor(color: string) {
    const nextColor = normalizeFootprintColor(color)

    onFootprintStyleChange({
      ...footprintStyle,
      color: nextColor,
    })
  }

  function updateOpacity(value: string) {
    const nextOpacity = Number.parseFloat(value)
    if (!Number.isFinite(nextOpacity)) return

    onFootprintStyleChange({
      ...footprintStyle,
      opacity: normalizeFootprintOpacity(nextOpacity),
    })
  }

  return (
    <div className="map-toolbar" aria-label="地图工具">
      {isFootprintStyleOpen ? (
        <div className="footprint-style-popover" role="dialog" aria-label="足迹显示设置">
          <div className="footprint-style-popover__row">
            <label htmlFor={sizeInputId}>足迹点大小</label>
            <span className="footprint-style-popover__value">{footprintStyle.pixelSize}</span>
            <input
              id={sizeInputId}
              type="range"
              min={FOOTPRINT_PIXEL_SIZE_MIN}
              max={FOOTPRINT_PIXEL_SIZE_MAX}
              step={FOOTPRINT_PIXEL_SIZE_STEP}
              value={footprintStyle.pixelSize}
              onChange={(event) => updatePixelSize(event.target.value)}
            />
          </div>
          <div className="footprint-style-popover__row">
            <label htmlFor={opacityInputId}>足迹点透明度</label>
            <span className="footprint-style-popover__value">{footprintStyle.opacity}</span>
            <input
              id={opacityInputId}
              type="range"
              min={FOOTPRINT_OPACITY_MIN}
              max={FOOTPRINT_OPACITY_MAX}
              step={FOOTPRINT_OPACITY_STEP}
              value={footprintStyle.opacity}
              onChange={(event) => updateOpacity(event.target.value)}
            />
          </div>
          <div className="footprint-style-popover__row">
            <label htmlFor={colorInputId}>足迹点颜色</label>
            <input
              id={colorInputId}
              type="color"
              value={footprintStyle.color}
              style={{ '--footprint-color': footprintStyle.color } as CSSProperties}
              onChange={(event) => updateColor(event.target.value)}
            />
          </div>
          <div className="footprint-style-popover__swatches" aria-label="足迹点颜色预设">
            {FOOTPRINT_COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className="footprint-style-popover__swatch"
                aria-label={`选择足迹点颜色 ${color}`}
                title={color}
                style={{ '--swatch-color': color } as CSSProperties}
                onClick={() => updateColor(color)}
              />
            ))}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="足迹显示设置"
        title="足迹显示设置"
        aria-expanded={isFootprintStyleOpen}
        onClick={() => setIsFootprintStyleOpen((isOpen) => !isOpen)}
      >
        <Settings2 size={18} strokeWidth={1.8} />
      </button>
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
