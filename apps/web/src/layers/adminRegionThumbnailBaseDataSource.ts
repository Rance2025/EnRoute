export type AdminRegionThumbnailBases = {
  viewBox: string
  signature: string
  bases: {
    world: { path: string }
    china: { path: string }
  }
}

type LoadAdminRegionThumbnailBasesOptions = {
  baseUrl?: string
  fetcher?: typeof fetch
}

const DEFAULT_ADMIN_REGION_THUMBNAIL_BASES_URL = '/api/admin-regions/thumbnail-bases'
const requestsByUrl = new Map<string, Promise<AdminRegionThumbnailBases>>()

export function loadAdminRegionThumbnailBases({
  baseUrl = DEFAULT_ADMIN_REGION_THUMBNAIL_BASES_URL,
  fetcher = fetch,
}: LoadAdminRegionThumbnailBasesOptions = {}): Promise<AdminRegionThumbnailBases> {
  const existingRequest = requestsByUrl.get(baseUrl)
  if (existingRequest) return existingRequest

  const request = fetcher(baseUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Admin-region thumbnail bases request failed: ${response.status}`)
      }

      const payload: unknown = await response.json()
      if (!isAdminRegionThumbnailBases(payload)) {
        throw new Error('Invalid admin-region thumbnail bases response')
      }

      return payload
    })
    .catch((error: unknown) => {
      if (requestsByUrl.get(baseUrl) === request) {
        requestsByUrl.delete(baseUrl)
      }
      throw error
    })

  requestsByUrl.set(baseUrl, request)
  return request
}

function isAdminRegionThumbnailBases(value: unknown): value is AdminRegionThumbnailBases {
  if (!isRecord(value) || !isRecord(value.bases)) return false

  return (
    isNonEmptyString(value.viewBox) &&
    isNonEmptyString(value.signature) &&
    isThumbnailBase(value.bases.world) &&
    isThumbnailBase(value.bases.china)
  )
}

function isThumbnailBase(value: unknown): value is { path: string } {
  return isRecord(value) && isNonEmptyString(value.path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
