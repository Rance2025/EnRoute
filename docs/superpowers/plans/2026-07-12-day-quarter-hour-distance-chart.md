# 单日距离图表 15 分钟粒度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“日”模式距离图表从 24 个小时桶改为 96 个真实 15 分钟桶，并让接口、前端兼容聚合、均值线和交互使用一致量纲。

**Architecture:** 后端指标查询以 900 秒为一个桶并固定补齐全天 96 桶，前端原始点兼容路径复用同一分桶规则。`TimeContextPanel` 只消费新的 `quarter-hour` 契约，按 15 分钟计算均值，同时沿用现有密集柱图、线性/对数尺度和横坐标命中逻辑。

**Tech Stack:** Python 3.12、FastAPI、SQLite、pytest、React 19、TypeScript 6、Vitest、Testing Library、Vite、ESLint。

---

## 文件结构

- `apps/api/src/enroute_api/footprints/store.py`：主指标接口的 15 分钟 SQL 分桶和 96 桶序列输出。
- `apps/api/tests/test_footprints_api.py`：API 与快照接口契约、15 分钟边界测试。
- `apps/web/src/layers/footprintTypes.ts`：将单日距离序列类型改为 `quarter-hour`。
- `apps/web/src/layers/footprintSelectors.ts`：前端原始点兼容路径的 15 分钟聚合。
- `apps/web/src/layers/footprintSelectors.test.ts`：兼容聚合契约与边界测试。
- `apps/web/src/layers/footprintAggregation.test.ts`：渲染快照中的距离序列契约。
- `apps/web/src/components/TimeContextPanel.tsx`：15 分钟汇总文案、单位和均值算法。
- `apps/web/src/components/TimeContextPanel.test.tsx`：96 列、历史/当天/未来均值和交互测试。
- `apps/web/src/App.test.tsx`：应用层地图指标 mock 契约。
- `apps/web/src/components/MapboxCanvas.test.tsx`：地图指标 mock 与单日序列夹具。

不修改 `App.css`。现有 `time-context-trend__chart--dense` 在 96 列时已经启用零间距和满宽柱形。

### Task 1: 后端输出固定 96 个 15 分钟桶

**Files:**
- Modify: `apps/api/tests/test_footprints_api.py:408`
- Modify: `apps/api/tests/test_footprints_api.py:531`
- Modify: `apps/api/src/enroute_api/footprints/store.py:44`
- Modify: `apps/api/src/enroute_api/footprints/store.py:1158`

- [ ] **Step 1: 添加失败的 API 契约与边界测试**

在 `apps/api/tests/test_footprints_api.py` 的测试数据后增加唯一的期望值构造器：

```python
def expected_quarter_hour_buckets(
    date_key: str,
    distance_by_bucket: dict[int, float],
) -> list[dict[str, object]]:
    buckets: list[dict[str, object]] = []
    for bucket_index in range(96):
        hour, quarter = divmod(bucket_index, 4)
        label = f"{hour:02d}:{quarter * 15:02d}"
        buckets.append(
            {
                "key": f"{date_key}T{label}",
                "label": label,
                "distanceMeters": distance_by_bucket.get(bucket_index, 0),
            },
        )
    return buckets
```

把 `test_serves_footprint_metrics_without_raw_points_for_date_range` 和 `test_serves_snapshot_from_database_backed_viewport_query` 中的单日序列期望改为：

```python
"distanceSeries": {
    "granularity": "quarter-hour",
    "unit": "quarter-hour",
    "buckets": expected_quarter_hour_buckets(
        "2026-06-19",
        {0: 100, 46: 300},
    ),
},
```

`SNAPSHOT_CSV` 的第二、三条单日记录位于 11:33:20 和 11:35:00，因此都必须进入索引 46、标签 `11:30` 的桶。

再增加边界测试，直接证明闭开区间规则：

