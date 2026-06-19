import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import App from '../App'

afterEach(() => {
  cleanup()
})

const configuredAmap = {
  key: 'test-key',
  securityJsCode: 'test-security-code',
  isConfigured: true,
  missingKeys: [],
  defaultCenter: [104.195397, 35.86166] as [number, number],
  defaultZoom: 5.1,
  defaultBounds: {
    southWest: [73.3, 17.8] as [number, number],
    northEast: [135.1, 53.7] as [number, number],
  },
  renderBounds: {
    southWest: [-180, -85.05112878] as [number, number],
    northEast: [180, 85.05112878] as [number, number],
  },
  themes: [
    { id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' },
  ],
  features: ['bg', 'road', 'building'] as Array<'bg' | 'road' | 'building'>,
  showLabel: false,
}

describe('unified shell layout', () => {
  it('renders a shared time panel beside the map workspace', () => {
    render(<App amapConfig={configuredAmap} />)

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '时间模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '日' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('日历选择')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '周历' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('足迹 18')).toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 地图工作区')).toBeInTheDocument()
  })

  it('keeps the shared time panel when switching to accounting', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    const shell = screen.getByRole('main')

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByText('日 · 人民币')).toBeInTheDocument()
    expect(shell).toHaveClass('app-shell--accounting')
    expect(shell).toHaveClass('has-data-panel')
    expect(shell).not.toHaveStyle({ '--data-panel-width': '0px' })
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
  })

  it('switches the shared time panel between top-level range modes', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    for (const range of ['日', '周', '月', '年', '全部', '自定义']) {
      expect(screen.getByRole('button', { name: range })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: '周' }))

    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('heading', { name: '第25周' })).toBeInTheDocument()
    expect(screen.getByLabelText('周聚合选择')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
    expect(screen.getByText('周 · 人民币')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '月' }))

    expect(screen.getByLabelText('月份聚合选择')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '年' }))

    expect(screen.getByLabelText('年份聚合选择')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '全部' }))

    expect(screen.getByLabelText('全部时间摘要')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义' }))

    expect(screen.getByLabelText('自定义时间范围')).toBeInTheDocument()
    expect(screen.queryByLabelText('日历选择')).not.toBeInTheDocument()
  })
})
