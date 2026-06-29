export function shouldRenderAmapBoundaryPreview(search: string) {
  const params = new URLSearchParams(search)
  const value = params.get('amapBoundaryPreview')

  return value === '1' || value === 'true'
}
