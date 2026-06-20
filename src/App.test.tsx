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

  it('switches from the map page into the rebuilt iOS accounting workspace', async () => {
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
    expect(screen.getByLabelText('iOS 记账工作台')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '记账' })).not.toBeInTheDocument()
    expect(screen.queryByText('Money ledger')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('app-shell--accounting')
    expect(document.body).toHaveClass('is-accounting-view')
    expect(document.body).not.toHaveClass('is-map-view')
    expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
    expect(screen.getByLabelText('在途 EnRoute 主工作区')).toBeInTheDocument()
    expect(screen.queryByText('Ledger Atlas')).not.toBeInTheDocument()
    expect(screen.queryByText('记账图谱工作台')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前账目范围')).not.toBeInTheDocument()
    expect(screen.getByLabelText('账户与流水工作台')).toBeInTheDocument()
    expect(screen.getByText('新增流水')).toBeInTheDocument()
    expect(screen.getByText('查看统计')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '记账工作区' })).not.toBeInTheDocument()

    const timePanel = screen.getByLabelText('时间范围面板')
    const timeCardSummary = within(timePanel).getByLabelText('记账概览卡片')

    expect(within(timeCardSummary).getByText('净流入')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('+¥4691.23')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('支出')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('¥481.18')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('流水')).toBeInTheDocument()
    expect(within(timeCardSummary).getByText('6 笔')).toBeInTheDocument()
    expect(within(timeCardSummary).queryByText('¥420')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前范围摘要')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('记账概览摘要')).not.toBeInTheDocument()
    expect(screen.queryByText('本期流水')).not.toBeInTheDocument()
  })

  it('renders accounts and ledger together with account filtering and ledger actions', async () => {
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

    const workspace = screen.getByLabelText('账户与流水工作台')
    const accountFilter = within(workspace).getByLabelText('账户筛选卡片')
    const accountStack = accountFilter.querySelector('.ios-account-filter-stack')

    expect(workspace).toBeInTheDocument()
    expect(accountFilter).toBeInTheDocument()
    expect(accountStack).not.toBeNull()

    const allFilter = within(accountFilter).getByRole('button', { name: /全部流水/ })
    expect(allFilter).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(allFilter).toHaveClass('ios-account-all-filter')
    expect(allFilter).not.toHaveClass('ios-account-filter-card')
    expect(within(accountStack as HTMLElement).queryByRole('button', { name: /全部账户|全部流水/ })).not.toBeInTheDocument()
    expect(accountStack?.querySelectorAll('.ios-account-filter-card')).toHaveLength(4)
    expect(within(workspace).getByText('流水明细')).toBeInTheDocument()
    expect(within(workspace).getByLabelText('流水列表')).toBeInTheDocument()
    expect(within(workspace).getByText('新增流水')).toBeInTheDocument()
    expect(within(workspace).getByText('查看统计')).toBeInTheDocument()
    expect(within(workspace).getAllByText('NIBU 酸奶').length).toBeGreaterThan(0)
    expect(within(workspace).getAllByText('鲜嗨发牛肉火锅').length).toBeGreaterThan(0)
    expect(within(workspace).getAllByText('餐饮 / 饮品').length).toBeGreaterThan(0)
    expect(within(workspace).getAllByText('地点旅行 / 青岛之行').length).toBeGreaterThan(0)
    expect(within(workspace).queryByText('分类线索')).not.toBeInTheDocument()
    expect(within(workspace).queryByText('标签线索')).not.toBeInTheDocument()
    expect(within(workspace).queryByText('选中流水')).not.toBeInTheDocument()
    expect(workspace.querySelector('.accounting-scroll--ledger')).not.toBeNull()

    const initialAccountCards = Array.from(
      (accountStack as HTMLElement).querySelectorAll('.ios-account-filter-card'),
    )
    const initialFirstAccountText = initialAccountCards[0]?.textContent
    const huabeiCard = within(accountFilter).getByRole('button', { name: /花呗/ })

    fireEvent.click(huabeiCard)

    const selectedAccountCards = Array.from(
      (accountStack as HTMLElement).querySelectorAll('.ios-account-filter-card'),
    )

    expect(huabeiCard).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(huabeiCard).toHaveClass('is-active')
    expect(huabeiCard).toHaveClass('is-stack-primary')
    expect(huabeiCard).not.toHaveClass('is-pulled')
    expect(selectedAccountCards[0]).toBe(huabeiCard)
    expect(selectedAccountCards[0]).toHaveClass('ios-account-filter-card--rank-0')
    expect(
      selectedAccountCards.some((card) => card.classList.contains('is-pulled')),
    ).toBe(false)
    expect(allFilter).toHaveAttribute('aria-pressed', 'false')
    expect(within(workspace).getByText('筛选后流水')).toBeInTheDocument()
    expect(within(workspace).queryByText('青岛住宿')).not.toBeInTheDocument()

    fireEvent.click(selectedAccountCards[0])

    expect(allFilter).toHaveAttribute('aria-pressed', 'true')
    expect(huabeiCard).toHaveAttribute('aria-pressed', 'false')
    expect(huabeiCard).not.toHaveClass('is-pulled')
    expect(huabeiCard).not.toHaveClass('is-stack-primary')
    expect(
      (accountStack as HTMLElement).querySelector('.ios-account-filter-card')?.textContent,
    ).toBe(initialFirstAccountText)
    expect(within(allFilter).getByText('全部流水')).toBeInTheDocument()
    expect(within(workspace).getAllByText('青岛住宿').length).toBeGreaterThan(0)
  })

  it('opens transaction and new-ledger modals from the accounting workspace', async () => {
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

    const workspace = screen.getByLabelText('账户与流水工作台')

    fireEvent.click(within(workspace).getAllByText('NIBU 酸奶')[0])

    const detailDialog = screen.getByRole('dialog', { name: '流水详情' })

    expect(within(detailDialog).getByText('修改流水')).toBeInTheDocument()
    expect(within(detailDialog).getByText('删除流水')).toBeInTheDocument()
    expect(within(detailDialog).getByText('原始分类')).toBeInTheDocument()
    expect(within(detailDialog).getByText('归入分类')).toBeInTheDocument()

    fireEvent.click(within(detailDialog).getByRole('button', { name: '关闭' }))
    fireEvent.click(within(workspace).getByRole('button', { name: '新增流水' }))

    const newDialog = screen.getByRole('dialog', { name: '新增流水' })

    expect(within(newDialog).getByText('记录新流水')).toBeInTheDocument()
    expect(within(newDialog).getByText('保存流水')).toBeInTheDocument()
  })

  it('renders analytics with charts plus category and tag tree statistics', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '查看统计' }))

    const reportWorkspace = screen.getByLabelText('统计工作区')

    expect(within(reportWorkspace).getByText('统计总览')).toBeInTheDocument()
    expect(within(reportWorkspace).getByLabelText('收支环形图')).toBeInTheDocument()
    expect(within(reportWorkspace).getByText('分类占比')).toBeInTheDocument()
    expect(within(reportWorkspace).getByText('标签关联')).toBeInTheDocument()
    expect(within(reportWorkspace).getByLabelText('分类树统计')).toBeInTheDocument()
    expect(within(reportWorkspace).getByLabelText('标签树统计')).toBeInTheDocument()
    expect(within(reportWorkspace).getAllByText('旅行 / 住宿').length).toBeGreaterThan(0)
    expect(within(reportWorkspace).getAllByText('地点旅行 / 青岛之行').length).toBeGreaterThan(0)
    expect(reportWorkspace.querySelector('.ios-chart-ring')).not.toBeNull()
  })

  it('uses a statistics entrance instead of top-level ledger account report tabs', async () => {
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

    expect(screen.queryByRole('group', { name: '记账工作区' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '流水' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '账户' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '统计' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('账户与流水工作台')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看统计' }))

    expect(screen.getByLabelText('统计工作区')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回流水' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回流水' }))

    expect(screen.getByLabelText('账户与流水工作台')).toBeInTheDocument()
    expect(screen.queryByLabelText('统计工作区')).not.toBeInTheDocument()
  })
})
