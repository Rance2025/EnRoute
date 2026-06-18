import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import App from './App'

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('shows a setup message when AMap credentials are missing', () => {
    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.getByRole('banner', { name: '在途 EnRoute' })).toBeInTheDocument()
    expect(screen.getByText('需要配置高德地图密钥')).toBeInTheDocument()
    expect(screen.getByText(/VITE_AMAP_KEY/)).toBeInTheDocument()
    expect(screen.getByText(/VITE_AMAP_SECURITY_CODE/)).toBeInTheDocument()
  })

  it('does not expose map theme switching in the first version', () => {
    render(
      <App
        amapConfig={{
          key: 'test-key',
          securityJsCode: 'test-security-code',
          isConfigured: true,
          missingKeys: [],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 5.1,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [{ id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' }],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.queryByLabelText(/切换地图主题/)).not.toBeInTheDocument()
  })

  it('uses a text-only brand and a single floating map toolbar', () => {
    render(
      <App
        amapConfig={{
          key: 'test-key',
          securityJsCode: 'test-security-code',
          isConfigured: true,
          missingKeys: [],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 5.1,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [{ id: 'whitesmoke', name: '远山黛', style: 'amap://styles/whitesmoke' }],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.getByRole('banner', { name: '在途 EnRoute' })).toBeInTheDocument()
    expect(screen.queryByText('途')).not.toBeInTheDocument()
    expect(screen.queryByText(/地图已就绪/)).not.toBeInTheDocument()
    expect(screen.queryByText(/远山黛/)).not.toBeInTheDocument()
    const mapToolbar = screen.getByLabelText('地图工具')
    expect(mapToolbar).toBeInTheDocument()
    expect(mapToolbar.querySelectorAll('button')).toHaveLength(4)
    expect(screen.queryByLabelText('回到默认中国视角')).not.toBeInTheDocument()
    expect(screen.queryByText('国内地图底座')).not.toBeInTheDocument()
    expect(screen.queryByText('轨迹层与海量点图层预留')).not.toBeInTheDocument()
  })

  it('switches between the map page and the accounting page inside one app shell', async () => {
    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    expect(screen.getByRole('button', { name: '地图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('需要配置高德地图密钥')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--map')
    expect(document.body).toHaveClass('is-map-view')

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    expect(screen.getByRole('button', { name: '记账' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('heading', { name: '记账' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--accounting')
    expect(document.body).toHaveClass('is-accounting-view')
    expect(document.body).not.toHaveClass('is-map-view')
    expect(screen.getByText('总余额')).toBeInTheDocument()
  })

  it('renders accounting accounts, transactions, category trees, tag trees, and editor fields', async () => {
    render(
      <App
        amapConfig={{
          key: '',
          securityJsCode: '',
          isConfigured: false,
          missingKeys: ['VITE_AMAP_KEY', 'VITE_AMAP_SECURITY_CODE'],
          defaultCenter: [104.195397, 35.86166],
          defaultZoom: 4.2,
          defaultBounds: {
            southWest: [73.3, 17.8],
            northEast: [135.1, 53.7],
          },
          themes: [],
          features: ['bg', 'road', 'building'],
          showLabel: false,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '记账' }))

    expect(screen.getAllByText('微信 - 日常').length).toBeGreaterThan(0)
    expect(screen.getAllByText('花呗').length).toBeGreaterThan(0)
    expect(screen.getByText('秒思 5月实习')).toBeInTheDocument()
    expect(screen.getByText('鲜旺发牛肉火锅')).toBeInTheDocument()
    expect(screen.getByText('支出分类')).toBeInTheDocument()
    expect(screen.getAllByText('餐饮 / 晚餐').length).toBeGreaterThan(0)
    expect(screen.getByText('全局标签')).toBeInTheDocument()
    expect(screen.getAllByText('旅行 / 青岛之行').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('交易类型')).toBeInTheDocument()
    expect(screen.getByLabelText('金额')).toBeInTheDocument()
    expect(screen.getByLabelText('发生时间')).toBeInTheDocument()
    expect(screen.getByLabelText('备注')).toBeInTheDocument()
  })
})
