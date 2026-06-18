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
  themes: [{ id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' }],
  features: ['bg', 'road', 'building'] as Array<'bg' | 'road' | 'building'>,
  showLabel: false,
}

describe('unified shell layout', () => {
  it('renders a shared time panel beside the map workspace', () => {
    render(<App amapConfig={configuredAmap} />)

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '6月18日' })).toBeInTheDocument()
    expect(screen.getByText('位置 3')).toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 地图工作区')).toBeInTheDocument()
  })

  it('keeps the shared time panel when switching to accounting', () => {
    render(<App amapConfig={configuredAmap} />)

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByText('支出 ¥51')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--accounting')
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
  })
})