```python
def test_assigns_exact_quarter_hour_boundary_to_the_next_bucket(tmp_path: Path):
    boundary_csv = "\n".join(
        [
            "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
            "1781799299,1,121.5,31.2,0,5,0,10,1,0,0",
            "1781799300,1,121.5,31.2,0,5,0,20,1,0,0",
        ],
    )
    data_path = write_csv(tmp_path, boundary_csv)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.get("/api/footprints/metrics?start=2026-06-19&end=2026-06-19")

    assert response.status_code == 200
    series = response.json()["distanceSeries"]
    assert len(series["buckets"]) == 96
    assert series["buckets"][:2] == [
        {
            "key": "2026-06-19T00:00",
            "label": "00:00",
            "distanceMeters": 10,
        },
        {
            "key": "2026-06-19T00:15",
            "label": "00:15",
            "distanceMeters": 20,
        },
    ]
    assert series["buckets"][-1] == {
        "key": "2026-06-19T23:45",
        "label": "23:45",
        "distanceMeters": 0,
    }
```

- [ ] **Step 2: 运行聚焦测试并确认 RED**

Run:

```powershell
python -c "import sys, pytest; sys.path.insert(0, 'apps/api/src'); raise SystemExit(pytest.main(['apps/api/tests/test_footprints_api.py::test_serves_footprint_metrics_without_raw_points_for_date_range', 'apps/api/tests/test_footprints_api.py::test_assigns_exact_quarter_hour_boundary_to_the_next_bucket', 'apps/api/tests/test_footprints_api.py::test_serves_snapshot_from_database_backed_viewport_query', '-q']))"
```

Expected: FAIL，现有实现仍返回 `granularity == "hour"`、24 个桶，且没有 `00:15` 桶。

- [ ] **Step 3: 实现最小后端 15 分钟聚合**

在 `store.py` 的常量区增加：

```python
QUARTER_HOUR_SECONDS = 15 * 60
QUARTER_HOURS_PER_DAY = 24 * 4
```

把单日分支及查询函数改为：

```python
def query_distance_series(
    connection: sqlite3.Connection,
    input_payload: dict[str, Any],
) -> dict[str, object]:
    time_range = input_payload["timeRange"]
    day_count = max(int(time_range["dayCount"]), 1)

    if day_count == 1:
        return query_quarter_hour_distance_series(connection, time_range)

    return query_daily_distance_series(connection, time_range)


def query_quarter_hour_distance_series(
    connection: sqlite3.Connection,
    time_range: dict[str, int],
) -> dict[str, object]:
    start_date = shanghai_date_from_timestamp(int(time_range["startTimestampSeconds"]))
    day_start_timestamp = shanghai_date_start_timestamp_seconds(
        start_date.year,
        start_date.month,
        start_date.day,
    )
    distance_by_bucket = {
        int(row["bucketIndex"]): float(row["distanceMeters"])
        for row in connection.execute(
            """
            SELECT
              CAST((timestamp_seconds - ?) / ? AS INTEGER) AS bucketIndex,
              COALESCE(SUM(CASE WHEN distance > 0 THEN distance ELSE 0 END), 0) AS distanceMeters
            FROM footprints
            WHERE timestamp_seconds >= ?
              AND timestamp_seconds <= ?
            GROUP BY bucketIndex
            """,
            (
                day_start_timestamp,
                QUARTER_HOUR_SECONDS,
                time_range["startTimestampSeconds"],
                time_range["endTimestampSeconds"],
            ),
        )
    }

    buckets = []
    for bucket_index in range(QUARTER_HOURS_PER_DAY):
        hour, quarter = divmod(bucket_index, 4)
        label = f"{hour:02d}:{quarter * 15:02d}"
        buckets.append(
            {
                "key": f"{start_date.isoformat()}T{label}",
                "label": label,
                "distanceMeters": distance_by_bucket.get(bucket_index, 0),
            },
        )

    return {
        "granularity": "quarter-hour",
        "unit": "quarter-hour",
        "buckets": buckets,
    }
```

删除旧的 `query_hourly_distance_series`，不保留双重契约。

- [ ] **Step 4: 运行聚焦 API 测试并确认 GREEN**

Run: 使用 Step 2 的同一命令。

Expected: 3 passed。

- [ ] **Step 5: 运行完整 API 测试**

Run:

```powershell
npm run test:api
```

