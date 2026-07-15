# Accounting Workspaces Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将记账模块重构为共享时间范围的“流水 / 账户 / 统计”三页工作台，在保持三栏同构玻璃壳层的同时，补齐正确的净资产口径、分类与标签树、会话内流水编辑、账户轮替和高信息密度图表。

**Architecture:** `AccountingPage` 持有本次会话的账户、流水和页面内交互状态；`App` 持有本来就位于外层壳中的时间范围与统计口径控件状态；`apps/web/src/accounting/` 提供不依赖 React 的金额、余额、分类、标签与趋势选择器；三个工作区只接收已经计算好的视图模型。懒加载的 `AccountingPage` 通过纯数据 `AccountingShellSnapshot` 向 `App` 汇报左栏指标与右栏上下文，`App` 再通过命令对象把右栏账户管理动作传回页面，避免破坏现有懒加载边界或让壳层直接读取记账数据集。

**Tech Stack:** React 19、TypeScript 6、Vite 8、Vitest、Testing Library、Framer Motion、Lucide React、CSS/SVG

---

## 实施约束

- 全部工作在 `feat/accounting-workspaces-redesign` 分支与 `.worktrees/accounting-workspaces-redesign` worktree 内完成。
- 不新增后端表、API 或持久化写入；新增和编辑仅修改 `AccountingPage` 的会话状态，刷新后恢复代表性数据集。
- 不引入图表库。小型图表使用语义化 HTML、CSS 和可访问 SVG，避免为本轮增加新的打包体积与主题适配面。
- 左侧 `TimeContextPanel` 的位置、宽度、外边距、内边距、背景和溢出继续由共享壳层控制；子页面只提供不同的指标和统计控件数据。
- 支出、负债和负净额不使用红色；红色只用于归档确认等危险操作。
- 每个任务遵循红灯测试 → 最小实现 → 定向测试 → 提交。不得一次累积全部改动后再测试。

## 统一类型约定

以下公共类型在任务 1 和任务 5 中建立，后续任务不得另造同义结构：

```ts
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
```

```ts
export type AccountNature = 'asset' | 'liability'

export type Account = {
  id: string
  name: string
  nature: AccountNature
  currency: 'CNY'
  openingBalanceInCents: number
  openingBalanceAt: string
  brand?: { slug: string; label: string; color: string }
  hidden?: boolean
  archived?: boolean
  sourceLabel?: string
  createdAt: string
  updatedAt: string
}
```

所有余额都采用带符号的净头寸：资产通常为正，负债欠款为负。界面可把负债欠款显示为绝对值，但选择器和图表输入不得丢失符号。

## Task 1：扩展记账领域模型与代表性数据

**Files:**

- Modify: `apps/web/src/accounting/types.ts`
- Modify: `apps/web/src/accounting/ledgerAtlasData.ts`
- Modify: `apps/web/src/accounting/accounting.test.ts`

- [ ] **Step 1: 写出账户性质、币种与树兼容性的失败测试**

在 `accounting.test.ts` 增加断言，确保代表性数据同时包含资产和负债账户、全部账户币种为 CNY、每笔分类与流水类型兼容、标签仍允许多选。

```ts
it('contains both asset and liability accounts with explicit CNY currency', () => {
  expect(new Set(ledgerAtlasDataset.accounts.map((account) => account.nature)))
    .toEqual(new Set(['asset', 'liability']))
  expect(ledgerAtlasDataset.accounts.every((account) => account.currency === 'CNY')).toBe(true)
})
```

- [ ] **Step 2: 运行领域测试并确认红灯**

Run: `npm test -- --run apps/web/src/accounting/accounting.test.ts`

Expected: TypeScript 或断言因 `nature`、`currency`、品牌/状态字段尚不存在而失败。

- [ ] **Step 3: 扩展类型并升级数据夹具**

在 `types.ts` 添加 `AccountNature`、账户品牌、隐藏/归档/来源字段；保持流水金额仍为正整数分，方向继续由流水类型决定。升级 `ledgerAtlasDataset`：

- 至少 4 个资产账户与 1 个负债账户；
- 负债账户开户余额为负数；
- 分类覆盖足以验证收入和支出 Top 5 + 其他；
- 标签包含至少两层、同名不同路径和一笔多标签流水；
- 流水跨越当前展示期之前与之内，供任意范围余额测试使用。

- [ ] **Step 4: 运行定向测试**

Run: `npm test -- --run apps/web/src/accounting/accounting.test.ts apps/web/src/accounting/importedMoney.test.ts`

Expected: PASS，且现有导入金额契约未被破坏。

- [ ] **Step 5: 提交领域模型变更**

```powershell
git add apps/web/src/accounting/types.ts apps/web/src/accounting/ledgerAtlasData.ts apps/web/src/accounting/accounting.test.ts
git commit -m "feat: 补齐记账账户性质与分析样本"
```

## Task 2：修正任意时间范围余额与净资产口径

**Files:**

- Modify: `apps/web/src/accounting/balances.ts`
- Modify: `apps/web/src/accounting/selectors.ts`
- Modify: `apps/web/src/accounting/selectors.test.ts`

- [ ] **Step 1: 为历史范围和转账抵消写失败测试**

测试以下事实：

