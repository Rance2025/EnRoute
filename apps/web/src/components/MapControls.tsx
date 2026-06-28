import type { CSSProperties } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { Crosshair, Globe2, LocateFixed, Minus, Plus, Settings2 } from 'lucide-react'
import { MAP_STYLE_OPTIONS, type MapStylePreference } from '../mapStyleOptions'
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

type MapProjectionPreference = 'globe' | 'mercator'
type MapLanguagePreference = 'auto' | 'zh-Hans' | 'en'

type MapControlsProps = {
  onFitFootprints: () => void
  onLocate: () => void
  onShowWorld: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  footprintStyle: FootprintStyle
  onFootprintStyleChange: (style: FootprintStyle) => void
  placeLabelsVisible?: boolean
  adminBoundariesVisible?: boolean
  mapStyle?: MapStylePreference
  mapProjection?: MapProjectionPreference
  mapLanguage?: MapLanguagePreference
  onPlaceLabelsVisibleChange?: (visible: boolean) => void
  onAdminBoundariesVisibleChange?: (visible: boolean) => void
  onMapStyleChange?: (style: MapStylePreference) => void
  onMapProjectionChange?: (projection: MapProjectionPreference) => void
  onMapLanguageChange?: (language: MapLanguagePreference) => void
}

type FootprintStylePopoverProps = {
  footprintStyle: FootprintStyle
  onFootprintStyleChange: (style: FootprintStyle) => void
  placeLabelsVisible?: boolean
  adminBoundariesVisible?: boolean
  mapStyle?: MapStylePreference
  mapProjection?: MapProjectionPreference
  mapLanguage?: MapLanguagePreference
  onPlaceLabelsVisibleChange?: (visible: boolean) => void
  onAdminBoundariesVisibleChange?: (visible: boolean) => void
  onMapStyleChange?: (style: MapStylePreference) => void
  onMapProjectionChange?: (projection: MapProjectionPreference) => void
  onMapLanguageChange?: (language: MapLanguagePreference) => void
}

const FOOTPRINT_COLOR_SWATCHES = ['#123f35', '#4f7cff', '#b8544c']
const FOOTPRINT_STYLE_COMMIT_DELAY_MS = 180
const MAP_STYLE_LABEL = '\u5730\u56fe\u6837\u5f0f'
const MAP_PROJECTION_LABEL = '\u5730\u56fe\u5f62\u6001'
const MAP_LANGUAGE_LABEL = '\u5730\u56fe\u8bed\u8a00'
const MAP_PROJECTION_OPTIONS: Array<{ value: MapProjectionPreference; label: string }> = [
  { value: 'globe', label: '\u7403\u5f62' },
  { value: 'mercator', label: '\u5e73\u9762' },
]
const MAP_LANGUAGE_OPTIONS: Array<{ value: MapLanguagePreference; label: string }> = [
  { value: 'auto', label: '\u5168' },
  { value: 'zh-Hans', label: '\u4e2d' },
  { value: 'en', label: '\u82f1' },
]