Expected: 146 passed，0 failed。

- [ ] **Step 6: 提交后端变更**

```powershell
git add apps/api/src/enroute_api/footprints/store.py apps/api/tests/test_footprints_api.py
git commit -m "feat: 提供单日15分钟距离序列"
```

### Task 2: 前端统一 15 分钟契约、均值和交互

**Files:**
- Modify: `apps/web/src/layers/footprintTypes.ts:34`
- Modify: `apps/web/src/layers/footprintSelectors.ts:88`
- Modify: `apps/web/src/layers/footprintSelectors.test.ts:120`
- Modify: `apps/web/src/layers/footprintAggregation.test.ts:143`
- Modify: `apps/web/src/components/TimeContextPanel.tsx:568`
- Modify: `apps/web/src/components/TimeContextPanel.test.tsx:51`
- Modify: `apps/web/src/App.test.tsx:18`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx:2565`

- [ ] **Step 1: 添加失败的前端聚合测试**

在 `footprintSelectors.test.ts` 中把单日期望改成 96 桶，并增加边界测试。测试内使用以下构造器：

```ts
function expectedQuarterHourBuckets(
  dateKey: string,
  distanceByBucket: Record<number, number>,
) {
  return Array.from({ length: 96 }, (_, bucketIndex) => {
    const hour = Math.floor(bucketIndex / 4)
    const minute = (bucketIndex % 4) * 15
    const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

    return {
      key: `${dateKey}T${label}`,
      label,
      distanceMeters: distanceByBucket[bucketIndex] ?? 0,
    }
  })
}
```

原有单日期望使用：

```ts
distanceSeries: {
  granularity: 'quarter-hour',
  unit: 'quarter-hour',
  buckets: expectedQuarterHourBuckets('2026-06-19', { 0: 100, 46: 200.5 }),
},
```

增加：

```ts
it('places exact 15-minute boundaries in adjacent distance buckets', () => {
  const selection = selectDay('2026-06-19')
  const metrics = calculateFootprintMetrics(
    [
      point('before-boundary', 1781799299, 121, 31, 10),
      point('at-boundary', 1781799300, 121, 31, 20),
    ],
    selection,
  )

  expect(metrics.distanceSeries).toMatchObject({
    granularity: 'quarter-hour',
    unit: 'quarter-hour',
  })
  expect(metrics.distanceSeries?.buckets).toHaveLength(96)
  expect(metrics.distanceSeries?.buckets.slice(0, 2)).toEqual(
    expectedQuarterHourBuckets('2026-06-19', { 0: 10, 1: 20 }).slice(0, 2),
  )
})
```

- [ ] **Step 2: 添加失败的图表语义测试**

在 `TimeContextPanel.test.tsx` 中将 `hourlyDistanceSeries` 替换为：

```ts
const quarterHourDistanceSeries: FootprintDistanceSeries = {
  granularity: 'quarter-hour',
  unit: 'quarter-hour',
  buckets: Array.from({ length: 96 }, (_, bucketIndex) => {
    const hour = Math.floor(bucketIndex / 4)
    const minute = (bucketIndex % 4) * 15
    const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

    return {
      key: `2026-06-19T${label}`,
      label,
      distanceMeters: { 0: 100, 46: 300 }[bucketIndex] ?? 0,
    }
  }),
}
```

增加历史日期断言：

```ts
it('renders 96 quarter-hour columns with a matching historical average unit', () => {
  const { container } = render(
    <TimeContextPanel
      view="map"
      selection={selectDay('2026-06-19')}
      distanceSeries={quarterHourDistanceSeries}
      onSelectionChange={vi.fn()}
    />,
  )

  const trend = screen.getByLabelText('当前范围距离')
  expect(container.querySelectorAll('.time-context-trend__column')).toHaveLength(96)
  expect(container.querySelector('.time-context-trend__chart')).toHaveClass(
    'time-context-trend__chart--dense',
  )
  expect(within(trend).getByText('按15分钟汇总 · 24小时')).toBeInTheDocument()
  expect(container.querySelector('.time-context-trend__average-label')).toHaveTextContent(
    '4 m/15分钟',
  )

  fireEvent.pointerEnter(container.querySelectorAll('.time-context-trend__column')[46])
  expect(within(trend).getByText('11:30 · 300 m')).toBeInTheDocument()
})
```

把当前日期均值测试改为 10:20，并让桶 0 与桶 41 分别包含 40 和 60 米：

```ts
vi.setSystemTime(new Date('2026-06-20T10:20:00+08:00'))