- 期初余额包含范围开始前、开户日后的全部变动；
- 期末余额等于期初加范围内变动；
- 单账户转入/转出改变该账户余额；
- 全部账户净变动中内部转账抵消；
- 资产、负债与净资产关系为 `assets - liabilities`；
- 开户日前流水不参与余额。

```ts
expect(summary.closingInCents)
  .toBe(summary.openingInCents + summary.netChangeInCents)
expect(portfolio.closingNetWorthInCents)
  .toBe(portfolio.closingAssetsInCents - portfolio.closingLiabilitiesInCents)
expect(portfolio.netChangeInCents)
  .toBe(portfolio.incomeInCents - portfolio.expenseInCents)
```

- [ ] **Step 2: 运行选择器测试并确认旧算法失败**

Run: `npm test -- --run apps/web/src/accounting/selectors.test.ts`

Expected: 旧 `getAccountPeriodSummaries` 因把固定开户余额直接叠加范围内流水而失败。

- [ ] **Step 3: 实现唯一的账户变动与组合净资产选择器**

在 `balances.ts` 提供：

```ts
export function getSignedAccountMovement(
  transaction: Transaction,
  accountId: string,
): number

export function getAccountBalanceAt(
  dataset: AccountingDataset,
  accountId: string,
  exclusiveEnd: string,
): number
```

在 `selectors.ts` 重写：

```ts
export function getAccountPeriodSummaries(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
): AccountPeriodSummary[]

export function getPortfolioPeriodSummary(
  dataset: AccountingDataset,
  range: TimeRangeSelection,
): PortfolioPeriodSummary
```

所有交易方向只通过 `getSignedAccountMovement` 计算，避免组件和不同选择器各自解释转账。

- [ ] **Step 4: 运行余额相关测试**

Run: `npm test -- --run apps/web/src/accounting/selectors.test.ts apps/web/src/accounting/accounting.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交余额口径修复**

```powershell
git add apps/web/src/accounting/balances.ts apps/web/src/accounting/selectors.ts apps/web/src/accounting/selectors.test.ts
git commit -m "fix: 修正任意时间范围账户余额口径"
```

## Task 3：建立分类、标签、余额阶梯与时间趋势选择器

**Files:**

- Create: `apps/web/src/accounting/insightSelectors.ts`
- Create: `apps/web/src/accounting/insightSelectors.test.ts`
- Modify: `apps/web/src/accounting/trees.ts`
- Modify: `apps/web/src/accounting/types.ts`

- [ ] **Step 1: 为全部分析口径写表驱动失败测试**

覆盖：

- 收入/支出分别按顶层分类取金额前 5，剩余合并“其他”，最大 6 段；
- 分类不足 5 个时不制造空段或“其他”；
- 分类树同时返回直接金额和后代聚合金额；
- 直接标签按 `income + expense` 排序取前 5，并返回净额、收入、支出；
- 多标签流水可以出现在多个标签节点，函数不提供可横向相加的总计；
- 标签树同时返回直接和后代聚合；
- 账户余额轨迹为阶梯节点，首点是期初、末点是期末；
- 趋势可按日/周/月分桶，收入、支出、净额使用同一范围；
- 跨账户贡献返回各账户收入、支出和净额。

```ts
expect(categorySummary.expense.segments).toHaveLength(6)
expect(categorySummary.expense.segments.at(-1)?.label).toBe('其他')
expect(tagSummary[0]).toMatchObject({ incomeInCents: expect.any(Number), expenseInCents: expect.any(Number) })
expect(balanceSteps.at(-1)?.balanceInCents).toBe(accountSummary.closingInCents)
```

- [ ] **Step 2: 运行新测试并确认模块不存在**

Run: `npm test -- --run apps/web/src/accounting/insightSelectors.test.ts`

Expected: FAIL，`insightSelectors.ts` 尚不存在。

- [ ] **Step 3: 实现纯分析选择器**

导出并统一使用以下函数：

```ts
getTopCategoryComposition(dataset, transactions)
getCategoryTreeStatistics(dataset, transactions)
getTopDirectTagAmounts(dataset, transactions, limit)
getTagTreeStatistics(dataset, transactions)
getAccountBalanceSteps(dataset, range, accountId)
getCashflowTrend(dataset, range, granularity, includeTransfers)
getAccountContributions(dataset, range)
getPreviousPeriodRange(range)
getTaxonomyNodeContext(dataset, range, taxonomy, nodeId)
```

树统计节点统一返回 `path`、`depth`、`direct`、`aggregate`；金额统计统一含 `incomeInCents`、`expenseInCents`、`netInCents`、`transactionCount`。不要在 React 组件内重新聚合。

- [ ] **Step 4: 运行分析与既有选择器测试**

Run: `npm test -- --run apps/web/src/accounting/insightSelectors.test.ts apps/web/src/accounting/selectors.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交分析选择器**

```powershell
git add apps/web/src/accounting/insightSelectors.ts apps/web/src/accounting/insightSelectors.test.ts apps/web/src/accounting/trees.ts apps/web/src/accounting/types.ts
git commit -m "feat: 建立记账分类标签与趋势选择器"
```

## Task 4：建立流水草稿、校验与会话更新函数

**Files:**