export function MapControls({
  onFitFootprints,
  onLocate,
  onShowWorld,
  onZoomIn,
  onZoomOut,
  footprintStyle,
  onFootprintStyleChange,
  placeLabelsVisible = true,
  adminBoundariesVisible = true,
  mapStyle = 'primary',
  mapProjection = 'globe',
  mapLanguage = 'auto',
  onPlaceLabelsVisibleChange,
  onAdminBoundariesVisibleChange,
  onMapStyleChange,
  onMapProjectionChange,
  onMapLanguageChange,
}: MapControlsProps) {
  const [isFootprintStyleOpen, setIsFootprintStyleOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isFootprintStyleOpen) return

    function closeFootprintStyleOnOutsidePointer(event: PointerEvent) {
      if (settingsRef.current?.contains(event.target as Node)) return

      setIsFootprintStyleOpen(false)
    }

    document.addEventListener('pointerdown', closeFootprintStyleOnOutsidePointer)

    return () => {
      document.removeEventListener('pointerdown', closeFootprintStyleOnOutsidePointer)
    }
  }, [isFootprintStyleOpen])

  return (
    <div className="map-toolbar" aria-label="地图工具">
      <button
        type="button"
        className="map-toolbar__button"
        aria-label="聚焦当前足迹"
        title="聚焦当前足迹"
        onClick={onFitFootprints}
      >
        <Crosshair size={18} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="map-toolbar__button"
        aria-label="显示世界地图"
        title="显示世界地图"
        onClick={onShowWorld}
      >
        <Globe2 size={18} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="map-toolbar__button"
        aria-label="定位当前位置"
        title="定位当前位置"
        onClick={onLocate}
      >
        <LocateFixed size={18} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="map-toolbar__button"
        aria-label="放大地图"
        title="放大地图"
        onClick={onZoomIn}
      >
        <Plus size={18} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="map-toolbar__button"
        aria-label="缩小地图"
        title="缩小地图"
        onClick={onZoomOut}
      >
        <Minus size={18} strokeWidth={1.8} />
      </button>
      <div className="map-toolbar__settings" ref={settingsRef}>
        {isFootprintStyleOpen ? (
          <FootprintStylePopover
            footprintStyle={footprintStyle}
            onFootprintStyleChange={onFootprintStyleChange}
            placeLabelsVisible={placeLabelsVisible}
            adminBoundariesVisible={adminBoundariesVisible}
            mapStyle={mapStyle}
            mapProjection={mapProjection}
            mapLanguage={mapLanguage}
            onPlaceLabelsVisibleChange={onPlaceLabelsVisibleChange}
            onAdminBoundariesVisibleChange={onAdminBoundariesVisibleChange}
            onMapStyleChange={onMapStyleChange}
            onMapProjectionChange={onMapProjectionChange}
            onMapLanguageChange={onMapLanguageChange}
          />
        ) : null}
        <button
          type="button"
          className="map-toolbar__button"
          aria-label="足迹显示设置"
          title="足迹显示设置"
          aria-expanded={isFootprintStyleOpen}
          onClick={() => setIsFootprintStyleOpen((isOpen) => !isOpen)}
        >
          <Settings2 size={18} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}