const currentDaySeries: FootprintDistanceSeries = {
  granularity: 'quarter-hour',
  unit: 'quarter-hour',
  buckets: Array.from({ length: 96 }, (_, bucketIndex) => {
    const hour = Math.floor(bucketIndex / 4)
    const minute = (bucketIndex % 4) * 15
    const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
    return {
      key: `2026-06-20T${label}`,
      label,
      distanceMeters: { 0: 40, 41: 60 }[bucketIndex] ?? 0,
    }
  }),
}
```

对应断言为：

```ts
expect(container.querySelector('.time-context-trend__average-label')).toHaveTextContent(
  '2 m/15分钟',
)
expect(container.querySelector('.time-context-trend__head small')).toHaveTextContent(
  '10.3小时',
)
```

增加未来日期断言：

```ts
it('shows a zero quarter-hour average for a future day', () => {
  const futureSeries: FootprintDistanceSeries = {
    ...quarterHourDistanceSeries,
    buckets: quarterHourDistanceSeries.buckets.map((bucket) => ({
      ...bucket,
      key: bucket.key.replace('2026-06-19', '2026-06-21'),
    })),
  }
  const { container } = render(
    <TimeContextPanel
      view="map"
      selection={selectDay('2026-06-21')}
      distanceSeries={futureSeries}
      onSelectionChange={vi.fn()}
    />,
  )

  expect(container.querySelector('.time-context-trend__average-label')).toHaveTextContent(
    '0 m/15分钟',
  )
  expect(container.querySelector('.time-context-trend__head small')).toHaveTextContent(
    '0.0小时',
  )
})
```

- [ ] **Step 3: 运行两个聚焦测试文件并确认 RED**

Run:

```powershell
npm run test:web -- apps/web/src/layers/footprintSelectors.test.ts apps/web/src/components/TimeContextPanel.test.tsx
```

Expected: FAIL，现有代码仍生成 24 个 `hour` 桶，并显示“按小时汇总”和 `/小时`。

- [ ] **Step 4: 更新共享类型与前端兼容聚合**

将 `FootprintDistanceSeries` 改为：

```ts
export type FootprintDistanceSeries = {
  granularity: 'quarter-hour' | 'day'
  unit: 'quarter-hour' | 'day'
  buckets: FootprintDistanceBucket[]
}
```

在 `footprintSelectors.ts` 中用以下实现替换小时聚合：

```ts
const QUARTER_HOUR_SECONDS = 15 * 60
const QUARTER_HOURS_PER_DAY = 24 * 4

function calculateDistanceSeries(
  points: FootprintPoint[],
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
    dayCount: number
  },
): FootprintDistanceSeries {
  if (Math.max(timeRange.dayCount, 1) === 1) {
    return calculateQuarterHourDistanceSeries(points, timeRange)
  }

  return calculateDailyDistanceSeries(points, timeRange)
}

