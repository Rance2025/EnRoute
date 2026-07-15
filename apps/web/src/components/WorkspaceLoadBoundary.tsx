import { Component, type ReactNode } from 'react'

type WorkspaceLoadBoundaryProps = {
  children: ReactNode
}

type WorkspaceLoadBoundaryState = {
  failed: boolean
}

export class WorkspaceLoadBoundary extends Component<
  WorkspaceLoadBoundaryProps,
  WorkspaceLoadBoundaryState
> {
  state: WorkspaceLoadBoundaryState = { failed: false }

  static getDerivedStateFromError(): WorkspaceLoadBoundaryState {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="workspace-load-failure glass-panel glass-panel--solid" role="alert">
          <span>工作区暂时不可用</span>
          <strong>记账页面加载失败</strong>
          <p>本地服务可能已更新或重新启动，请重新加载当前页面。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </section>
      )
    }

    return this.props.children
  }
}
