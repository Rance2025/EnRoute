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

export function getTreeDescendantIds<T extends { id: string; parentId?: string }>(
  items: T[],
  itemId: string,
): string[] {
  const childIds = items.filter((item) => item.parentId === itemId).map((item) => item.id)
  return childIds.flatMap((childId) => [childId, ...getTreeDescendantIds(items, childId)])
}

export function getTreeDepth<T extends { id: string; parentId?: string }>(
  items: T[],
  itemId: string,
) {
  const byId = new Map(items.map((item) => [item.id, item]))
  let depth = 0
  let current = byId.get(itemId)

  while (current?.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent) break
    depth += 1
    current = parent
  }

  return depth
}

export function getTopLevelTreeId<T extends { id: string; parentId?: string }>(
  items: T[],
  itemId: string,
) {
  const byId = new Map(items.map((item) => [item.id, item]))
  let current = byId.get(itemId)
  if (!current) return undefined

  while (current.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent) break
    current = parent
  }

  return current.id
}