function calculateQuarterHourDistanceSeries(
  points: FootprintPoint[],
  timeRange: {
    startTimestampSeconds: number
    endTimestampSeconds: number
  },
): FootprintDistanceSeries {
  const startDate = shanghaiDateFromTimestampSeconds(timeRange.startTimestampSeconds)
  const dayStartTimestampSeconds = shanghaiDateStartTimestampSeconds(startDate)
  const distanceByBucket = new Map<number, number>()

  for (const point of points) {
    if (!isPointInTimestampRange(point, timeRange)) continue
    if (!Number.isFinite(point.distance) || point.distance <= 0) continue

    const bucketIndex = Math.floor(
      (point.timestampSeconds - dayStartTimestampSeconds) / QUARTER_HOUR_SECONDS,
    )
    distanceByBucket.set(
      bucketIndex,
      (distanceByBucket.get(bucketIndex) ?? 0) + point.distance,
    )
  }

  const dateKey = formatDateKey(startDate)

  return {
    granularity: 'quarter-hour',
    unit: 'quarter-hour',
    buckets: Array.from({ length: QUARTER_HOURS_PER_DAY }, (_, bucketIndex) => {
      const hour = Math.floor(bucketIndex / 4)
      const minute = (bucketIndex % 4) * 15
      const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

      return {
        key: `${dateKey}T${label}`,
        label,
        distanceMeters: distanceByBucket.get(bucketIndex) ?? 0,
      }
    }),
  }
}
```

- [ ] **Step 5: 更新图表契约、文案和均值算法**

在 `TimeContextPanel.tsx` 中把单日兼容检查改为 `distanceSeries.granularity === 'quarter-hour'`，并在 `getDistanceTrendModel` 中使用：

```ts
const denominatorLabel = distanceSeries?.unit === 'quarter-hour' ? '15分钟' : '日'
const aggregationLabel = grouping.isGrouped
  ? `按${grouping.groupSize}日归并`
  : distanceSeries?.granularity === 'quarter-hour' ? '按15分钟汇总' : '按日汇总'
```

把空序列和单日分支改为：

```ts
if (buckets.length === 0) {
  return {
    value: 0,
    rangeLabel: granularity === 'quarter-hour' ? '0.0小时' : '0天',
  }
}

