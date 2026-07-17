export const ADMIN_REGION_THUMBNAIL_FRAME_ASPECT_RATIO = 32 / 15
export const DEFAULT_ADMIN_REGION_THUMBNAIL_VIEW_BOX = '0 15 320 150'

type SvgBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function fitAdminRegionThumbnailViewBox(bounds: SvgBounds) {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]

  if (!values.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    return DEFAULT_ADMIN_REGION_THUMBNAIL_VIEW_BOX
  }

  let { x, y, width, height } = bounds
  const contentAspectRatio = width / height

  if (contentAspectRatio < ADMIN_REGION_THUMBNAIL_FRAME_ASPECT_RATIO) {
    const fittedWidth = height * ADMIN_REGION_THUMBNAIL_FRAME_ASPECT_RATIO
    x -= (fittedWidth - width) / 2
    width = fittedWidth
  } else if (contentAspectRatio > ADMIN_REGION_THUMBNAIL_FRAME_ASPECT_RATIO) {
    const fittedHeight = width / ADMIN_REGION_THUMBNAIL_FRAME_ASPECT_RATIO
    y -= (fittedHeight - height) / 2
    height = fittedHeight
  }

  return [x, y, width, height].map(roundViewBoxValue).join(' ')
}

function roundViewBoxValue(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}
