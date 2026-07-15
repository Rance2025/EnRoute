import { describe, expect, it, vi } from 'vitest'

import { loadAdminRegionThumbnailBases } from './adminRegionThumbnailBaseDataSource'

const thumbnailBasesPayload = {
  viewBox: '0 0 320 180',
  signature: 'thumbnail-signature',
  bases: {
    world: { path: 'M0 0L320 0L320 180Z' },
    china: { path: 'M80 30L240 30L240 160Z' },
  },
}

function createJsonResponse(payload: unknown, status = 200) {
  const response = new Response(null, { status })
  response.json = async () => payload
  return response
}

describe('loadAdminRegionThumbnailBases', () => {
  it('loads the independent world and China thumbnail bases', async () => {
    const fetcher = vi.fn(async () => createJsonResponse(thumbnailBasesPayload))

    await expect(loadAdminRegionThumbnailBases({
      baseUrl: '/thumbnail-bases/valid',
      fetcher,
    })).resolves.toEqual(thumbnailBasesPayload)

    expect(fetcher).toHaveBeenCalledWith('/thumbnail-bases/valid')
  })

  it('deduplicates concurrent and completed requests for the same session URL', async () => {
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetcher = vi.fn(() => response)
    const options = { baseUrl: '/thumbnail-bases/deduplicated', fetcher }

    const first = loadAdminRegionThumbnailBases(options)
    const second = loadAdminRegionThumbnailBases(options)

    expect(fetcher).toHaveBeenCalledTimes(1)
    resolveResponse(createJsonResponse(thumbnailBasesPayload))
    await expect(Promise.all([first, second])).resolves.toEqual([
      thumbnailBasesPayload,
      thumbnailBasesPayload,
    ])
    await expect(loadAdminRegionThumbnailBases(options)).resolves.toEqual(thumbnailBasesPayload)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not retain a failed request and allows a later retry', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(createJsonResponse(thumbnailBasesPayload))
    const options = { baseUrl: '/thumbnail-bases/retry', fetcher }

    await expect(loadAdminRegionThumbnailBases(options)).rejects.toThrow('network unavailable')
    await expect(loadAdminRegionThumbnailBases(options)).resolves.toEqual(thumbnailBasesPayload)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports non-successful responses', async () => {
    const fetcher = vi.fn(async () => createJsonResponse({}, 503))

    await expect(loadAdminRegionThumbnailBases({
      baseUrl: '/thumbnail-bases/unavailable',
      fetcher,
    })).rejects.toThrow('Admin-region thumbnail bases request failed: 503')
  })

  it.each([
    ['missing signature', { ...thumbnailBasesPayload, signature: undefined }],
    ['missing world path', {
      ...thumbnailBasesPayload,
      bases: { ...thumbnailBasesPayload.bases, world: {} },
    }],
    ['empty China path', {
      ...thumbnailBasesPayload,
      bases: { ...thumbnailBasesPayload.bases, china: { path: '' } },
    }],
  ])('rejects malformed payloads with %s', async (description, payload) => {
    const fetcher = vi.fn(async () => createJsonResponse(payload))

    await expect(loadAdminRegionThumbnailBases({
      baseUrl: `/thumbnail-bases/invalid/${description}`,
      fetcher,
    })).rejects.toThrow('Invalid admin-region thumbnail bases response')
  })
})