- Create: `apps/web/src/accounting/transactionDraft.ts`
- Create: `apps/web/src/accounting/transactionDraft.test.ts`
- Modify: `apps/web/src/accounting/balances.ts`

- [ ] **Step 1: 写创建、编辑和字段级校验失败测试**

覆盖金额大于零、收入/支出必选账户、转账账户必须不同、分类必须匹配类型、类型变化时清空不兼容分类、编辑保留 `id` 与 `createdAt`、保存更新 `updatedAt`。

```ts
expect(validateTransactionDraft(invalidTransfer, dataset)).toMatchObject({
  fromAccountId: '请选择转出账户',
  toAccountId: '转入账户不能与转出账户相同',
})
```

- [ ] **Step 2: 运行草稿测试并确认红灯**

Run: `npm test -- --run apps/web/src/accounting/transactionDraft.test.ts`

Expected: FAIL，草稿模块尚不存在。

- [ ] **Step 3: 实现可测试的会话数据操作**

提供：

```ts
createTransactionDraft(now: string): TransactionDraft
createTransactionDraftFromTransaction(transaction): TransactionDraft
changeDraftType(draft, nextType, dataset): TransactionDraft
validateTransactionDraft(draft, dataset): TransactionDraftErrors
saveTransactionDraft(transactions, draft, now): Transaction[]
```

保存函数不得写 localStorage、SQLite 或网络；仅返回新数组。

- [ ] **Step 4: 运行领域测试**

Run: `npm test -- --run apps/web/src/accounting/transactionDraft.test.ts apps/web/src/accounting/accounting.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交流水草稿模块**

```powershell
git add apps/web/src/accounting/transactionDraft.ts apps/web/src/accounting/transactionDraft.test.ts apps/web/src/accounting/balances.ts
git commit -m "feat: 支持会话内流水创建与编辑校验"
```

## Task 5：接通三页导航与壳层快照协议

**Files:**

- Create: `apps/web/src/accounting/shell.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/AccountingPage.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: 把旧导航契约改成三页失败测试**

断言记账二级导航依次显示 `流水 / 账户 / 统计`，点击账户向 `AccountingPage` 传入 `section="accounts"`，流水为 `ledger`，统计为 `analytics`。删除“账户不出现在导航”的旧断言。

- [ ] **Step 2: 为壳层快照和命令回传写失败测试**

测试 `AccountingPage` 的 `onShellSnapshotChange` 能让左栏指标与右栏内容随页面切换；点击账户页右栏“编辑资料”会把 `edit-account` 命令传回 `AccountingPage`，处理后命令被清空。

- [ ] **Step 3: 运行壳层测试并确认红灯**

Run: `npm test -- --run apps/web/src/App.test.tsx apps/web/src/components/mapShellLayout.test.tsx`

Expected: FAIL，账户导航与快照协议尚不存在。

- [ ] **Step 4: 实现纯数据壳层协议**

在 `shell.ts` 定义本计划“统一类型约定”中的类型。`App` 维护：

```ts
const [accountingShellSnapshot, setAccountingShellSnapshot] = useState<AccountingShellSnapshot | null>(null)
const [accountingShellCommand, setAccountingShellCommand] = useState<AccountingShellAction | null>(null)
```

`AccountingPage` 新 props：

```ts
type AccountingPageProps = {
  section: AccountingSection
  timeRange: TimeRangeSelection
  statisticsControls: AccountingStatisticsControls
  shellCommand: AccountingShellAction | null
  onShellCommandHandled: () => void
  onShellSnapshotChange: (snapshot: AccountingShellSnapshot) => void
}
```

快照只携带可序列化展示数据，不携带按钮回调。右栏按钮由 `App` 生成命令，页面消费命令后调用 `onShellCommandHandled`。保持 `AccountingPage` 懒加载。

- [ ] **Step 5: 运行壳层测试**

Run: `npm test -- --run apps/web/src/App.test.tsx apps/web/src/components/mapShellLayout.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交导航和协议**

```powershell
git add apps/web/src/accounting/shell.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/AccountingPage.tsx apps/web/src/components/mapShellLayout.test.tsx
git commit -m "feat: 接通记账三页导航与壳层上下文"
```

## Task 6：实现共享分类与标签树选择器

**Files:**

- Create: `apps/web/src/components/accounting/TaxonomyPicker.tsx`
- Create: `apps/web/src/components/accounting/TaxonomyPicker.test.tsx`
- Create: `apps/web/src/components/accounting/AccountingMetric.tsx`
- Modify: `apps/web/src/components/accounting/formatting.ts`

- [ ] **Step 1: 写树选择器行为失败测试**

分类模式断言：按流水类型过滤、父叶节点都可单选、搜索展示完整路径、最近使用可选、清除有效。标签模式断言：父叶节点都可多选、同名节点以完整路径区分、已选项可移除。两种模式都要有键盘可达按钮与 `aria-expanded`。

- [ ] **Step 2: 运行组件测试并确认红灯**

Run: `npm test -- --run apps/web/src/components/accounting/TaxonomyPicker.test.tsx`

Expected: FAIL，组件尚不存在。

- [ ] **Step 3: 实现共享树壳与两个显式导出**

```ts
export function CategoryTreePicker(props: CategoryTreePickerProps)
export function TagTreePicker(props: TagTreePickerProps)
```

内部复用 `TaxonomyPicker`，但对外 props 明确区分单选 `value/onChange` 与多选 `values/onChange`，不使用难以收窄的布尔泛型。完整树管理不在本轮实现，只显示“管理分类/标签”预留入口且不伪造行为。

- [ ] **Step 4: 实现统一指标排版**

`AccountingMetric` 只负责 label/value/supporting text/tone，tone 限制为 `positive | negative | neutral`，其中 negative 映射冷灰蓝而非红色。

- [ ] **Step 5: 运行组件测试**

Run: `npm test -- --run apps/web/src/components/accounting/TaxonomyPicker.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交树选择器**