if (granularity === 'quarter-hour') {
  return getQuarterHourDistanceTrendAverage(buckets)
}
```

用以下函数替换 `getHourlyDistanceTrendAverage`：

```ts
function getQuarterHourDistanceTrendAverage(buckets: FootprintDistanceBucket[]) {
  const now = new Date()
  const todayKey = formatLocalDateKey(now)
  const bucketDateKey = buckets[0]?.key.slice(0, 10) ?? ''

  if (bucketDateKey > todayKey) {
    return {
      value: 0,
      rangeLabel: '0.0小时',
    }
  }

  if (bucketDateKey < todayKey) {
    return {
      value: (
        buckets.reduce((total, bucket) => total + Math.max(bucket.distanceMeters, 0), 0) /
        buckets.length
      ),
      rangeLabel: `${buckets.length / 4}小时`,
    }
  }

  const selectedDayStart = new Date(`${bucketDateKey}T00:00:00`)
  const elapsedQuarterHours = Math.min(
    Math.max((now.getTime() - selectedDayStart.getTime()) / (15 * 60 * 1000), 0),
    96,
  )
  const elapsedDistanceMeters = buckets.reduce((total, bucket) => {
    const bucketStart = new Date(`${bucket.key}:00`)
    if (bucketStart >= now) return total

    return total + Math.max(bucket.distanceMeters, 0)
  }, 0)

  return {
    value: elapsedQuarterHours === 0 ? 0 : elapsedDistanceMeters / elapsedQuarterHours,
    rangeLabel: `${(elapsedQuarterHours / 4).toFixed(1)}小时`,
  }
}
```

- [ ] **Step 6: 迁移所有单日前端测试夹具**

按同一个 `quarter-hour` 契约更新以下夹具，不保留 `hour` 类型：

1. `footprintAggregation.test.ts` 的快照期望使用 96 桶，距离索引为 `{ 0: 100, 46: 300 }`。
2. `App.test.tsx` 的 mock 类型改为 `'quarter-hour' | 'day'`，单日 mock 生成 96 桶。非零距离可放在索引 40，对应 `10:00`。
3. `MapboxCanvas.test.tsx` 的 mock 类型改为 `'quarter-hour' | 'day'`；`createTestDistanceSeries` 接收 `'quarter-hour' | 'day'`，所有五个 `'hour'` 调用改为 `'quarter-hour'`，单日夹具生成 96 桶。
4. `TimeContextPanel.test.tsx` 中所有引用 `hourlyDistanceSeries` 的位置改为 `quarterHourDistanceSeries`。

每个 96 桶夹具都使用同一条显式公式：

```ts
const hour = Math.floor(bucketIndex / 4)
const minute = (bucketIndex % 4) * 15
const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
```

- [ ] **Step 7: 运行前端聚焦测试并确认 GREEN**

Run:

```powershell
npm run test:web -- apps/web/src/layers/footprintSelectors.test.ts apps/web/src/layers/footprintAggregation.test.ts apps/web/src/components/TimeContextPanel.test.tsx apps/web/src/App.test.tsx apps/web/src/components/MapboxCanvas.test.tsx
```

Expected: 5 test files passed，0 failed。

- [ ] **Step 8: 搜索并清除已废弃小时契约**

Run:

```powershell
rg -n "granularity: 'hour'|unit: 'hour'|query_hourly|calculateHourly|getHourly|按小时汇总" apps
```

Expected: 无输出，exit code 1。

- [ ] **Step 9: 运行前端类型构建与 lint**

Run:

```powershell
npm run lint
npm run build
```

Expected: 两条命令均 exit code 0。

- [ ] **Step 10: 提交前端变更**

```powershell
git add apps/web/src/layers/footprintTypes.ts apps/web/src/layers/footprintSelectors.ts apps/web/src/layers/footprintSelectors.test.ts apps/web/src/layers/footprintAggregation.test.ts apps/web/src/components/TimeContextPanel.tsx apps/web/src/components/TimeContextPanel.test.tsx apps/web/src/App.test.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "feat: 展示单日96个距离柱"
```

### Task 3: 全量验证与浏览器验收

**Files:**
- Verify only: repository test, lint, build, ignored local runtime files

- [ ] **Step 1: 运行仓库完整测试**

Run:

```powershell
npm test
```

Expected: 前端至少 438 项、API 146 项、仓库工具 36 项全部通过，0 failed。

- [ ] **Step 2: 重新运行 lint 与生产构建**

Run:

```powershell
npm run lint
npm run build
```

Expected: 两条命令均 exit code 0。

- [ ] **Step 3: 准备工作树的忽略运行数据**

确认目标都位于当前工作树内，再复制主工作区已有的本地配置与持久数据库：

```powershell
Copy-Item -LiteralPath 'D:\Coding\EnRoute\.env.local' -Destination 'D:\Coding\EnRoute\.worktrees\feat-day-quarter-hour-chart\.env.local'
New-Item -ItemType Directory -Force -Path 'D:\Coding\EnRoute\.worktrees\feat-day-quarter-hour-chart\data'
Copy-Item -LiteralPath 'D:\Coding\EnRoute\data\footprints.sqlite' -Destination 'D:\Coding\EnRoute\.worktrees\feat-day-quarter-hour-chart\data\footprints.sqlite'
```

Expected: `.env.local` 与 `data/` 继续被 `.gitignore` 忽略，主数据库不被修改。

- [ ] **Step 4: 启动当前工作树服务**

Run:

```powershell
python start.py start
```

若默认端口已由主工作区占用，则使用工作树专属端口启动 API 和 Vite，并记录实际 URL。不要停止或覆盖用户已有服务。

- [ ] **Step 5: 浏览器验证桌面视口**

打开实际工作树 URL，选择一个有足迹的历史日期，验证：

- 图表包含 96 个可命中列，顶部显示“按15分钟汇总 · 24小时”。
- 均值标签以 `/15分钟` 结尾，悬停显示 `HH:mm · 距离`。
- 线性/对数切换可用，平均线和柱形不溢出左栏。
- 地图正常渲染，标签、行政区和工具条没有布局回归。
- 控制台无 React、Mapbox 或接口错误。

- [ ] **Step 6: 浏览器验证窄视口**

在约 390 x 844 的窄视口重新验证左栏文字不重叠、96 列不撑宽页面、平均标签不越界，地图与控件保持可用。

- [ ] **Step 7: 检查最终差异和分支状态**

Run:

```powershell
git diff --check
git status --short
git log -3 --oneline --decorate
```

Expected: `git diff --check` 无输出，工作树没有未提交文件；提交历史包含设计、计划、后端与前端四个中文约定式提交。
