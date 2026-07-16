import { describe, expect, it } from 'vitest'

import {
  calculateMapFocusPadding,
  DEFAULT_MAP_FOCUS_MARGIN_PX,
} from './mapFocusViewport'

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom }
}

describe('map focus viewport padding', () => {
  it('adds the same 64px margin outside symmetric overlay panels', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(20, 16, 320, 884),
      rightPanelRect: rect(1120, 16, 1420, 884),
    })).toEqual({ top: 64, right: 384, bottom: 64, left: 384 })
  })

  it('measures asymmetric overlays independently', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(100, 50, 1700, 950),
      leftPanelRect: rect(120, 70, 420, 930),
      rightPanelRect: rect(1480, 70, 1680, 930),
    })).toEqual({ top: 64, right: 284, bottom: 64, left: 384 })
  })

  it('falls back to the safe margin for hidden, outside, or invalid overlays', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(20, 16, 20, 884),
      rightPanelRect: rect(Number.NaN, 16, 1420, 884),
    })).toEqual({ top: 64, right: 64, bottom: 64, left: 64 })

    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(-500, 16, -100, 884),
      rightPanelRect: rect(1540, 16, 1740, 884),
    })).toEqual({ top: 64, right: 64, bottom: 64, left: 64 })
  })

  it('clips partially outside panels to the map rectangle', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 1440, 900),
      leftPanelRect: rect(-100, -20, 250, 920),
      rightPanelRect: rect(1300, -20, 1500, 920),
    })).toEqual({ top: 64, right: 204, bottom: 64, left: 314 })
  })

  it('uses a uniform safe margin when the map rectangle is invalid', () => {
    expect(calculateMapFocusPadding({
      mapRect: rect(0, 0, 0, 900),
      leftPanelRect: rect(20, 16, 320, 884),
      rightPanelRect: rect(1120, 16, 1420, 884),
    })).toEqual({
      top: DEFAULT_MAP_FOCUS_MARGIN_PX,
      right: DEFAULT_MAP_FOCUS_MARGIN_PX,
      bottom: DEFAULT_MAP_FOCUS_MARGIN_PX,
      left: DEFAULT_MAP_FOCUS_MARGIN_PX,
    })
  })
})