```powershell
git add apps/web/src/components/accounting/TaxonomyPicker.tsx apps/web/src/components/accounting/TaxonomyPicker.test.tsx apps/web/src/components/accounting/AccountingMetric.tsx apps/web/src/components/accounting/formatting.ts
git commit -m "feat: 实现分类单选与标签多选树"
```

## Task 7：实现流水详情、创建与编辑弹窗

**Files:**

- Create: `apps/web/src/components/accounting/TransactionDialog.tsx`
- Create: `apps/web/src/components/accounting/TransactionDialog.test.tsx`
- Create: `apps/web/src/components/accounting/TransactionRow.tsx`
- Modify: `apps/web/src/components/AccountingPage.tsx`
- Modify: `apps/web/src/components/accounting/LedgerWorkspace.tsx`

- [ ] **Step 1: 写详情与表单失败测试**

覆盖：点击流水行打开详情、详情显示完整分类/标签路径、点击编辑进入同一表单、创建含全部字段、切换类型清空不兼容分类、转账显示双账户、字段错误保留输入、保存后列表和指标立即更新、Esc 关闭并将焦点还给触发按钮。

- [ ] **Step 2: 运行弹窗测试并确认红灯**

Run: `npm test -- --run apps/web/src/components/accounting/TransactionDialog.test.tsx`

Expected: FAIL，完整弹窗组件尚不存在。

- [ ] **Step 3: 实现共享 TransactionDialog**

使用判别联合：

```ts
type TransactionDialogMode =
  | { kind: 'detail'; transactionId: string }
  | { kind: 'create' }
  | { kind: 'edit'; transactionId: string }
```

表单调用 Task 4 的纯草稿函数，不在组件中复制校验。顶部显示“本地原型 · 本次会话有效”。弹窗提供 `role="dialog"`、`aria-modal`、标题关联、焦点圈定、Esc 与焦点恢复。

- [ ] **Step 4: 实现共享 TransactionRow**

行内展示固定 Lucide 类型图标、名称、账户方向、分类路径、最多两个标签、金额和时间；溢出文本截断但 `title`/详情可读取完整内容。支出金额采用冷灰蓝，转账采用中性青灰。

- [ ] **Step 5: 在 AccountingPage 中接管会话流水状态**

```ts
const [dataset, setDataset] = useState(() => cloneAccountingDataset(ledgerAtlasDataset))
const [dialogMode, setDialogMode] = useState<TransactionDialogMode | null>(null)
```

创建/编辑只更新 `dataset.transactions`，所有工作区接收同一数据集。

- [ ] **Step 6: 运行弹窗与页面测试**

Run: `npm test -- --run apps/web/src/components/accounting/TransactionDialog.test.tsx apps/web/src/App.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交流水操作闭环**

```powershell
git add apps/web/src/components/accounting/TransactionDialog.tsx apps/web/src/components/accounting/TransactionDialog.test.tsx apps/web/src/components/accounting/TransactionRow.tsx apps/web/src/components/AccountingPage.tsx apps/web/src/components/accounting/LedgerWorkspace.tsx
git commit -m "feat: 完成流水详情创建与编辑闭环"
```

## Task 8：实现流水页净资产与关键洞察图表

**Files:**

- Create: `apps/web/src/components/accounting/NetWorthPanel.tsx`
- Create: `apps/web/src/components/accounting/NetWorthPanel.test.tsx`
- Create: `apps/web/src/components/accounting/CategoryStackedColumns.tsx`
- Create: `apps/web/src/components/accounting/CategoryStackedColumns.test.tsx`
- Create: `apps/web/src/components/accounting/TagAmountTable.tsx`
- Modify: `apps/web/src/components/accounting/LedgerWorkspace.tsx`

- [ ] **Step 1: 写净资产视觉语义失败测试**

断言大数字是期末净资产，资产/负债采用对向刻度，桥接四项依次为期初、收入、支出、期末，内部转账不进入桥接净变动，负净资产保留负号且 DOM 不出现红色 tone 类。

- [ ] **Step 2: 写分类与标签图失败测试**

断言两根堆叠柱共享金额刻度、默认金额模式、可切换 100% 构成、每类最大 6 段、图例含金额和比例；标签表显示前 5 完整路径及净额/收入/支出，不显示标签占比，也不显示可求和总计。

- [ ] **Step 3: 运行图表测试并确认红灯**

Run: `npm test -- --run apps/web/src/components/accounting/NetWorthPanel.test.tsx apps/web/src/components/accounting/CategoryStackedColumns.test.tsx`

Expected: FAIL，新组件尚不存在。

- [ ] **Step 4: 实现可访问的小型图表**

`NetWorthPanel`、`CategoryStackedColumns` 使用 CSS 布局和少量 SVG。每张图提供屏幕可读摘要或隐藏数据表；不使用双纵轴、伪造最小柱高或红色。分类色板固定为远山黛深浅绿和冷灰蓝，不按收入/支出改变同一分类的颜色身份。

- [ ] **Step 5: 重构 LedgerWorkspace 为窄流水、宽洞察**

中栏内部采用约 `41% / 59%`：左侧为按日期分组的紧凑流水与固定新增按钮；右侧上方净资产组合图，下方分类堆叠柱和标签金额表。无流水时保留新增入口并显示真实空状态。

- [ ] **Step 6: 运行流水页测试**

Run: `npm test -- --run apps/web/src/components/accounting/NetWorthPanel.test.tsx apps/web/src/components/accounting/CategoryStackedColumns.test.tsx apps/web/src/components/accounting/TransactionDialog.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交流水页洞察**

