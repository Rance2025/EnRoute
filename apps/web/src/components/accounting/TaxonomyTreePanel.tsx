import { useState, type CSSProperties } from 'react'

import type { TaxonomyInsightNode } from '../../accounting/insightSelectors'
import { formatCnyFromCents } from '../../accounting/money'

type TaxonomyTreePanelProps = {
  taxonomy: 'category' | 'tag'
  nodes: TaxonomyInsightNode[]
  measure: 'amount' | 'count'
  onSelectNode: (node: TaxonomyInsightNode) => void
}

type CategoryView = 'treemap' | 'columns' | 'table'

export function TaxonomyTreePanel({ taxonomy, nodes, measure, onSelectNode }: TaxonomyTreePanelProps) {
  const [categoryView, setCategoryView] = useState<CategoryView>('treemap')
  const activeNodes = nodes.filter((node) => node.aggregate.transactionCount > 0)
  const view = taxonomy === 'tag' ? 'table' : categoryView

  return (
    <section className="taxonomy-tree-panel" aria-label={taxonomy === 'category' ? '分类层级分析' : '标签层级分析'}>
      <header className="accounting-chart-header">
        <div>
          <span>{taxonomy === 'category' ? '分类树' : '标签树'}</span>
          <strong>{taxonomy === 'category' ? '资金流向层级' : '标签金额语境'}</strong>
        </div>
        {taxonomy === 'category' ? (
          <div className="taxonomy-tree-panel__modes" aria-label="分类图表模式">
            <ModeButton label="矩形树图" active={view === 'treemap'} onClick={() => setCategoryView('treemap')} />
            <ModeButton label="层级柱图" active={view === 'columns'} onClick={() => setCategoryView('columns')} />
            <ModeButton label="树表" active={view === 'table'} onClick={() => setCategoryView('table')} />
          </div>
        ) : null}
      </header>
      {taxonomy === 'tag' ? <p className="taxonomy-tree-panel__notice">标签可能重叠，不可横向相加</p> : null}
      {view === 'treemap' ? <Treemap nodes={activeNodes} measure={measure} onSelectNode={onSelectNode} /> : null}
      {view === 'columns' ? <HierarchyColumns nodes={activeNodes} measure={measure} onSelectNode={onSelectNode} /> : null}
      {view === 'table' ? <TreeTable taxonomy={taxonomy} nodes={activeNodes} measure={measure} onSelectNode={onSelectNode} /> : null}
    </section>
  )
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick}>{label}</button>
}

function Treemap({ nodes, measure, onSelectNode }: Omit<TaxonomyTreePanelProps, 'taxonomy'>) {
  const topNodes = nodes.filter((node) => node.depth === 0)
  const total = topNodes.reduce((sum, node) => sum + nodeValue(node, measure), 0)
  return (
    <div className="taxonomy-treemap" role="img" aria-label="分类矩形树图">
      {topNodes.map((node, index) => {
        const share = total === 0 ? 0 : nodeValue(node, measure) / total
        if (share === 0) return null
        return <button key={node.id} type="button" data-tone={index % 5} style={{ '--tree-share': share } as CSSProperties} aria-label={`查看 ${node.path}`} onClick={() => onSelectNode(node)}><strong>{node.name}</strong><span>{formatNodeValue(node.aggregate, measure)}</span><small>{Math.round(share * 100)}%</small></button>
      })}
    </div>
  )
}

function HierarchyColumns({ nodes, measure, onSelectNode }: Omit<TaxonomyTreePanelProps, 'taxonomy'>) {
  const max = Math.max(...nodes.map((node) => nodeValue(node, measure)), 1)
  return (
    <div className="taxonomy-columns" role="img" aria-label="分类层级柱图">
      {nodes.map((node) => <button key={node.id} type="button" style={{ '--column-share': nodeValue(node, measure) / max, '--tree-depth': node.depth } as CSSProperties} aria-label={`查看 ${node.path}`} onClick={() => onSelectNode(node)}><i /><span>{node.path}</span><strong>{formatNodeValue(node.aggregate, measure)}</strong></button>)}
    </div>
  )
}

function TreeTable({ taxonomy, nodes, measure, onSelectNode }: TaxonomyTreePanelProps) {
  return (
    <div className="taxonomy-table-wrap">
      <table className="taxonomy-tree-table" aria-label={`${taxonomy === 'category' ? '分类' : '标签'}树金额表`}>
        <thead><tr><th>节点</th><th>直接金额</th><th>后代聚合</th><th>净额</th><th>收入</th><th>支出</th><th>笔数</th></tr></thead>
        <tbody>{nodes.map((node) => <tr key={node.id}><th><button type="button" style={{ '--tree-depth': node.depth } as CSSProperties} onClick={() => onSelectNode(node)}>{node.path}</button></th><td>{formatNodeValue(node.direct, measure)}</td><td>{formatNodeValue(node.aggregate, measure)}</td><td>{formatSigned(node.aggregate.netInCents, measure, node.aggregate.transactionCount)}</td><td>{formatMoneyOrCount(node.aggregate.incomeInCents, measure, node.aggregate.transactionCount)}</td><td>{formatMoneyOrCount(node.aggregate.expenseInCents, measure, node.aggregate.transactionCount)}</td><td>{node.aggregate.transactionCount}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function nodeValue(node: TaxonomyInsightNode, measure: 'amount' | 'count') {
  return measure === 'amount'
    ? node.aggregate.incomeInCents + node.aggregate.expenseInCents
    : node.aggregate.transactionCount
}

function formatNodeValue(summary: TaxonomyInsightNode['aggregate'], measure: 'amount' | 'count') {
  return measure === 'amount'
    ? `¥${formatCnyFromCents(summary.incomeInCents + summary.expenseInCents)}`
    : `${summary.transactionCount} 笔`
}

function formatSigned(value: number, measure: 'amount' | 'count', count: number) {
  if (measure === 'count') return `${count} 笔`
  return `${value < 0 ? '-' : value > 0 ? '+' : ''}¥${formatCnyFromCents(Math.abs(value))}`
}

function formatMoneyOrCount(value: number, measure: 'amount' | 'count', count: number) {
  return measure === 'amount' ? `¥${formatCnyFromCents(value)}` : `${count} 笔`
}
