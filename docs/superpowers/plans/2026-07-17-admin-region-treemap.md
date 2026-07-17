# 行政区域指标拼图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在区域页面右栏底部增加随时间范围、行政层级、区域选择和排行依据变化的全量真实比例 treemap，并自然填满剩余高度。

**Architecture:** 后端只读摘要响应为每个区域补充直接父级 ID，前端继续一次预取同一时间范围的四级摘要，再通过纯函数解析当前拼图范围。`d3-hierarchy` 只负责 squarified treemap 坐标，React 组件负责尺寸观测、可访问标签和状态渲染，页面层继续拥有选择与重试生命周期。

**Tech Stack:** FastAPI、SQLite 只读查询、React 19、TypeScript 6、Vitest、Testing Library、d3-hierarchy、CSS Grid、ResizeObserver

---

## 文件结构

- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py`：摘要元数据查询和 `parentRegionId` 响应。
- Modify: `apps/api/tests/test_admin_region_precompute.py`：只读父级契约与 API 回归测试。
- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.ts`：`AdminRegionMetric.parentRegionId` 类型和严格校验。
- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.test.ts`：父级字段合法与非法响应测试。
- Modify: `apps/web/src/components/adminRegionRanking.test.ts`、`AdminRegionContextPanel.test.tsx`、`App.test.tsx`：补齐必需的父级字段并增加页面联动断言。
- Modify: `apps/web/src/layers/adminRegionSummaryCache.test.ts`：补齐缓存摘要 fixture 的父级字段。
- Create: `apps/web/src/components/adminRegionTreemap.ts`：范围解析、指标选择、排序、占比、色阶和标签数据纯函数。
- Create: `apps/web/src/components/adminRegionTreemap.test.ts`：四级范围和数据口径单元测试。
- Create: `apps/web/src/components/AdminRegionTreemapCard.tsx`：ResizeObserver、d3 布局和卡片状态。
- Create: `apps/web/src/components/AdminRegionTreemapCard.test.tsx`：渲染、标签阈值、空/加载/错误测试。
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx`：组合第三块拼图卡片。
- Modify: `apps/web/src/App.tsx`：提供当前/下一层缓存、状态和按实际深度重试。
- Modify: `apps/web/src/App.css`：右栏三行弹性布局和项目原生色阶。
- Modify: `apps/web/src/components/mapLayout.test.ts`：布局与配色契约。
- Modify: `apps/web/package.json`、`package-lock.json`：加入 `d3-hierarchy` 和类型包。

### Task 1: 后端摘要返回直接父级

**Files:**
- Modify: `apps/api/tests/test_admin_region_precompute.py`
- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py`

- [ ] **Step 1: 在预计算摘要测试中写入父子关系断言**

在 `test_query_precomputed_admin_region_summary_reads_only_ready_rows` 的预期 `regionMetrics` 中为每个区域加入父级：

```python
{
    "regionId": "district-a",
    "parentRegionId": "city-a",
    "name": "district-a",
    "footprintCount": 1,
    "stayDurationSeconds": 180,
    "travelDistanceMeters": 6.0,
    "bounds": {
        "west": 0.0,
        "south": 0.0,
        "east": 1.0,
        "north": 1.0,
    },
}
```

并增加一个没有父级的国家元数据测试：

```python
def test_eligible_admin_region_metadata_returns_nullable_parent() -> None:
    connection = create_precomputed_summary_metrics_fixture()
    connection.execute(
        """
        INSERT INTO admin_regions (
          id, name, level, geometry, min_lng, min_lat, max_lng, max_lat
        ) VALUES ('CN', 'China', 1, '{}', 73.0, 18.0, 135.0, 54.0)
        """,
    )

    rows = precompute.query_eligible_admin_region_metadata(connection, depth=1)

    country = next(row for row in rows if row["id"] == "CN")
    assert country["parent_id"] is None