```powershell
git add apps/web/src/components/accounting/NetWorthPanel.tsx apps/web/src/components/accounting/NetWorthPanel.test.tsx apps/web/src/components/accounting/CategoryStackedColumns.tsx apps/web/src/components/accounting/CategoryStackedColumns.test.tsx apps/web/src/components/accounting/TagAmountTable.tsx apps/web/src/components/accounting/LedgerWorkspace.tsx
git commit -m "feat: 重构流水页净资产与关键洞察"
```

## Task 9：提取并完善账户卡片轮替交互

**Files:**

- Create: `apps/web/src/components/accounting/AccountCardCarousel.tsx`
- Create: `apps/web/src/components/accounting/AccountCardCarousel.test.tsx`
- Modify: `apps/web/src/components/accounting/LedgerWorkspace.tsx`

- [ ] **Step 1: 为离散轮替写失败测试**

覆盖仅渲染三张可见卡、滚轮一次只前进一张、阈值内小滚动不切换、动画/节流窗口内不连跳、点击后卡选中、左右方向键等价、循环轮替、单账户时禁用、显示 `当前 / 总数`。

- [ ] **Step 2: 运行轮替测试并确认红灯**

Run: `npm test -- --run apps/web/src/components/accounting/AccountCardCarousel.test.tsx`

Expected: FAIL，独立组件尚不存在。

- [ ] **Step 3: 从旧 AccountsWorkspace 提取并校正状态机**

组件只接收账户视图模型和受控 `selectedAccountId`。滚轮累积绝对 delta 超过阈值后触发一次选择，并在 Framer Motion `onAnimationComplete` 后解锁；容器调用 `preventDefault`，不能带动 body。动画只使用平移、缩放、层级和轻透明度。

- [ ] **Step 4: 运行轮替测试**

Run: `npm test -- --run apps/web/src/components/accounting/AccountCardCarousel.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交账户轮替组件**

```powershell
git add apps/web/src/components/accounting/AccountCardCarousel.tsx apps/web/src/components/accounting/AccountCardCarousel.test.tsx apps/web/src/components/accounting/LedgerWorkspace.tsx
git commit -m "feat: 完善账户卡片离散轮替交互"
```

## Task 10：完成账户页及账户管理入口

**Files:**

- Create: `apps/web/src/components/accounting/AccountsWorkspace.tsx`
- Create: `apps/web/src/components/accounting/AccountsWorkspace.test.tsx`
- Create: `apps/web/src/components/accounting/AccountBalanceStepChart.tsx`
- Create: `apps/web/src/components/accounting/AccountManagementDialog.tsx`
- Modify: `apps/web/src/components/AccountingPage.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: 写账户页联动失败测试**

前景卡切换后，账户流水、期初/期末/净变动、收入/支出/转入/转出、阶梯图、分类图、标签表、左栏指标与右栏资料必须同步更新。余额图首末点必须等于账户摘要。

- [ ] **Step 2: 写右栏管理命令失败测试**

测试编辑资料、调整期初余额、设置品牌、隐藏账户会更新会话数据；归档需要确认；普通管理区没有删除入口。处理每个命令后调用 `onShellCommandHandled`。

- [ ] **Step 3: 运行账户页测试并确认红灯**

Run: `npm test -- --run apps/web/src/components/accounting/AccountsWorkspace.test.tsx apps/web/src/App.test.tsx`

Expected: FAIL，完整账户页尚不存在。

- [ ] **Step 4: 实现账户页左右内栏**

左内栏上方使用 `AccountCardCarousel`，下方使用共享 `TransactionRow` 显示选中账户流水。右内栏依次放指标带、`AccountBalanceStepChart`、`CategoryStackedColumns`、`TagAmountTable`。阶梯图用水平段和垂直跃迁，不使用平滑曲线。

- [ ] **Step 5: 实现账户管理弹窗和快照**

`AccountingPage` 维护选中账户 ID，并为账户页发布：

- 左栏：账户名、期初、期末、净变动；
- 右栏：品牌、性质、币种、开户日期、来源、隐藏/归档状态；
- 动作：编辑、期初余额、品牌、隐藏、归档。

