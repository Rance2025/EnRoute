import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appCss = readFileSync('src/App.css', 'utf8')
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

  it('keeps the today action secondary and compact', () => {
    const rule = cssRule('.time-context-card__today')

    expect(rule).toContain('min-height: 24px')
    expect(rule).toContain('padding: 0 8px')
    expect(rule).toContain('font-size: 11px')
  })

  it('centers time picker arrow glyphs inside circular buttons', () => {
    const rule = cssRule('.time-picker-bar button')

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

  it('keeps unified time picker grids compact across day week month and year modes', () => {
    expect(cssRule('.time-picker-grid')).toContain('gap: 6px')
    expect(cssRule('.time-picker-calendar-frame')).toContain('overflow: hidden')
    expect(cssRule('.time-picker-calendar-frame')).toContain(
      'transition: max-height 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    expect(cssRule('.time-picker-calendar-weekdays')).toContain(
      'grid-template-columns: repeat(7, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--calendar')).toContain('transform: translateY(')
    expect(cssRule('.time-picker-grid--calendar')).toContain(
      'transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    expect(cssRule('.time-picker-grid--days')).toContain(
      'grid-template-columns: repeat(7, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--months')).toContain(
      'grid-template-columns: repeat(6, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--years')).toContain(
      'grid-template-columns: repeat(5, minmax(0, 1fr))',
    )
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
    expect(cssRule('.segmented-control')).toContain('--segmented-active-label-color: #f8fbfa')
    expect(cssRule('.segmented-control')).toContain(
      '--segmented-disabled-label-color: rgba(23, 35, 31, 0.26)',
    )
    expect(cssRule('.segmented-control button')).toContain(
      'color: var(--segmented-label-color)',
    )
    expect(cssRule('.segmented-control button')).not.toContain('mix-blend-mode')
    expect(segmentedControlSource).not.toContain('segmented-control__thumb-label')
    expect(cssRule('.segmented-control__thumb-label')).toBe('')
    expect(cssRule('.time-mode-tabs')).toContain(
      '--segmented-label-color: rgba(255, 255, 255, 0.66)',
    )
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-active-label-color: #123f35')
    expect(cssRule(".app-nav .segmented-control button[aria-pressed='true']")).toContain(
      'color: var(--segmented-label-color)',
    )
    expect(cssRule('.segmented-control button::after')).toContain(
      'color: var(--segmented-active-label-color)',
    )
    expect(cssRule('.segmented-control button::after')).toContain(
      'content: attr(data-segment-label)',
    )
    expect(cssRule('.segmented-control button::after')).toContain('clip-path')
    expect(cssRule('.segmented-control button::after')).toContain(
      'var(--segmented-active-start, 0%)',
    )
    expect(cssRule('.segmented-control button::after')).toContain('pointer-events: none')
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
    const rule = cssRule('.map-toolbar button')

    expect(rule).toContain('width: 38px')
    expect(rule).toContain('height: 38px')
    expect(amapCanvasSource).not.toContain('new AMap.ControlBar')
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
  })
})
