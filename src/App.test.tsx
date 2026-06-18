import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    expect(screen.getByLabelText('地图工具')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(screen.queryByLabelText('回到默认中国视角')).not.toBeInTheDocument()
    expect(screen.queryByText('国内地图底座')).not.toBeInTheDocument()
    expect(screen.queryByText('轨迹层与海量点图层预留')).not.toBeInTheDocument()
  })
})
