import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appCss = readFileSync('src/App.css', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')
const mainSource = readFileSync('src/main.tsx', 'utf8')
const rootSource = readFileSync('src/Root.tsx', 'utf8')
const amapCanvasSource = readFileSync('src/components/AmapCanvas.tsx', 'utf8')
const amapLoaderSource = readFileSync('src/services/amapLoader.ts', 'utf8')
const mapboxCanvasSource = readFileSync('src/components/MapboxCanvas.tsx', 'utf8')
const mapControlsSource = readFileSync('src/components/MapControls.tsx', 'utf8')
const segmentedControlSource = readFileSync('src/components/SegmentedControl.tsx', 'utf8')
const timeContextPanelSource = readFileSync('src/components/TimeContextPanel.tsx', 'utf8')
const adminRegionContextPanelSource = readFileSync('src/components/AdminRegionContextPanel.tsx', 'utf8')
const accountingRightContextPanelSource = readFileSync('src/components/accounting/AccountingRightContextPanel.tsx', 'utf8')
const accountingCss = readFileSync('src/components/accounting/accounting.css', 'utf8')
const accountingPageSource = readFileSync('src/components/AccountingPage.tsx', 'utf8')

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return appCss.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? ''
}

function lastCssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...appCss.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'g'))]

  return matches.at(-1)?.[0] ?? ''
}

function allCssRules(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...appCss.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'g'))].map(
    (match) => match[0],
  )
}

function expectMaterialRule(rule: string) {
  expect(rule).toContain('border: 1px solid var(--glass-panel-border)')
  expect(rule).toContain('background: var(--solid-glass-panel-bg)')
  expect(rule).toContain('box-shadow: var(--glass-panel-shadow)')
  expect(rule).toContain('backdrop-filter: var(--glass-panel-filter)')
  expect(rule).toContain('-webkit-backdrop-filter: var(--glass-panel-filter)')
  expect(rule).toContain('position: relative')
  expect(rule).toContain('isolation: isolate')
  expect(rule).toContain('overflow: hidden')
  expect(cssRule('.glass-panel::before')).toContain('background:')
  expect(cssRule('.glass-panel::before')).toContain('pointer-events: none')
}

function expectNoOwnedGlassMaterial(rule: string) {
  expect(rule).not.toContain('border: 1px solid var(--glass-panel-border)')
  expect(rule).not.toContain('background: var(--solid-glass-panel-bg)')
  expect(rule).not.toContain('background: var(--glass-panel-bg)')
  expect(rule).not.toContain('box-shadow: var(--glass-panel-shadow)')
  expect(rule).not.toContain('backdrop-filter: var(--glass-panel-filter)')
  expect(rule).not.toContain('-webkit-backdrop-filter: var(--glass-panel-filter)')
}

function expectNoOwnedGlassShape(rule: string) {
  expect(rule).not.toContain('border-radius:')
}

function mediaBlock(queryStart: string) {
  const start = appCss.indexOf(queryStart)
  if (start < 0) return ''

  let depth = 0
  for (let index = start; index < appCss.length; index += 1) {
    if (appCss[index] === '{') depth += 1
    if (appCss[index] === '}') {
      depth -= 1
      if (depth === 0) return appCss.slice(start, index + 1)
    }
  }

  return ''
}

function cssRuleIn(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? ''
}

function cssCustomPx(rule: string, property: string) {
  const match = rule.match(new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)px`))

  return match ? Number(match[1]) : Number.NaN
}

function cssCustomNumber(rule: string, property: string) {
  const match = rule.match(new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)`))

  return match ? Number(match[1]) : Number.NaN
}

