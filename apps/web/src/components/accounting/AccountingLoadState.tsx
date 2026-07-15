type AccountingLoadStateProps =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string; onRetry: () => void }

export function AccountingLoadState(props: AccountingLoadStateProps) {
  if (props.kind === 'loading') {
    return (
      <section className="accounting-load-state accounting-load-state--loading" aria-live="polite">
        <div className="accounting-load-state__skeleton" aria-hidden="true" />
        <strong>正在载入记账数据</strong>
        <span>正在读取账户、分类和流水</span>
      </section>
    )
  }
  if (props.kind === 'empty') {
    return (
      <section className="accounting-load-state" aria-live="polite">
        <strong>当前数据库还没有记账数据</strong>
        <span>运行 npm run prepare:accounting 导入现有账单</span>
      </section>
    )
  }
  return (
    <section className="accounting-load-state accounting-load-state--error" role="alert">
      <strong>记账数据载入失败</strong>
      <span>{props.message}</span>
      <button type="button" onClick={props.onRetry}>重新载入</button>
    </section>
  )
}