```

- [ ] **Step 2: 运行目标测试确认父级字段缺失**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_region_precompute.py -k "query_precomputed_admin_region_summary or precompute_api_separates" -q
```

Expected: FAIL，响应指标缺少 `parentRegionId`。

- [ ] **Step 3: 让摘要元数据查询只读关联父级**

将 `query_eligible_admin_region_metadata()` 的查询改为：

```python
SELECT regions.id,
       regions.name,
       regions.min_lng,
       regions.min_lat,
       regions.max_lng,
       regions.max_lat,
       tree.parent_id
FROM admin_regions AS regions
LEFT JOIN admin_region_tree AS tree ON tree.child_id = regions.id
WHERE regions.level = ?
{country_filter}
ORDER BY regions.id
```

并在 `format_precomputed_admin_region_metric()` 中加入：

```python
"parentRegionId": None if row[6] is None else str(row[6]),
```

不改 schema、签名和任何写入路径。

- [ ] **Step 4: 运行后端目标测试**

Run:

```powershell
$env:PYTHONPATH='apps/api/src'; python -m pytest apps/api/tests/test_admin_region_precompute.py -q
```

Expected: PASS，现有摘要值不变且父级字段正确。

- [ ] **Step 5: 提交后端契约**

```powershell
git add apps/api/src/enroute_api/admin_regions/precompute.py apps/api/tests/test_admin_region_precompute.py
git commit -m "feat: 补充行政区域摘要父级关系"
```

### Task 2: 前端严格接收父级字段

**Files:**
- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.ts`
- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.test.ts`
- Modify: `apps/web/src/components/adminRegionRanking.test.ts`
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/layers/adminRegionSummaryCache.test.ts`

- [ ] **Step 1: 为数据源测试 payload 增加父级并添加非法用例**

有效城市指标使用：

```ts
{
  regionId: '310100',
  parentRegionId: '310000',
  name: 'Shanghai',
  footprintCount: 4,
  stayDurationSeconds: 3_600,
  travelDistanceMeters: 12_345.67,
  bounds: {
    west: 120.85,
    south: 30.65,
    east: 122.15,
    north: 31.9,
  },
}
```

在 malformed 表格中增加：

```ts
['a missing parent region id', () => ({
  ...createPayload(),
  regionMetrics: [{
    ...createPayload().regionMetrics[0],
    parentRegionId: undefined,
  }],
})],
['a numeric parent region id', () => ({
  ...createPayload(),
  regionMetrics: [{
    ...createPayload().regionMetrics[0],
    parentRegionId: 310000,
  }],
})],
```

- [ ] **Step 2: 运行数据源测试确认严格契约尚未实现**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/layers/adminRegionSummaryDataSource.test.ts
```

Expected: FAIL，非法父级字段仍被接受。

- [ ] **Step 3: 增加类型和校验**

在 `AdminRegionMetric` 中加入：

```ts
parentRegionId: string | null
```

在 `isAdminRegionMetric()` 中加入：

```ts
(value.parentRegionId === null || typeof value.parentRegionId === 'string') &&
```

- [ ] **Step 4: 机械补齐所有测试 fixture 的父级字段**

国家使用 `parentRegionId: null`；中国省级使用 `parentRegionId: 'CN'`；城市和区县 fixture 使用其测试父级。不要把生产类型改成可选字段来绕过 fixture。

- [ ] **Step 5: 运行数据源、排行、区域面板和 App 测试**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/layers/adminRegionSummaryDataSource.test.ts src/components/adminRegionRanking.test.ts src/components/AdminRegionContextPanel.test.tsx src/App.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交前端契约**

```powershell
git add apps/web/src
git commit -m "feat: 接入行政区域父级摘要字段"
```

### Task 3: 拼图纯数据模型

**Files:**
- Create: `apps/web/src/components/adminRegionTreemap.ts`
- Create: `apps/web/src/components/adminRegionTreemap.test.ts`