归档按钮是唯一危险 tone；隐藏只是可逆状态。若仅一个可用账户，轮替禁用。若没有账户，显示先创建账户的真实空状态，但本轮不实现完整新增账户流程。

- [ ] **Step 6: 运行账户页测试**

Run: `npm test -- --run apps/web/src/components/accounting/AccountsWorkspace.test.tsx apps/web/src/components/accounting/AccountCardCarousel.test.tsx apps/web/src/App.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交账户页**

```powershell
git add apps/web/src/components/accounting/AccountsWorkspace.tsx apps/web/src/components/accounting/AccountsWorkspace.test.tsx apps/web/src/components/accounting/AccountBalanceStepChart.tsx apps/web/src/components/accounting/AccountManagementDialog.tsx apps/web/src/components/AccountingPage.tsx apps/web/src/App.test.tsx
git commit -m "feat: 完成账户轮替分析与管理工作页"
```

## Task 11：重构统计页为单屏联动分析画布

**Files:**

- Create: `apps/web/src/components/accounting/CashflowTrendChart.tsx`
- Create: `apps/web/src/components/accounting/CashflowTrendChart.test.tsx`
- Create: `apps/web/src/components/accounting/TaxonomyTreePanel.tsx`
- Create: `apps/web/src/components/accounting/TaxonomyTreePanel.test.tsx`
- Modify: `apps/web/src/components/accounting/AnalyticsWorkspace.tsx`
- Create: `apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx`
- Modify: `apps/web/src/components/AccountingPage.tsx`

- [ ] **Step 1: 写统计口径控制失败测试**

断言页面内没有第三级导航，左栏控制支持金额/笔数、自动/日/周/月、上周期、计入转账、分类层级；改变控制后主趋势和树统计使用同一筛选口径。

- [ ] **Step 2: 写主趋势和分类层级失败测试**

主趋势同轴显示收入/支出簇形柱、净额折线和可选上周期虚线。分类默认矩形树图，可在卡片内切换层级柱图/树表；节点选择发布完整路径、直接/聚合金额、笔数、上周期变化与主要账户/标签。

- [ ] **Step 3: 写标签树和右栏焦点失败测试**

标签默认完整树金额表，显示直接与后代聚合、净额、收入、支出、笔数，并明确提示标签重叠不可横向相加。页面不默认渲染“标签 × 分类”热力图。未选节点时右栏显示账户贡献与图例；选中节点后显示焦点详情并可清除。

- [ ] **Step 4: 运行统计测试并确认红灯**

Run: `npm test -- --run apps/web/src/components/accounting/CashflowTrendChart.test.tsx apps/web/src/components/accounting/TaxonomyTreePanel.test.tsx apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx`

Expected: FAIL，新统计组件尚不存在。

- [ ] **Step 5: 实现趋势图与上周期对齐**

主图使用 SVG，柱和折线共享同一金额或笔数刻度。上周期按等长前置范围计算并以中性虚线绘制；无可比数据时显示“无可比数据”。自动粒度根据范围天数选择日/周/月，但 UI 同步显示最终粒度。

- [ ] **Step 6: 实现复用 TaxonomyTreePanel**

分类与标签使用同一树面板壳，但分类提供 `treemap | columns | table`，标签默认只提供 `table`。矩形树图面积按聚合金额，文本与隐藏表提供完整语义；零值节点不伪造面积。

- [ ] **Step 7: 组装单屏统计工作台与壳层快照**

统计页中心上方为主趋势，下方为分类和标签两块；局部卡片独立滚动。右栏快照根据焦点在“账户贡献/图例/口径”和“选中节点详情”之间切换。左栏统计控件由 `TimeContextPanel` 渲染，状态由同属壳层的 `App` 持有；`App` 将同一个 `AccountingStatisticsControls` 传给 `TimeContextPanel` 和 `AccountingPage`，保证展示控件与选择器输入一致。

- [ ] **Step 8: 运行统计页测试**

Run: `npm test -- --run apps/web/src/components/accounting/CashflowTrendChart.test.tsx apps/web/src/components/accounting/TaxonomyTreePanel.test.tsx apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx`

Expected: PASS。

- [ ] **Step 9: 提交统计页**

```powershell
git add apps/web/src/components/accounting/CashflowTrendChart.tsx apps/web/src/components/accounting/CashflowTrendChart.test.tsx apps/web/src/components/accounting/TaxonomyTreePanel.tsx apps/web/src/components/accounting/TaxonomyTreePanel.test.tsx apps/web/src/components/accounting/AnalyticsWorkspace.tsx apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx apps/web/src/components/AccountingPage.tsx
git commit -m "feat: 重构记账统计联动分析画布"
```

## Task 12：统一左栏指标、统计控件与右栏上下文

**Files:**

- Modify: `apps/web/src/components/TimeContextPanel.tsx`
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx`
- Create: `apps/web/src/components/accounting/AccountingRightContextPanel.tsx`
- Create: `apps/web/src/components/accounting/AccountingRightContextPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: 写三页左栏内容与几何同构测试**

流水页显示收入/支出/笔数；账户页显示选中账户期初/期末/净变动；统计页显示收入/支出/净额并在时间选择器下显示统计口径。测试只允许内容变化，不允许 `.app-shell--accounting` 子页覆盖左栏位置或尺寸。

- [ ] **Step 2: 写右栏同构上下文测试**

流水右栏显示范围、全部账户、本地原型；账户右栏显示账户资料与动作；统计右栏显示贡献或焦点详情。所有页复用同一玻璃卡片结构和标题层级。

- [ ] **Step 3: 运行左右栏测试并确认红灯**

Run: `npm test -- --run apps/web/src/components/TimeContextPanel.test.tsx apps/web/src/components/accounting/AccountingRightContextPanel.test.tsx apps/web/src/components/mapShellLayout.test.tsx`

Expected: FAIL，新上下文组件和统计 slot 尚未接通。

- [ ] **Step 4: 让 TimeContextPanel 接收记账快照与统计 slot**

移除 `TimeContextPanel` 内部直接读取静态 `ledgerAtlasDataset` 的记账摘要路径。新增显式 props：

```ts
accountingMetricItems?: TimeContextMetricItem[]
accountingStatisticsControls?: AccountingStatisticsControls
onAccountingStatisticsControlsChange?: (next: AccountingStatisticsControls) => void
```

`App` 仅在统计页传入统计口径 props，并将同一状态传入 `AccountingPage`。外层面板几何和共享时间选择器 DOM 不变，仅替换指标数据并在选择器下渲染控件。

- [ ] **Step 5: 实现 AccountingRightContextPanel**

该组件只消费 `AccountingShellSnapshot['context']`，动作点击回传 `AccountingShellAction`。空快照时显示稳定的加载占位，不能闪回地图或旧记账说明。

- [ ] **Step 6: 运行左右栏测试**

Run: `npm test -- --run apps/web/src/components/TimeContextPanel.test.tsx apps/web/src/components/accounting/AccountingRightContextPanel.test.tsx apps/web/src/components/mapShellLayout.test.tsx apps/web/src/App.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交左右栏集成**

