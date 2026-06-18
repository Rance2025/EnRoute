import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appCss = readFileSync('src/App.css', 'utf8')
const amapCanvasSource = readFileSync('src/components/AmapCanvas.tsx', 'utf8')

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return appCss.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? ''
}

describe('map chrome layout', () => {
  it('anchors the wordmark to the upper-left instead of centering it', () => {
    const rule = cssRule('.brand-header')

    expect(rule).toContain('left: max(')
    expect(rule).not.toContain('left: 50%')
    expect(rule).not.toContain('translateX(-50%)')
  })

  it('anchors the map toolbar to the lower-right under the compass', () => {
    const rule = cssRule('.map-toolbar')
    const stageRule = cssRule('.map-stage')

    expect(stageRule).toContain('--map-chrome-x: max(24px, env(safe-area-inset-right))')
    expect(stageRule).toContain('--map-chrome-y: max(24px, env(safe-area-inset-bottom))')
    expect(rule).toContain('right: var(--map-chrome-x)')
    expect(rule).toContain('bottom: var(--map-chrome-y)')
    expect(rule).not.toContain('left: 50%')
    expect(rule).not.toContain('translateX(-50%)')
    expect(amapCanvasSource).toContain("right: '24px'")
    expect(amapCanvasSource).toContain("bottom: '82px'")
  })

  it('keeps the floating wordmark compact', () => {
    expect(cssRule('.brand-header h1')).toContain('font-size: clamp(15px, 1.35vw, 18px)')
    expect(cssRule('.brand-header h1 span:last-child')).not.toContain('font-size:')
    expect(appCss).not.toMatch(/font-size:\s*clamp\(22px,\s*3\.6vw,\s*38px\)/)
  })

  it('keeps the toolbar compact enough to sit beside the compass', () => {
    const rule = cssRule('.map-toolbar button')

    expect(rule).toContain('width: 38px')
    expect(rule).toContain('height: 38px')
    expect(amapCanvasSource).toContain("right: '24px'")
  })

  it('visually ties the AMap compass to the lower-right toolbar', () => {
    expect(cssRule('.map-stage .amap-controlbar')).toBe('')
    expect(amapCanvasSource).toContain("right: '24px'")
    expect(amapCanvasSource).toContain("bottom: '82px'")
  })
})
