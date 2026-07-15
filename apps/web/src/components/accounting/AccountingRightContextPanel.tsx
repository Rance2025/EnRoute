import type {
  AccountingShellAction,
  AccountingShellSnapshot,
} from '../../accounting/shell'

export function AccountingRightContextPanel({
  snapshot,
  onAction,
}: {
  snapshot: AccountingShellSnapshot | null
  onAction: (action: AccountingShellAction) => void
}) {
  if (!snapshot) {
    return (
      <div className="accounting-right-context-panel" aria-label="记账右侧上下文">
        <section className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__summary" aria-label="当前分区摘要">
          <span className="right-context-panel__eyebrow">记账工作台</span>
          <strong>正在准备记账上下文</strong>
          <p>范围指标与当前分区状态即将就绪。</p>
        </section>
        <section className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__legend" aria-label="工作区状态">
          <span className="right-context-panel__eyebrow">工作区状态</span>
          <div className="right-context-panel__rows"><div className="right-context-panel__row"><span>状态</span><strong>加载中</strong></div></div>
        </section>
      </div>
    )
  }

  return (
    <div className="accounting-right-context-panel" aria-label="记账右侧上下文">
      <section className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__summary" aria-label="当前分区摘要">
        <span className="right-context-panel__eyebrow">{snapshot.context.eyebrow}</span>
        <strong>{snapshot.context.title}</strong>
        <p>{snapshot.context.description}</p>
      </section>
      <section className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__legend" aria-label="工作区状态">
        <span className="right-context-panel__eyebrow">工作区状态</span>
        <div className="right-context-panel__rows">
          {snapshot.context.rows.map((row) => <div className="right-context-panel__row" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
        </div>
        {snapshot.context.actions.length > 0 ? (
          <div className="right-context-panel__actions">
            {snapshot.context.actions.map((action) => <button key={action.id} type="button" className={action.tone === 'danger' ? 'is-danger' : undefined} onClick={() => onAction(action.id)}>{action.label}</button>)}
          </div>
        ) : null}
      </section>
    </div>
  )
}