- [ ] **Step 1: 写四级范围与指标口径失败测试**

测试构造当前摘要和下一层摘要，并覆盖：

```ts
expect(buildAdminRegionTreemapModel({
  depth: 2,
  currentSummary: provinceSummary,
  nextSummary: citySummary,
  selectedRegion: jiangsu,
  metric: 'time',
})).toMatchObject({
  dataDepth: 3,
  title: '江苏各市',
  items: [
    { regionId: '320100', metricValue: 3_600 },
    { regionId: '320500', metricValue: 1_800 },
  ],
})
```

还必须断言：中国国家级下钻、其他国家不聚焦、市级下钻、区级不变化、当前指标零值过滤、所有正值保留、同值稳定排序、面积值总和、同值同色。

- [ ] **Step 2: 运行测试确认模块不存在**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/adminRegionTreemap.test.ts
```

Expected: FAIL with import/module not found。

- [ ] **Step 3: 实现纯类型和范围解析**

生产接口固定为：

```ts
export type AdminRegionTreemapItem = {
  region: AdminRegionMetric
  metricValue: number
  share: number
  fill: string
  textColor: string
  displayValue: string
  ariaLabel: string
}

export type AdminRegionTreemapModel = {
  dataDepth: AdminRegionDepth
  title: string
  metricLabel: string
  totalValue: number
  items: AdminRegionTreemapItem[]
}

export function buildAdminRegionTreemapModel(options: {
  depth: AdminRegionDepth
  currentSummary: AdminRegionSummary
  nextSummary: AdminRegionSummary | null
  selectedRegion: AdminRegionMetric | null
  metric: AdminRegionRankingMetric
}): AdminRegionTreemapModel
```

中国 ID 判断使用标准化集合：

```ts
const CHINA_COUNTRY_IDS = new Set(['cn', 'chn', '156'])
const isChinaCountry = (regionId: string) => CHINA_COUNTRY_IDS.has(regionId.toLowerCase())
```

省、市选择时只从下一层 `regionMetrics` 过滤 `parentRegionId === selectedRegion.regionId`。区级和非中国国家继续使用当前摘要。

- [ ] **Step 4: 实现指标选择、稳定排序与色阶**

使用与排行相同的 formatter，并按以下阈值返回固定项目色阶：

```ts
const COLOR_STOPS = [
  { minRatio: 0.72, fill: '#1d594c', textColor: '#f8fbfa' },
  { minRatio: 0.48, fill: '#4c897b', textColor: '#f8fbfa' },
  { minRatio: 0.30, fill: '#75a79b', textColor: '#17231f' },
  { minRatio: 0.16, fill: '#93b4ab', textColor: '#17231f' },
  { minRatio: 0.08, fill: '#abc8c0', textColor: '#17231f' },
  { minRatio: 0.04, fill: '#b8d1ca', textColor: '#17231f' },
  { minRatio: 0.015, fill: '#c5d7d2', textColor: '#17231f' },
  { minRatio: 0, fill: '#d3e1dd', textColor: '#17231f' },
] as const
```

色阶 ratio 使用 `metricValue / maxMetricValue`，面积继续使用原始 `metricValue`。

- [ ] **Step 5: 运行纯函数测试**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/adminRegionTreemap.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交模型**

```powershell
git add apps/web/src/components/adminRegionTreemap.ts apps/web/src/components/adminRegionTreemap.test.ts
git commit -m "feat: 建立行政区域拼图数据模型"
```

### Task 4: treemap 卡片组件

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Create: `apps/web/src/components/AdminRegionTreemapCard.tsx`
- Create: `apps/web/src/components/AdminRegionTreemapCard.test.tsx`

- [ ] **Step 1: 安装成熟布局依赖**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install --workspace apps/web d3-hierarchy
& 'C:\Program Files\nodejs\npm.cmd' install --workspace apps/web --save-dev @types/d3-hierarchy
```