describe('map chrome layout', () => {
  it('does not render a second map wordmark inside the map chrome', () => {
    expect(amapCanvasSource).not.toContain('className="brand-header"')
    expect(cssRule('.brand-header')).toBe('')
    expect(cssRule('.brand-header h1')).toBe('')
  })

  it('keeps the AMap boundary quality preview behind an explicit query switch', () => {
    expect(mainSource).toContain('<Root />')
    expect(rootSource).toContain("resolveAmapBoundaryPreviewMode(window.location.search)")
    expect(rootSource).toContain("lazy(() => import('./components/AmapBoundaryPreview')")
    expect(rootSource).toContain("lazy(() => import('./components/MapboxAmapBoundaryPreview')")
    expect(rootSource).toContain("<LazyAmapBoundaryPreview config={getAmapConfig()} />")
    expect(rootSource).toContain("<LazyMapboxAmapBoundaryPreview amapConfig={getAmapConfig()} />")
    expect(rootSource).toContain("<App />")
    expect(cssRule('.amap-boundary-preview')).toContain('position: fixed')
    expect(cssRule('.amap-boundary-preview__map')).toContain('position: absolute')
    expect(cssRule('.amap-boundary-preview__panel')).toContain('position: absolute')
    expect(appSource).not.toContain('AmapBoundaryPreview')
    expect(mapboxCanvasSource).not.toContain('AmapBoundaryPreview')
  })

  it('routes glass panel material through shared classes', () => {
    const materialRule = cssRule('.glass-panel')
    const solidRule = cssRule('.glass-panel--solid')
    const largeRule = cssRule('.glass-panel--large')
    const cardRule = cssRule('.glass-panel--card')
    const compactRule = cssRule('.glass-panel--compact')
    const pillRule = cssRule('.glass-panel--pill')

    expectMaterialRule(materialRule)
    expect(solidRule).toContain('background: var(--solid-glass-panel-bg)')
    expect(largeRule).toContain('border-radius: 28px')
    expect(cardRule).toContain('border-radius: 24px')
    expect(compactRule).toContain('border-radius: 18px')
    expect(pillRule).toContain('border-radius: 999px')

    expect(timeContextPanelSource).toContain(
      'className="glass-panel glass-panel--solid glass-panel--large time-context-panel"',
    )
    expect(accountingRightContextPanelSource).toContain('className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__summary"')
    expect(accountingRightContextPanelSource).toContain('className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__legend"')
    expect(adminRegionContextPanelSource).toContain(
      'className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass admin-region-atlas-card"',
    )
    expect(appSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact settings-dialog__panel"')
    expect(mapControlsSource).toContain('className="glass-panel glass-panel--solid glass-panel--pill map-toolbar"')
    expect(mapControlsSource).toContain('className="glass-panel glass-panel--solid glass-panel--card footprint-style-popover"')
    expect(mapControlsSource).not.toMatch(/\{isFootprintStyleOpen \? \(\r?\n\s{10}<FootprintStylePopover/)
    expect(mapControlsSource).toMatch(/\{isFootprintStyleOpen \? \(\r?\n\s{8}<FootprintStylePopover/)
    expect(amapCanvasSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact footprint-debug-panel"')
    expect(mapboxCanvasSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact footprint-debug-panel"')
    expect(amapCanvasSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact admin-region-unlock-panel"')
    expect(amapCanvasSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact map-message"')
    expect(mapboxCanvasSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact map-message')

    for (const selector of [
      '.time-context-panel',
      '.right-context-panel__glass',
      '.settings-dialog__panel',
      '.map-toolbar',
      '.footprint-debug-panel',
      '.admin-region-unlock-panel',
      '.footprint-style-popover',
      '.map-message',
    ]) {
      const rules = allCssRules(selector)
      expect(rules.length, selector).toBeGreaterThan(0)
      for (const rule of rules) {
        expectNoOwnedGlassMaterial(rule)
      }
    }
  })

  it('gives the accounting center the shared glass material and dense local scroll layout', () => {
    expect(accountingPageSource).toContain("import './accounting/accounting.css'")
    expect(appCss).toContain('--panel-glass-background: var(--solid-glass-panel-bg)')
    expect(appCss).toContain('--panel-glass-border: var(--glass-panel-border)')
    expect(appCss).toContain('--panel-glass-shadow: var(--glass-panel-shadow)')
    expect(accountingCss).toContain('grid-template-columns: minmax(300px, 41fr) minmax(0, 59fr)')
    expect(accountingCss).toContain('background: var(--panel-glass-background)')
    expect(accountingCss).toContain('border: 1px solid var(--panel-glass-border)')
    expect(accountingCss).toContain('box-shadow: var(--panel-glass-shadow), var(--panel-glass-inset)')
    expect(accountingCss).toContain('.accounting-scroll--ledger')
    expect(accountingCss).toContain('overflow-y: auto')
    expect(accountingCss).toContain('.taxonomy-table-wrap')
    expect(accountingCss).toContain('@media (max-width: 760px)')
    expect(accountingCss).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(accountingCss).not.toMatch(/\.app-shell--accounting[^,{]*\.time-context-panel/)
    expect(accountingCss).not.toContain('--accounting-expense: #b8544c')
    expect(accountingCss).not.toContain('--accounting-expense: #d05b52')
  })

  it('reserves symmetric side panels and keeps the map workspace between them', () => {
    const appShellRule = cssRule('.app-shell')
    const panelRule = cssRule('.time-context-panel')
    const rightPanelRule = cssRule('.right-context-panel')
    const rightPanelStackRule = cssRule('.right-context-panel__stack')
    const rightPanelGlassRule = cssRule('.right-context-panel__glass')
    const sharedGlassRule = cssRule('.glass-panel')
    const secondaryRailRule = cssRule('.secondary-nav-rail')
    const secondaryItemsRule = cssRule('.secondary-nav-rail__items')
    const workspaceRule = cssRule('.main-workspace')
    const stageRule = cssRule('.map-stage')
    const navRule = cssRule('.app-nav')
    const boardRule = cssRule('.app-board')

    expect(appShellRule).toContain('position: relative')
    expect(appShellRule).toContain('--page-board-bg:')
    expect(appShellRule).toContain('--shell-board-inset-x:')
    expect(appShellRule).toContain('--shell-board-inset-y:')
    expect(appShellRule).toContain('--shell-board-top-reserve:')
    expect(appShellRule).toContain('--shell-board-column-gutter:')
    expect(appShellRule).toContain('--secondary-rail-width: 300px')
    expect(appShellRule).toContain('--right-panel-width: var(--secondary-rail-width)')
    expect(appShellRule).toContain('--glass-panel-bg:')
    expect(appShellRule).toContain('--glass-panel-filter: blur(24px) saturate(1.22) brightness(1.02)')
    expect(appShellRule).toContain('--glass-panel-opacity: 0.7')
    expect(appShellRule).toContain('--theme-mist-board-start: rgba(225, 234, 233, 0.86)')
    expect(appShellRule).toContain('--theme-mist-board-end: rgba(180, 193, 194, 0.92)')
    expect(appShellRule).toContain('--theme-mist-board-base: #b4c0c1')
    expect(appShellRule).toContain(
      '--theme-mist-glass-end: rgba(238, 246, 244, calc(var(--glass-panel-opacity) * 0.478))',
    )
    expect(appShellRule).toContain(
      '--theme-mist-glass-sheen-strong: rgba(255, 255, 255, calc(var(--glass-panel-opacity) * 0.686))',
    )
    expect(appShellRule).toContain(
      '--theme-mist-glass-sheen-soft: rgba(255, 255, 255, calc(var(--glass-panel-opacity) * 0.314))',
    )
    expect(appShellRule).toContain(
      '--theme-mist-glass-sheen-faint: rgba(255, 255, 255, calc(var(--glass-panel-opacity) * 0.057))',
    )
    expect(appShellRule).toContain(
      '--theme-mist-glass-edge-top: rgba(255, 255, 255, calc(var(--glass-panel-opacity) * 0.743))',
    )
    expect(appShellRule).toContain(
      '--theme-mist-glass-edge-bottom: rgba(18, 35, 32, calc(var(--glass-panel-opacity) * 0.071))',
    )
    expect(appShellRule).toContain('background: transparent')
    expect(cssRule('.app-shell:not(.app-shell--map)')).toContain('background: var(--page-board-bg)')
    expect(appSource).toContain('className="app-board"')
    expect(boardRule).toContain('position: absolute')
    expect(boardRule).toContain('inset: 0')
    expect(boardRule).not.toContain('border:')
    expect(boardRule).not.toContain('border-radius:')
    expect(boardRule).not.toContain('box-shadow:')
    expect(boardRule).toContain('overflow: hidden')
    expect(boardRule).toContain('background: transparent')
    expect(boardRule).toContain('isolation: isolate')
    expect(cssRule('.app-board::before')).not.toContain('linear-gradient(90deg')
    expect(navRule).toContain('position: absolute')
    expect(navRule).not.toContain('position: fixed')
    expect(navRule).toContain('top: 22px')
    expect(navRule).toContain('left: 50%')
    expect(sharedGlassRule).toContain('background: var(--solid-glass-panel-bg)')
    expect(sharedGlassRule).toContain('box-shadow: var(--glass-panel-shadow)')
    expect(sharedGlassRule).toContain('backdrop-filter: var(--glass-panel-filter)')
    expect(cssRule('.glass-panel::before')).toContain('var(--theme-mist-glass-sheen-strong)')
    expect(cssRule('.glass-panel::before')).toContain('var(--theme-mist-glass-sheen-soft)')
    expect(cssRule('.glass-panel::before')).toContain('var(--theme-mist-glass-sheen-faint)')
    expect(cssRule('.glass-panel::before')).toContain('var(--theme-mist-glass-edge-top)')
    expect(cssRule('.glass-panel::before')).toContain('var(--theme-mist-glass-edge-bottom)')
    expect(appSource).toContain('glass-panel glass-panel--solid glass-panel--pill app-nav')
    expect(appSource).toContain('aria-label="二级导航"')
    expect(appSource).toContain('className="secondary-nav-rail"')
    expect(appSource).toContain('className="right-context-panel"')
    expect(appSource).toContain('aria-label="右侧上下文栏"')
    expect(appSource).toContain('const secondaryNavItemsByView')
    expect(appSource).toContain("label: '足迹'")
    expect(appSource).toContain("label: '区域'")
    expect(appSource).toContain("label: '统计'")
    expect(appSource).toContain("label: '流水'")
    expect(rightPanelRule).toContain('position: absolute')
    expect(rightPanelRule).toContain('box-sizing: border-box')
    expect(rightPanelRule).toContain('var(--shell-board-inset-x)')
    expect(rightPanelRule).toContain('var(--shell-board-inset-y)')
    expect(rightPanelRule).toMatch(/inset:\s*var\(--shell-board-inset-y\)/)
    expect(rightPanelRule).not.toContain('calc(var(--shell-board-top-reserve) + var(--shell-board-inset-y))')
    expect(rightPanelRule).not.toContain('inset: var(--shell-board-top-reserve) 0 0 auto')
    expect(rightPanelRule).toContain('width: var(--right-panel-width)')
    expect(rightPanelRule).not.toContain('height: 100svh')
    expect(rightPanelRule).toContain('grid-template-rows: auto minmax(0, 1fr)')
    expect(rightPanelRule).toContain('padding: 0')
    expect(rightPanelRule).not.toContain('border-left:')
    expect(rightPanelRule).toContain('background: transparent')
    expect(rightPanelRule).toContain('box-shadow: none')
    expect(rightPanelRule).toContain('backdrop-filter: none')
    expect(rightPanelRule).toContain('pointer-events: auto')
    expect(appSource).toContain('right-context-panel__stack')
    expect(appSource).toContain('glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__summary')
    expect(appSource).toContain('glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__legend')
    expect(rightPanelRule).not.toContain('overflow: hidden')
    expect(rightPanelStackRule).toContain('display: grid')
    expect(rightPanelStackRule).toContain('gap: 14px')
    expect(rightPanelStackRule).toContain('align-content: start')
    expect(rightPanelStackRule).toContain('--right-panel-shadow-buffer: 24px')
    expect(rightPanelStackRule).toContain('box-sizing: border-box')
    expect(rightPanelStackRule).toContain('width: calc(100% + (var(--right-panel-shadow-buffer) * 2))')
    expect(rightPanelStackRule).toContain('margin: calc(0px - var(--right-panel-shadow-buffer))')
    expect(rightPanelStackRule).toContain('padding: var(--right-panel-shadow-buffer)')
    expect(rightPanelStackRule).toContain('overflow: visible')
    expect(rightPanelStackRule).not.toContain('overflow-x: hidden')
    expect(rightPanelStackRule).not.toContain('overflow-y: auto')
    expectNoOwnedGlassMaterial(rightPanelGlassRule)
    expect(cssRule('.glass-panel--card')).toContain('border-radius: 24px')
    expect(secondaryRailRule).toContain('display: grid')
    expect(secondaryItemsRule).toContain('display: flex')
    expect(secondaryItemsRule).toContain('padding: 5px')
    expect(cssRule('.glass-panel--pill')).toContain('border-radius: 999px')
    expectNoOwnedGlassMaterial(secondaryItemsRule)
    expect(panelRule).toContain('var(--shell-board-inset-x)')
    expect(panelRule).toContain('var(--shell-board-inset-y)')
    expect(panelRule).toMatch(/inset:\s*var\(--shell-board-inset-y\)/)
    expect(panelRule).not.toContain('calc(var(--shell-board-top-reserve) + var(--shell-board-inset-y))')
    expect(panelRule).not.toContain('inset: var(--shell-board-top-reserve) auto 0 0')
    expect(panelRule).toContain('box-sizing: border-box')
    expectNoOwnedGlassMaterial(panelRule)
    expect(panelRule).not.toContain('inset -1px 0 0 rgba(255, 255, 255, 0.42)')
    expect(panelRule).toContain('width: var(--data-panel-width, 0px)')
    expect(panelRule).toContain('overflow: visible')
    expect(panelRule).toContain('pointer-events: none')
    expect(cssRule('.app-shell:not(.has-data-panel) .time-context-panel')).toContain(
      'display: none',
    )
    expect(workspaceRule).toContain(
      'calc(var(--right-panel-width) + var(--shell-board-inset-x) + var(--shell-board-column-gutter))',
    )
    expect(workspaceRule).toContain(
      'calc(var(--data-panel-width) + var(--shell-board-inset-x) + var(--shell-board-column-gutter))',
    )
    expect(workspaceRule).toMatch(/inset:\s*var\(--shell-board-inset-y\)/)
    expect(workspaceRule).not.toContain('calc(var(--shell-board-top-reserve) + var(--shell-board-inset-y))')
    expect(workspaceRule).not.toContain('100vw')
    expect(workspaceRule).not.toContain('height: 100svh')
    expect(workspaceRule).toContain('overflow: visible')
    expect(workspaceRule).toContain('background: transparent')
    expect(stageRule).toContain('inset: 0')
    expect(stageRule).not.toContain('calc(var(--shell-board-top-reserve) + var(--shell-board-inset-y))')
    expect(stageRule).not.toContain('100vw')
    expect(stageRule).not.toContain('100svh')
    expect(stageRule).toContain('--map-loading-bg: var(--page-board-bg)')
    expect(stageRule).toContain('background: transparent')
    expect(stageRule).toContain('z-index: 0')
    expect(cssRule('.map-stage::before')).toContain('background: var(--map-loading-bg)')
    expect(cssRule('.map-stage::before')).toContain('opacity: 0')
    expect(cssRule('.map-stage--loading::before')).toContain('opacity: 1')
    expect(cssRule('.map-stage--loading::before')).toContain('z-index: 2')
    expect(cssRule('.map-stage--missing-token::before')).toContain('opacity: 1')
    expect(cssRule('.map-stage--error::before')).toContain('opacity: 1')
    expect(cssRule('.map-stage--ready::before')).toContain('opacity: 0')
    expect(cssRule('.map-stage--ready::before')).toContain('z-index: 0')
    expect(cssRule('.app-shell--map')).toContain('background: transparent')
    expect(cssRule('.app-shell:not(.app-shell--map)')).toContain('background: var(--page-board-bg)')
    expect(cssRule('.app-shell--map .app-board')).toContain('background: transparent')
    expect(cssRule('.app-shell--map .secondary-nav-rail')).toBe('')
    expect(cssRule('.app-shell--accounting .secondary-nav-rail')).toBe('')
    expect(cssRule('.app-shell--schedule .secondary-nav-rail')).toBe('')
    expect(cssRule('.secondary-nav-rail__button')).toContain('box-sizing: border-box')
    expect(cssRule('.secondary-nav-rail__button')).toContain('flex: 1 1 0')
    expect(cssRule('.secondary-nav-rail__button')).toContain('height: 34px')
    expect(cssRule('.secondary-nav-rail__button')).toContain('grid-template-columns: auto minmax(0, 1fr)')
    expect(cssRule('.secondary-nav-rail__button.is-active')).toContain('background: #123f35')
    expect(cssRule('.amap-surface')).toContain('background: transparent')
    expect(cssRule('.amap-surface')).not.toContain('var(--page-board-bg)')
  })

  it('keeps accounting in a three-panel shell with the shared time rail visible', () => {
    const accountingAppShellRule = cssRule('.app-shell--accounting')
    const accountingShellRule = cssRule('.app-shell--accounting .time-context-panel')
    const accountingWorkspaceRule = cssRule('.app-shell--accounting .main-workspace')
    const accountingRailScrollRule = cssRule('.app-shell--accounting .time-context-panel__scroll')
    const accountingPageRule = cssRule('.accounting-page')
    const workspaceRule = cssRule('.ios-account-ledger-workspace')
    const ledgerMainPlacementRule = cssRule('.ios-ledger-main')
    const mobileMedia = mediaBlock('@media (max-width: 720px)')

    expect(accountingAppShellRule).toBe('')
    expect(accountingShellRule).not.toContain('display: none')
    expect(accountingShellRule).toBe('')
    expect(accountingShellRule).not.toContain('border-right:')
    expect(accountingShellRule).not.toContain('rgba(247, 250, 249, 0.9)')
    expect(accountingWorkspaceRule).toBe('')
    expect(accountingRailScrollRule).toBe('')
    expect(cssRule('.time-context-panel')).toContain('width: var(--data-panel-width, 0px)')
    expect(cssRule('.main-workspace')).toContain(
      'calc(var(--right-panel-width) + var(--shell-board-inset-x) + var(--shell-board-column-gutter))',
    )
    expect(cssRule('.main-workspace')).toContain(
      'calc(var(--data-panel-width) + var(--shell-board-inset-x) + var(--shell-board-column-gutter))',
    )
    expect(accountingPageRule).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
    expect(accountingPageRule).toContain('--accounting-outer-gutter: 36px')
    expect(accountingPageRule).toContain('--accounting-internal-gap: 24px')
    expect(accountingPageRule).not.toContain('--accounting-left-bleed')
    expect(cssCustomPx(accountingPageRule, '--accounting-outer-gutter')).toBeGreaterThan(
      cssCustomPx(accountingPageRule, '--accounting-internal-gap'),
    )
    expect(
      cssCustomPx(accountingPageRule, '--accounting-outer-gutter') -
        cssCustomPx(accountingPageRule, '--accounting-internal-gap'),
    ).toBe(12)
    expect(accountingPageRule).toContain('column-gap: var(--accounting-internal-gap)')
    expect(accountingPageRule).toContain('margin-left: 0')
    expect(accountingPageRule).toContain('width: 100%')
    expect(accountingPageRule).toContain(
      'padding: 96px var(--accounting-outer-gutter) 18px var(--accounting-outer-gutter)',
    )
    expect(accountingPageRule).toContain('background: transparent')
    expect(accountingPageRule).not.toContain('#ccd6d7')
    expect(accountingPageRule).not.toContain('rgba(238, 244, 242, 0.66)')
    expect(cssRule('.accounting-content-slot')).toBe('')
    expect(accountingPageRule).not.toContain('#f2f5f2')
    expect(cssRule('.accounting-page::before')).toBe('')
    expect(cssRule('.app-shell--accounting .time-context-panel::after')).toBe('')
    expect(cssRuleIn(mobileMedia, '.accounting-page')).toContain('padding: 10px 10px 12px')
    expect(cssRuleIn(mobileMedia, '.accounting-page::before')).toBe('')
    expect(cssRuleIn(mobileMedia, '.app-shell--accounting .time-context-panel::after')).toBe('')
    expect(cssRuleIn(mobileMedia, '.right-context-panel')).toContain('display: none')
    expect(
      cssRuleIn(
        mediaBlock(
          '@media (min-width: 721px) and (max-width: 1440px), (min-width: 721px) and (max-height: 790px)',
        ),
        '.accounting-page',
      ),
    ).toContain('--accounting-outer-gutter: 28px')
    expect(workspaceRule).toContain('grid-column: 1')
    expect(workspaceRule).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
    expect(workspaceRule).toContain('gap: var(--accounting-internal-gap)')
    expect(workspaceRule).toContain('align-items: start')
    expect(workspaceRule).toContain('position: relative')
    expect(ledgerMainPlacementRule).toContain('grid-column: 1')
    expect(ledgerMainPlacementRule).toContain('height: 100%')
    expect(ledgerMainPlacementRule).not.toContain('100svh')
    expect(cssRule('.ios-accounting-secondary-rail')).toBe('')
    expect(cssRule('.ios-accounting-side-panel')).toBe('')
    expect(cssRule('.ios-accounting-secondary-tabs')).toBe('')
    expect(cssRuleIn(mobileMedia, '.ios-account-ledger-workspace')).toContain('grid-column: 1')
    expect(cssRuleIn(mobileMedia, '.ios-account-ledger-workspace')).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
    expect(cssRuleIn(mobileMedia, '.ios-ledger-main')).toContain('grid-column: 1')
    expect(cssRuleIn(mobileMedia, '.accounting-content-slot')).toBe('')
    expect(cssRuleIn(mobileMedia, '.ios-accounting-side-panel')).toBe('')
  })

  it('keeps the shared time panel high in the left rail without a fake top spacer', () => {
    const scrollRule = cssRule('.time-context-panel__scroll')

    expect(scrollRule).toContain('--time-panel-shadow-buffer: 34px')
    expect(scrollRule).toContain('position: relative')
    expect(scrollRule).toContain('width: calc(100% + var(--time-panel-shadow-buffer))')
    expect(scrollRule).toContain('margin-right: calc(0px - var(--time-panel-shadow-buffer))')
    expect(scrollRule).toContain(
      'grid-template-rows: max-content max-content minmax(0, 1fr)',
    )
    expect(scrollRule).not.toContain('grid-template-rows: max-content max-content minmax(174px, 1fr)')
    expect(scrollRule).not.toContain('grid-template-rows: auto minmax(0, 1fr) auto')
    expect(scrollRule).toContain(
      'padding: 24px calc(24px + var(--time-panel-shadow-buffer)) 18px 24px',
    )
    expect(scrollRule).toContain('gap: 20px')
    expect(scrollRule).toContain('overflow: visible')
    expect(scrollRule).not.toContain('overflow-x: hidden')
    expect(scrollRule).not.toContain('overflow-y: auto')
    expect(scrollRule).not.toContain('scrollbar-width')
    expect(cssRule('.time-panel-content')).toContain('overflow: visible')
    expect(cssRule('.time-panel-content')).toContain('height: var(--time-panel-stage-height, auto)')
    expect(cssRule('.time-panel-content')).toContain(
      'height 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    expect(cssRule('.time-panel-content')).not.toContain('min-height: max-content')
    expect(cssRule('.time-panel-content')).not.toContain('overflow: auto')
    expect(cssRule('.time-panel-content::-webkit-scrollbar')).toBe('')
    expect(scrollRule).toContain('pointer-events: none')
    expect(scrollRule).not.toContain('padding: 16px')
    expect(scrollRule).not.toContain('padding: 88px')
    expect(cssRule('.time-context-panel__scroll > *')).toContain('pointer-events: auto')
  })

  it('keeps the persistent time editor on the shared panel grid without stale editing overrides', () => {
    const scrollRule = cssRule('.time-context-panel__scroll')

    expect(scrollRule).toContain(
      'grid-template-rows: max-content max-content minmax(0, 1fr)',
    )
    expect(scrollRule).toContain('position: relative')
    expect(scrollRule).toContain('gap: 20px')
    expect(appCss).not.toContain('is-editing-time')
    expect(timeContextPanelSource).not.toContain('is-editing-time')
  })

  it('keeps the left time panel layout isomorphic across navigation views', () => {
    const sharedScrollRule = cssRule('.time-context-panel__scroll')

    expect(sharedScrollRule).toContain(
      'padding: 24px calc(24px + var(--time-panel-shadow-buffer)) 18px 24px',
    )
    expect(sharedScrollRule).toContain('gap: 20px')
    expect(cssRule('.app-shell--map .time-context-panel__scroll')).toBe('')
    expect(cssRule('.app-shell--accounting .time-context-panel__scroll')).toBe('')
    expect(cssRule('.app-shell--schedule .time-context-panel__scroll')).toBe('')
  })

  it('partitions the shared time panel above every mobile workspace', () => {
    const mobileMedia = mediaBlock('@media (max-width: 720px)')
    const shellRule = cssRuleIn(mobileMedia, '.app-shell')
    const panelRule = cssRuleIn(mobileMedia, '.time-context-panel')
    const visibleWithoutDesktopWidthRule = cssRuleIn(
      mobileMedia,
      '.app-shell:not(.has-data-panel) .time-context-panel',
    )
    const scrollRule = cssRuleIn(mobileMedia, '.time-context-panel__scroll')
    const scrollWithTrendRule = cssRuleIn(
      mobileMedia,
      '.time-context-panel__scroll:has(.time-context-trend)',
    )
    const trendRule = cssRuleIn(mobileMedia, '.time-context-trend')
    const workspaceRule = cssRuleIn(mobileMedia, '.main-workspace')

    expect(shellRule).toContain('--mobile-time-panel-height: min(48svh, 400px)')

    expect(panelRule).not.toContain('display: none')
    expect(panelRule).toContain('inset:')
    expect(panelRule).toContain('var(--shell-board-top-reserve)')
    expect(panelRule).toContain('var(--shell-board-inset-x)')
    expect(panelRule).toContain('auto')
    expect(panelRule).toContain('width: auto')
    expect(panelRule).toContain('height: var(--mobile-time-panel-height)')
    expect(panelRule).toContain('min-height: 0')
    expect(panelRule).toContain('overflow: hidden')
    expect(panelRule).toContain('z-index: 4')
    expect(visibleWithoutDesktopWidthRule).toContain('display: block')

    expect(scrollRule).toContain('--time-panel-shadow-buffer: 0px')
    expect(scrollRule).toContain('box-sizing: border-box')
    expect(scrollRule).toContain('width: 100%')
    expect(scrollRule).toContain('height: 100%')
    expect(scrollRule).toContain('min-height: 0')
    expect(scrollRule).toContain('margin-right: 0')
    expect(scrollRule).toContain(
      'grid-template-rows: max-content minmax(0, 1fr)',
    )
    expect(scrollRule).toContain('gap: 12px')
    expect(scrollRule).toContain('padding: 14px')
    expect(scrollRule).toContain('overflow-x: hidden')
    expect(scrollRule).toContain('overflow-y: auto')
    expect(scrollRule).toContain('overscroll-behavior: contain')

    expect(scrollWithTrendRule).toContain(
      'grid-template-rows: minmax(144px, 1fr) max-content max-content',
    )

    expect(trendRule).toContain('grid-row: 1')
    expect(trendRule).toContain('min-height: 144px')

    expect(workspaceRule).toContain(
      'calc(var(--shell-board-top-reserve) + var(--mobile-time-panel-height) + 10px)',
    )

    for (const view of ['map', 'accounting', 'schedule']) {
      expect(cssRuleIn(mobileMedia, `.app-shell--${view} .time-context-panel`)).toBe('')
      expect(cssRuleIn(mobileMedia, `.app-shell--${view} .time-context-panel__scroll`)).toBe('')
      expect(cssRuleIn(mobileMedia, `.app-shell--${view} .main-workspace`)).toBe('')
    }
  })

  it('places the icon-only settings entry at the far right of the right rail header', () => {
    expect(timeContextPanelSource).not.toContain('aria-label="打开设置"')
    expect(timeContextPanelSource).not.toContain('className="time-context-panel__footer"')
    expect(timeContextPanelSource).not.toContain('time-settings-button')
    expect(appSource).toContain('aria-label="打开设置"')
    expect(appSource).toContain('className="right-context-settings-button"')
    expect(cssRule('.secondary-nav-rail__items')).toContain('display: flex')
    expect(cssRule('.secondary-nav-rail__items')).toContain('align-items: center')
    expect(cssRule('.right-context-settings-button')).toContain('flex: 0 0 34px')
    expect(cssRule('.right-context-settings-button')).toContain('width: 34px')
    expect(cssRule('.right-context-settings-button')).toContain('height: 34px')
    expect(cssRule('.right-context-settings-button')).toContain('border: 1px solid rgba(23, 35, 31, 0.06)')
    expect(cssRule('.right-context-settings-button')).toContain('border-radius: 999px')
    expect(cssRule('.right-context-settings-button')).toContain('background: rgba(255, 255, 255, 0.38)')
    expect(cssRule('.right-context-settings-button:hover')).toContain(
      'box-shadow: 0 7px 16px rgba(18, 63, 53, 0.08)',
    )
    expect(cssRule('.glass-panel--pill')).toContain('border-radius: 999px')
    expect(cssRule('.app-shell--map .time-context-panel__footer')).toBe('')
    expect(cssRule('.app-shell--accounting .time-context-panel__footer')).toBe('')
    expect(cssRule('.app-shell--schedule .time-context-panel__footer')).toBe('')
  })

  it('keeps the accounting ledger surface unframed so the center column reads as open content', () => {
    const ledgerRule = cssRule('.ios-ledger-main')

    expect(ledgerRule).toContain('background: transparent')
    expect(ledgerRule).toContain('border: 0')
    expect(ledgerRule).toContain('box-shadow: none')
    expect(ledgerRule).not.toContain('0 24px 58px')
    expect(ledgerRule).toContain('backdrop-filter: none')
  })

  it('keeps the right account column as an unframed assistant area instead of a dominant panel', () => {
    const accountPanelRule = cssRule('.ios-account-filter-panel')

    expect(accountPanelRule).toContain('border: 0')
    expect(accountPanelRule).toContain('background: transparent')
    expect(accountPanelRule).toContain('box-shadow: none')
    expect(accountPanelRule).toContain('backdrop-filter: none')
    expect(accountPanelRule).not.toContain('0 24px 58px')
    expect(accountPanelRule).not.toContain('rgba(255, 255, 255, 0.46)')
  })

  it('keeps the time overview unframed inside the single left glass rail', () => {
    const panelRule = cssRule('.time-context-panel')
    const scrollRule = cssRule('.time-context-panel__scroll')
    const cardRule = cssRule('.time-context-card')

    expect(panelRule).toContain('overflow: visible')
    expect(panelRule).toContain('pointer-events: none')
    expect(scrollRule).toContain('--time-panel-shadow-buffer: 34px')
    expect(scrollRule).toContain('width: calc(100% + var(--time-panel-shadow-buffer))')
    expect(scrollRule).toContain('margin-right: calc(0px - var(--time-panel-shadow-buffer))')
    expect(scrollRule).toContain('pointer-events: none')
    expect(cssRule('.time-context-panel__scroll > *')).toContain('pointer-events: auto')
    expect(cardRule).toContain('border-radius: 0')
    expect(cardRule).toContain('background: transparent')
    expect(cardRule).toContain('box-shadow: none')
    expect(cardRule).toContain('backdrop-filter: none')
    expect(cardRule).not.toContain('0 18px 34px')
    expect(cardRule).not.toContain('rgba(255, 255, 255, 0.72)')
  })

  it('balances the accounting page with the shared rail and keeps ledger content unframed', () => {
    const accountingPageRule = cssRule('.accounting-page')
    const workspaceRule = cssRule('.ios-account-ledger-workspace')
    const ledgerRule = cssRule('.ios-ledger-main')
    const ledgerScrollRule = cssRule('.accounting-scroll--ledger')
    const accountPanelRule = cssRule('.ios-account-filter-panel')

    expect(cssRule('.app-shell--accounting .time-context-panel__scroll')).toBe('')
    expect(accountingPageRule).toContain('--accounting-outer-gutter: 36px')
    expect(accountingPageRule).toContain('--accounting-internal-gap: 24px')
    expect(cssCustomPx(accountingPageRule, '--accounting-outer-gutter')).toBeGreaterThan(
      cssCustomPx(accountingPageRule, '--accounting-internal-gap'),
    )
    expect(
      cssCustomPx(accountingPageRule, '--accounting-outer-gutter') -
        cssCustomPx(accountingPageRule, '--accounting-internal-gap'),
    ).toBe(12)
    expect(accountingPageRule).toContain('column-gap: var(--accounting-internal-gap)')
    expect(accountingPageRule).toContain('margin-left: 0')
    expect(accountingPageRule).toContain('width: 100%')
    expect(accountingPageRule).toContain(
      'padding: 96px var(--accounting-outer-gutter) 18px var(--accounting-outer-gutter)',
    )
    expect(workspaceRule).toContain('gap: var(--accounting-internal-gap)')
    expect(ledgerRule).toContain('height: 100%')
    expect(ledgerRule).not.toContain('100svh')
    expect(ledgerRule).toContain('background: transparent')
    expect(ledgerRule).toContain('border: 0')
    expect(ledgerRule).toContain('box-shadow: none')
    expect(ledgerRule).toContain('overflow: visible')
    expect(ledgerScrollRule).toContain('padding: 0')
    expect(ledgerScrollRule).toContain('gap: 10px')
    expect(accountPanelRule).toContain('height: 100%')
    expect(accountPanelRule).not.toContain('100svh')
    expect(accountPanelRule).toContain('max-width: 320px')
    expect(accountPanelRule).toContain('background: transparent')
    expect(accountPanelRule).toContain('box-shadow: none')
  })

  it('keeps compact desktop accounting columns aligned to the shared rail', () => {
    const compactMedia = mediaBlock(
      '@media (min-width: 721px) and (max-width: 1440px), (min-width: 721px) and (max-height: 790px)',
    )
    const compactAccountingRule = cssRuleIn(compactMedia, '.accounting-page')

    expect(compactAccountingRule).toContain('--accounting-outer-gutter: 28px')
    expect(compactAccountingRule).toContain('--accounting-internal-gap: 20px')
    expect(cssCustomPx(compactAccountingRule, '--accounting-outer-gutter')).toBeGreaterThan(
      cssCustomPx(compactAccountingRule, '--accounting-internal-gap'),
    )
    expect(
      cssCustomPx(compactAccountingRule, '--accounting-outer-gutter') -
        cssCustomPx(compactAccountingRule, '--accounting-internal-gap'),
    ).toBe(8)
    expect(compactAccountingRule).toContain('column-gap: var(--accounting-internal-gap)')
    expect(compactAccountingRule).toContain(
      'padding: 96px var(--accounting-outer-gutter) 14px var(--accounting-outer-gutter)',
    )
    expect(compactAccountingRule).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
    expect(cssRuleIn(compactMedia, '.ios-account-ledger-workspace')).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
    expect(cssRuleIn(compactMedia, '.ios-account-ledger-workspace')).toContain(
      'gap: var(--accounting-internal-gap)',
    )
    expect(cssRuleIn(compactMedia, '.time-context-panel__scroll')).toContain(
      'padding: 24px calc(24px + var(--time-panel-shadow-buffer)) 18px 24px',
    )
    expect(cssRuleIn(compactMedia, '.ios-ledger-main')).toContain('height: 100%')
    expect(cssRuleIn(compactMedia, '.ios-account-filter-panel')).toContain('height: 100%')
    expect(cssRuleIn(compactMedia, '.ios-account-filter-panel')).toContain('max-width: 286px')
    expect(cssRuleIn(compactMedia, '.ios-accounting-side-panel')).toBe('')
    expect(cssRuleIn(compactMedia, '.ios-account-filter-panel')).not.toContain('height: calc(100svh - 112px)')
    expect(cssRuleIn(compactMedia, '.ios-ledger-main')).not.toContain('height: calc(100svh - 136px)')
  })

  it('moves accounting metrics into the time card instead of the bottom summary grid', () => {
    expect(timeContextPanelSource).toContain('aria-label="全局范围指标"')
    expect(timeContextPanelSource).not.toContain('aria-label="记账概览卡片"')
    expect(timeContextPanelSource).not.toContain('aria-label="当前范围摘要"')
    expect(cssRule('.time-context-metric-strip')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(cssRule('.time-context-metric-strip__label')).toContain('display: inline-flex')
    expect(cssRule('.time-context-trend__plot')).toContain('grid-template-columns: repeat(var(--trend-column-count, 17), minmax(0, 1fr))')
    expect(timeContextPanelSource).not.toContain('className="time-panel-content__actions"')
    expect(cssRule('.time-panel-content__actions')).toBe('')
    expect(cssRule('.time-context-accounting-summary')).toBe('')
    expect(cssRule('.time-context-summary')).toBe('')
    expect(cssRule('.ios-summary-strip')).toBe('')
  })

  it('scopes condensed metric number typography to the map metric strip only', () => {
    expect(timeContextPanelSource).toContain("'time-context-metric-strip--map'")
    expect(cssRule('.time-context-metric-strip .time-context-metric-strip__number')).not.toContain(
      'font-stretch: condensed',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__number')).toContain(
      'font-family: "Aptos Narrow", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__number')).not.toContain(
      'font-stretch: condensed',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__number')).toContain(
      'color: #0d1714',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__number')).toContain(
      'font-size: 21px',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__number')).toContain(
      'font-weight: 760',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__number')).toContain(
      'transform: scaleX(1.035)',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__number')).toContain(
      'transform-origin: left center',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__unit')).toContain(
      'font-size: 11px',
    )
  })

  it('locks the map metric and distance chart visual contract', () => {
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__label span')).toContain(
      'color: rgba(21, 48, 42, 0.72)',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__label svg')).toContain(
      'color: rgba(15, 106, 92, 0.9)',
    )
    expect(cssRule('.time-context-metric-strip--map .time-context-metric-strip__unit')).toContain(
      'color: rgba(21, 48, 42, 0.68)',
    )
    expect(cssRule('.time-context-panel__scroll')).toContain(
      'grid-template-rows: max-content max-content minmax(0, 1fr)',
    )
    expect(cssRule('.time-context-trend')).toContain('position: relative')
    expect(cssRule('.time-context-trend')).toContain('z-index: 1')
    expect(cssRule('.time-context-trend')).toContain('align-self: stretch')
    expect(cssRule('.time-context-trend')).toContain('display: flex')
    expect(cssRule('.time-context-trend')).toContain('flex-direction: column')
    expect(cssRule('.time-context-trend')).toContain('padding-bottom: 5px')
    expect(cssRule('.time-context-trend')).not.toContain('height: 196px')
    expect(cssRule('.time-context-trend')).not.toContain('height: 220px')
    expect(cssRule('.time-context-trend')).not.toContain('position: absolute')
    expect(cssRule('.time-context-trend')).not.toContain('bottom: 18px')
    expect(cssRule('.time-context-trend')).not.toContain('margin-top')
    expect(cssRule('.time-context-trend')).toContain('transition:')
    expect(cssRule('.time-context-trend')).toContain('opacity 180ms ease')
    expect(cssRule('.time-context-trend.is-hidden')).toContain('opacity: 0')
    expect(cssRule('.time-context-trend.is-hidden')).toContain('visibility: hidden')
    expect(cssRule('.time-context-trend.is-hidden')).toContain('pointer-events: none')
    expect(cssRule('.time-context-trend.is-hidden')).not.toContain('display:')
    expect(cssRule('.time-context-trend.is-hidden')).not.toContain('height:')
    expect(cssRule('.time-context-trend__head')).toContain('display: grid')
    expect(cssRule('.time-context-trend__head')).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(cssRule('.time-context-trend__head')).toContain('align-items: start')
    expect(cssRule('.time-context-trend__title')).toContain('flex-wrap: wrap')
    expect(cssRule('.time-context-trend__title span')).toContain('white-space: nowrap')
    expect(cssRule('.time-context-trend__summary')).toContain('display: grid')
    expect(cssRule('.time-context-trend__summary')).toContain('gap: 0')
    expect(cssRule('.time-context-trend__summary')).toContain('justify-self: end')
    expect(cssRule('.time-context-trend__summary')).toContain('text-align: right')
    expect(cssRule('.time-context-trend__summary')).toContain('white-space: normal')
    expect(cssRule('.time-context-trend__summary-line')).toContain('white-space: nowrap')
    expect(cssRule('.time-context-trend__chart')).toContain('flex: 1 1 auto')
    expect(cssRule('.time-context-trend__chart')).toContain('min-height: 144px')
    expect(cssRule('.time-context-trend__chart')).not.toMatch(/\n\s*height: 144px/)
    expect(cssRule('.time-context-trend__chart')).toContain('padding: 0 1px')
    expect(cssRule('.time-context-trend__chart')).toContain('overflow: hidden')
    expect(cssRule('.time-context-trend__plot')).toContain('position: relative')
    expect(cssRule('.time-context-trend__plot')).toContain('height: 100%')
    expect(cssRule('.time-context-trend__plot')).toContain('grid-template-columns: repeat(var(--trend-column-count, 17), minmax(0, 1fr))')
    expect(cssRule('.time-context-trend__column')).toContain('height: 100%')
    expect(cssRule('.time-context-trend__column')).toContain('align-items: end')
    expect(cssRule('.time-context-trend__bar')).toContain('width: min(9px, 82%)')
    expect(cssRule('.time-context-trend__bar')).not.toContain('min-height')
    expect(cssRule('.time-context-trend__bar')).toContain('border-radius: 2px 2px 1px 1px')
    expect(cssRule('.time-context-trend__chart--dense .time-context-trend__plot')).toContain('gap: 0')
    expect(cssRule('.time-context-trend__chart--dense .time-context-trend__bar')).toContain(
      'width: 100%',
    )
    expect(cssRule('.time-context-trend__chart--dense .time-context-trend__bar')).not.toContain(
      'min-height',
    )
    expect(cssRule('.time-context-trend__average-label')).not.toContain('background:')
    expect(cssRule('.time-context-trend__average-label')).toContain(
      'bottom: var(--trend-average-position, 50%)',
    )
    expect(cssRule('.time-context-trend__average-label')).toContain('transform: translateY(-6px)')
    expect(cssRule('.time-context-trend__bar.is-active')).toContain('background: #0f7f70')
    expect(cssRule('.time-context-trend__bar.is-emphasis')).toBe('')
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
    expect(rule).toContain('padding: 0 10px')
    expect(rule).toContain('font-size: 11px')
  })

  it('keeps the top-level time mode slider visually compact', () => {
    const tabsRule = cssRule('.time-mode-tabs')
    const buttonRule = cssRule('.time-mode-tabs button')

    expect(tabsRule).toContain('--segmented-thumb-bg: #123f35')
    expect(tabsRule).toContain('--segmented-padding: 2px')
    expect(tabsRule).toContain('--segmented-label-font-size: 11px')
    expect(tabsRule).toContain('--segmented-label-font-weight: 780')
    expect(tabsRule).toContain('padding: 3px')
    expect(buttonRule).toContain('height: 24px')
    expect(buttonRule).toContain('font-size: 11px')
    expect(buttonRule).toContain('font-weight: 780')
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

  it('centers time picker arrow icons inside circular buttons', () => {
    const rule = cssRule('.time-picker-bar button:not(.time-period-title)')
    const iconRule = cssRule('.time-picker-bar button:not(.time-period-title) svg')

    expect(rule).toContain('display: grid')
    expect(rule).toContain('place-items: center')
    expect(rule).toContain('line-height: 1')
    expect(iconRule).toContain('display: block')
    expect(iconRule).toContain('color: currentColor')
  })

  it('centers calendar arrow icons inside circular buttons', () => {
    const rule = cssRule('.time-picker-bar button:not(.time-period-title)')
    const iconRule = cssRule('.time-picker-bar button:not(.time-period-title) svg')

    expect(appCss).toMatch(
      /\.time-calendar-bar button:not\(\.time-period-title\),\s*\.time-picker-bar button:not\(\.time-period-title\)\s*\{/,
    )
    expect(appCss).toMatch(
      /\.time-calendar-bar button:not\(\.time-period-title\) svg,\s*\.time-picker-bar button:not\(\.time-period-title\) svg\s*\{/,
    )
    expect(rule).toContain('display: grid')
    expect(rule).toContain('place-items: center')
    expect(rule).toContain('line-height: 1')
    expect(iconRule).toContain('display: block')
    expect(iconRule).toContain('color: currentColor')
  })

  it('gives time picker arrows a clear press state', () => {
    const buttonRule = cssRule('.time-picker-bar button:not(.time-period-title)')
    const activeRule = cssRule('.time-picker-bar button:not(.time-period-title):active')

    expect(buttonRule).toContain('cursor: pointer')
    expect(buttonRule).toContain('transform')
    expect(buttonRule).toContain('box-shadow')
    expect(activeRule).toContain('transform: scale(0.94)')
    expect(activeRule).toContain('box-shadow')
  })

  it('keeps clickable period titles in the full-width pill slot, not arrow button chrome', () => {
    const arrowRule = cssRule('.time-picker-bar button:not(.time-period-title)')
    const titleRule = cssRule('.time-period-title')
    const titleButtonRule = cssRule('.time-period-title--button')

    expect(appCss).toMatch(
      /\.time-calendar-bar button:not\(\.time-period-title\),\s*\.time-picker-bar button:not\(\.time-period-title\)\s*\{/,
    )
    expect(arrowRule).toContain('width: 31px')
    expect(titleRule).toContain('width: 100%')
    expect(titleRule).toContain('border-radius: 999px')
    expect(titleRule).not.toContain('width: 31px')
    expect(titleRule).not.toContain('border-radius: 50%')
    expect(titleButtonRule).toContain('border: 0')
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

  it('animates the day calendar by translating one stable month grid without clipping shadows', () => {
    const shellRule = cssRule('.time-calendar-shell')
    const headRule = cssRule('.time-calendar-head')
    const switchRule = cssRule('.time-calendar-switch')
    const bodyRule = cssRule('.time-calendar-body')
    const bodySlotRule = cssRule('.time-calendar-body-slot')
    const weekBodyRule = cssRule('.time-calendar-body--week')
    const monthBodyRule = cssRule('.time-calendar-body--month')
    const expandingMonthBodyRule = cssRule('.time-calendar-body--expanding-month')
    const collapsingWeekBodyRule = cssRule('.time-calendar-body--collapsing-week')
    const weekdaysRule = cssRule('.time-calendar-weekdays')
    const gridWindowRule = cssRule('.time-calendar-grid-window')
    const gridRule = cssRule('.time-calendar-grid')
    const buttonRule = cssRule('.time-calendar-grid button')

    expect(shellRule).toContain('--time-calendar-day-height: 28px')
    expect(shellRule).toContain('--time-calendar-weekday-height: 17px')
    expect(shellRule).toContain('--time-calendar-grid-gap: 4px')
    expect(shellRule).toContain('overflow: clip')
    expect(headRule).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(headRule).toContain('margin-bottom: 10px')
    expect(switchRule).toContain('grid-template-columns: repeat(2, auto)')
    expect(bodySlotRule).toContain('position: relative')
    expect(bodySlotRule).not.toContain('height: calc(')
    expect(bodySlotRule).not.toContain('var(--time-calendar-day-height)')
    expect(bodyRule).toContain('display: flow-root')
    expect(bodyRule).toContain('overflow: clip')
    expect(bodyRule).toContain('overflow-clip-margin: var(--time-picker-shadow-buffer, 12px)')
    expect(bodyRule).toContain('var(--time-calendar-body-bottom-buffer, 0px)')
    expect(bodyRule).not.toContain('overflow: hidden')
    expect(bodyRule).toContain(
      'height 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    expect(weekBodyRule).toContain('--time-calendar-visible-rows: 1')
    expect(weekBodyRule).toContain(
      '--time-calendar-body-bottom-buffer: var(--time-picker-shadow-buffer, 12px)',
    )
    expect(weekBodyRule).toContain('position: relative')
    expect(weekBodyRule).toContain(
      '--time-calendar-grid-offset: calc(var(--time-calendar-active-week-index) * -1)',
    )
    expect(monthBodyRule).toContain('--time-calendar-grid-offset: 0')
    expect(monthBodyRule).toContain(
      '--time-calendar-body-bottom-buffer: var(--time-picker-shadow-buffer, 12px)',
    )
    expect(monthBodyRule).not.toContain('position: absolute')
    expect(monthBodyRule).not.toContain('top: 0')
    expect(monthBodyRule).not.toContain('box-shadow')
    expect(expandingMonthBodyRule).toContain('--time-calendar-grid-offset: 0')
    expect(expandingMonthBodyRule).toContain(
      '--time-calendar-body-bottom-buffer: var(--time-picker-shadow-buffer, 12px)',
    )
    expect(collapsingWeekBodyRule).toContain(
      '--time-calendar-grid-offset: calc(var(--time-calendar-active-week-index) * -1)',
    )
    expect(collapsingWeekBodyRule).toContain(
      '--time-calendar-body-bottom-buffer: var(--time-picker-shadow-buffer, 12px)',
    )
    expect(collapsingWeekBodyRule).not.toContain('position: absolute')
    expect(collapsingWeekBodyRule).not.toContain('top: 0')
    expect(collapsingWeekBodyRule).not.toContain('box-shadow')
    expect(weekdaysRule).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))')
    expect(weekdaysRule).toContain('margin-top: var(--time-calendar-grid-top-gap)')
    expect(gridWindowRule).toContain('height: calc(')
    expect(gridWindowRule).toContain('overflow: visible')
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
    expect(cssRule('.time-calendar-body--week .time-calendar-grid button:not(.is-visible-week)')).toContain(
      'visibility: hidden',
    )
    expect(cssRule('.time-calendar-body--expanding-month .time-calendar-grid button:not(.is-visible-week)')).toContain(
      'animation: timeCalendarMonthRowsReveal 180ms ease 80ms forwards',
    )
    expect(cssRule('.time-calendar-body--collapsing-week .time-calendar-grid')).toBe('')
    expect(cssRule('.time-calendar-body--collapsing-week .time-calendar-grid button:not(.is-visible-week)')).toContain(
      'visibility: hidden',
    )
    expect(buttonRule).toContain('height: var(--time-calendar-day-height)')
    expect(buttonRule).toContain('min-height: var(--time-calendar-day-height)')
  })

  it('keeps every time selection grid button compact and close to square', () => {
    const calendarCellRule = cssRule('.time-calendar-grid button')
    const pickerCellRule = cssRule('.time-picker-grid button')
    const monthCellRule = cssRule('.time-picker-grid--months button')
    const weekCellRule = cssRule('.time-picker-grid--weeks button')
    const weekDetailRule = cssRule('.time-picker-grid--weeks button small')
    const yearCellRule = cssRule('.time-picker-grid--years button')
    const customDateCellRule = cssRule('.time-date-picker__grid button')
    const customMonthCellRule = cssRule('.time-date-picker__grid--months button')

    expect(calendarCellRule).toContain('border-radius: 11px')
    expect(calendarCellRule).toContain('font-size: 11px')
    expect(calendarCellRule).toContain('font-weight: 760')
    expect(pickerCellRule).toContain('min-height: 34px')
    expect(pickerCellRule).toContain('border-radius: 11px')
    expect(pickerCellRule).toContain('font-size: 11px')
    expect(pickerCellRule).toContain('font-weight: 760')
    expect(monthCellRule).toContain('min-height: 30px')
    expect(monthCellRule).toContain('font-size: 10px')
    expect(monthCellRule).toContain('white-space: nowrap')
    expect(appCss.indexOf('.time-picker-grid--months button')).toBeGreaterThan(
      appCss.indexOf('.time-picker-grid button {'),
    )
    expect(weekCellRule).toContain('min-height: 42px')
    expect(weekDetailRule).toContain('font-size: 8px')
    expect(yearCellRule).toContain('border-radius: 10px')
    expect(customDateCellRule).toContain('height: 26px')
    expect(customDateCellRule).toContain('border-radius: 10px')
    expect(customDateCellRule).toContain('font-size: 10px')
    expect(customDateCellRule).toContain('font-weight: 760')
    expect(customMonthCellRule).toContain('height: 32px')
  })

  it('keeps the day calendar header stable when switching into month selection', () => {
    const headRule = cssRule('.time-calendar-head')
    const switchRule = cssRule('.time-calendar-switch')
    const switchButtonRule = cssRule('.time-calendar-switch button')

    expect(headRule).toContain('min-height: 26px')
    expect(switchRule).toContain('--segmented-padding: 2px')
    expect(switchRule).toContain('--segmented-label-font-size: 10px')
    expect(switchRule).toContain('--segmented-label-font-weight: 760')
    expect(switchRule).toContain('padding: 2px')
    expect(switchButtonRule).toContain('height: 22px')
    expect(switchButtonRule).toContain('padding: 0 7px')
    expect(switchButtonRule).toContain('font-size: 10px')
    expect(switchButtonRule).toContain('font-weight: 760')
  })

  it('starts the day calendar collapse transition from the calendar switch event', () => {
    expect(timeContextPanelSource).toContain('function handleCalendarModeChange')
    expect(timeContextPanelSource).toContain("calendarMode === 'month' && mode === 'week'")
    expect(timeContextPanelSource).toContain('handleCalendarModeChange,')
    expect(timeContextPanelSource).toContain('if (mode !== calendarMode) onCalendarModeChange(mode)')
    expect(timeContextPanelSource).not.toContain('previousCalendarModeRef')
  })

  it('keeps unified top-level time picker grids compact across week month and year modes', () => {
    expect(cssRule('.time-picker-grid')).toContain('gap: 5px')
    expect(cssRule('.time-picker-grid--days')).toContain(
      'grid-template-columns: repeat(7, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--weeks')).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--months')).toContain(
      'grid-template-columns: repeat(6, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--years')).toContain(
      'grid-template-columns: repeat(5, minmax(0, 1fr))',
    )
  })

  it('keeps short week ranges on one line inside picker cards', () => {
    const detailRule = cssRule('.time-picker-grid button small')
    const weekDetailRule = lastCssRule('.time-picker-grid--weeks button small')
    const weekDetailLineRule = lastCssRule('.time-picker-grid--weeks button small > span')
    const weekDetailSeparatorRule = lastCssRule(".time-picker-grid--weeks button small span[aria-hidden='true']")

    expect(detailRule).toContain('white-space: nowrap')
    expect(weekDetailRule).toContain('font-size: 8px')
    expect(weekDetailLineRule).toContain('white-space: nowrap')
    expect(weekDetailLineRule).toContain('text-overflow: ellipsis')
    expect(weekDetailSeparatorRule).toBe('')
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
    const customDateSlotRule = cssRule('.time-date-picker-slot')
    const customDateSlotOpenRule = cssRule('.time-date-picker-slot--open')
    const customDateSlotClosedRule = cssRule('.time-date-picker-slot--closed')
    const customDateSlotInnerRule = cssRule('.time-date-picker-slot__inner')
    const customDateWindowRule = cssRule('.time-date-picker__grid-window')
    const customDateMotionRule = cssRule('.time-date-picker__grid-motion')
    const previousRule = cssRule('.time-range-grid-motion--previous')
    const nextRule = cssRule('.time-range-grid-motion--next')

    expect(timeContextPanelSource).toContain('useMeasuredStageHeight')
    expect(timeContextPanelSource).toContain('style={panelContentStyle}')
    expect(stageRule).toContain('position: relative')
    expect(stageRule).toContain('z-index: 2')
    expect(stageRule).not.toContain('animation:')
    expect(stageRule).not.toContain('transform')
    expect(dayWindowRule).toContain('--time-picker-shadow-buffer')
    expect(dayWindowRule).toContain('var(--time-picker-shadow-buffer) * 2')
    expect(dayWindowRule).toContain('padding: var(--time-picker-shadow-buffer)')
    expect(dayWindowRule).toContain('width: calc(100% + var(--time-picker-shadow-buffer) * 2)')
    expect(dayWindowRule).toContain('calc(var(--time-picker-shadow-buffer) * -1)')
    expect(dayWindowRule).toContain('overflow: visible')
    expect(dayMotionRule).toContain('width: 100%')
    expect(pickerWindowRule).toContain('--time-picker-shadow-buffer')
    expect(pickerWindowRule).toContain('padding: var(--time-picker-shadow-buffer)')
    expect(pickerWindowRule).toContain('width: calc(100% + var(--time-picker-shadow-buffer) * 2)')
    expect(pickerWindowRule).toContain('calc(var(--time-picker-shadow-buffer) * -1)')
    expect(pickerWindowRule).toContain('overflow: visible')
    expect(pickerMotionRule).toContain('width: 100%')
    expect(customDateSlotRule).toContain('display: grid')
    expect(customDateSlotRule).toContain('grid-template-rows: 0fr')
    expect(customDateSlotRule).toContain(
      'grid-template-rows 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    )
    expect(customDateSlotRule).toContain('opacity 180ms ease')
    expect(customDateSlotRule).toContain('transform 260ms cubic-bezier(0.22, 1, 0.36, 1)')
    expect(customDateSlotOpenRule).toContain('grid-template-rows: 1fr')
    expect(customDateSlotOpenRule).toContain('opacity: 1')
    expect(customDateSlotOpenRule).toContain('transform: translateY(0)')
    expect(customDateSlotClosedRule).toContain('pointer-events: none')
    expect(customDateSlotInnerRule).toContain('min-height: 0')
    expect(customDateSlotInnerRule).toContain('overflow: hidden')
    expect(cssRule('.time-date-picker-slot--open .time-date-picker-slot__inner')).toContain(
      'overflow: visible',
    )
    expect(customDateWindowRule).toContain('overflow: visible')
    expect(customDateMotionRule).toContain('width: 100%')
    expect(cssRule('.time-custom-shell .time-date-picker')).not.toContain('position: absolute')
    expect(cssRule('.time-custom-shell .time-date-picker')).not.toContain('top:')
    expect(cssRule('.time-custom-shell .time-date-picker')).not.toContain('right:')
    expect(previousRule).toContain('--time-range-enter-x: -')
    expect(previousRule).toContain('animation:')
    expect(previousRule).toContain('timeRangeGridIn')
    expect(nextRule).toContain('--time-range-enter-x: ')
    expect(nextRule).toContain('animation:')
    expect(nextRule).toContain('timeRangeGridIn')
    expect(appCss).toContain('@keyframes timeRangeGridIn')
    expect(appCss).not.toContain('@keyframes timeRangeStageIn')
  })

  it('lets the custom date picker title open a compact month grid that shares navigation motion', () => {
    const titleRule = cssRule('.time-date-picker__title')
    const titleHoverRule = cssRule('.time-date-picker__title:hover')
    const titleActiveRule = cssRule('.time-date-picker__title:active')
    const arrowButtonRule = cssRule('.time-date-picker__bar button:not(.time-date-picker__title)')
    const monthGridRule = cssRule('.time-date-picker__grid--months')
    const monthButtonRule = cssRule('.time-date-picker__grid--months button')

    expect(timeContextPanelSource).toContain("type CustomDatePickerMode = 'day' | 'month'")
    expect(timeContextPanelSource).toContain("aria-label=\"月份选择\"")
    expect(timeContextPanelSource).toContain("aria-label={isMonthPicker ? '上一年' : '上个月'}")
    expect(timeContextPanelSource).toContain("aria-label={isMonthPicker ? '下一年' : '下个月'}")
    expect(timeContextPanelSource).toContain('time-date-picker__grid-motion')
    expect(timeContextPanelSource).toContain('time-range-grid-motion--')
    expect(titleRule).toContain('display: grid')
    expect(titleRule).toContain('cursor: pointer')
    expect(titleRule).toContain('width: 100%')
    expect(titleRule).toContain('border: 0')
    expect(titleRule).toContain('border-radius: 0')
    expect(titleRule).toContain('background: transparent')
    expect(titleRule).toContain('box-shadow: none')
    expect(titleHoverRule).toContain('background: transparent')
    expect(titleActiveRule).toContain('transform: none')
    expect(arrowButtonRule).toContain('border-radius: 50%')
    expect(cssRule('.time-date-picker__bar button:not(.time-date-picker__title) svg')).toContain(
      'display: block',
    )
    expect(cssRule('.time-date-picker__bar button:not(.time-date-picker__title) svg')).toContain(
      'color: currentColor',
    )
    expect(appCss).not.toMatch(/\.time-date-picker__bar button\s*\{/)
    expect(monthGridRule).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(monthButtonRule).toContain('height: 32px')
    expect(monthButtonRule).toContain('font-size: 10px')
    expect(monthButtonRule).toContain('white-space: nowrap')
  })

  it('frames custom date ranges with the outer shell instead of inner date buttons', () => {
    const shellRule = cssRule('.time-custom-shell')
    const fieldRule = cssRule('.time-date-field')
    const buttonRule = cssRule('.time-date-button')
    const buttonHoverRule =
      appCss.match(/\.time-date-button:hover,\s*\.time-date-button\.is-open\s*\{[^}]*\}/)?.[0] ?? ''

    expect(shellRule).toContain('border: 1px solid')
    expect(shellRule).toContain('border-radius: 22px')
    expect(fieldRule).toContain('padding: 0')
    expect(fieldRule).toContain('border: 0')
    expect(fieldRule).toContain('border-radius: 0')
    expect(fieldRule).toContain('background: transparent')
    expect(fieldRule).toContain('box-shadow: none')
    expect(buttonRule).toContain('border: 0')
    expect(buttonRule).toContain('background: transparent')
    expect(buttonRule).toContain('box-shadow: none')
    expect(buttonHoverRule).toContain('background: transparent')
    expect(buttonHoverRule).toContain('box-shadow: none')
  })

  it('lays out custom start and end dates around a subtle centered dash', () => {
    const presetRule = cssRule('.time-custom-presets')
    const presetButtonRule = cssRule('.time-custom-presets button')
    const activePresetRule = cssRule('.time-custom-presets button.is-active')
    const fieldsRule = cssRule('.time-range-fields')
    const fieldRule = cssRule('.time-date-field')
    const buttonRule = cssRule('.time-date-button')
    const separatorRule = cssRule('.time-range-separator')

    expect(timeContextPanelSource).toContain('className="time-range-separator"')
    expect(timeContextPanelSource).toContain('aria-hidden="true"')
    expect(presetRule).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(presetRule).toContain('margin-bottom: 14px')
    expect(presetButtonRule).toContain('color: rgba(17, 40, 35, 0.58)')
    expect(presetButtonRule).toContain('font-size: 9px')
    expect(presetButtonRule).not.toContain('text-overflow: ellipsis')
    expect(activePresetRule).toContain('color: #f8fbfa')
    expect(fieldsRule).toContain('display: flex')
    expect(fieldsRule).toContain('justify-content: space-between')
    expect(fieldsRule).toContain('align-items: center')
    expect(fieldsRule).toContain('gap: 8px')
    expect(fieldsRule).toContain('margin-top: 0')
    expect(fieldRule).toContain('display: inline-grid')
    expect(fieldRule).toContain('grid-template-columns: auto auto')
    expect(fieldRule).toContain('gap: 5px')
    expect(buttonRule).toContain('width: auto')
    expect(buttonRule).toContain('padding: 0')
    expect(buttonRule).toContain('font-size: 12px')
    expect(buttonRule).not.toContain('text-overflow: ellipsis')
    expect(separatorRule).toContain('width: 12px')
    expect(separatorRule).toContain('height: 2px')
    expect(separatorRule).toContain('flex: 0 0 auto')
    expect(separatorRule).toContain('background: rgba(18, 63, 53, 0.26)')
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
      '--segmented-label-color: rgba(21, 48, 42, 0.66)',
    )
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-gap: 3px')
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-thumb-bg: #123f35')
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-padding: 2px')
    expect(cssRule('.time-mode-tabs')).toContain('padding: 3px')
    expect(cssRule('.time-mode-tabs button')).toContain('height: 24px')
    expect(cssRule('.time-mode-tabs')).not.toContain('--segmented-thumb-shadow')
    expect(cssRule('.transaction-type-switch')).not.toContain('--segmented-thumb-shadow')
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-active-label-color: #f8fbfa')
    expect(appSource).toContain("className={`app-nav__thumb${isTopNavigationDragging ? ' is-dragging' : ''}`}")
    expect(appSource).toContain('role="slider"')
    expect(appSource).toContain('onPointerDown={handleTopNavigationPointerDown}')
    expect(appSource).toContain('previewLeft')
    expect(appSource).toContain('app-nav__active-items')
    expect(appSource).toContain('topNavigationButtonRefs')
    expect(appSource).toContain('getBoundingClientRect()')
    expect(cssRule('.app-nav__tabs')).toContain('cursor: grab')
    expect(cssRule('.app-nav__tabs.is-dragging')).toContain('cursor: grabbing')
    expect(cssRule('.app-nav__thumb')).toContain(
      'left: var(--top-nav-thumb-preview-left, var(--top-nav-thumb-left))',
    )
    expect(cssRule('.app-nav__thumb')).toContain(
      'width: var(--top-nav-thumb-preview-width, var(--top-nav-thumb-width))',
    )
    expect(cssRule('.app-nav__thumb')).toContain('overflow: hidden')
    expect(cssRule('.app-nav__thumb')).toContain('touch-action: none')
    expect(cssRule('.app-nav__thumb.is-dragging')).toContain('transition: none')
    expect(cssRule('.app-nav__active-items')).toContain('width: var(--top-nav-tabs-width)')
    expect(cssRule('.app-nav__active-items')).toContain('color: #f8fbfa')
    expect(cssRule('.app-nav__active-items')).toContain(
      'calc(0px - var(--top-nav-thumb-preview-left, var(--top-nav-thumb-left)))',
    )
    expect(cssRule('.app-nav__thumb.is-dragging .app-nav__active-items')).toContain(
      'transition: none',
    )
    expect(cssRule(".app-nav__button[aria-pressed='true']")).not.toContain('color: #f8fbfa')
    expect(cssRule('.app-nav__button--page svg')).toContain('color: currentColor')
    expect(cssRule('.app-nav__button:hover')).toContain('color: #17231f')
    expect(cssRule('.app-nav__button:hover')).toContain('background: transparent')
    expect(cssRule('.app-nav__button:hover')).not.toContain('rgba(23, 35, 31, 0.07)')
    expect(cssRule('.settings-navigation-tabs')).toContain('--segmented-active-label-color: #f8fbfa')
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

  it('keeps footprint map style and projection choices as compact pill button groups', () => {
    expect(cssRule('.footprint-style-popover__row--inline')).toContain('display: flex')
    expect(cssRule('.footprint-style-popover__row--inline')).toContain('justify-content: space-between')
    expect(cssRule('.footprint-style-popover__row--inline')).toContain('gap: 10px')
    expect(cssRule('.pill-button-group')).toContain('display: inline-flex')
    expect(cssRule('.pill-button-group')).toContain('border-radius: 999px')
    expect(cssRule('.pill-button-group')).toContain('background: rgba(255, 255, 255, 0.66)')
    expect(cssRule('.pill-button-group__button')).toContain('border: 0')
    expect(cssRule('.pill-button-group__button')).toContain('border-radius: 999px')
    expect(cssRule('.pill-button-group__button')).toContain('background: transparent')
    expect(cssRule(".pill-button-group__button[aria-pressed='true']")).toContain('background: #123f35')
  })

  it('renders the settings dialog as a centered non-fullscreen modal', () => {
    expect(appSource).toContain('className="settings-dialog"')
    expect(appSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact settings-dialog__panel"')
    expect(appSource).toContain('className="settings-dialog__body"')
    expect(appSource).toContain('className="settings-dialog__tabs"')
    expect(appSource).toContain('className="settings-dialog__content"')
    expect(appSource).toContain("role=\"switch\"")
    expect(appSource).toContain('aria-labelledby="settings-dialog-title"')
    expect(cssRule('.settings-dialog')).toContain('position: fixed')
    expect(cssRule('.settings-dialog')).toContain('place-items: center')
    expect(cssRule('.settings-dialog__backdrop')).toContain('position: absolute')
    expect(cssRule('.settings-dialog__backdrop')).toContain('background: rgba(19, 29, 27, 0.28)')
    expect(cssRule('.settings-dialog__backdrop')).toContain('backdrop-filter: blur(6px)')
    expect(cssRule('.settings-dialog__backdrop')).toContain('-webkit-backdrop-filter: blur(6px)')
    expect(cssRule('.settings-dialog__panel')).toContain('width: min(680px, calc(100vw - 32px))')
    expect(cssRule('.settings-dialog__panel')).toContain('max-height: calc(100svh - 32px)')
    expect(cssRule('.settings-dialog__panel')).not.toContain('width: 100vw')
    expect(cssRule('.settings-dialog__panel')).not.toContain('height: 100svh')
    expect(cssRule('.settings-dialog__body')).toContain(
      'grid-template-columns: 142px minmax(0, 1fr)',
    )
    expect(cssRule('.settings-dialog__tabs')).toContain('display: grid')
    expect(cssRule('.settings-dialog__tabs')).toContain('align-content: start')
    expect(cssRule('.settings-dialog__tab')).toContain('text-align: left')
    expect(cssRule('.settings-dialog__tab.is-active')).toContain('background: #123f35')
    expect(cssRule('.settings-dialog__content')).toContain('min-width: 0')
    expect(cssRule('.settings-switch-row')).toContain('grid-template-columns: minmax(0, 1fr) 42px')
    expect(cssRule('.settings-switch-row__control::after')).toContain('width: 18px')
    expect(cssRule('.settings-switch-row.is-active .settings-switch-row__control::after')).toContain(
      'transform: translateX(18px)',
    )
    expect(cssRule('.settings-navigation-tabs')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')

    const mobileSettings = mediaBlock('@media (max-width: 720px)')
    expect(cssRuleIn(mobileSettings, '.settings-dialog__body')).toContain(
      'grid-template-columns: 1fr',
    )
    expect(cssRuleIn(mobileSettings, '.settings-dialog__tabs')).toContain(
      'grid-template-columns: repeat(4, minmax(0, 1fr))',
    )
  })

  it('lays month aggregation out as two compact rows', () => {
    expect(cssRule('.time-picker-grid--months')).toContain(
      'grid-template-columns: repeat(6, minmax(0, 1fr))',
    )
    expect(cssRule('.time-picker-grid--months button')).toContain('min-height: 30px')
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
    expect(cssRule('.accounting-page')).not.toContain('grid-template-rows: auto minmax(0, 1fr)')
    expect(cssRule('.accounting-workspace')).toContain('overflow: hidden')
    expect(cssRule('.accounting-page *')).toContain('min-width: 0')
    expect(cssRule('.accounting-scroll--ledger')).toContain('overflow-y: auto')
    expect(cssRule('.accounting-scroll--ledger')).toContain('overflow-x: hidden')
    expect(cssRule('.ios-account-ledger-workspace')).toContain('overflow: hidden')
    expect(cssRule('.ios-ledger-main')).toContain('overflow: visible')
    expect(cssRule('.accounting-modal-card')).toContain('overflow: hidden')
    expect(cssRule('.transaction-list')).toBe('')
    expect(cssRule('.transaction-editor')).toBe('')
  })

  it('keeps ledger rows in the main workspace and leaves account cards out of the ledger page', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')
    const ledgerWorkspaceSource = ledgerSource.slice(
      ledgerSource.indexOf('export function LedgerWorkspace'),
      ledgerSource.indexOf('type AccountsWorkspaceProps'),
    )
    const workspaceRule = cssRuleIn(accountingCss, '.ios-account-ledger-workspace')

    expect(workspaceRule).toContain(
      'grid-template-columns: minmax(300px, 41fr) minmax(0, 59fr)',
    )
    expect(workspaceRule).toContain('align-items: stretch')
    expect(cssRuleIn(accountingCss, '.accounting-insights-column')).toContain('height: 100%')
    expect(cssRuleIn(accountingCss, '.category-column')).toContain('height: 100%')
    expect(cssRuleIn(accountingCss, '.net-worth-bridge')).toContain('align-items: stretch')
    expect(cssRuleIn(accountingCss, '.net-worth-bridge__item > span')).not.toContain('max-height: 72px')
    expect(cssRuleIn(accountingCss, '.taxonomy-treemap')).toContain('grid-row: 3')
    expect(ledgerWorkspaceSource).toContain('className="ios-ledger-main accounting-ledger-column"')
    expect(ledgerWorkspaceSource).not.toContain('className="ios-ledger-control-panel"')
    expect(ledgerWorkspaceSource).not.toContain('className="ios-panel ios-account-filter-panel"')
  })

  it('keeps account cards in a dedicated accounts workspace', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')
    const panelRule = cssRule('.ios-account-filter-panel')
    const accountRegionRule = cssRule('.ios-account-filter-panel__accounts')
    const panelHeadRule = cssRule('.ios-account-filter-panel .ios-panel-head')
    const summaryRule = cssRule('.ios-account-stack-summary')
    const allFilterRule = cssRule('.ios-account-all-filter')
    const stackRule = cssRule('.ios-account-filter-stack')

    expect(ledgerSource).toContain('className="ios-account-filter-panel__accounts"')
    expect(panelRule).toContain('padding: 14px 18px 16px')
    expect(panelRule).toContain('grid-column: 1')
    expect(panelRule).toContain('width: 100%')
    expect(panelRule).toContain('max-width: 320px')
    expect(panelRule).toContain('height: 100%')
    expect(panelRule).not.toContain('100svh')
    expect(panelRule).toContain('border-radius: 26px')
    expect(panelRule).toContain('gap: 14px')
    expect(panelRule).toContain('background: transparent')
    expect(panelRule).toContain('box-shadow: none')
    expect(cssRule('.ios-ledger-main')).toContain('background: transparent')
    expect(accountRegionRule).toContain('display: grid')
    expect(accountRegionRule).toContain('align-content: start')
    expect(accountRegionRule).toContain('overflow: visible')
    expect(panelHeadRule).toContain('padding: 8px 2px 10px')
    expect(summaryRule).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(summaryRule).toContain('padding: 0 0 6px')
    expect(summaryRule).not.toContain('gap: 4px')
    expect(allFilterRule).toContain('margin: 0 0 10px')
    expect(allFilterRule).not.toContain('box-shadow:')
    expect(stackRule).toContain('height: 406px')
    expect(stackRule).toContain('margin-top: -10px')
    expect(stackRule).toContain('padding: 10px 0 18px')
    expect(stackRule).toContain('overflow: visible')
    expect(stackRule).toContain('overscroll-behavior: contain')
    expect(cssRule('.ios-account-filter-stack__scroll-space')).toBe('')
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-0'), '--account-card-stack-y')).toBe(126)
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-1'), '--account-card-stack-y')).toBe(80)
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-2'), '--account-card-stack-y')).toBe(34)
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-3'), '--account-card-stack-y')).toBe(-12)
    expect(cssCustomNumber(cssRule('.ios-account-filter-card--rank-1'), '--account-card-scale')).toBe(0.995)
    expect(cssCustomNumber(cssRule('.ios-account-filter-card--rank-2'), '--account-card-scale')).toBe(0.99)
    expect(cssCustomNumber(cssRule('.ios-account-filter-card--rank-3'), '--account-card-scale')).toBe(0.985)
  })

  it('cycles stacked account cards on mouse wheel so rear cards can move into the clickable front position', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')

    expect(ledgerSource).toContain('const accountStackRef = useRef<HTMLDivElement>(null)')
    expect(ledgerSource).toContain('const [frontAccountId, setFrontAccountId] = useState<string | null>(null)')
    expect(ledgerSource).toContain('const resolvedFrontAccountId =')
    expect(ledgerSource).toContain('const frontStackIndex = Math.max(')
    expect(ledgerSource).toContain('const orderedStackSummaries = rotateAccountSummaries(summaries, frontStackIndex)')
    expect(ledgerSource).toContain('const lastAccountStackWheelAtRef = useRef(0)')
    expect(ledgerSource).toContain('const handleAccountStackWheel = useCallback((event: WheelEvent) => {')
    expect(ledgerSource).toContain('event.preventDefault()')
    expect(ledgerSource).toContain('Math.sign(event.deltaY)')
    expect(ledgerSource).toContain('if (direction === 0) return')
    expect(ledgerSource).toContain('direction > 0 ? 1 : -1')
    expect(ledgerSource).toContain('setFrontAccountId(summaries[nextIndex]?.account.id ?? null)')
    expect(ledgerSource).toContain("addEventListener('wheel', handleAccountStackWheel, { passive: false })")
    expect(ledgerSource).toContain("removeEventListener('wheel', handleAccountStackWheel)")
    expect(ledgerSource).toContain('ref={accountStackRef}')
    expect(ledgerSource).not.toContain('onWheel={handleAccountStackWheel}')
    expect(ledgerSource).toContain('orderedStackSummaries.map')
    expect(ledgerSource).toContain('function rotateAccountSummaries')
  })

  it('uses a non-passive native wheel listener for the active account carousel', () => {
    const carouselSource = readFileSync('src/components/accounting/AccountCardCarousel.tsx', 'utf8')

    expect(carouselSource).toContain('const carouselRef = useRef<HTMLDivElement>(null)')
    expect(carouselSource).toContain("addEventListener('wheel', handleWheel, { passive: false })")
    expect(carouselSource).toContain("removeEventListener('wheel', handleWheel)")
    expect(carouselSource).toContain('ref={carouselRef}')
    expect(carouselSource).not.toContain('onWheel={handleWheel}')
  })

  it('keeps all-ledger selection outside the stack and promotes display cards without filtering the ledger', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')

    expect(ledgerSource).toContain('className="ios-account-all-filter"')
    expect(ledgerSource).not.toContain('title="全部账户"')
    expect(ledgerSource).toContain("selectedAccountId === 'all'")
    expect(ledgerSource).toContain('const [frontAccountId, setFrontAccountId] = useState<string | null>(null)')
    expect(ledgerSource).toContain('const orderedStackSummaries = rotateAccountSummaries(summaries, frontStackIndex)')
    expect(ledgerSource).not.toContain('visibleStackSummaries')
    expect(ledgerSource).not.toContain('ios-account-selected-slot')
    expect(ledgerSource).not.toContain('ios-account-selected-slot__empty')
    expect(ledgerSource).not.toContain('is-detached')
    expect(ledgerSource).not.toContain('detached')
    expect(ledgerSource).not.toContain('aria-label="单独显示的选中账户"')
    expect(ledgerSource).toContain('aria-label="层叠账户卡片"')
    expect(ledgerSource).toContain('active={summary.account.id === resolvedFrontAccountId}')
    expect(ledgerSource).toContain('onSelect={() => setFrontAccountId(summary.account.id)}')
    expect(ledgerSource).not.toContain('selectedAccountId === summary.account.id ?')
    expect(ledgerSource).toContain("from 'framer-motion'")
    expect(ledgerSource).toContain('ACCOUNT_CARD_LAYOUT_TRANSITION')
    expect(ledgerSource).not.toContain('AnimatePresence')
    expect(ledgerSource).toContain('<LayoutGroup id="account-card-stack">')
    expect(ledgerSource).toContain('layoutId={`account-card-${summary.account.id}`}')
    expect(ledgerSource).toContain('<motion.button')
    expect(ledgerSource).toContain('layout="position"')
    expect(ledgerSource).toContain('ios-account-filter-card--rank-')
    expect(ledgerSource).not.toContain('is-pulled')
    expect(cssRule('.ios-account-all-filter')).not.toContain('linear-gradient(135deg')
    expect(cssRule('.ios-account-filter-card')).not.toContain('--account-pull-x')
    expect(cssRule('.ios-account-filter-card.is-pulled')).toBe('')
    expect(cssRule('.ios-account-selected-slot')).toBe('')
    expect(cssRule('.ios-account-selected-slot.is-empty')).toBe('')
    expect(cssRule('.ios-account-selected-slot__empty')).toBe('')
    expect(cssRule('.ios-account-filter-stack')).toContain('margin-top: -10px')
    expect(cssRule('.ios-account-filter-stack')).toContain('position: relative')
    expect(cssRule('.ios-account-filter-stack')).toContain('height: 406px')
    expect(cssRule('.ios-account-filter-stack')).toContain('perspective: 1100px')
    expect(cssRule('.ios-account-filter-stack')).toContain('transform-style: preserve-3d')
    expect(cssRule('.ios-account-filter-stack.is-spread')).toBe('')
    expect(cssRule('.ios-account-filter-stack .ios-account-filter-card')).toContain('position: absolute')
    expect(cssRule('.ios-account-filter-stack .ios-account-filter-card')).toContain(
      'top: var(--account-card-stack-y)',
    )
    expect(cssRule('.ios-account-filter-stack .ios-account-filter-card')).toContain('width: 100%')
    expect(cssRule('.ios-account-filter-card')).toContain('width: 100%')
    expect(cssRule('.ios-account-filter-card__surface')).toContain('transform-origin: center bottom')
    expect(cssRule('.ios-account-filter-card__surface')).toContain('aspect-ratio: 1.586 / 1')
    expect(cssRule('.ios-account-filter-card__surface')).toContain(
      'width: calc(100% - var(--account-card-shift-x))',
    )
    expect(cssRule('.ios-account-filter-card__surface')).toContain(
      'translate 520ms cubic-bezier(0.16, 1, 0.3, 1)',
    )
    expect(cssRule('.ios-account-filter-card__surface')).toContain('transform: rotateX(var(--account-card-tilt))')
    expect(cssRule('.ios-account-filter-card + .ios-account-filter-card')).toContain(
      'margin-top: 0',
    )
    expect(cssRule('.ios-account-filter-stack.is-spread .ios-account-filter-card + .ios-account-filter-card')).toBe('')
    expect(cssRule('.ios-account-filter-card--rank-1')).toContain('--account-card-lift: 0px')
    expect(cssRule('.ios-account-filter-card--rank-1')).toContain('--account-card-scale: 0.995')
    expect(cssRule('.ios-account-filter-card--rank-1')).toContain('--account-card-shift-x: 10px')
    expect(cssRule('.ios-account-filter-card--rank-2')).toContain('--account-card-lift: 0px')
    expect(cssRule('.ios-account-filter-card--rank-2')).toContain('--account-card-scale: 0.99')
    expect(cssRule('.ios-account-filter-card--rank-2')).toContain('--account-card-shift-x: 20px')
    expect(cssRule('.ios-account-filter-card--rank-3')).toContain('--account-card-lift: 0px')
    expect(cssRule('.ios-account-filter-card--rank-3')).toContain('--account-card-scale: 0.985')
    expect(cssRule('.ios-account-filter-card--rank-3')).toContain('--account-card-shift-x: 30px')
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-0'), '--account-card-stack-y')).toBe(126)
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-1'), '--account-card-stack-y')).toBe(80)
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-2'), '--account-card-stack-y')).toBe(34)
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-3'), '--account-card-stack-y')).toBe(-12)
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-0'), '--account-card-stack-y')).toBeGreaterThan(
      cssCustomPx(cssRule('.ios-account-filter-card--rank-1'), '--account-card-stack-y'),
    )
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-1'), '--account-card-stack-y')).toBeGreaterThan(
      cssCustomPx(cssRule('.ios-account-filter-card--rank-2'), '--account-card-stack-y'),
    )
    expect(cssCustomPx(cssRule('.ios-account-filter-card--rank-2'), '--account-card-stack-y')).toBeGreaterThan(
      cssCustomPx(cssRule('.ios-account-filter-card--rank-3'), '--account-card-stack-y'),
    )
    expect(cssCustomNumber(cssRule('.ios-account-filter-card--rank-0'), '--account-card-z')).toBeGreaterThan(
      cssCustomNumber(cssRule('.ios-account-filter-card--rank-1'), '--account-card-z'),
    )
    expect(cssCustomNumber(cssRule('.ios-account-filter-card--rank-1'), '--account-card-z')).toBeGreaterThan(
      cssCustomNumber(cssRule('.ios-account-filter-card--rank-2'), '--account-card-z'),
    )
    expect(cssCustomNumber(cssRule('.ios-account-filter-card--rank-2'), '--account-card-z')).toBeGreaterThan(
      cssCustomNumber(cssRule('.ios-account-filter-card--rank-3'), '--account-card-z'),
    )
    expect(appCss).not.toContain('--account-card-info-y')
    expect(
      cssRule(
        '.ios-account-filter-card__body,\n.ios-account-filter-card__side',
      ),
    ).not.toContain('transform:')
    expect(cssRule('.ios-account-filter-card.is-detached')).toBe('')
    expect(cssRule('.ios-account-filter-card.is-detached .ios-account-filter-card__surface')).toBe('')
    expect(cssRule('.ios-account-filter-stack.is-spread')).toBe('')
    expect(appCss).not.toContain('@keyframes accountCardDetachIn')
    expect(appCss).not.toContain('@keyframes accountCardSettleBack')
    expect(appCss).not.toContain('@keyframes accountSelectedSlotIn')
  })

  it('keeps account-card layout projection separate from the 3D stack surface', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')
    const cardRule = cssRule('.ios-account-filter-card')
    const surfaceRule = cssRule('.ios-account-filter-card__surface')
    const hoverRule = cssRule('.ios-account-filter-card:hover .ios-account-filter-card__surface')

    expect(ledgerSource).toContain('className="ios-account-filter-card__surface"')
    expect(ledgerSource).toContain('<motion.button')
    expect(cardRule).toContain('width: 100%')
    expect(cardRule).not.toMatch(/\n\s+translate:/)
    expect(cardRule).not.toMatch(/\n\s+scale:/)
    expect(cardRule).not.toContain('transform: rotateX')
    expect(cardRule).not.toContain('will-change: translate, scale, transform')
    expect(surfaceRule).toContain('width: calc(100% - var(--account-card-shift-x))')
    expect(surfaceRule).toContain('aspect-ratio: 1.586 / 1')
    expect(surfaceRule).toContain('translate: var(--account-card-shift-x) var(--account-card-lift)')
    expect(surfaceRule).toContain('scale: var(--account-card-scale)')
    expect(surfaceRule).toContain('transform: rotateX(var(--account-card-tilt))')
    expect(hoverRule).not.toContain('translate:')
    expect(hoverRule).not.toContain('filter:')
    expect(hoverRule).not.toContain('box-shadow:')
  })

  it('uses verified brand SVG logos as muted white marks on darkened brand-color gradients', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')

    expect(ledgerSource).toContain("type AccountCardBrand = 'wechat' | 'alipay' | 'meituan' | 'jd' | 'douyin' | 'bank' | 'generic'")
    expect(ledgerSource).toContain("from 'simple-icons'")
    expect(ledgerSource).toContain('siWechat.hex')
    expect(ledgerSource).toContain('siAlipay.hex')
    expect(ledgerSource).toContain('siMeituan.hex')
    expect(ledgerSource).toContain('siTiktok.hex')
    expect(ledgerSource).toContain('const ALIPAY_WORDMARK_LOGO_PATH')
    expect(ledgerSource).toContain("import meituanLogoRabbitWordmarkUrl from '../../assets/meituan-logo-rabbit-wordmark.png'")
    expect(ledgerSource).toContain('const MEITUAN_RABBIT_WORDMARK_LOGO_SRC = meituanLogoRabbitWordmarkUrl')
    expect(ledgerSource).toContain("title: 'Meituan Waimai'")
    expect(ledgerSource).toContain("logoImageSrc: MEITUAN_RABBIT_WORDMARK_LOGO_SRC")
    expect(ledgerSource).toContain("logoViewBox: '0 0 1072 419'")
    expect(ledgerSource).not.toContain('wideLogo: true')
    expect(ledgerSource).toContain('getAccountCardBrandTone(brand, config)')
    expect(ledgerSource).toContain("if (brand === 'meituan')")
    expect(ledgerSource).not.toContain('logoPath: siAlipay.path')
    expect(ledgerSource).not.toContain('logoPath: siMeituan.path')
    expect(ledgerSource).toContain('baseHex: `#${')
    expect(ledgerSource).not.toContain('const JD_LOGO_PATH')
    expect(ledgerSource).toContain('function getAccountCardBrand')
    expect(ledgerSource).toContain('function getAccountCardBrandConfig')
    expect(ledgerSource).toContain('ios-account-filter-card--brand-${brand}')
    expect(ledgerSource).toContain('ios-account-filter-card__brand-logo')
    expect(ledgerSource).toContain("viewBox={brandConfig.logoViewBox ?? '0 0 24 24'}")
    expect(ledgerSource).toContain('<image')
    expect(ledgerSource).toContain('href={brandConfig.logoImageSrc}')
    expect(ledgerSource).toContain('<path d={brandConfig.logoPath ?? GENERIC_CARD_LOGO_PATH} fill="currentColor" />')
    expect(ledgerSource).toContain("style={getAccountCardBrandStyle(brandConfig)}")
    expect(ledgerSource).not.toContain('ios-account-filter-card__brand-mark')
    expect(ledgerSource).not.toContain('ios-account-filter-card__brand-watermark')
    expect(ledgerSource).not.toContain('getAccountCardBrandWatermark')
    for (const brand of ['wechat', 'alipay', 'meituan', 'jd', 'douyin', 'bank', 'generic']) {
      expect(cssRule(`.ios-account-filter-card--brand-${brand} .ios-account-filter-card__surface`)).toBe('')
    }
    expect(appCss).not.toContain('--account-card-glow')
    expect(cssRule('.ios-account-filter-card__surface')).not.toContain('radial-gradient')
    expect(cssRule('.ios-account-filter-card__surface::before')).toBe('')
    expect(cssRule('.ios-account-filter-card__surface::after')).toBe('')
    expect(cssRule('.ios-account-filter-card__brand-logo')).toContain('color: #ffffff')
    expect(cssRule('.ios-account-filter-card__brand-logo')).toContain('opacity: 0.16')
    expect(cssRule('.ios-account-filter-card__brand-logo')).toContain('width: clamp(124px, 46%, 184px)')
    expect(cssRule('.ios-account-filter-card__brand-logo')).toContain('z-index: 0')
    expect(cssRule('.ios-account-filter-card--brand-meituan .ios-account-filter-card__brand-logo')).toContain('right: -8px')
    expect(cssRule('.ios-account-filter-card--brand-meituan .ios-account-filter-card__brand-logo')).toContain('width: min(78%, 260px)')
    expect(cssRule('.ios-account-filter-card--brand-meituan .ios-account-filter-card__brand-logo')).toContain('aspect-ratio: 2.56 / 1')
    expect(cssRule('.ios-account-filter-card--brand-meituan .ios-account-filter-card__brand-logo')).toContain('opacity: 0.13')
    expect(cssRule('.ios-account-filter-card__brand-logo--wide')).toBe('')
    expect(cssRule('.ios-account-filter-card__brand-logo--wide svg')).toBe('')
    expect(cssRule('.ios-account-filter-card__brand-logo svg')).toContain('width: 100%')
    expect(cssRule('.ios-account-filter-card__surface')).toContain('linear-gradient(')
    expect(cssRule('.ios-account-filter-card__surface')).toContain('145deg')
    expect(cssRule('.ios-account-filter-card__surface')).toContain('var(--account-card-bg-start)')
    expect(cssRule('.ios-account-filter-card__surface')).toContain('var(--account-card-bg-end)')
    expect(cssRule('.ios-account-filter-card__surface')).not.toContain('--account-card-bg-start: #')
    expect(cssRule('.ios-account-filter-card')).toContain('--account-card-bg-start: #385552')
    expect(cssRule('.ios-account-filter-card__check')).toBe('')
    expect(ledgerSource).not.toContain('ios-account-filter-card__check')
    expect(
      cssRule(
        '.ios-account-filter-stack .ios-account-filter-card:not(.ios-account-filter-card--rank-0) .ios-account-filter-card__body',
      ),
    ).toContain('align-self: start')
    expect(
      cssRule(
        '.ios-account-filter-stack .ios-account-filter-card:not(.ios-account-filter-card--rank-0) .ios-account-filter-card__side',
      ),
    ).toContain('align-self: start')
    expect(
      cssRule(
        '.ios-account-filter-stack .ios-account-filter-card:not(.ios-account-filter-card--rank-0) .ios-account-filter-card__body em',
      ),
    ).toContain('display: none')
    expect(
      cssRule(
        '.ios-account-filter-stack .ios-account-filter-card:not(.ios-account-filter-card--rank-0) .ios-account-filter-card__side small',
      ),
    ).toContain('display: none')
    expect(appCss).not.toContain('z-index: 8')
  })

  it('keeps responsive account-card stacks ordered upward without margin-based overlap', () => {
    const mobileMedia = mediaBlock('@media (max-width: 720px)')
    const compactMedia = mediaBlock(
      '@media (min-width: 721px) and (max-width: 1440px), (min-width: 721px) and (max-height: 790px)',
    )

    const cases = [
      { media: mobileMedia, offsets: [78, 52, 26, 0] },
      { media: compactMedia, offsets: [96, 64, 32, 0] },
    ] as const

    for (const { media, offsets } of cases) {
      expect(cssRuleIn(media, '.ios-account-filter-card + .ios-account-filter-card')).toContain(
        'margin-top: 0',
      )
      expect(cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-0'), '--account-card-stack-y')).toBe(
        offsets[0],
      )
      expect(cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-1'), '--account-card-stack-y')).toBe(
        offsets[1],
      )
      expect(cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-2'), '--account-card-stack-y')).toBe(
        offsets[2],
      )
      expect(cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-3'), '--account-card-stack-y')).toBe(
        offsets[3],
      )
      expect(cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-0'), '--account-card-stack-y')).toBeGreaterThan(
        cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-1'), '--account-card-stack-y'),
      )
      expect(cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-1'), '--account-card-stack-y')).toBeGreaterThan(
        cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-2'), '--account-card-stack-y'),
      )
      expect(cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-2'), '--account-card-stack-y')).toBeGreaterThan(
        cssCustomPx(cssRuleIn(media, '.ios-account-filter-card--rank-3'), '--account-card-stack-y'),
      )
    }
  })

  it('keeps desktop account cards slightly proud of the ledger with a visible top stack lip', () => {
    const accountPanelRule = cssRule('.ios-account-filter-panel')
    const accountStackRule = cssRule('.ios-account-filter-stack')
    const frontCardRule = cssRule('.ios-account-filter-card--rank-0')
    const secondCardRule = cssRule('.ios-account-filter-card--rank-1')
    const backCardRule = cssRule('.ios-account-filter-card--rank-3')

    expect(accountPanelRule).toContain('height: 100%')
    expect(accountPanelRule).not.toContain('100svh')
    expect(accountPanelRule).toContain('width: 100%')
    expect(accountPanelRule).toContain('overflow: visible')
    expect(accountStackRule).toContain('margin-top: -10px')
    expect(accountStackRule).toContain('padding: 10px 0 18px')
    expect(cssCustomPx(frontCardRule, '--account-card-stack-y')).toBe(126)
    expect(cssCustomPx(secondCardRule, '--account-card-stack-y')).toBe(80)
    expect(cssCustomPx(backCardRule, '--account-card-stack-y')).toBe(-12)
    expect(cssCustomPx(frontCardRule, '--account-card-stack-y')).toBeGreaterThan(
      cssCustomPx(secondCardRule, '--account-card-stack-y'),
    )
    expect(cssCustomPx(secondCardRule, '--account-card-stack-y')).toBeGreaterThan(
      cssCustomPx(backCardRule, '--account-card-stack-y'),
    )
  })

  it('contains ledger rows so amount and date content cannot spill out of the row', () => {
    const rowRule = cssRuleIn(accountingCss, '.ios-transaction-row')
    const sideRule = cssRuleIn(accountingCss, '.ios-transaction-row__side')
    const metaRule = cssRuleIn(accountingCss, '.ios-transaction-row__meta')
    const sideTextRule =
      accountingCss.match(
        /\.ios-transaction-row__side b,\s*\.ios-transaction-row__meta\s*\{[^}]*\}/,
      )?.[0] ?? ''
    const transactionRowSource = readFileSync('src/components/accounting/TransactionRow.tsx', 'utf8')

    expect(rowRule).toContain('grid-template-columns:')
    expect(rowRule).toContain('28px minmax(0, 1fr) minmax(48px, 0.7fr) auto')
    expect(rowRule).toContain('overflow: hidden')
    expect(sideRule).toContain('min-width: 0')
    expect(sideRule).toContain('justify-items: end')
    expect(metaRule).toContain('display: inline-flex')
    expect(metaRule).toContain('gap:')
    expect(sideTextRule).toContain('max-width: 100%')
    expect(sideTextRule).toContain('text-overflow: ellipsis')
    expect(transactionRowSource).toContain('className="ios-transaction-row__meta"')
    expect(transactionRowSource).toMatch(
      /<span className="ios-transaction-row__meta">\s*<time dateTime=\{transaction\.occurredAt\}>\{formatMonthDay\(transaction\.occurredAt\)\}<\/time>\s*<small>\{presentation\.label\}<\/small>\s*<\/span>/,
    )
  })

  it('keeps compact ledger rows as a single readable line instead of wrapping side content under the icon', () => {
    const compactMedia = mediaBlock(
      '@media (min-width: 721px) and (max-width: 1440px), (min-width: 721px) and (max-height: 790px)',
    )
    const compactRowRule = cssRuleIn(compactMedia, '.ios-transaction-row')
    const compactTagsRule = cssRuleIn(compactMedia, '.ios-transaction-row__tags')

    expect(compactRowRule).toContain('grid-template-columns:')
    expect(compactRowRule).toContain('minmax(86px, 102px)')
    expect(compactRowRule).not.toContain('34px minmax(0, 1fr) auto')
    expect(compactRowRule).not.toContain('minmax(0, 0.01fr)')
    expect(compactTagsRule).toContain('display: none')
  })

  it('initializes the map at the first full-world coverage threshold', () => {
    expect(amapCanvasSource).toContain('calculateMinimumZoomForViewportCoverage({')
    expect(amapCanvasSource).toContain('viewportWidth: mapNodeRef.current.clientWidth')
    expect(amapCanvasSource).toContain('viewportHeight: mapNodeRef.current.clientHeight')
    expect(amapCanvasSource).toContain('zoom: initialZoom')
    expect(amapCanvasSource).toContain('zooms: [AMAP_MIN_ZOOM, 20]')
    expect(amapCanvasSource).not.toContain('zooms: [initialZoom, 20]')
    expect(amapCanvasSource).not.toContain('zoom: config.defaultZoom')
  })

  it('enforces the current map zoom against the resized coverage threshold', () => {
    expect(amapCanvasSource).toContain('currentZoom < minimumZoom')
    expect(amapCanvasSource).toContain('currentZoom > minimumZoom')
    expect(amapCanvasSource).toContain('isWorldViewLockedRef')
    expect(amapCanvasSource).toContain('setZoomAndCenter(')
    expect(amapCanvasSource).toContain('calculateWorldCenter(config.renderBounds)')
  })

  it('anchors the map toolbar to the lower-right', () => {
    const rule = cssRule('.map-toolbar')
    const stageRule = cssRule('.map-stage')

    expect(stageRule).toContain(
      '--map-chrome-x: calc(var(--right-panel-width) + var(--shell-board-inset-x) + var(--shell-board-column-gutter))',
    )
    expect(stageRule).toContain('--map-chrome-y: max(24px, env(safe-area-inset-bottom))')
    expect(stageRule).toContain('--map-chrome-top: max(24px, env(safe-area-inset-top))')
    expect(rule).toContain('right: var(--map-chrome-x)')
    expect(rule).toContain('bottom: var(--map-chrome-y)')
    expect(rule).not.toContain('left: 50%')
    expect(rule).not.toContain('translateX(-50%)')
  })

  it('keeps map chrome text from using oversized hero typography', () => {
    expect(appCss).not.toMatch(/font-size:\s*clamp\(22px,\s*3\.6vw,\s*38px\)/)
  })

  it('keeps the 2D map toolbar compact', () => {
    const rule = cssRule('.map-toolbar__button')

    expect(rule).toContain('width: 38px')
    expect(rule).toContain('height: 38px')
    expect(amapCanvasSource).not.toContain('new AMap.ControlBar')
  })

  it('positions footprint style settings as a compact popover above the map toolbar', () => {
    const toolbarRule = cssRule('.map-toolbar')
    const toolbarButtonRule = cssRule('.map-toolbar__button')
    const settingsRule = cssRule('.map-toolbar__settings')
    const popoverRule = cssRule('.footprint-style-popover')
    const rowRule = cssRule('.footprint-style-popover__row')
    const labelRule = cssRule('.footprint-style-popover__label')
    const spacingRule = cssRule(
      '.footprint-style-popover__row + .footprint-style-popover__row, .footprint-style-popover__swatches, .footprint-style-popover__switch',
    )
    const inlineLabelRule = cssRule('.footprint-style-popover__row--inline span')
    const switchRule = lastCssRule('.footprint-style-popover__switch')
    const swatchRule = cssRule('.footprint-style-popover__swatch')
    const pillButtonRule = cssRule('.pill-button-group__button')

    expect(toolbarRule).toContain('overflow: visible')
    expect(cssRule('.map-toolbar button')).toBe('')
    expect(cssRule('.map-toolbar > button')).toBe('')
    expect(toolbarButtonRule).toContain('width: 38px')
    expect(settingsRule).toContain('position: relative')
    expect(settingsRule).toContain('display: grid')
    expect(appCss).toContain('.map-toolbar__button:hover')
    expect(mapControlsSource).toContain('className="map-toolbar__settings"')
    expect(mapControlsSource).not.toContain('<div className="map-toolbar__settings" ref={settingsRef}>')
    expect(mapControlsSource).toContain('<div className="map-toolbar__settings" ref={settingsButtonRef}>')
    expect(mapControlsSource).toContain('const settingsButtonRef = useRef<HTMLDivElement | null>(null)')
    expect(mapControlsSource).toContain('const popoverRef = useRef<HTMLDivElement | null>(null)')
    expect(mapControlsSource).toContain('ref={settingsButtonRef}')
    expect(mapControlsSource).toContain('ref={popoverRef}')
    expect(mapControlsSource).toContain('settingsButtonRef.current?.contains')
    expect(mapControlsSource).toContain('popoverRef.current?.contains')
    expect(popoverRule).toContain('position: absolute')
    expect(popoverRule).toContain('right: var(--map-chrome-x)')
    expect(popoverRule).toContain('bottom: calc(var(--map-chrome-y) + 66px)')
    expect(popoverRule).toContain('z-index: 3')
    expect(popoverRule).toContain('width: 218px')
    expect(popoverRule).toContain('max-width: calc(100vw - 28px)')
    expect(popoverRule).toContain('display: grid')
    expect(popoverRule).toContain('gap: 6px')
    expectNoOwnedGlassMaterial(popoverRule)
    expect(rowRule).toContain('grid-template-columns:')
    expect(rowRule).toContain('gap: 4px 10px')
    expect(rowRule).toContain('line-height: 1.08')
    expect(labelRule).toContain('font-weight: 400')
    expect(labelRule).toContain('line-height: 1.08')
    expect(spacingRule).toBe('')
    expect(inlineLabelRule).not.toContain('font-weight:')
    expect(switchRule).toContain('grid-template-columns: minmax(0, 1fr) 42px')
    expect(switchRule).toContain('font-size: 12px')
    expect(switchRule).toContain('font-weight: 400')
    expect(switchRule).toContain('line-height: 1.08')
    expect(pillButtonRule).toContain('font-weight: 400')
    expect(cssRule('.footprint-style-popover__switch-control::after')).toContain('width: 18px')
    expect(cssRule('.footprint-style-popover__switch.is-active .footprint-style-popover__switch-control::after')).toContain(
      'transform: translateX(18px)',
    )
    const valueRule = cssRule('.footprint-style-popover__value')
    expect(valueRule).toContain('display: grid')
    expect(valueRule).toContain('cursor: default')
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

  it('places administrative region depth controls inside the right context panel', () => {
    const bodyRule = cssRule('.admin-region-atlas-card__body')
    const depthRule = cssRule('.admin-region-atlas-card__depth-control')
    const depthButtonRule = cssRule('.admin-region-atlas-card__depth-control button')
    const thumbnailRule = cssRule('.admin-region-atlas-card__thumbnail')
    const thumbnailSourceIndex = adminRegionContextPanelSource.indexOf(
      'className="admin-region-atlas-card__thumbnail"',
    )
    const depthControlSourceIndex = adminRegionContextPanelSource.indexOf('<DepthControl')

    expect(appSource).toContain('<AdminRegionContextPanel')
    expect(adminRegionContextPanelSource).toContain('ariaLabel="行政区层级"')
    expect(mapboxCanvasSource).not.toContain('<AdminRegionContextPanel')
    expect(bodyRule).toContain('display: grid')
    expect(bodyRule).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(bodyRule).toContain('align-items: stretch')
    expect(depthRule).toContain('display: grid')
    expect(depthRule).toContain('--segmented-padding: 3px')
    expect(depthRule).toContain('width: 34px')
    expect(depthRule).toContain('align-self: stretch')
    expect(depthRule).toContain('border: 1px solid rgba(18, 63, 53, 0.08)')
    expect(depthRule).toContain('background: rgba(18, 63, 53, 0.07)')
    expect(depthButtonRule).toContain('border-radius: 0')
    expect(depthButtonRule).toContain('background: transparent')
    expect(depthButtonRule).not.toContain('background: rgba(23, 35, 31, 0.06)')
    expect(thumbnailRule).toContain('display: block')
    expect(thumbnailRule).toContain('width: 100%')
    expect(thumbnailRule).toContain('height: auto')
    expect(thumbnailRule).toContain('aspect-ratio: 32 / 15')
    expect(thumbnailRule).not.toContain('aspect-ratio: 16 / 9')
    expect(thumbnailRule).toContain('overflow: hidden')
    expect(thumbnailSourceIndex).toBeGreaterThanOrEqual(0)
    expect(depthControlSourceIndex).toBeGreaterThan(thumbnailSourceIndex)
  })

  it('renders administrative region rankings as a compact trackless bar chart', () => {
    const cardRule = lastCssRule('.admin-region-ranking-card')
    const rightPanelStackRule = cssRule('.right-context-panel__stack')
    const listRule = cssRule('.admin-region-ranking-card__list')
    const firefoxScrollbarBlock = mediaBlock(
      '@supports not selector(::-webkit-scrollbar)',
    )
    const scrollbarRule = cssRule('.admin-region-ranking-card__list::-webkit-scrollbar')
    const scrollbarButtonRule = cssRule(
      '.admin-region-ranking-card__list::-webkit-scrollbar-button',
    )
    const scrollbarTrackRule = cssRule(
      '.admin-region-ranking-card__list::-webkit-scrollbar-track',
    )
    const scrollbarThumbRule = cssRule(
      '.admin-region-ranking-card__list::-webkit-scrollbar-thumb',
    )
    const cardHoverScrollbarThumbRule = cssRule(
      '.admin-region-ranking-card:hover .admin-region-ranking-card__list::-webkit-scrollbar-thumb',
    )
    const cardFocusScrollbarThumbRule = cssRule(
      '.admin-region-ranking-card:focus-within .admin-region-ranking-card__list::-webkit-scrollbar-thumb',
    )
    const rowRule = cssRule('.admin-region-ranking-card__row')
    const nameRule = cssRule('.admin-region-ranking-card__name')
    const barRule = cssRule('.admin-region-ranking-card__bar')
    const fillRule = cssRule('.admin-region-ranking-card__bar span')
    const valueRule = cssRule('.admin-region-ranking-card__row strong')
    const hoverRule = cssRule('.admin-region-ranking-card__row:hover')
    const focusRule = cssRule('.admin-region-ranking-card__row:focus-visible')
    const hoverNameRule = cssRule(
      '.admin-region-ranking-card__row:hover .admin-region-ranking-card__name',
    )
    const selectedNameRule = cssRule(
      '.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__name',
    )
    const hoverFillRule = cssRule(
      '.admin-region-ranking-card__row:hover .admin-region-ranking-card__bar span',
    )
    const selectedFillRule = cssRule(
      '.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__bar span',
    )

    expect(cardRule).toContain('--admin-region-rank-row-height: 24px')
    expect(listRule).toContain(
      'max-height: calc(var(--admin-region-rank-row-height) * 5)',
    )
    expect(listRule).toContain('scrollbar-gutter: stable')
    expect(listRule).not.toContain('scrollbar-width: thin')
    expect(listRule).not.toContain('scrollbar-color:')
    expect(rightPanelStackRule).not.toContain('scrollbar-width: thin')
    expect(rightPanelStackRule).not.toContain('scrollbar-color:')
    expect(firefoxScrollbarBlock).toContain('.right-context-panel__stack')
    expect(firefoxScrollbarBlock).toContain('.admin-region-ranking-card__list')
    expect(firefoxScrollbarBlock).toContain('scrollbar-width: thin')
    expect(firefoxScrollbarBlock).toContain(
      'scrollbar-color: transparent transparent',
    )
    expect(cssRuleIn(
      firefoxScrollbarBlock,
      '.admin-region-ranking-card:hover .admin-region-ranking-card__list',
    )).toContain('scrollbar-color: rgba(23, 62, 53, 0.18) transparent')
    expect(cssRuleIn(
      firefoxScrollbarBlock,
      '.admin-region-ranking-card:focus-within .admin-region-ranking-card__list',
    )).toContain('scrollbar-color: rgba(23, 62, 53, 0.18) transparent')
    expect(rowRule).toContain('height: var(--admin-region-rank-row-height)')
    expect(rowRule).toContain('grid-template-columns: 22px 4em minmax(0, 1fr) auto')
    expect(rowRule).toContain('padding: 0 10px 0 2px')
    expect(rowRule).toContain('font-size: 12px')
    expect(rowRule).not.toContain('border-bottom')
    expect(nameRule).toContain('overflow: hidden')
    expect(nameRule).toContain('text-overflow: ellipsis')
    expect(nameRule).toContain('white-space: nowrap')
    expect(nameRule).toContain('color: rgba(23, 35, 31, 0.72)')
    expect(nameRule).toContain('font-weight: 600')
    expect(barRule).toContain('min-width: 0')
    expect(barRule).toContain('height: 8px')
    expect(barRule).toContain('background: transparent')
    expect(barRule).not.toContain('border-radius')
    expect(barRule).not.toMatch(/background: rgba\(/)
    expect(fillRule).toContain('background: #3d8f7d')
    expect(fillRule).not.toContain('border-radius')
    expect(fillRule).toContain('transform-origin: left center')
    expect(hoverRule).toContain('background: transparent')
    expect(focusRule).toContain('outline: 1px solid #2c8572')
    expect(focusRule).not.toContain('background:')
    expect(hoverNameRule).toContain('color: #101915')
    expect(selectedNameRule).toContain('color: #101915')
    expect(hoverFillRule).toContain('background: #2c8572')
    expect(selectedFillRule).toContain('background: #2c8572')
    expect(valueRule).toContain(
      'font-family: "Bahnschrift", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
    )
    expect(valueRule).toContain('font-weight: 700')
    expect(valueRule).toContain('font-variant-numeric: tabular-nums')
    expect(valueRule).toContain('letter-spacing: 0')
    expect(valueRule).toContain('text-align: right')
    expect(scrollbarRule).toContain('width: 4px')
    expect(scrollbarButtonRule).toContain('display: none')
    expect(scrollbarButtonRule).toContain('width: 0')
    expect(scrollbarButtonRule).toContain('height: 0')
    expect(scrollbarTrackRule).toContain('background: transparent')
    expect(scrollbarThumbRule).toContain('background: transparent')
    expect(cardHoverScrollbarThumbRule).toContain(
      'background: rgba(23, 62, 53, 0.18)',
    )
    expect(cardFocusScrollbarThumbRule).toContain(
      'background: rgba(23, 62, 53, 0.18)',
    )
  })

  it('lets the administrative region treemap fill the remaining right-panel height', () => {
    expect(appSource).toContain(
      "right-context-panel__stack${isRegionMode ? ' right-context-panel__stack--admin-region' : ''}",
    )
    expect(cssRule('.right-context-panel__stack--admin-region')).toContain(
      'grid-template-rows: minmax(0, 1fr)',
    )
    expect(cssRule('.right-context-panel__stack--admin-region')).toContain(
      'align-content: stretch',
    )
    expect(cssRule('.admin-region-context-panel')).toContain('height: 100%')
    expect(cssRule('.admin-region-context-panel')).toContain(
      'grid-template-rows: auto auto minmax(160px, 1fr)',
    )
    expect(cssRule('.admin-region-treemap-card')).toContain('min-height: 160px')
    expect(cssRule('.admin-region-treemap-card__body')).toContain('min-height: 0')
  })

  it('covers antialias seams only on visited administrative region paths', () => {
    const baseRule = cssRule('.admin-region-atlas-card__base')
    const visitedRule = cssRule('.admin-region-atlas-card__visited')

    expect(baseRule).not.toContain('stroke:')
    expect(visitedRule).toContain('fill: #2c8572')
    expect(visitedRule).toContain('stroke: #2c8572')
    expect(visitedRule).toContain('stroke-width: 0.6')
    expect(visitedRule).toContain('stroke-linecap: round')
    expect(visitedRule).toContain('stroke-linejoin: round')
    expect(visitedRule).toContain('paint-order: stroke fill')
  })

  it('places legacy AMap administrative region unlock controls as a separate map overlay above the toolbar', () => {
    const panelRule = cssRule('.admin-region-unlock-panel')
    const levelRule = cssRule('.admin-region-unlock-levels')

    expect(panelRule).toContain('position: absolute')
    expect(panelRule).toContain('bottom: calc(var(--map-chrome-y) + 66px)')
    expect(panelRule).toContain('right: var(--map-chrome-x)')
    expect(levelRule).toContain('display: grid')
    expect(levelRule).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
  })

  it('places the footprint rendering debug panel in the map upper-right corner', () => {
    const stageRule = cssRule('.map-stage')
    const panelRule = cssRule('.footprint-debug-panel')
    const rowRule = cssRule('.footprint-debug-panel__row')

    expect(amapCanvasSource).toContain('aria-label="足迹渲染调试"')
    expect(mapboxCanvasSource).toContain('aria-label="足迹渲染调试"')
    expect(stageRule).toContain('--map-chrome-top: max(24px, env(safe-area-inset-top))')
    expect(panelRule).toContain('position: absolute')
    expect(panelRule).toContain('right: var(--map-chrome-x)')
    expect(panelRule).toContain('top: var(--map-chrome-top)')
    expect(panelRule).not.toContain('bottom: calc(var(--map-chrome-y) + 66px)')
    expect(panelRule).toContain('width: 148px')
    expect(panelRule).toContain('gap: 3px')
    expect(panelRule).toContain('padding: 8px 11px')
    expect(panelRule).toContain('z-index: 2')
    expect(rowRule).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(rowRule).toContain('gap: 5px')
    expect(rowRule).toContain('white-space: nowrap')
    expect(cssRule('.footprint-debug-panel__row span')).toContain('font-size: 9px')
    expect(cssRule('.footprint-debug-panel__row strong')).toContain('font-size: 10px')
  })

  it('uses sealed shared glass material for footprint overlays', () => {
    const appShellRule = cssRule('.app-shell')

    expect(appShellRule).toContain('--solid-glass-panel-bg:')
    expect(appShellRule).toContain('--glass-panel-opacity: 0.7')
    expect(appShellRule).toContain(
      '--theme-mist-solid-start: rgba(250, 252, 251, calc(var(--glass-panel-opacity) * 1.022))',
    )
    expect(appShellRule).toContain(
      '--theme-mist-solid-end: rgba(232, 242, 240, calc(var(--glass-panel-opacity) * 0.913))',
    )
    expect(appShellRule).toContain(
      '--theme-mist-solid-base: rgba(239, 246, 244, var(--glass-panel-opacity))',
    )
    expect(appShellRule).toContain('linear-gradient(145deg, var(--theme-mist-solid-start), var(--theme-mist-solid-end))')
    expect(appShellRule).toContain('var(--theme-mist-solid-base)')
    expect(amapCanvasSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact footprint-debug-panel"')
    expect(mapboxCanvasSource).toContain('className="glass-panel glass-panel--solid glass-panel--compact footprint-debug-panel"')
    expect(mapControlsSource).toContain('className="glass-panel glass-panel--solid glass-panel--card footprint-style-popover"')

    for (const selector of [
      '.footprint-debug-panel',
      '.admin-region-unlock-panel',
      '.footprint-style-popover',
      '.map-message',
    ]) {
      for (const rule of allCssRules(selector)) {
        expectNoOwnedGlassMaterial(rule)
        expectNoOwnedGlassShape(rule)
      }
    }
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

  it('uses Mapbox as the active configurable projection map surface for footprint tiles', () => {
    expect(appSource).toContain("lazy(() => import('./components/MapboxCanvas')")
    expect(appSource).toContain('default: module.MapboxCanvas')
    expect(appSource).toContain('<LazyMapboxCanvas')
    expect(appSource).toContain('<MapLoadingFallback />')
    expect(appSource).toContain('fallback={<MapLoadingFallback />}')
    expect(appSource).not.toContain('<AmapCanvas')
    expect(mapboxCanvasSource).toContain('MAX_FOOTPRINT_TILE_ZOOM')
    expect(mapboxCanvasSource).toContain('maxZoom: MAX_FOOTPRINT_TILE_ZOOM')
    expect(mapboxCanvasSource).toContain('minPitch: 0')
    expect(mapboxCanvasSource).toContain('maxPitch: 0')
    expect(mapboxCanvasSource).toContain('pitch: 0')
    expect(mapboxCanvasSource).toContain('bearing: 0')
    expect(mapboxCanvasSource).toContain('dragRotate: false')
    expect(mapboxCanvasSource).toContain('touchZoomRotate: false')
    expect(mapboxCanvasSource).toContain('touchPitch: false')
    expect(mapboxCanvasSource).toContain("const DEFAULT_MAPBOX_PROJECTION: MapboxProjection = 'globe'")
    expect(mapboxCanvasSource).toContain('VITE_MAPBOX_PROJECTION?: string')
    expect(mapboxCanvasSource).toContain('projection: resolvedProjection')
    expect(mapboxCanvasSource).toContain("renderWorldCopies: resolvedProjection === 'mercator'")
    expect(mapboxCanvasSource).toContain('createFootprintVectorTileSource')
    expect(mapboxCanvasSource).toContain('createFootprintCircleLayer')
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