```powershell
git add apps/web/src/components/TimeContextPanel.tsx apps/web/src/components/TimeContextPanel.test.tsx apps/web/src/components/accounting/AccountingRightContextPanel.tsx apps/web/src/components/accounting/AccountingRightContextPanel.test.tsx apps/web/src/App.tsx apps/web/src/components/mapShellLayout.test.tsx
git commit -m "feat: 统一记账三页左右上下文面板"
```

## Task 13：建立同层玻璃材质、高密度布局与响应式样式

**Files:**

- Create: `apps/web/src/components/accounting/accounting.css`
- Modify: `apps/web/src/components/AccountingPage.tsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: 先更新 CSS 源契约失败测试**

断言：

- 中栏主面板、左栏与右栏卡片引用相同的玻璃 token；
- 中栏有边框、圆角、背景、外阴影和内高光，不再透明凹陷；
- 流水内部为约 41/59，账户与统计内部不会让窄列表占满横向空间；
- 桌面根容器 `overflow: hidden`，列表和树为局部滚动；
- 记账子页没有改变共享左栏几何的选择器；
- 支出/负债相关类不使用红色色值；
- 1440×900 无横向溢出，移动端改为纵向内容顺序。

- [ ] **Step 2: 运行布局契约并确认红灯**

Run: `npm test -- --run apps/web/src/components/mapLayout.test.ts apps/web/src/components/mapShellLayout.test.tsx`

Expected: FAIL，新样式文件和 token 使用尚不存在。

- [ ] **Step 3: 抽取记账样式并保留共享壳层规则**

`AccountingPage.tsx` 引入 `./accounting/accounting.css`。`App.css` 只保留全局壳层、共享玻璃变量和非记账页面规则；记账工作区、图表、行、弹窗和响应式规则迁到新文件。使用现有远山黛 token，新增统一变量时放在共享根选择器：

```css
--panel-glass-background: ...;
--panel-glass-border: ...;
--panel-glass-shadow: ...;
--panel-glass-inset: ...;
```

左、中、右同层区域都引用这组变量，不为中栏制造更低透明度。

- [ ] **Step 4: 完成桌面和移动断点**

优先保证 2048×1152 与 1440×900；小型桌面仍为三栏，降低图表标签密度但不横向滚动。移动端按时间摘要 → 核心指标 → 流水/主图 → 次级分析 → 右栏上下文纵向排列，按钮触点至少 44px。

- [ ] **Step 5: 运行布局测试**

Run: `npm test -- --run apps/web/src/components/mapLayout.test.ts apps/web/src/components/mapShellLayout.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交视觉系统**

```powershell
git add apps/web/src/components/accounting/accounting.css apps/web/src/components/AccountingPage.tsx apps/web/src/App.css apps/web/src/components/mapLayout.test.ts apps/web/src/components/mapShellLayout.test.tsx
git commit -m "feat: 统一记账工作台玻璃层级与高密度布局"
```

## Task 14：补齐集成、无障碍与极端状态测试

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/accounting/AccountsWorkspace.test.tsx`
- Modify: `apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx`
- Modify: `apps/web/src/components/accounting/TransactionDialog.test.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: 增加真实用户路径集成测试**

用 Testing Library 完成：选择时间范围 → 流水页创建支出并选分类/多标签 → 查看详情 → 编辑金额 → 切账户页并轮替账户 → 切统计页并改变粒度/选树节点。每一步断言当前页的指标与相关图表文本同步。

