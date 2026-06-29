import { describe, expect, it, vi } from 'vitest'
import { loadAdminRegions } from './adminRegionDataSource'

describe('admin region data source', () => {
  it('loads selected administrative region level and viewport from the local API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        regions: [
          {
            id: 'sf',
            name: 'San Francisco',
            level: 3,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [[-122.55, 37.7], [-122.35, 37.7], [-122.35, 37.84], [-122.55, 37.84], [-122.55, 37.7]],
              ],
            },
            firstSeenTimestamp: 100,
            footprintCount: 2,
            stayDurationSeconds: 30,
            travelDistanceMeters: 40,
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(loadAdminRegions('/api/admin-regions', {
      level: 3,
      zoom: 10,
      viewportBounds: { west: -123, south: 37, east: -122, north: 38 },
    }, controller.signal)).resolves.toEqual([
      {
        id: 'sf',
        name: 'San Francisco',
        level: 3,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[-122.55, 37.7], [-122.35, 37.7], [-122.35, 37.84], [-122.55, 37.84], [-122.55, 37.7]],
          ],
        },
        firstSeenTimestamp: 100,
        footprintCount: 2,
        stayDurationSeconds: 30,
        travelDistanceMeters: 40,
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions?level=3&west=-123&south=37&east=-122&north=38&zoom=10',
      {
        method: 'GET',
        signal: controller.signal,
      },
    )
  })

  it('rejects malformed administrative region payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ regions: [{ id: 'broken' }] }),
    }))

    await expect(loadAdminRegions('/api/admin-regions', {
      level: 3,
      zoom: 10,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
    }, new AbortController().signal))
      .rejects.toThrow('Invalid admin regions API response')
  })

  it('rejects unavailable administrative levels from API payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        regions: [
          {
            id: 'legacy-street',
            name: 'Street',
            level: 6,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]],
              ],
            },
            firstSeenTimestamp: null,
            footprintCount: 0,
            stayDurationSeconds: 0,
            travelDistanceMeters: 0,
          },
        ],
      }),
    }))

    await expect(loadAdminRegions('/api/admin-regions', {
      level: 3,
      zoom: 10,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
    }, new AbortController().signal))
      .rejects.toThrow('Invalid admin regions API response')
  })

  it('rejects legacy level 5 administrative region payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        regions: [
          {
            id: 'osm:12867438',
            name: 'Huamu',
            level: 5,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]],
              ],
            },
            firstSeenTimestamp: null,
            footprintCount: 0,
            stayDurationSeconds: 0,
            travelDistanceMeters: 0,
          },
        ],
      }),
    }))

    await expect(loadAdminRegions('/api/admin-regions', {
      level: 3,
      zoom: 12,
      viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
    }, new AbortController().signal))
      .rejects.toThrow('Invalid admin regions API response')
  })
})