Expected: 只更新 web workspace 依赖和根锁文件。

- [ ] **Step 2: 写卡片失败测试**

在测试中 mock `ResizeObserver` 返回 `320 x 240`，断言：

```ts
expect(screen.getByRole('heading', { name: '全国各省' })).toBeInTheDocument()
expect(screen.getByRole('list', { name: '全国各省时间分布' })).toBeInTheDocument()
expect(screen.getByRole('listitem', { name: /上海.*12\.6 天.*41\.8%/ })).toBeInTheDocument()
expect(document.querySelectorAll('.admin-region-treemap-card__tile')).toHaveLength(model.items.length)
```

分别测试 loading、empty、error/retry、小块隐藏可见文字但保留 `aria-label`。

- [ ] **Step 3: 运行组件测试确认组件不存在**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/AdminRegionTreemapCard.test.tsx
```

Expected: FAIL with module not found。

- [ ] **Step 4: 实现尺寸观测与 d3 布局**

核心布局保持：

```tsx
type TreemapDatum = {
  item?: AdminRegionTreemapItem
  children?: TreemapDatum[]
}

const root = hierarchy<TreemapDatum>({
  children: model.items.map((item) => ({ item })),
})
  .sum((node) => node.item?.metricValue ?? 0)
  .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))

treemap<TreemapDatum>()
  .size([width, height])
  .paddingInner(3)
  .round(true)(root)
```

只渲染 `root.leaves()`。组件无 `onClick`；每块使用 `role="listitem"`、`aria-label` 和 `title`。

- [ ] **Step 5: 实现标签阈值与状态**

标签规则写成纯判断：

```ts
const showDetails = tileWidth >= 92 && tileHeight >= 48
const showName = tileWidth >= 52 && tileHeight >= 24
```

加载、空、错误状态必须复用同一 `.admin-region-treemap-card__body` 高度。错误按钮只调用传入的 `onRetry`。

- [ ] **Step 6: 运行组件和模型测试**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/adminRegionTreemap.test.ts src/components/AdminRegionTreemapCard.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交卡片组件**

```powershell
git add apps/web/package.json package-lock.json apps/web/src/components/AdminRegionTreemapCard.tsx apps/web/src/components/AdminRegionTreemapCard.test.tsx
git commit -m "feat: 新增行政区域指标拼图卡片"
```

### Task 5: 接入右栏、缓存状态和重试

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: 写右栏组合失败测试**

扩展 `renderPanel()` 传入 `nextSummary`、`timeRange` 和下一层状态，断言 DOM 顺序为版图、排行、拼图，并断言选中江苏时：

```ts
expect(screen.getByRole('heading', { name: '江苏各市' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '省' })).toHaveAttribute('aria-pressed', 'true')
```

增加非中国国家不聚焦、区级选择范围不变、拼图 retry 回调的测试。

- [ ] **Step 2: 运行区域面板测试确认缺少第三块**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/AdminRegionContextPanel.test.tsx
```

Expected: FAIL，找不到拼图标题。

- [ ] **Step 3: 在区域面板组合卡片**

新增 props：

```ts
nextSummary: AdminRegionSummary | null
nextSummaryStatus: AdminRegionSummaryStatus
timeRange: TimeRangeSelection
onTreemapRetry: (depth: AdminRegionDepth) => void
```

使用 `buildAdminRegionTreemapModel()` 生成 ready model，并把实际 `dataDepth` 传给 retry。

- [ ] **Step 4: 在 App 中提供下一层缓存和状态**

计算：

```ts
const nextAdminRegionDepth = adminRegionDepth < 4
  ? ((adminRegionDepth + 1) as AdminRegionDepth)
  : null
const nextAdminRegionSummary = nextAdminRegionDepth === null
  ? null
  : getCachedAdminRegionSummary(selectedTimeRange, nextAdminRegionDepth)
```