function FootprintStylePopover({
  footprintStyle,
  onFootprintStyleChange,
  placeLabelsVisible = true,
  adminBoundariesVisible = true,
  mapStyle = 'primary',
  mapProjection = 'globe',
  mapLanguage = 'auto',
  onPlaceLabelsVisibleChange,
  onAdminBoundariesVisibleChange,
  onMapStyleChange,
  onMapProjectionChange,
  onMapLanguageChange,
}: FootprintStylePopoverProps) {
  const [draftFootprintStyle, setDraftFootprintStyle] = useState(footprintStyle)
  const styleCommitTimerRef = useRef<number | null>(null)
  const pendingCommitStyleRef = useRef<FootprintStyle | null>(null)
  const onFootprintStyleChangeRef = useRef(onFootprintStyleChange)
  const sizeInputId = useId()
  const opacityInputId = useId()
  const colorInputId = useId()

  useEffect(() => {
    onFootprintStyleChangeRef.current = onFootprintStyleChange
  }, [onFootprintStyleChange])

  useEffect(() => () => {
    if (styleCommitTimerRef.current !== null) {
      window.clearTimeout(styleCommitTimerRef.current)
    }

    const pendingStyle = pendingCommitStyleRef.current
    pendingCommitStyleRef.current = null
    if (pendingStyle) {
      onFootprintStyleChangeRef.current(pendingStyle)
    }
  }, [])

  function scheduleFootprintStyleCommit(nextStyle: FootprintStyle) {
    if (styleCommitTimerRef.current !== null) {
      window.clearTimeout(styleCommitTimerRef.current)
    }

    pendingCommitStyleRef.current = nextStyle
    styleCommitTimerRef.current = window.setTimeout(() => {
      styleCommitTimerRef.current = null
      pendingCommitStyleRef.current = null
      onFootprintStyleChangeRef.current(nextStyle)
    }, FOOTPRINT_STYLE_COMMIT_DELAY_MS)
  }

  function updateDraftFootprintStyle(nextStyle: FootprintStyle) {
    setDraftFootprintStyle(nextStyle)
    scheduleFootprintStyleCommit(nextStyle)
  }

  function updatePixelSize(value: string) {
    const nextPixelSize = Number.parseFloat(value)
    if (!Number.isFinite(nextPixelSize)) return

    updateDraftFootprintStyle({
      ...draftFootprintStyle,
      pixelSize: normalizeFootprintPixelSize(nextPixelSize),
    })
  }

  function updateColor(color: string) {
    const nextColor = normalizeFootprintColor(color)

    updateDraftFootprintStyle({
      ...draftFootprintStyle,
      color: nextColor,
    })
  }

  function updateOpacity(value: string) {
    const nextOpacity = Number.parseFloat(value)
    if (!Number.isFinite(nextOpacity)) return

    updateDraftFootprintStyle({
      ...draftFootprintStyle,
      opacity: normalizeFootprintOpacity(nextOpacity),
    })
  }

  return (
    <div className="footprint-style-popover" role="dialog" aria-label="足迹显示设置">
      {onMapLanguageChange ? (
        <div className="footprint-style-popover__row footprint-style-popover__row--inline">
          <span>{MAP_LANGUAGE_LABEL}</span>
          <PillButtonGroup
            ariaLabel={MAP_LANGUAGE_LABEL}
            options={MAP_LANGUAGE_OPTIONS}
            value={mapLanguage}
            onChange={onMapLanguageChange}
          />
        </div>
      ) : null}
      {onMapProjectionChange ? (
        <div className="footprint-style-popover__row footprint-style-popover__row--inline">
          <span>{MAP_PROJECTION_LABEL}</span>
          <PillButtonGroup
            ariaLabel={MAP_PROJECTION_LABEL}
            options={MAP_PROJECTION_OPTIONS}
            value={mapProjection}
            onChange={onMapProjectionChange}
          />
        </div>
      ) : null}
      {onMapStyleChange ? (
        <div className="footprint-style-popover__row footprint-style-popover__row--inline">
          <span>{MAP_STYLE_LABEL}</span>
          <PillButtonGroup
            ariaLabel={MAP_STYLE_LABEL}
            options={MAP_STYLE_OPTIONS}
            value={mapStyle}
            onChange={onMapStyleChange}
          />
        </div>
      ) : null}
      <div className="footprint-style-popover__row">
        <label htmlFor={sizeInputId}>足迹点大小</label>
        <span className="footprint-style-popover__value">{draftFootprintStyle.pixelSize}</span>
        <input
          id={sizeInputId}
          type="range"
          min={FOOTPRINT_PIXEL_SIZE_MIN}
          max={FOOTPRINT_PIXEL_SIZE_MAX}
          step={FOOTPRINT_PIXEL_SIZE_STEP}
          value={draftFootprintStyle.pixelSize}
          onChange={(event) => updatePixelSize(event.target.value)}
        />
      </div>
      <div className="footprint-style-popover__row">
        <label htmlFor={opacityInputId}>足迹点透明度</label>
        <span className="footprint-style-popover__value">{draftFootprintStyle.opacity}</span>
        <input
          id={opacityInputId}
          type="range"
          min={FOOTPRINT_OPACITY_MIN}
          max={FOOTPRINT_OPACITY_MAX}
          step={FOOTPRINT_OPACITY_STEP}
          value={draftFootprintStyle.opacity}
          onChange={(event) => updateOpacity(event.target.value)}
        />
      </div>
      <div className="footprint-style-popover__row">
        <label htmlFor={colorInputId}>足迹点颜色</label>
        <input
          id={colorInputId}
          type="color"
          value={draftFootprintStyle.color}
          style={{ '--footprint-color': draftFootprintStyle.color } as CSSProperties}
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
      {onPlaceLabelsVisibleChange ? (
        <button
          type="button"
          role="switch"
          aria-checked={placeLabelsVisible}
          className={
            placeLabelsVisible
              ? 'footprint-style-popover__switch is-active'
              : 'footprint-style-popover__switch'
          }
          onClick={() => onPlaceLabelsVisibleChange(!placeLabelsVisible)}
        >
          <span>显示地名</span>
          <span className="footprint-style-popover__switch-control" aria-hidden="true" />
        </button>
      ) : null}
      {onAdminBoundariesVisibleChange ? (
        <button
          type="button"
          role="switch"
          aria-checked={adminBoundariesVisible}
          className={
            adminBoundariesVisible
              ? 'footprint-style-popover__switch is-active'
              : 'footprint-style-popover__switch'
          }
          onClick={() => onAdminBoundariesVisibleChange(!adminBoundariesVisible)}
        >
          <span>显示行政边界</span>
          <span className="footprint-style-popover__switch-control" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

type PillOption<Value extends string> = {
  value: Value
  label: string
}

type PillButtonGroupProps<Value extends string> = {
  ariaLabel: string
  options: Array<PillOption<Value>>
  value: Value
  onChange: (value: Value) => void
}

function PillButtonGroup<Value extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: PillButtonGroupProps<Value>) {
  return (
    <div className="pill-button-group" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={
            option.value === value
              ? 'pill-button-group__button is-active'
              : 'pill-button-group__button'
          }
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
