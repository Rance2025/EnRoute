import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('./components/MapboxCanvas', () => ({
  MapboxCanvas: () => <section aria-label="在途 EnRoute 地图工作区" />,
}))

vi.mock('./components/AccountingPage', () => (
  Promise.reject(new Error('accounting chunk unavailable'))
))

import App from './App'

const missingAmapConfig = {
  key: '',
  securityJsCode: '',
  isConfigured: false,
  missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
  defaultCenter: [104.195397, 35.86166] as [number, number],
  defaultZoom: 4.2,
  defaultBounds: {
    southWest: [73.3, 17.8] as [number, number],
    northEast: [135.1, 53.7] as [number, number],
  },
  themes: [],
  features: ['bg', 'road', 'building'],
  showLabel: false,
} as const

beforeEach(() => {
  vi.setSystemTime(new Date('2026-06-19T10:20:30+08:00'))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('keeps the application shell visible when the accounting chunk fails', async () => {
  render(<App amapConfig={missingAmapConfig} />)

  fireEvent.click(screen.getByRole('button', { name: '记账' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('记账页面加载失败')
  expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
})
