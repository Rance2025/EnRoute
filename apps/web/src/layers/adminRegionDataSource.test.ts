import { describe, expect, it, vi } from 'vitest'
import { loadAdminRegions } from './adminRegionDataSource'

describe('admin region data source', () => {
  it('loads selected administrative region level from the local API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        regions: [
          {
            id: 'sanlin',
            name: '三林镇',
            level: 5,
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

    await expect(loadAdminRegions('/api/admin-regions', 5, controller.signal)).resolves.toEqual([
      {
        id: 'sanlin',
        name: '三林镇',
        level: 5,
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
    expect(fetchMock).toHaveBeenCalledWith('/api/admin-regions?level=5', {
      method: 'GET',
      signal: controller.signal,
    })
  })

  it('rejects malformed administrative region payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ regions: [{ id: 'broken' }] }),
    }))

    await expect(loadAdminRegions('/api/admin-regions', 4, new AbortController().signal))
      .rejects.toThrow('Invalid admin regions API response')
  })
})
