import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MAP_CAMERA, resetMapCamera } from './mapCamera'

describe('map camera', () => {
  it('uses 2D mode and disables map rotation', () => {
    expect(DEFAULT_MAP_CAMERA).toEqual({
      viewMode: '2D',
      pitch: 0,
      rotation: 0,
      pitchEnable: false,
      rotateEnable: false,
    })
  })

  it('resets rotation and pitch before fitting the full China bounds', () => {
    const map = {
      setPitch: vi.fn(),
      setRotation: vi.fn(),
      setBounds: vi.fn(),
    }
    const bounds = { kind: 'amap-bounds' } as unknown as AMap.Bounds

    resetMapCamera(map, bounds)

    expect(map.setPitch).toHaveBeenCalledWith(0, true)
    expect(map.setRotation).toHaveBeenCalledWith(0, true)
    expect(map.setBounds).toHaveBeenCalledWith(bounds, false, undefined, 900)
  })
})
