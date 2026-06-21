import { describe, expect, it, vi } from 'vitest'
import { loadAdminRegions } from './adminRegionDataSource'

describe('admin region data source', () => {
  it('loads selected administrative region level and viewport from the local API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        regions: [
          {
            id: '310115',
            name: 'Pudong',
            level: 4,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]],
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
      level: 4,
      zoom: 10,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
    }, controller.signal)).resolves.toEqual([
      {
        id: '310115',
        name: 'Pudong',
        level: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]],
          ],
        },
        firstSeenTimestamp: 100,
        footprintCount: 2,
        stayDurationSeconds: 30,
        travelDistanceMeters: 40,
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-regions?level=4&west=120&south=30&east=122&north=32&zoom=10',
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
      level: 4,
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
      level: 4,
      zoom: 10,
      viewportBounds: { west: 120, south: 30, east: 122, north: 32 },
    }, new AbortController().signal))
      .rejects.toThrow('Invalid admin regions API response')
  })
})
