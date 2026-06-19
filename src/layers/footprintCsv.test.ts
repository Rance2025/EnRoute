import { describe, expect, it } from 'vitest'

import { parseFootprintCsv } from './footprintCsv'

describe('parseFootprintCsv', () => {
  it('parses one exported location row with a seconds timestamp', () => {
    const csv = [
      'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
      '1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956',
    ].join('\n')

    expect(parseFootprintCsv(csv)).toEqual([
      {
        id: '1768144456-0',
        timestampSeconds: 1768144456,
        longitude: 121.511383,
        latitude: 31.296564,
        accuracy: 5.729415,
        speed: -1,
        distance: 0,
        heading: 0,
        altitude: 10.146956,
        locType: 1,
        isBackForeground: 1,
        stepType: 0,
      },
    ])
  })

  it('skips blank lines and rows with invalid coordinates', () => {
    const csv = [
      'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
      '',
      '1768144456,1,181,31.296564,0,5,-1,0,1,0,10',
      '1768144457,1,121.5,91,0,5,-1,0,1,0,10',
      '1768144458,1,121.5,31.2,0,5,-1,0,1,0,10',
    ].join('\n')

    expect(parseFootprintCsv(csv)).toHaveLength(1)
    expect(parseFootprintCsv(csv)[0].timestampSeconds).toBe(1768144458)
  })
})
