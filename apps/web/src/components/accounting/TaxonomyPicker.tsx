import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { getCategoryPath, getTagPath } from '../../accounting/trees'
import type { Category, Tag, TransactionType } from '../../accounting/types'

type CategoryTreePickerProps = {
  categories: Category[]
  type: TransactionType
  value: string
  recentIds?: string[]
  onChange: (value: string) => void
}

type TagTreePickerProps = {
  tags: Tag[]
  values: string[]
  recentIds?: string[]
  onChange: (values: string[]) => void
}

type PickerNode = {
  id: string
  name: string
  parentId?: string
  sortOrder: number
}

type TaxonomyPickerProps = {
  kind: 'category' | 'tag'
  nodes: PickerNode[]
  selectedIds: string[]
  recentIds: string[]
  multiple: boolean
  getPath: (id: string) => string
  onChange: (ids: string[]) => void
}

export function CategoryTreePicker({
  categories,
  type,
  value,
  recentIds = [],
  onChange,
}: CategoryTreePickerProps) {
  const nodes = useMemo(
    () => categories.filter((category) => category.type === type),
    [categories, type],
  )
  return (
    <TaxonomyPicker
      kind="category"
      nodes={nodes}
      selectedIds={value ? [value] : []}
      recentIds={recentIds}
      multiple={false}
      getPath={(id) => getCategoryPath(nodes as Category[], id)}
      onChange={(ids) => onChange(ids[0] ?? '')}
    />
  )
}

export function TagTreePicker({
  tags,
  values,
  recentIds = [],
  onChange,
}: TagTreePickerProps) {
  return (
    <TaxonomyPicker
      kind="tag"
      nodes={tags}
      selectedIds={values}
      recentIds={recentIds}
      multiple
      getPath={(id) => getTagPath(tags, id)}
      onChange={onChange}
    />
  )
}

function TaxonomyPicker({
  kind,
  nodes,
  selectedIds,
  recentIds,
  multiple,
  getPath,
  onChange,
}: TaxonomyPickerProps) {
  const label = kind === 'category' ? '分类' : '标签'
  const [query, setQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState(
    () => new Set(nodes.filter((node) => nodes.some((candidate) => candidate.parentId === node.id)).map((node) => node.id)),
  )
  const roots = nodes
    .filter((node) => !node.parentId || !nodes.some((candidate) => candidate.id === node.parentId))
    .sort(compareNodes)
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const searchResults = normalizedQuery
    ? nodes.filter((node) => getPath(node.id).toLocaleLowerCase('zh-CN').includes(normalizedQuery))
    : []
  const recentNodes = recentIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is PickerNode => Boolean(node))

  const select = (id: string) => {
    if (!multiple) {
      onChange([id])
      return
    }
    onChange(selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id])
  }

  return (
    <section className="taxonomy-picker" aria-label={`${label}选择器`}>
      <label className="taxonomy-picker__search">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">搜索{label}</span>
        <input
          type="search"
          aria-label={`搜索${label}`}
          value={query}
          placeholder={`搜索${label}或完整路径`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {multiple && selectedIds.length > 0 ? (
        <div className="taxonomy-picker__selected" aria-label={`已选${label}`}>
          {selectedIds.map((id) => (
            <span key={id}>
              {getPath(id)}
              <button type="button" aria-label={`移除${label} ${getPath(id)}`} onClick={() => select(id)}>
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {recentNodes.length > 0 ? (
        <div className="taxonomy-picker__recent" aria-label={`最近使用的${label}`}>
          <span>最近</span>
          {recentNodes.map((node) => (
            <button key={node.id} type="button" onClick={() => select(node.id)}>
              {getPath(node.id)}
            </button>
          ))}
        </div>
      ) : null}

      {normalizedQuery ? (
        <div className="taxonomy-picker__results" aria-label={`${label}搜索结果`}>
          {searchResults.map((node) => (
            <button
              key={node.id}
              type="button"
              aria-label={`选择${label} ${getPath(node.id)}`}
              aria-pressed={selectedIds.includes(node.id)}
              onClick={() => select(node.id)}
            >
              {getPath(node.id)}
            </button>
          ))}
          {searchResults.length === 0 ? <p>没有匹配的{label}</p> : null}
        </div>
      ) : (
        <div className="taxonomy-picker__tree" role="tree" aria-label={`${label}树`}>
          {roots.map((node) => (
            <TreeNodeRow
              key={node.id}
              node={node}
              nodes={nodes}
              label={label}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              getPath={getPath}
              onSelect={select}
              onToggle={(id) => setExpandedIds((current) => {
                const next = new Set(current)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })}
            />
          ))}
        </div>
      )}

      <footer className="taxonomy-picker__footer">
        <button type="button" aria-label={`清除${label}`} onClick={() => onChange([])}>清除</button>
        <span>{label}管理位于记账设置</span>
      </footer>
    </section>
  )
}

function TreeNodeRow({
  node,
  nodes,
  label,
  selectedIds,
  expandedIds,
  getPath,
  onSelect,
  onToggle,
}: {
  node: PickerNode
  nodes: PickerNode[]
  label: string
  selectedIds: string[]
  expandedIds: Set<string>
  getPath: (id: string) => string
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}) {
  const children = nodes.filter((candidate) => candidate.parentId === node.id).sort(compareNodes)
  const expanded = expandedIds.has(node.id)
  return (
    <div role="treeitem" aria-selected={selectedIds.includes(node.id)}>
      <div className="taxonomy-picker__node">
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={node.name}
            aria-expanded={expanded}
            onClick={() => onToggle(node.id)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span aria-hidden="true" />}
        <button
          type="button"
          aria-label={`选择${label} ${getPath(node.id)}`}
          aria-pressed={selectedIds.includes(node.id)}
          onClick={() => onSelect(node.id)}
        >
          {node.name}
        </button>
      </div>
      {children.length > 0 && expanded ? (
        <div role="group">
          {children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              nodes={nodes}
              label={label}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              getPath={getPath}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function compareNodes(a: PickerNode, b: PickerNode) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN')
}
