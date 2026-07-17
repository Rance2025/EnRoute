import { describe, expect, it } from 'vitest'

import type {
  AdminRegionMetric,
  AdminRegionSummary,
} from '../layers/adminRegionSummaryDataSource'
import type { AdminRegionDepth } from '../layers/adminRegionVectorTileSource'
import { buildAdminRegionTreemapModel } from './adminRegionTreemap'

function createMetric({
  regionId,
  parentRegionId,
  name,
  footprintCount,
  stayDurationSeconds,
  travelDistanceMeters,
}: {
  regionId: string
  parentRegionId: string | null
  name: string
  footprintCount: number
  stayDurationSeconds: number
  travelDistanceMeters: number
}): AdminRegionMetric {
  return {
    regionId,
    parentRegionId,
    name,
    footprintCount,
    stayDurationSeconds,
    travelDistanceMeters,
    bounds: { west: 100, south: 20, east: 110, north: 30 },
  }
}

function createSummary(
  depth: AdminRegionDepth,
  regionMetrics: AdminRegionMetric[],
): AdminRegionSummary {
  return {
    depth,
    visitedRegionIds: regionMetrics.filter((item) => item.footprintCount > 0)
      .map((item) => item.regionId),
    visitedCount: regionMetrics.filter((item) => item.footprintCount > 0).length,
    totalCount: regionMetrics.length,
    visitedPath: '',
    regionMetrics,
  }
}

const china = createMetric({
  regionId: 'CN', parentRegionId: null, name: '中国',
  footprintCount: 100, stayDurationSeconds: 10_000, travelDistanceMeters: 1_000,
})
const unitedStates = createMetric({
  regionId: 'US', parentRegionId: null, name: '美国',
  footprintCount: 20, stayDurationSeconds: 2_000, travelDistanceMeters: 500,
})
const jiangsu = createMetric({
  regionId: '320000', parentRegionId: 'CN', name: '江苏',
  footprintCount: 60, stayDurationSeconds: 6_000, travelDistanceMeters: 300,
})
const zhejiang = createMetric({
  regionId: '330000', parentRegionId: 'CN', name: '浙江',
  footprintCount: 40, stayDurationSeconds: 4_000, travelDistanceMeters: 700,
})
const nanjing = createMetric({
  regionId: '320100', parentRegionId: '320000', name: '南京',
  footprintCount: 30, stayDurationSeconds: 3_600, travelDistanceMeters: 100,
})
const suzhou = createMetric({
  regionId: '320500', parentRegionId: '320000', name: '苏州',
  footprintCount: 20, stayDurationSeconds: 1_800, travelDistanceMeters: 200,
})
const hangzhou = createMetric({
  regionId: '330100', parentRegionId: '330000', name: '杭州',
  footprintCount: 10, stayDurationSeconds: 900, travelDistanceMeters: 400,
})
const gulou = createMetric({
  regionId: '320106', parentRegionId: '320100', name: '鼓楼',
  footprintCount: 12, stayDurationSeconds: 1_200, travelDistanceMeters: 80,
})
const xuanwu = createMetric({
  regionId: '320102', parentRegionId: '320100', name: '玄武',
  footprintCount: 8, stayDurationSeconds: 800, travelDistanceMeters: 20,
})

