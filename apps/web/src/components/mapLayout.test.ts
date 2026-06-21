import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appCss = readFileSync('src/App.css', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')
const amapCanvasSource = readFileSync('src/components/AmapCanvas.tsx', 'utf8')
const amapLoaderSource = readFileSync('src/services/amapLoader.ts', 'utf8')
const mapControlsSource = readFileSync('src/components/MapControls.tsx', 'utf8')
const segmentedControlSource = readFileSync('src/components/SegmentedControl.tsx', 'utf8')
const timeContextPanelSource = readFileSync('src/components/TimeContextPanel.tsx', 'utf8')

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return appCss.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? ''
}

function lastCssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...appCss.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'g'))]

  return matches.at(-1)?.[0] ?? ''
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

  it('reserves a left shared time panel, a right secondary navigation rail, and keeps the map between them', () => {
    const appShellRule = cssRule('.app-shell')
    const panelRule = cssRule('.time-context-panel')
    const secondaryRailRule = cssRule('.secondary-nav-rail')
    const workspaceRule = cssRule('.main-workspace')
    const stageRule = cssRule('.map-stage')

    expect(appShellRule).toContain('position: relative')
    expect(appShellRule).toContain('--page-board-bg:')
    expect(appShellRule).toContain('--secondary-rail-width: 60px')
    expect(appShellRule).toContain('rgba(238, 244, 242, 0.66)')
    expect(appShellRule).toContain('rgba(204, 214, 215, 0.78)')
    expect(appShellRule).toContain('#ccd6d7')
    expect(appShellRule).toContain('background: var(--page-board-bg)')
    expect(appSource).toContain('aria-label="二级导航"')
    expect(appSource).toContain('className="secondary-nav-rail"')
    expect(appSource).toContain('const secondaryNavItemsByView')
    expect(appSource).toContain("label: '足迹'")
    expect(appSource).toContain("label: '区域'")
    expect(appSource).toContain("label: '统计'")
    expect(appSource).toContain("label: '流水'")
    expect(secondaryRailRule).toContain('position: absolute')
    expect(secondaryRailRule).toContain('inset: 0 0 0 auto')
    expect(secondaryRailRule).toContain('width: var(--secondary-rail-width)')
    expect(secondaryRailRule).toContain('height: 100svh')
    expect(secondaryRailRule).toContain('align-items: center')
    expect(secondaryRailRule).toContain('justify-content: center')
    expect(secondaryRailRule).toContain('padding: 0 8px')
    expect(secondaryRailRule).toContain('box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.42)')
    expect(secondaryRailRule).toContain('background: transparent')
    expect(secondaryRailRule).toContain('pointer-events: auto')
    expect(panelRule).toContain('inset: 0 auto 0 0')
    expect(panelRule).toContain('background: transparent')
    expect(panelRule).not.toContain('backdrop-filter')
    expect(panelRule).not.toContain('border-right')
    expect(panelRule).toContain('box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.42)')
    expect(panelRule).toContain('width: var(--data-panel-width, 0px)')
    expect(panelRule).toContain('overflow: visible')
    expect(panelRule).toContain('pointer-events: none')
    expect(cssRule('.app-shell:not(.has-data-panel) .time-context-panel')).toContain(
      'display: none',
    )
    expect(workspaceRule).toContain(
      'inset: 0 var(--secondary-rail-width) 0 var(--data-panel-width)',
    )
    expect(workspaceRule).toContain(
      'width: calc(100vw - var(--data-panel-width) - var(--secondary-rail-width))',
    )
    expect(workspaceRule).toContain('overflow: visible')
    expect(workspaceRule).toContain('background: transparent')
    expect(stageRule).toContain(
      'inset: 0 var(--secondary-rail-width) 0 var(--data-panel-width)',
    )
    expect(stageRule).toContain(
      'width: calc(100vw - var(--data-panel-width) - var(--secondary-rail-width))',
    )
    expect(stageRule).toContain('background: transparent')
    expect(stageRule).not.toContain('var(--page-board-bg)')
    expect(cssRule('.app-shell--map .secondary-nav-rail')).toBe('')
    expect(cssRule('.app-shell--accounting .secondary-nav-rail')).toBe('')
    expect(cssRule('.app-shell--schedule .secondary-nav-rail')).toBe('')
    expect(cssRule('.secondary-nav-rail__button')).toContain('box-sizing: border-box')
    expect(cssRule('.secondary-nav-rail__button')).toContain('width: 44px')
    expect(cssRule('.secondary-nav-rail__button')).toContain('height: 44px')
    expect(cssRule('.secondary-nav-rail__button')).toContain('aspect-ratio: 1 / 1')
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
    const accountPanelPlacementRule = cssRule('.ios-account-filter-panel')
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
      'inset: 0 var(--secondary-rail-width) 0 var(--data-panel-width)',
    )
    expect(accountingPageRule).toContain('grid-template-columns: minmax(0, 1fr) minmax(640px, 1fr) minmax(280px, 320px)')
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
    expect(accountingPageRule).not.toContain('#f2f5f2')
    expect(cssRule('.accounting-page::before')).toBe('')
    expect(cssRule('.app-shell--accounting .time-context-panel::after')).toBe('')
    expect(cssRuleIn(mobileMedia, '.accounting-page')).toContain('padding: 92px 10px 12px')
    expect(cssRuleIn(mobileMedia, '.accounting-page::before')).toBe('')
    expect(cssRuleIn(mobileMedia, '.app-shell--accounting .time-context-panel::after')).toBe('')
    expect(
      cssRuleIn(
        mediaBlock(
          '@media (min-width: 721px) and (max-width: 1240px), (min-width: 721px) and (max-height: 790px)',
        ),
        '.accounting-page',
      ),
    ).toContain('--accounting-outer-gutter: 28px')
    expect(workspaceRule).toContain('grid-column: 1 / -1')
    expect(workspaceRule).toContain(
      'grid-template-columns: minmax(640px, 1fr) minmax(280px, 320px)',
    )
    expect(workspaceRule).toContain('gap: var(--accounting-internal-gap)')
    expect(workspaceRule).toContain('align-items: start')
    expect(workspaceRule).toContain('position: relative')
    expect(ledgerMainPlacementRule).toContain('grid-column: 1')
    expect(ledgerMainPlacementRule).toContain('height: calc(100svh - 114px)')
    expect(accountPanelPlacementRule).toContain('align-self: start')
    expect(accountPanelPlacementRule).toContain('grid-column: 2')
    expect(accountPanelPlacementRule).toContain('width: 100%')
    expect(accountPanelPlacementRule).toContain('height: calc(100svh - 114px)')
    expect(accountPanelPlacementRule).toContain('margin-top: 0')
    expect(accountPanelPlacementRule).not.toContain('position: fixed')
    expect(accountPanelPlacementRule).not.toContain('right: 24px')
    expect(accountPanelPlacementRule).not.toContain('top: 92px')
    expect(cssRuleIn(mobileMedia, '.ios-account-ledger-workspace')).toContain('grid-column: 1')
    expect(cssRuleIn(mobileMedia, '.ios-account-ledger-workspace')).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
    expect(cssRuleIn(mobileMedia, '.ios-ledger-main')).toContain('grid-column: 1')
    expect(cssRuleIn(mobileMedia, '.ios-account-filter-panel')).toContain('grid-column: 1')
    expect(cssRuleIn(mobileMedia, '.ios-account-filter-panel')).not.toContain('position: fixed')
    expect(cssRuleIn(mobileMedia, '.ios-account-filter-panel')).not.toContain('\n    top:')
    expect(cssRuleIn(mobileMedia, '.ios-account-filter-panel')).not.toContain('\n    right:')
  })

  it('keeps the shared time panel high in the left rail without a fake top spacer', () => {
    const scrollRule = cssRule('.time-context-panel__scroll')

    expect(scrollRule).toContain('--time-panel-shadow-buffer: 34px')
    expect(scrollRule).toContain('width: calc(100% + var(--time-panel-shadow-buffer))')
    expect(scrollRule).toContain('margin-right: calc(0px - var(--time-panel-shadow-buffer))')
    expect(scrollRule).toContain(
      'padding: 96px calc(24px + var(--time-panel-shadow-buffer)) 18px 24px',
    )
    expect(scrollRule).toContain('gap: 20px')
    expect(scrollRule).toContain('overflow-x: hidden')
    expect(scrollRule).toContain('overflow-y: auto')
    expect(scrollRule).toContain('pointer-events: none')
    expect(scrollRule).not.toContain('padding: 16px')
    expect(scrollRule).not.toContain('padding: 88px')
    expect(cssRule('.time-context-panel__scroll > *')).toContain('pointer-events: auto')
  })

  it('keeps the left time panel layout isomorphic across navigation views', () => {
    const sharedScrollRule = cssRule('.time-context-panel__scroll')

    expect(sharedScrollRule).toContain(
      'padding: 96px calc(24px + var(--time-panel-shadow-buffer)) 18px 24px',
    )
    expect(sharedScrollRule).toContain('gap: 20px')
    expect(cssRule('.app-shell--map .time-context-panel__scroll')).toBe('')
    expect(cssRule('.app-shell--accounting .time-context-panel__scroll')).toBe('')
    expect(cssRule('.app-shell--schedule .time-context-panel__scroll')).toBe('')
  })

  it('keeps the settings entry in the shared time-panel footer without view-specific placement', () => {
    expect(timeContextPanelSource).toContain('aria-label="打开设置"')
    expect(timeContextPanelSource).toContain('className="time-context-panel__footer"')
    expect(timeContextPanelSource).toContain('className="time-settings-button"')
    expect(cssRule('.time-context-panel__footer')).toContain('align-self: end')
    expect(cssRule('.time-context-panel__footer')).toContain('justify-self: start')
    expect(cssRule('.time-settings-button')).toContain('width: 44px')
    expect(cssRule('.time-settings-button')).toContain('height: 44px')
    expect(cssRule('.time-settings-button')).toContain('border-radius: 999px')
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

  it('lets the time header card shadow render past the rail edge without a hard clip', () => {
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
    expect(cardRule).toContain('box-shadow:')
    expect(cardRule).toContain('rgba(13, 46, 39, 0.22)')
    expect(cardRule).not.toContain('0 18px 42px rgba(13, 46, 39, 0.24)')
    expect(cardRule).toContain('0 18px 34px -12px')
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
    expect(ledgerRule).toContain('height: calc(100svh - 114px)')
    expect(ledgerRule).toContain('background: transparent')
    expect(ledgerRule).toContain('border: 0')
    expect(ledgerRule).toContain('box-shadow: none')
    expect(ledgerRule).toContain('overflow: visible')
    expect(ledgerScrollRule).toContain('padding: 0')
    expect(ledgerScrollRule).toContain('gap: 10px')
    expect(accountPanelRule).toContain('height: calc(100svh - 114px)')
    expect(accountPanelRule).toContain('max-width: 320px')
    expect(accountPanelRule).toContain('background: transparent')
    expect(accountPanelRule).toContain('box-shadow: none')
  })

  it('keeps compact desktop accounting columns aligned to the shared rail', () => {
    const compactMedia = mediaBlock(
      '@media (min-width: 721px) and (max-width: 1240px), (min-width: 721px) and (max-height: 790px)',
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
    expect(cssRuleIn(compactMedia, '.ios-account-ledger-workspace')).toContain(
      'grid-template-columns: minmax(500px, 1fr) minmax(252px, 286px)',
    )
    expect(cssRuleIn(compactMedia, '.ios-account-ledger-workspace')).toContain(
      'gap: var(--accounting-internal-gap)',
    )
    expect(cssRuleIn(compactMedia, '.time-context-panel__scroll')).toContain(
      'padding: 96px calc(24px + var(--time-panel-shadow-buffer)) 18px 24px',
    )
    expect(cssRuleIn(compactMedia, '.ios-ledger-main')).toContain('height: calc(100svh - 110px)')
    expect(cssRuleIn(compactMedia, '.ios-account-filter-panel')).toContain('height: calc(100svh - 110px)')
    expect(cssRuleIn(compactMedia, '.ios-account-filter-panel')).toContain('max-width: 286px')
    expect(cssRuleIn(compactMedia, '.ios-account-filter-panel')).not.toContain('height: calc(100svh - 112px)')
    expect(cssRuleIn(compactMedia, '.ios-ledger-main')).not.toContain('height: calc(100svh - 136px)')
  })

  it('moves accounting metrics into the time card instead of the bottom summary grid', () => {
    expect(timeContextPanelSource).toContain('aria-label="全局范围指标"')
    expect(timeContextPanelSource).not.toContain('aria-label="记账概览卡片"')
    expect(timeContextPanelSource).not.toContain('aria-label="当前范围摘要"')
    expect(cssRule('.time-context-metric-strip')).toContain('grid-template-columns: repeat(auto-fit, minmax(68px, 1fr))')
    expect(cssRule('.time-context-accounting-summary')).toBe('')
    expect(cssRule('.time-context-summary')).toBe('')
    expect(cssRule('.ios-summary-strip')).toBe('')
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
    const rule = cssRule('.time-picker-bar button:not(.time-period-title)')

    expect(rule).toContain('display: grid')
    expect(rule).toContain('place-items: center')
    expect(rule).toContain('line-height: 1')
  })

  it('centers calendar arrow glyphs inside circular buttons', () => {
    const rule = cssRule('.time-picker-bar button:not(.time-period-title)')

    expect(appCss).toMatch(
      /\.time-calendar-bar button:not\(\.time-period-title\),\s*\.time-picker-bar button:not\(\.time-period-title\)\s*\{/,
    )
    expect(rule).toContain('display: grid')
    expect(rule).toContain('place-items: center')
    expect(rule).toContain('line-height: 1')
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

  it('animates the day calendar by clipping and translating one stable month grid', () => {
    const shellRule = cssRule('.time-calendar-shell')
    const switchRule = cssRule('.time-calendar-switch')
    const bodyRule = cssRule('.time-calendar-body')
    const weekBodyRule = cssRule('.time-calendar-body--week')
    const monthBodyRule = cssRule('.time-calendar-body--month')
    const collapsingWeekBodyRule = cssRule('.time-calendar-body--collapsing-week')
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
    expect(collapsingWeekBodyRule).toContain(
      '--time-calendar-grid-offset: calc(var(--time-calendar-active-week-index) * -1)',
    )
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
    expect(cssRule('.time-calendar-body--collapsing-week .time-calendar-grid')).toBe('')
    expect(buttonRule).toContain('height: var(--time-calendar-day-height)')
    expect(buttonRule).toContain('min-height: var(--time-calendar-day-height)')
  })

  it('starts the day calendar collapse transition from the calendar switch event', () => {
    expect(timeContextPanelSource).toContain('function handleCalendarModeChange')
    expect(timeContextPanelSource).toContain("calendarMode === 'month' && mode === 'week'")
    expect(timeContextPanelSource).toContain('handleCalendarModeChange,')
    expect(timeContextPanelSource).toContain('if (mode !== calendarMode) onCalendarModeChange(mode)')
    expect(timeContextPanelSource).not.toContain('previousCalendarModeRef')
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

  it('keeps short week ranges on one line inside picker cards', () => {
    const detailRule = cssRule('.time-picker-grid button small')
    const weekDetailRule = lastCssRule('.time-picker-grid--weeks button small')
    const weekDetailLineRule = lastCssRule('.time-picker-grid--weeks button small > span')
    const weekDetailSeparatorRule = lastCssRule(".time-picker-grid--weeks button small span[aria-hidden='true']")

    expect(detailRule).toContain('white-space: nowrap')
    expect(weekDetailRule).toBe('')
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
    const customDateWindowRule = cssRule('.time-date-picker__grid-window')
    const customDateMotionRule = cssRule('.time-date-picker__grid-motion')
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
    expect(customDateWindowRule).toContain('overflow: hidden')
    expect(customDateMotionRule).toContain('width: 100%')
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
    expect(appCss).not.toMatch(/\.time-date-picker__bar button\s*\{/)
    expect(monthGridRule).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))')
    expect(monthButtonRule).toContain('height: 34px')
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
    expect(presetRule).toContain('margin-bottom: 18px')
    expect(presetButtonRule).toContain('color: rgba(17, 40, 35, 0.58)')
    expect(activePresetRule).toContain('color: #f8fbfa')
    expect(fieldsRule).toContain('display: flex')
    expect(fieldsRule).toContain('justify-content: center')
    expect(fieldsRule).toContain('align-items: center')
    expect(fieldsRule).toContain('gap: clamp(18px, 10%, 32px)')
    expect(fieldsRule).toContain('margin-top: 0')
    expect(fieldRule).toContain('display: inline-grid')
    expect(fieldRule).toContain('grid-template-columns: auto auto')
    expect(fieldRule).toContain('gap: 8px')
    expect(buttonRule).toContain('width: auto')
    expect(buttonRule).toContain('padding: 0')
    expect(separatorRule).toContain('width: 20px')
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
      '--segmented-label-color: rgba(255, 255, 255, 0.66)',
    )
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-gap: 3px')
    expect(cssRule('.time-mode-tabs')).not.toContain('--segmented-thumb-shadow')
    expect(cssRule('.transaction-type-switch')).not.toContain('--segmented-thumb-shadow')
    expect(cssRule('.time-mode-tabs')).toContain('--segmented-active-label-color: #123f35')
    expect(appSource).toContain('className="app-nav__thumb"')
    expect(appSource).toContain('topNavigationButtonRefs')
    expect(appSource).toContain('getBoundingClientRect()')
    expect(cssRule('.app-nav__thumb')).toContain('left: var(--top-nav-thumb-left)')
    expect(cssRule('.app-nav__thumb')).toContain('width: var(--top-nav-thumb-width)')
    expect(cssRule('.app-nav__button--page svg')).toContain('color: currentColor')
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

  it('renders the settings dialog as a centered non-fullscreen modal', () => {
    expect(appSource).toContain('className="settings-dialog"')
    expect(appSource).toContain('className="settings-dialog__panel"')
    expect(appSource).toContain('aria-labelledby="settings-dialog-title"')
    expect(cssRule('.settings-dialog')).toContain('position: fixed')
    expect(cssRule('.settings-dialog')).toContain('place-items: center')
    expect(cssRule('.settings-dialog__backdrop')).toContain('position: absolute')
    expect(cssRule('.settings-dialog__panel')).toContain('width: min(360px, calc(100vw - 32px))')
    expect(cssRule('.settings-dialog__panel')).toContain('max-height: calc(100svh - 32px)')
    expect(cssRule('.settings-dialog__panel')).not.toContain('width: 100vw')
    expect(cssRule('.settings-dialog__panel')).not.toContain('height: 100svh')
    expect(cssRule('.settings-navigation-tabs')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
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

  it('keeps ledger rows in the main center column and account cards in the inset right panel', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')
    const workspaceRule = cssRule('.ios-account-ledger-workspace')
    const accountPanelRule = cssRule('.ios-account-filter-panel')

    expect(workspaceRule).toContain(
      'grid-template-columns: minmax(640px, 1fr) minmax(280px, 320px)',
    )
    expect(accountPanelRule).toContain('grid-column: 2')
    expect(accountPanelRule).toContain('width: 100%')
    expect(accountPanelRule).not.toContain('\n  top:')
    expect(accountPanelRule).not.toContain('height: 100svh')
    expect(ledgerSource.indexOf('className="ios-panel ios-ledger-main"')).toBeLessThan(
      ledgerSource.indexOf('className="ios-panel ios-account-filter-panel"'),
    )
  })

  it('keeps account cards in a top-right area and reserves a separate lower-right area', () => {
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')
    const panelRule = cssRule('.ios-account-filter-panel')
    const accountRegionRule = cssRule('.ios-account-filter-panel__accounts')
    const secondaryRegionRule = cssRule('.ios-account-filter-panel__secondary')
    const panelHeadRule = cssRule('.ios-account-filter-panel .ios-panel-head')
    const summaryRule = cssRule('.ios-account-stack-summary')
    const allFilterRule = cssRule('.ios-account-all-filter')
    const stackRule = cssRule('.ios-account-filter-stack')

    expect(ledgerSource).toContain('className="ios-account-filter-panel__accounts"')
    expect(ledgerSource).toContain('className="ios-account-filter-panel__secondary"')
    expect(ledgerSource.indexOf('className="ios-account-filter-panel__accounts"')).toBeLessThan(
      ledgerSource.indexOf('className="ios-account-filter-panel__secondary"'),
    )
    expect(panelRule).toContain('padding: 14px 18px 16px')
    expect(panelRule).toContain('grid-column: 2')
    expect(panelRule).toContain('width: 100%')
    expect(panelRule).toContain('max-width: 320px')
    expect(panelRule).toContain('height: calc(100svh - 114px)')
    expect(panelRule).toContain('border-radius: 26px')
    expect(panelRule).toContain('gap: 14px')
    expect(panelRule).toContain('background: transparent')
    expect(panelRule).toContain('box-shadow: none')
    expect(cssRule('.ios-ledger-main')).toContain('background: transparent')
    expect(accountRegionRule).toContain('display: grid')
    expect(accountRegionRule).toContain('align-content: start')
    expect(accountRegionRule).toContain('overflow: visible')
    expect(secondaryRegionRule).toContain('min-height: 0')
    expect(secondaryRegionRule).toContain('border-top: 1px solid rgba(23, 35, 31, 0.06)')
    expect(secondaryRegionRule).not.toContain('border-radius:')
    expect(secondaryRegionRule).not.toContain('ios-account-filter-card')
    expect(panelHeadRule).toContain('padding: 8px 0 10px')
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
      '@media (min-width: 721px) and (max-width: 1240px), (min-width: 721px) and (max-height: 790px)',
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

    expect(accountPanelRule).toContain('height: calc(100svh - 114px)')
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
    const rowRule = cssRule('.ios-transaction-row')
    const sideRule = cssRule('.ios-transaction-row__side')
    const metaRule = cssRule('.ios-transaction-row__meta')
    const sideTextRule =
      appCss.match(
        /\.ios-transaction-row__side b,\s*\.ios-transaction-row__meta\s*\{[^}]*\}/,
      )?.[0] ?? ''
    const ledgerSource = readFileSync('src/components/accounting/LedgerWorkspace.tsx', 'utf8')

    expect(rowRule).toContain('grid-template-columns:')
    expect(rowRule).toContain('minmax(96px, 112px)')
    expect(rowRule).toContain('overflow: hidden')
    expect(sideRule).toContain('min-width: 0')
    expect(sideRule).toContain('justify-items: end')
    expect(metaRule).toContain('display: inline-flex')
    expect(metaRule).toContain('gap:')
    expect(sideTextRule).toContain('max-width: 100%')
    expect(sideTextRule).toContain('text-overflow: ellipsis')
    expect(ledgerSource).toContain('className="ios-transaction-row__meta"')
    expect(ledgerSource).toMatch(
      /<span className="ios-transaction-row__meta">\s*<time>\{formatMonthDay\(transaction\.occurredAt\)\}<\/time>\s*<small>\{typeLabels\[transaction\.type\]\}<\/small>\s*<\/span>/,
    )
  })

  it('keeps compact ledger rows as a single readable line instead of wrapping side content under the icon', () => {
    const compactMedia = mediaBlock(
      '@media (min-width: 721px) and (max-width: 1240px), (min-width: 721px) and (max-height: 790px)',
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
    const swatchRule = cssRule('.footprint-style-popover__swatch')

    expect(toolbarRule).toContain('overflow: visible')
    expect(cssRule('.map-toolbar button')).toBe('')
    expect(cssRule('.map-toolbar > button')).toBe('')
    expect(toolbarButtonRule).toContain('width: 38px')
    expect(settingsRule).toContain('position: relative')
    expect(settingsRule).toContain('display: grid')
    expect(appCss).toContain('.map-toolbar__button:hover')
    expect(mapControlsSource).toContain('className="map-toolbar__settings"')
    expect(mapControlsSource).toContain('ref={settingsRef}')
    expect(popoverRule).toContain('position: absolute')
    expect(popoverRule).toContain('right: 0')
    expect(popoverRule).toContain('bottom: calc(100% + 16px)')
    expect(popoverRule).toContain('width: 218px')
    expect(popoverRule).toContain('max-width: calc(100vw - 28px)')
    expect(popoverRule).toContain('border-radius: 10px')
    expect(popoverRule).toContain('background: rgba(250, 252, 251, 0.74)')
    expect(popoverRule).toContain('0 14px 40px rgba(31, 46, 42, 0.12)')
    expect(popoverRule).toContain('backdrop-filter: blur(18px) saturate(1.1)')
    expect(rowRule).toContain('grid-template-columns:')
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

  it('places administrative region unlock level controls as a separate map overlay above the toolbar', () => {
    const panelRule = cssRule('.admin-region-unlock-panel')
    const levelRule = cssRule('.admin-region-unlock-levels')

    expect(panelRule).toContain('position: absolute')
    expect(panelRule).toContain('bottom: calc(var(--map-chrome-y) + 66px)')
    expect(panelRule).toContain('right: var(--map-chrome-x)')
    expect(levelRule).toContain('display: grid')
    expect(levelRule).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))')
  })

  it('places the footprint rendering debug panel in the map upper-right corner', () => {
    const stageRule = cssRule('.map-stage')
    const panelRule = cssRule('.footprint-debug-panel')
    const rowRule = cssRule('.footprint-debug-panel__row')

    expect(amapCanvasSource).toContain('aria-label="足迹渲染调试"')
    expect(stageRule).toContain('--map-chrome-top: max(24px, env(safe-area-inset-top))')
    expect(panelRule).toContain('position: absolute')
    expect(panelRule).toContain('right: var(--map-chrome-x)')
    expect(panelRule).toContain('top: var(--map-chrome-top)')
    expect(panelRule).not.toContain('bottom: calc(var(--map-chrome-y) + 66px)')
    expect(panelRule).toContain('width: 168px')
    expect(panelRule).toContain('z-index: 2')
    expect(rowRule).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(rowRule).toContain('white-space: nowrap')
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
