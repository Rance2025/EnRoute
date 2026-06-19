import type { CSSProperties } from 'react'
import { useId, useState } from 'react'
import { Crosshair, LocateFixed, Minus, Plus, Settings2 } from 'lucide-react'

export type FootprintStyle = {
  pixelSize: number
  color: string
}

type MapControlsProps = {
  onLocate: () => void
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  footprintStyle: FootprintStyle
  onFootprintStyleChange: (style: FootprintStyle) => void
}

const FOOTPRINT_COLOR_SWATCHES = ['#123f35', '#4f7cff', '#b8544c']
const MAX_FOOTPRINT_PIXEL_SIZE = 5
const MIN_FOOTPRINT_PIXEL_SIZE = 1
const FOOTPRINT_PIXEL_SIZE_PRECISION = 10
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

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
  const colorInputId = useId()

  function updatePixelSize(value: string) {
    const nextPixelSize = Number.parseFloat(value)
    if (!Number.isFinite(nextPixelSize)) return

    onFootprintStyleChange({
      ...footprintStyle,
      pixelSize: normalizePixelSize(nextPixelSize),
    })
  }

  function updateColor(color: string) {
    if (!HEX_COLOR_PATTERN.test(color)) return

    onFootprintStyleChange({
      ...footprintStyle,
      color: color.toLowerCase(),
    })
  }

  return (
    <div className="map-toolbar" aria-label="地图工具">
      {isFootprintStyleOpen ? (
        <div className="footprint-style-popover" role="dialog" aria-label="足迹显示设置">
          <div className="footprint-style-popover__row">
            <label htmlFor={sizeInputId}>足迹点大小</label>
            <input
              className="footprint-style-popover__number"
              type="number"
              aria-label="足迹点大小数值"
              min="1"
              max="5"
              step="0.1"
              value={footprintStyle.pixelSize}
              onChange={(event) => updatePixelSize(event.target.value)}
            />
            <input
              id={sizeInputId}
              type="range"
              min="1"
              max="5"
              step="0.1"
              value={footprintStyle.pixelSize}
              onChange={(event) => updatePixelSize(event.target.value)}
            />
          </div>
          <div className="footprint-style-popover__row">
            <label htmlFor={colorInputId}>足迹点颜色</label>
            <input
              id={colorInputId}
              type="color"
              value={footprintStyle.color}
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

function normalizePixelSize(pixelSize: number) {
  const clampedPixelSize = Math.min(
    Math.max(pixelSize, MIN_FOOTPRINT_PIXEL_SIZE),
    MAX_FOOTPRINT_PIXEL_SIZE,
  )

  return Math.round(clampedPixelSize * FOOTPRINT_PIXEL_SIZE_PRECISION) /
    FOOTPRINT_PIXEL_SIZE_PRECISION
}