describe('buildAdminRegionTreemapModel', () => {
  it('focuses China into provinces while keeping another selected country at country scope', () => {
    const countrySummary = createSummary(1, [china, unitedStates])
    const provinceSummary = createSummary(2, [jiangsu, zhejiang])

    const chinaModel = buildAdminRegionTreemapModel({
      depth: 1,
      currentSummary: countrySummary,
      nextSummary: provinceSummary,
      selectedRegion: china,
      metric: 'footprint',
    })
    const usModel = buildAdminRegionTreemapModel({
      depth: 1,
      currentSummary: countrySummary,
      nextSummary: provinceSummary,
      selectedRegion: unitedStates,
      metric: 'footprint',
    })

    expect(chinaModel).toMatchObject({
      dataDepth: 2,
      title: '中国各省',
      selectedRegionId: null,
    })
    expect(chinaModel.items.map((item) => item.region.regionId)).toEqual(['320000', '330000'])
    expect(usModel).toMatchObject({
      dataDepth: 1,
      title: '各国',
      selectedRegionId: 'US',
    })
    expect(usModel.items.map((item) => item.region.regionId)).toEqual(['CN', 'US'])
  })

  it('focuses a selected province into direct cities and a selected city into direct districts', () => {
    const provinceModel = buildAdminRegionTreemapModel({
      depth: 2,
      currentSummary: createSummary(2, [jiangsu, zhejiang]),
      nextSummary: createSummary(3, [nanjing, suzhou, hangzhou]),
      selectedRegion: jiangsu,
      metric: 'time',
    })
    const cityModel = buildAdminRegionTreemapModel({
      depth: 3,
      currentSummary: createSummary(3, [nanjing, suzhou, hangzhou]),
      nextSummary: createSummary(4, [gulou, xuanwu]),
      selectedRegion: nanjing,
      metric: 'distance',
    })

    expect(provinceModel).toMatchObject({ dataDepth: 3, title: '江苏各市' })
    expect(provinceModel.items.map((item) => [item.region.regionId, item.metricValue])).toEqual([
      ['320100', 3_600],
      ['320500', 1_800],
    ])
    expect(cityModel).toMatchObject({ dataDepth: 4, title: '南京各区县' })
    expect(cityModel.items.map((item) => item.region.regionId)).toEqual(['320106', '320102'])
  })

  it('keeps district scope unchanged and marks the selected district for outlining', () => {
    const model = buildAdminRegionTreemapModel({
      depth: 4,
      currentSummary: createSummary(4, [gulou, xuanwu]),
      nextSummary: null,
      selectedRegion: gulou,
      metric: 'footprint',
    })

    expect(model).toMatchObject({
      dataDepth: 4,
      title: '全部区县',
      selectedRegionId: '320106',
    })
    expect(model.items.map((item) => item.region.regionId)).toEqual(['320106', '320102'])
  })

  it('filters only the active metric zeroes, retains every positive value, and uses raw shares', () => {
    const zeroFootprint = createMetric({
      regionId: 'zero', parentRegionId: 'CN', name: '零值',
      footprintCount: 0, stayDurationSeconds: 999, travelDistanceMeters: 999,
    })
    const tiny = createMetric({
      regionId: 'tiny', parentRegionId: 'CN', name: '微小',
      footprintCount: 1, stayDurationSeconds: 1, travelDistanceMeters: 1,
    })
    const model = buildAdminRegionTreemapModel({
      depth: 2,
      currentSummary: createSummary(2, [jiangsu, zeroFootprint, tiny]),
      nextSummary: null,
      selectedRegion: null,
      metric: 'footprint',
    })

    expect(model.totalValue).toBe(61)
    expect(model.items.map((item) => item.region.regionId)).toEqual(['320000', 'tiny'])
    expect(model.items.map((item) => item.metricValue)).toEqual([60, 1])
    expect(model.items.reduce((total, item) => total + item.share, 0)).toBeCloseTo(1)
    expect(model.items[1].share).toBeCloseTo(1 / 61)
  })

  it('uses metric-specific ordering, stable ties, and the approved project color endpoints', () => {
    const alpha = createMetric({
      regionId: 'alpha', parentRegionId: 'CN', name: '安',
      footprintCount: 10, stayDurationSeconds: 20, travelDistanceMeters: 30,
    })
    const alphaLaterId = createMetric({
      regionId: 'beta', parentRegionId: 'CN', name: '安',
      footprintCount: 10, stayDurationSeconds: 20, travelDistanceMeters: 30,
    })
    const maximum = createMetric({
      regionId: 'maximum', parentRegionId: 'CN', name: '最高',
      footprintCount: 100, stayDurationSeconds: 1, travelDistanceMeters: 1,
    })
    const minimum = createMetric({
      regionId: 'minimum', parentRegionId: 'CN', name: '最低',
      footprintCount: 1, stayDurationSeconds: 1, travelDistanceMeters: 1,
    })
    const model = buildAdminRegionTreemapModel({
      depth: 2,
      currentSummary: createSummary(2, [minimum, alphaLaterId, maximum, alpha]),
      nextSummary: null,
      selectedRegion: null,
      metric: 'footprint',
    })

    expect(model.items.map((item) => item.region.regionId)).toEqual([
      'maximum', 'alpha', 'beta', 'minimum',
    ])
    expect(model.items[0]).toMatchObject({ fill: '#1d594c', textColor: '#f8fbfa' })
    expect(model.items.at(-1)).toMatchObject({ fill: '#d3e1dd', textColor: '#17231f' })
    expect(model.items[1].fill).toBe(model.items[2].fill)
  })
})