- [ ] **Step 2: 增加空值和极端比例测试**

覆盖无流水、无账户、无分类/标签、单账户、分类不足 5、标签不足 5、负净资产、单笔巨大收入、上周期无数据、全为转账。断言不出现 NaN/Infinity、伪造图段或红色负值语义。

- [ ] **Step 3: 增加无障碍契约**

断言卡片轮替键盘操作、图表文本摘要、弹窗焦点、按钮可访问名称、树节点展开状态、局部滚动区域名称。避免只以颜色表达正负或类型。

- [ ] **Step 4: 运行全量前端测试**

Run: `npm test -- --run`

Expected: web、API 和仓库工具测试全部 PASS，无未处理 promise 或 React `act` 警告。

- [ ] **Step 5: 修复集成暴露的问题后再次全量测试**

Run: `npm test -- --run`

Expected: PASS。

- [ ] **Step 6: 提交集成测试**

```powershell
git add apps/web/src/App.test.tsx apps/web/src/components/accounting/AccountsWorkspace.test.tsx apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx apps/web/src/components/accounting/TransactionDialog.test.tsx apps/web/src/components/mapShellLayout.test.tsx
git commit -m "test: 覆盖记账三页联动与极端状态"
```

## Task 15：真实浏览器验收与最终验证

**Files:**

- Modify if needed: `apps/web/src/components/accounting/accounting.css`
- Modify if needed: affected accounting components and tests
- Modify if needed: `README.md`
- Modify if needed: `docs/superpowers/specs/2026-07-14-accounting-workspaces-redesign-design.md`

- [ ] **Step 1: 启动本地应用并记录进程**

Run: `python start.py start`

Expected: API 与 Vite 启动成功，前端可从启动器报告的本地地址访问；不输出或提交 `.env.local` 内容。

- [ ] **Step 2: 在 2048×1152 验收三页**

逐页确认：三栏约 450/956/450；左、中、右玻璃层级同构；中栏不凹陷；流水列窄而洞察列宽；无 body 滚动；右栏利用充分；控制台无 React/SVG/运行时错误。

- [ ] **Step 3: 在 1440×900 验收三页与弹窗**

确认无横向溢出、重要文字不互相覆盖、局部滚动可用、创建/详情/编辑弹窗在视口内、分类与标签树可键盘操作。

- [ ] **Step 4: 验收账户轮替和图表真实性**

用滚轮、触控板模拟、点击后卡和方向键轮替，确认一次一张且页面不滚动。验证分类极端比例不使用最小高度歪曲；余额是阶梯线；主趋势共享刻度；所有支出、负债和负净额均无红色。

- [ ] **Step 5: 验收空状态和负净资产**

通过测试夹具或开发态临时状态检查无流水、单账户、负净资产与上周期无数据；不得把临时调试数据或截图提交到仓库。

- [ ] **Step 6: 停止本地服务并检查文档影响**

Run: `python start.py stop`

Expected: 本轮启动的进程停止。检查 README：只有导航或当前阶段仓库事实需要同步时才修改；设计细节以已批准 spec 为准。

- [ ] **Step 7: 运行最终门禁**

```powershell
npm test -- --run
npm run lint
npm run build
git diff --check
git status --short
```

Expected: 测试、lint、build 全部成功；`git diff --check` 无输出；仅有预期文档/源代码改动，无 `.env.local`、截图、日志、构建产物或其他本地文件进入暂存范围。

- [ ] **Step 8: 提交浏览器验收后的必要修正**

若浏览器验收产生修正，先用 `git status --short` 确认范围，再只暂存下列本轮允许修改的文件：

```powershell
git add apps/web/src/App.tsx apps/web/src/App.css apps/web/src/App.test.tsx apps/web/src/components/AccountingPage.tsx apps/web/src/components/TimeContextPanel.tsx apps/web/src/components/TimeContextPanel.test.tsx apps/web/src/components/mapLayout.test.ts apps/web/src/components/mapShellLayout.test.tsx apps/web/src/components/accounting docs/superpowers/specs/2026-07-14-accounting-workspaces-redesign-design.md README.md
git commit -m "fix: 完成记账工作台浏览器验收修正"
```

若没有代码修正，不创建空提交。

## 完成定义

- `流水 / 账户 / 统计` 三页都使用同一个时间范围和同一份会话数据。
- 三栏比例和玻璃视觉同构，中栏信息密度符合已批准设计，不再由宽流水瀑布占满。
- 任意范围期初/期末余额、资产、负债、净资产、转账抵消均通过纯函数测试。
- 流水可创建、查看和编辑，分类单选树与标签多选树可实际操作。
- 账户页卡片轮替、账户流水、余额阶梯、分类、标签与管理入口完整联动。
- 统计页不增加第三级导航，提供趋势、完整分类树、完整标签树和账户贡献。
- 标签不显示占比，不默认实现意义不明的标签×分类热力图。
- 支出、负债与负向图表不使用红色；图表提供文字摘要且不歪曲比例。
- `npm test -- --run`、`npm run lint`、`npm run build` 和两种桌面分辨率浏览器验收全部通过。
