import type { Category, Tag } from './types'

export function getCategoryPath(categories: Category[], categoryId: string) {
  return getTreePath(categories, categoryId)
}

export function getTagPath(tags: Tag[], tagId: string) {
  return getTreePath(tags, tagId)
}

export function getTreePath<T extends { id: string; name: string; parentId?: string }>(
  items: T[],
  itemId: string,
) {
  const byId = new Map(items.map((item) => [item.id, item]))
  const names: string[] = []
  let current = byId.get(itemId)

  while (current) {
    names.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return names.join(' / ')
}
