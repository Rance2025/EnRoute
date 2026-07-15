export type AccountingSection = 'ledger' | 'accounts' | 'analytics'

export type AccountingShellAction =
  | 'edit-account'
  | 'adjust-opening-balance'
  | 'set-account-brand'
  | 'toggle-account-hidden'
  | 'archive-account'

export type AccountingShellSnapshot = {
  metricItems: Array<{ label: string; value: string }>
  context: {
    eyebrow: string
    title: string
    description: string
    rows: Array<{ label: string; value: string }>
    actions: Array<{ id: AccountingShellAction; label: string; tone?: 'danger' }>
  }
}

export type AccountingStatisticsControls = {
  measure: 'amount' | 'count'
  granularity: 'auto' | 'day' | 'week' | 'month'
  comparePrevious: boolean
  includeTransfers: boolean
  categoryDepth: 'top' | 'second' | 'all'
}

export const defaultAccountingStatisticsControls: AccountingStatisticsControls = {
  measure: 'amount',
  granularity: 'auto',
  comparePrevious: true,
  includeTransfers: false,
  categoryDepth: 'all',
}
