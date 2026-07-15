import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Category, Tag } from '../../accounting/types'
import { CategoryTreePicker, TagTreePicker } from './TaxonomyPicker'

afterEach(cleanup)

const categories: Category[] = [
  { id: 'food', type: 'expense', name: '餐饮', sortOrder: 1 },
  { id: 'dinner', type: 'expense', name: '正餐', parentId: 'food', sortOrder: 1 },
  { id: 'salary', type: 'income', name: '工作收入', sortOrder: 1 },
]

const tags: Tag[] = [
  { id: 'personal', name: '个人', sortOrder: 1 },
  { id: 'personal-trip', name: '旅行', parentId: 'personal', sortOrder: 1 },
  { id: 'work', name: '工作', sortOrder: 2 },
  { id: 'work-trip', name: '旅行', parentId: 'work', sortOrder: 1 },
]

describe('taxonomy pickers', () => {
  it('filters category trees by transaction type and selects parent or leaf nodes', () => {
    const onChange = vi.fn()
    render(
      <CategoryTreePicker
        categories={categories}
        type="expense"
        value=""
        recentIds={['dinner']}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('button', { name: '餐饮' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '选择分类 餐饮' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择分类 餐饮 / 正餐' })).toBeInTheDocument()
    expect(screen.queryByText('工作收入')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('最近使用的分类')).getByText('餐饮 / 正餐')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '选择分类 餐饮' }))
    expect(onChange).toHaveBeenLastCalledWith('food')
    fireEvent.click(screen.getByRole('button', { name: '清除分类' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('searches by full category path', () => {
    render(
      <CategoryTreePicker
        categories={categories}
        type="expense"
        value=""
        onChange={() => undefined}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索分类' }), {
      target: { value: '餐饮 / 正餐' },
    })

    expect(screen.getByRole('button', { name: '选择分类 餐饮 / 正餐' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择分类 餐饮' })).not.toBeInTheDocument()
  })

  it('distinguishes same-name tag paths and supports multi-select removal', () => {
    const onChange = vi.fn()
    render(
      <TagTreePicker
        tags={tags}
        values={['personal-trip']}
        recentIds={['work-trip']}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('个人 / 旅行')).toBeInTheDocument()
    expect(within(screen.getByLabelText('最近使用的标签')).getByText('工作 / 旅行')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '选择标签 工作 / 旅行' }))
    expect(onChange).toHaveBeenLastCalledWith(['personal-trip', 'work-trip'])
    fireEvent.click(screen.getByRole('button', { name: '移除标签 个人 / 旅行' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})