从现有 `adminRegionSummaryLoadState.statuses` 读取下一层状态。把当前 retry 逻辑提取为接受目标 depth 的回调；排行/版图 retry 仍清除当前选择，拼图下一层 retry 保留父区域选择。

- [ ] **Step 5: 增加 App 联动测试**

覆盖：进入区域模式仍只请求四级摘要一次；切换时间后拼图更新；切换排行依据不新增请求；选择江苏后使用已缓存城市摘要；下一层失败时只重试对应 depth。

- [ ] **Step 6: 运行 App 与区域组件测试**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/AdminRegionContextPanel.test.tsx src/App.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交页面联动**

```powershell
git add apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: 联动行政区域拼图上下文"
```

### Task 6: 弹性布局、配色和视觉验收

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: 写 CSS 契约失败测试**

断言：

```ts
expect(cssRule('.admin-region-context-panel')).toContain(
  'grid-template-rows: auto auto minmax(160px, 1fr)',
)
expect(cssRule('.admin-region-context-panel')).toContain('height: 100%')
expect(cssRule('.admin-region-treemap-card')).toContain('min-height: 160px')
expect(cssRule('.admin-region-treemap-card__body')).toContain('min-height: 0')
```

- [ ] **Step 2: 运行布局测试确认规则缺失**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/mapLayout.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现三行弹性布局和拼图样式**

核心规则：

```css
.admin-region-context-panel {
  height: 100%;
  grid-template-rows: auto auto minmax(160px, 1fr);
}

.admin-region-treemap-card {
  min-height: 160px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.admin-region-treemap-card__body {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

矩形使用 0 圆角和 3px 间距，卡片继续复用现有玻璃卡片、20px 外圆角和右栏排版。过渡只做 `opacity 120ms ease`，reduced-motion 下禁用。

- [ ] **Step 4: 运行前端目标测试、lint 和 build**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' --workspace apps/web test -- --run src/components/adminRegionTreemap.test.ts src/components/AdminRegionTreemapCard.test.tsx src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts src/App.test.tsx
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected: 全部通过。

- [ ] **Step 5: 启动本地服务并做桌面浏览器验收**

使用空闲端口启动 worktree 前端和 API。验证：默认省级拼图、选择江苏后的城市范围、选择非中国国家、区级不下钻、三种指标、左侧时间切换、加载/空/错误、窄桌面高度、reduced motion、控制台无错误。

- [ ] **Step 6: 确认数据库未写入**

在验收前后只读记录以下表的行数和 SHA-256 或 SQLite `total_changes=0` 证据：

```text
visual_tiles
admin_region_tiles
admin_region_daily_stats
```

Expected: 行数和内容不变。

- [ ] **Step 7: 运行完整验证并记录已知基线**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected: API、repo、lint、build 和本功能 Web 测试通过；若完整 Web 套件仍只有开工前已记录的 `AccountingPage.integration.test.tsx` 基线失败，明确单独报告。

- [ ] **Step 8: 提交视觉与验证调整**

```powershell
git add apps/web/src/App.css apps/web/src/components/mapLayout.test.ts
git commit -m "feat: 完善行政区域拼图布局"
```

### Task 7: 完成性复核

**Files:**
- Review: `docs/superpowers/specs/2026-07-17-admin-region-treemap-design.md`
- Review: all changed files

- [ ] **Step 1: 按规格逐项核对实现**

确认时间、层级、选择、指标、全量正值、配色、只读、状态、可访问性和桌面验收全部有代码与测试证据。

- [ ] **Step 2: 检查工作区和提交历史**

```powershell
git status --short
git log --oneline --decorate -8
git diff master...HEAD --check
```

Expected: 工作区干净、提交均为中文约定式提交、diff 无空白错误。

- [ ] **Step 3: 使用 verification-before-completion 做最终新鲜验证**

重新运行最终声明所依赖的目标测试、lint、build 和数据库只读检查，读取完整退出码后再报告完成。
