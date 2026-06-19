import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveTextContent('EnRoute')
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

    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveTextContent('EnRoute')
    expect(screen.getAllByText('EnRoute')).toHaveLength(1)
    expect(screen.queryByText('途')).not.toBeInTheDocument()
    expect(screen.queryByText(/地图已就绪/)).not.toBeInTheDocument()
    expect(screen.queryByText(/远山黛/)).not.toBeInTheDocument()
    const mapToolbar = screen.getByLabelText('地图工具')
    expect(mapToolbar).toBeInTheDocument()
    expect(mapToolbar.querySelectorAll('button')).toHaveLength(5)
    expect(within(mapToolbar).getByRole('button', { name: '足迹显示设置' })).toBeInTheDocument()
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
    expect(screen.getByLabelText('记账工作区')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '记账' })).not.toBeInTheDocument()
    expect(screen.queryByText('Money ledger')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--accounting')
    expect(document.body).toHaveClass('is-accounting-view')
    expect(document.body).not.toHaveClass('is-map-view')
    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
    expect(screen.getByText('总余额')).toBeInTheDocument()
  })

  it('renders the ledger page as transaction list plus quick record rail', async () => {
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

    const ledgerWorkspace = screen.getByLabelText('交易流水工作区')

    expect(ledgerWorkspace).toBeInTheDocument()
    expect(within(ledgerWorkspace).getByLabelText('快速记录')).toBeInTheDocument()
    expect(within(ledgerWorkspace).queryByLabelText('快速记录与时间规则')).not.toBeInTheDocument()
    expect(within(ledgerWorkspace).queryByLabelText('发生时间规则')).not.toBeInTheDocument()
    expect(within(ledgerWorkspace).queryByLabelText('流水侧栏')).not.toBeInTheDocument()
    expect(within(ledgerWorkspace).getByRole('heading', { name: '快速记录' })).toBeInTheDocument()
    expect(within(ledgerWorkspace).getAllByText('秒思 5月实习').length).toBeGreaterThan(0)
    expect(within(ledgerWorkspace).getAllByText('鲜旺发牛肉火锅').length).toBeGreaterThan(0)
    expect(within(ledgerWorkspace).getAllByText('餐饮 / 晚餐').length).toBeGreaterThan(0)
    expect(within(ledgerWorkspace).queryByLabelText('流水洞察')).not.toBeInTheDocument()
    expect(within(ledgerWorkspace).queryByText('账户影响')).not.toBeInTheDocument()
    expect(within(ledgerWorkspace).getByLabelText('交易类型')).toBeInTheDocument()
    expect(within(ledgerWorkspace).getByLabelText('金额')).toBeInTheDocument()
    expect(within(ledgerWorkspace).getByLabelText('发生时间')).toBeInTheDocument()
    expect(within(ledgerWorkspace).getByLabelText('备注')).toBeInTheDocument()
    expect(screen.queryByText('分类与标签管理')).not.toBeInTheDocument()
  })

  it('renders stacked account cards on the account page', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '账户' }))

    expect(screen.getByLabelText('账户堆叠卡片')).toBeInTheDocument()
    expect(screen.getAllByText('微信 - 日常').length).toBeGreaterThan(0)
    expect(screen.getAllByText('花呗').length).toBeGreaterThan(0)
    expect(screen.getByText('开账余额')).toBeInTheDocument()
    expect(screen.getByText('账户规则')).toBeInTheDocument()
  })

  it('keeps category and tag management on the report page', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '统计' }))

    const reportWorkspace = screen.getByLabelText('统计报告工作区')

    expect(within(reportWorkspace).getByText('统计报告')).toBeInTheDocument()
    expect(within(reportWorkspace).queryByText('分类与标签管理')).not.toBeInTheDocument()

    const categoryPanel = within(reportWorkspace).getByLabelText('分类管理')
    const tagPanel = within(reportWorkspace).getByLabelText('标签管理')

    expect(within(categoryPanel).getByRole('button', { name: '新建分类' })).toBeInTheDocument()
    expect(within(categoryPanel).getByText('收入分类')).toBeInTheDocument()
    expect(within(categoryPanel).getByText('支出分类')).toBeInTheDocument()
    expect(within(categoryPanel).getByText('转账分类')).toBeInTheDocument()
    expect(within(categoryPanel).getByText('分类树规则')).toBeInTheDocument()
    expect(within(tagPanel).getByRole('button', { name: '编辑标签' })).toBeInTheDocument()
    expect(within(tagPanel).getByText('全局标签')).toBeInTheDocument()
    expect(within(tagPanel).getAllByText('旅行 / 青岛之行').length).toBeGreaterThan(0)
  })

  it('switches the whole accounting workspace between account, ledger, and report modes', async () => {
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

    expect(screen.getByRole('button', { name: '流水' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('交易流水工作区')).toBeInTheDocument()
    expect(screen.queryByLabelText('账户管理工作区')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '账户' }))

    expect(screen.getByRole('button', { name: '账户' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('账户管理工作区')).toBeInTheDocument()
    expect(screen.queryByLabelText('交易流水工作区')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '统计' }))

    expect(screen.getByRole('button', { name: '统计' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('统计报告工作区')).toBeInTheDocument()
    expect(screen.queryByLabelText('账户管理工作区')).not.toBeInTheDocument()
  })
})
