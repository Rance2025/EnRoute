import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appCss = readFileSync('src/App.css', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')
const amapCanvasSource = readFileSync('src/components/AmapCanvas.tsx', 'utf8')
const amapLoaderSource = readFileSync('src/services/amapLoader.ts', 'utf8')
const segmentedControlSource = readFileSync('src/components/SegmentedControl.tsx', 'utf8')

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return appCss.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? ''
}

function lastCssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...appCss.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'g'))]

  return matches.at(-1)?.[0] ?? ''
}

describe('map chrome layout', () => {
  it('does not render a second map wordmark inside the map chrome', () => {
    expect(amapCanvasSource).not.toContain('className="brand-header"')
    expect(cssRule('.brand-header')).toBe('')
    expect(cssRule('.brand-header h1')).toBe('')
  })

  it('reserves a left data panel and keeps the map in the remaining workspace', () => {
    const appShellRule = cssRule('.app-shell')
    const panelRule = cssRule('.time-context-panel')
    const workspaceRule = cssRule('.main-workspace')
    const stageRule = cssRule('.map-stage')

    expect(appShellRule).toContain('position: relative')
    expect(panelRule).toContain('width: var(--data-panel-width, 0px)')
    expect(panelRule).toContain('overflow: hidden')
    expect(cssRule('.app-shell:not(.has-data-panel) .time-context-panel')).toContain(
      'display: none',
    )
    expect(workspaceRule).toContain('inset: 0 0 0 var(--data-panel-width)')
    expect(workspaceRule).toContain('width: calc(100vw - var(--data-panel-width))')
    expect(stageRule).toContain('inset: 0 0 0 var(--data-panel-width)')
    expect(stageRule).toContain('width: calc(100vw - var(--data-panel-width))')
  })

  it('keeps the shared time panel high in the left rail without a fake top spacer', () => {
    const scrollRule = cssRule('.time-context-panel__scroll')

    expect(scrollRule).toContain('padding: 16px 16px 16px')
    expect(scrollRule).not.toContain('padding: 88px')
  })

  it('keeps calendar display mode local to the time panel to avoid map rerenders', () => {
    const timePanelSource = readFileSync('src/components/TimeContextPanel.tsx', 'utf8')

    expect(appSource).not.toContain('calendarMode')
    expect(appSource).not.toContain('setCalendarMode')
    expect(timePanelSource).toContain("useState<CalendarDisplayMode>('week')")
  })

  it('keeps the today action secondary and compact', () => {
    const rule = cssRule('.time-context-card__today')

    expect(rule).toContain('min-height: 24px')
    expect(rule).toContain('padding: 0 8px')
    expect(rule).toContain('font-size: 11px')
  })

  it('gives the current-period reset action a clear click feedback state', () => {
    const rule = cssRule('.time-context-card__today')
    const hoverRule = cssRule('.time-context-card__today:hover')
    const activeRule = cssRule('.time-context-card__today:active')
    const focusRule = cssRule('.time-context-card__today:focus-visible')

    expect(rule).toContain('cursor: pointer')
    expect(rule).toContain('transition:')
    expect(rule).toContain('transform')
    expect(rule).toContain('box-shadow')
    expect(hoverRule).toContain('background:')
    expect(hoverRule).toContain('box-shadow')
    expect(activeRule).toContain('transform: scale(0.96)')
    expect(activeRule).toContain('box-shadow')
    expect(focusRule).toContain('outline:')
  })

  it('centers time picker arrow glyphs inside circular buttons', () => {
    const rule = cssRule('.time-picker-bar button')

    expect(rule).toContain('display: grid')
    expect(rule).toContain('place-items: center')
    expect(rule).toContain('line-height: 1')
  })

  it('centers calendar arrow glyphs inside circular buttons', () => {
    const rule = cssRule('.time-picker-bar button')

    expect(appCss).toMatch(/\.time-calendar-bar button,\s*\.time-picker-bar button\s*\{/)
    expect(rule).toContain('display: grid')
    expect(rule).toContain('place-items: center')
    expect(rule).toContain('line-height: 1')
  })

  it('gives time picker arrows a clear press state', () => {
    const buttonRule = cssRule('.time-picker-bar button')
    const activeRule = cssRule('.time-picker-bar button:active')

    expect(buttonRule).toContain('cursor: pointer')
    expect(buttonRule).toContain('transform')
    expect(buttonRule).toContain('box-shadow')
    expect(activeRule).toContain('transform: scale(0.94)')
    expect(activeRule).toContain('box-shadow')
  })

  it('keeps time picker item hover lift restrained and removes click press motion', () => {
    const hoverRule = cssRule('.time-picker-grid button:hover')
    const activeRule = cssRule('.time-picker-grid button:active')

    expect(hoverRule).toContain('transform: translateY(-0.5px)')
    expect(hoverRule).not.toContain('translateY(-1px)')
    expect(activeRule).not.toContain('transform')
    expect(activeRule).not.toContain('box-shadow')
  })

  it('applies the same restrained hover-only motion to all time picker grids', () => {
    const gridRule = cssRule('.time-picker-grid button')
    const gridHoverRule = cssRule('.time-picker-grid button:hover')
    const gridActiveRule = cssRule('.time-picker-grid button:active')

    expect(gridRule).toContain('transform 150ms ease')
    expect(gridHoverRule).toContain('transform: translateY(-0.5px)')
    expect(gridHoverRule).not.toContain('translateY(-1px)')
    expect(gridActiveRule).not.toContain('transform')
    expect(gridActiveRule).not.toContain('box-shadow')
  })

  it('animates the day calendar by clipping and translating one stable month grid', () => {
    const shellRule = cssRule('.time-calendar-shell')
    const switchRule = cssRule('.time-calendar-switch')
    const bodyRule = cssRule('.time-calendar-body')
    const weekBodyRule = cssRule('.time-calendar-body--week')
    const monthBodyRule = cssRule('.time-calendar-body--month')
    const weekdaysRule = cssRule('.time-calendar-weekdays')
    const gridWindowRule = cssRule('.time-calendar-grid-window')
    const gridRule = cssRule('.time-calendar-grid')
    const buttonRule = cssRule('.time-calendar-grid button')

    expect(shellRule).toContain('--time-calendar-day-height: 37px')
    expect(shellRule).toContain('--time-calendar-weekday-height: 17px')
    expect(shellRule).toContain('--time-calendar-grid-gap: 5px')
    expect(switchRule).toContain('grid-template-columns: repeat(2, auto)')
    expect(bodyRule).not.toContain('overflow: hidden')
    expect(bodyRule).toContain(
      'height 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    expect(weekBodyRule).toContain('--time-calendar-visible-rows: 1')
    expect(weekBodyRule).toContain(
      '--time-calendar-grid-offset: calc(var(--time-calendar-active-week-index) * -1)',
    )
    expect(monthBodyRule).toContain('--time-calendar-grid-offset: 0')
    expect(weekdaysRule).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))')
    expect(weekdaysRule).toContain('margin-top: var(--time-calendar-grid-top-gap)')
    expect(gridWindowRule).toContain('height: calc(')
    expect(gridWindowRule).toContain('overflow: hidden')
    expect(gridWindowRule).toContain('transition: height 260ms cubic-bezier(0.22, 1, 0.36, 1)')
    expect(gridRule).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))')
    expect(gridRule).not.toContain('margin-top: var(--time-calendar-grid-gap)')
    expect(gridRule).toContain('transform: translateY(')
    expect(gridRule).toContain(
      'transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    expect(cssRule('.time-calendar-body--week .time-calendar-grid')).toContain(
      'transition: none',
    )
    expect(buttonRule).toContain('height: var(--time-calendar-day-height)')
    expect(buttonRule).toContain('min-height: var(--time-calendar-day-height)')
  })

  it('keeps unified top-level time picker grids compact across week month and year modes', () => {
    expect(cssRule('.time-picker-grid')).toContain('gap: 6px')
    expect(cssRule('.time-picker-grid--days')).toContain(
      'grid-template-columns: repeat(7, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--weeks')).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--months')).toContain(
      'grid-template-columns: repeat(6, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--years')).toContain(
      'grid-template-columns: repeat(5, minmax(0, 1fr))',
    )
  })

  it('gives day calendar active cells the same uncut raised shadow as picker cells', () => {
    const sharedActiveRule =
      appCss.match(
        /\.time-calendar-grid button\.is-active,\s*\.time-picker-grid button\.is-active\s*\{[^}]*\}/,
      )?.[0] ?? ''
    const pickerActiveRule = cssRule('.time-picker-grid button.is-active')

    expect(sharedActiveRule).toContain('box-shadow:')
    expect(sharedActiveRule).toContain('0 9px 20px')
    expect(pickerActiveRule).toContain('0 9px 20px')
  })

  it('gives day calendar hover feedback the same restrained lift as picker cells', () => {
    const sharedHoverRule =
      appCss.match(
        /\.time-calendar-grid button:hover,\s*\.time-picker-grid button:hover\s*\{[^}]*\}/,
      )?.[0] ?? ''
    const pickerHoverRule = cssRule('.time-picker-grid button:hover')

    expect(sharedHoverRule).toContain('0 8px 16px')
    expect(sharedHoverRule).toContain('transform: translateY(-0.5px)')
    expect(pickerHoverRule).toContain('0 8px 16px')
    expect(pickerHoverRule).toContain('transform: translateY(-0.5px)')
  })

  it('keeps the calendar shell fixed while animating only inner grid content', () => {
    const stageRule = cssRule('.time-panel-content__stage')
    const dayWindowRule = cssRule('.time-calendar-grid-window')
    const dayMotionRule = cssRule('.time-calendar-grid-motion')
    const pickerWindowRule = cssRule('.time-picker-grid-window')
    const pickerMotionRule = cssRule('.time-picker-grid-motion')
    const previousRule = cssRule('.time-range-grid-motion--previous')
    const nextRule = cssRule('.time-range-grid-motion--next')

    expect(stageRule).not.toContain('animation:')
    expect(stageRule).not.toContain('transform')
    expect(dayWindowRule).toContain('--time-picker-shadow-buffer')
    expect(dayWindowRule).toContain('var(--time-picker-shadow-buffer) * 2')
    expect(dayWindowRule).toContain('padding: var(--time-picker-shadow-buffer)')
    expect(dayWindowRule).toContain('width: calc(100% + var(--time-picker-shadow-buffer) * 2)')
    expect(dayWindowRule).toContain('calc(var(--time-picker-shadow-buffer) * -1)')
    expect(dayWindowRule).toContain('overflow: hidden')
    expect(dayMotionRule).toContain('width: 100%')
    expect(pickerWindowRule).toContain('--time-picker-shadow-buffer')
    expect(pickerWindowRule).toContain('padding: var(--time-picker-shadow-buffer)')
    expect(pickerWindowRule).toContain('width: calc(100% + var(--time-picker-shadow-buffer) * 2)')
    expect(pickerWindowRule).toContain('calc(var(--time-picker-shadow-buffer) * -1)')
    expect(pickerWindowRule).toContain('overflow: hidden')
    expect(pickerMotionRule).toContain('width: 100%')
    expect(previousRule).toContain('--time-range-enter-x: -')
    expect(previousRule).toContain('animation:')
    expect(previousRule).toContain('timeRangeGridIn')
    expect(nextRule).toContain('--time-range-enter-x: ')
    expect(nextRule).toContain('animation:')
    expect(nextRule).toContain('timeRangeGridIn')
    expect(appCss).toContain('@keyframes timeRangeGridIn')
    expect(appCss).not.toContain('@keyframes timeRangeStageIn')
  })

  it('lets segmented sliders drag from the switch surface with drag cursors', () => {
    expect(cssRule('.segmented-control')).toContain('cursor: grab')
    expect(cssRule('.segmented-control')).toContain('user-select: none')
    expect(cssRule('.segmented-control.is-dragging')).toContain('cursor: grabbing')
    expect(cssRule('.segmented-control button')).toContain('cursor: inherit')
    expect(cssRule('.segmented-control__thumb')).toContain('cursor: grab')
    expect(cssRule('.segmented-control__thumb')).toContain(
      'var(--segment-thumb-index, var(--segment-index))',
    )
    expect(cssRule(".segmented-control button[aria-pressed='true']")).toContain(
      'pointer-events: none',
    )
  })

  it('keeps segmented labels readable while the slider crosses each segment', () => {
    expect(cssRule('.segmented-control')).toContain(
      '--segmented-label-color: rgba(23, 35, 31, 0.62)',
    )
    expect(cssRule('.segmented-control')).toContain('--segmented-gap: 0px')
    expect(cssRule('.segmented-control')).toContain('--segmented-active-label-color: #f8fbfa')
    expect(cssRule('.segmented-control')).toContain('--segmented-thumb-shadow: none')
    expect(cssRule('.segmented-control')).toContain(
      '--segmented-disabled-label-color: rgba(23, 35, 31, 0.26)',
    )
    expect(cssRule('.segmented-control button')).toContain(
      'color: var(--segmented-label-color)',
    )
    expect(cssRule('.segmented-control button')).not.toContain('mix-blend-mode')
    expect(segmentedControlSource).not.toContain('segmented-control__thumb-label')
    expect(cssRule('.segmented-control__thumb-label')).toBe('')
    expect(segmentedControlSource).toContain('segmented-control__active-labels')
    expect(cssRule('.segmented-control__thumb')).toContain('overflow: hidden')
    expect(cssRule('.segmented-control__thumb.is-dragging')).not.toContain('transform')
    expect(cssRule('.segmented-control__active-labels')).toContain(
      'width: calc(100% * var(--segment-count))',
    )
    expect(cssRule('.segmented-control__active-labels')).toContain(
      'grid-template-columns: repeat(var(--segment-count), minmax(0, 1fr))',
    )
    expect(cssRule('.segmented-control__active-labels')).toContain(
      'gap: var(--segmented-gap)',
    )
    expect(cssRule('.segmented-control__active-labels')).toContain(
      'color: var(--segmented-active-label-color)',
    )
    expect(cssRule('.segmented-control__active-labels')).toContain(
      'var(--segment-thumb-index, var(--segment-index))',
    )
    expect(cssRule('.segmented-control__active-labels')).toContain(
      'transition: transform 190ms ease',
    )
    expect(
      cssRule('.segmented-control__thumb.is-dragging .segmented-control__active-labels'),
    ).toContain('transition: none')
    expect(cssRule('.segmented-control__active-label')).toContain('place-items: center')
    expect(cssRule('.time-mode-tabs')).toContain(
      '--segmented-label-color: rgba(255, 255, 255, 0.66)',
    )
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-gap: 3px')
    expect(cssRule('.time-mode-tabs')).not.toContain('--segmented-thumb-shadow')
    expect(cssRule('.accounting-mode-tabs')).not.toContain('--segmented-thumb-shadow')
    expect(cssRule('.transaction-type-switch')).not.toContain('--segmented-thumb-shadow')
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-active-label-color: #123f35')
    expect(cssRule(".app-nav .segmented-control button[aria-pressed='true']")).toContain(
      'color: var(--segmented-label-color)',
    )
    expect(cssRule('.segmented-control button::after')).toBe('')
    expect(segmentedControlSource).not.toContain('--segmented-active-start')
    expect(segmentedControlSource).not.toContain('--segmented-active-end')
    expect(lastCssRule(".segmented-control button[aria-pressed='true']")).toContain(
      'color: var(--segmented-label-color)',
    )
    expect(lastCssRule(".segmented-control button[aria-pressed='true']")).toContain(
      'background: transparent',
    )
    expect(lastCssRule(".segmented-control button[aria-pressed='true']")).toContain(
      'box-shadow: none',
    )
    expect(lastCssRule('.segmented-control button:hover')).toContain(
      'color: var(--segmented-label-color)',
    )
    expect(lastCssRule(".segmented-control button[aria-pressed='true']")).not.toContain(
      'color: transparent',
    )
  })

  it('lays month aggregation out as two compact rows', () => {
    expect(cssRule('.time-picker-grid--months')).toContain(
      'grid-template-columns: repeat(6, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--months button')).toContain('min-height: 46px')
  })

  it('keeps decade year cells on one readable line', () => {
    const gridRule = cssRule('.time-picker-grid--years')
    const rule = cssRule('.time-picker-grid--years button')
    const labelRule = cssRule('.time-picker-grid--years button span')

    expect(gridRule).toContain('gap: 3px')
    expect(rule).toContain('font-size: 9px')
    expect(rule).toContain('font-weight: 720')
    expect(rule).toContain('white-space: nowrap')
    expect(labelRule).toContain('white-space: nowrap')
    expect(appCss.indexOf('.time-picker-grid--years button')).toBeGreaterThan(
      appCss.indexOf('.time-picker-grid button {'),
    )
  })

  it('keeps the accounting page fixed while ledger internals scroll', () => {
    expect(cssRule('.accounting-page')).toContain('overflow: hidden')
    expect(cssRule('.accounting-workspace')).toContain('overflow: hidden')
    expect(cssRule('.transaction-list')).toContain('overflow: auto')
    expect(cssRule('.transaction-editor')).toContain('overflow: auto')
  })

  it('initializes the map at the single-world minimum zoom', () => {
    expect(amapCanvasSource).toContain(
      'const initialZoom = calculateMinimumZoomForLatitudeCoverage(mapNodeRef.current.clientHeight)',
    )
    expect(amapCanvasSource).toContain('zoom: initialZoom')
    expect(amapCanvasSource).not.toContain('zoom: config.defaultZoom')
  })

  it('enforces the current map zoom against the resized single-world minimum', () => {
    expect(amapCanvasSource).toContain('currentZoom < minimumZoom')
    expect(amapCanvasSource).toContain('setZoomAndCenter(')
    expect(amapCanvasSource).toContain('calculateBoundedZoomCenter(')
  })

  it('anchors the map toolbar to the lower-right', () => {
    const rule = cssRule('.map-toolbar')
    const stageRule = cssRule('.map-stage')

    expect(stageRule).toContain('--map-chrome-x: max(24px, env(safe-area-inset-right))')
    expect(stageRule).toContain('--map-chrome-y: max(24px, env(safe-area-inset-bottom))')
    expect(rule).toContain('right: var(--map-chrome-x)')
    expect(rule).toContain('bottom: var(--map-chrome-y)')
    expect(rule).not.toContain('left: 50%')
    expect(rule).not.toContain('translateX(-50%)')
  })

  it('keeps map chrome text from using oversized hero typography', () => {
    expect(appCss).not.toMatch(/font-size:\s*clamp\(22px,\s*3\.6vw,\s*38px\)/)
  })

  it('keeps the 2D map toolbar compact', () => {
    const rule = cssRule('.map-toolbar > button')

    expect(rule).toContain('width: 38px')
    expect(rule).toContain('height: 38px')
    expect(amapCanvasSource).not.toContain('new AMap.ControlBar')
  })

  it('positions footprint style settings as a compact popover above the map toolbar', () => {
    const toolbarRule = cssRule('.map-toolbar')
    const toolbarButtonRule = cssRule('.map-toolbar > button')
    const popoverRule = cssRule('.footprint-style-popover')
    const rowRule = cssRule('.footprint-style-popover__row')
    const swatchRule = cssRule('.footprint-style-popover__swatch')

    expect(toolbarRule).toContain('overflow: visible')
    expect(cssRule('.map-toolbar button')).toBe('')
    expect(toolbarButtonRule).toContain('width: 38px')
    expect(appCss).toContain('.map-toolbar > button:hover')
    expect(popoverRule).toContain('position: absolute')
    expect(popoverRule).toContain('right: 0')
    expect(popoverRule).toContain('bottom: calc(100% + 10px)')
    expect(popoverRule).toContain('width: 218px')
    expect(popoverRule).toContain('max-width: calc(100vw - 28px)')
    expect(rowRule).toContain('grid-template-columns:')
    expect(cssRule('.footprint-style-popover__value')).toContain('display: grid')
    expect(swatchRule).toContain('border-radius: 999px')
    expect(swatchRule).toContain('background: transparent')
    const swatchFillRule = cssRule('.footprint-style-popover__swatch::before')
    expect(swatchFillRule).toContain('inset: 0')
    expect(swatchFillRule).toContain(
      'background: var(--swatch-color)',
    )
    expect(cssRule('.footprint-style-popover__row input[type=\'color\']::-webkit-color-swatch')).toContain(
      'background: var(--footprint-color)',
    )
  })

  it('removes the AMap compass and limits map dragging to configured bounds', () => {
    expect(cssRule('.map-stage .amap-controlbar')).toBe('')
    expect(amapCanvasSource).not.toContain('new AMap.ControlBar')
    expect(amapCanvasSource).not.toContain('setLimitBounds(')
    expect(amapCanvasSource).toContain('installBoundedMapDrag(map, mapNodeRef.current, config.renderBounds)')
    expect(amapCanvasSource).toContain('installBoundedMapZoom(map, mapNodeRef.current, config.renderBounds)')
    expect(amapCanvasSource).toContain('clampMapCenterToLatitudeBounds(')
    expect(amapCanvasSource).toContain("map.on('zoomend'")
    expect(amapLoaderSource).not.toContain('AMap.ControlBar')
  })

  it('uses custom hard-bound dragging instead of native AMap drag rebound', () => {
    const dragSource = readFileSync('src/config/mapDragBounds.ts', 'utf8')

    expect(dragSource).toContain('setStatus({ dragEnable: false })')
    expect(dragSource).toContain('calculateNextBoundedDragCenter')
    expect(cssRule('.amap-surface')).toContain('touch-action: none')
  })

  it('uses custom hard-bound zooming instead of native AMap wheel zoom', () => {
    const zoomSource = readFileSync('src/config/mapZoomBounds.ts', 'utf8')

    expect(zoomSource).toContain('dragEnable: false')
    expect(zoomSource).toContain('scrollWheel: false')
    expect(zoomSource).toContain('doubleClickZoom: false')
    expect(zoomSource).toContain('keyboardEnable: false')
    expect(zoomSource).toContain("container.addEventListener('wheel'")
    expect(zoomSource).toContain('calculateBoundedZoomCenter')
    expect(zoomSource).toContain('window.requestAnimationFrame')
    expect(zoomSource).not.toContain('ZOOM_ANIMATION_FRAME_MS')
    expect(zoomSource).not.toContain('window.setTimeout(tick')
  })
})
