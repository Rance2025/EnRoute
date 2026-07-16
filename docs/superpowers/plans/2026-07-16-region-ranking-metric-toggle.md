# 区域排行榜多口径切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在区域排行榜中增加“足迹 / 时间 / 距离”三种即时切换口径，并以显式预计算的每日区域指标支持任意日期范围查询。

**Architecture:** 后端显式构建器按时间顺序把每个“前一点→当前点”区间完整归属给当前点区域，按 Asia/Shanghai 自然日拆分后写入扩展的 `admin_region_daily_stats`；只读摘要接口一次返回三项未排序指标。前端在单次响应上完成过滤、排序、格式化和柱长计算，`App` 只持有会话级口径状态，切换时不重新请求。

**Tech Stack:** Python 3.12、FastAPI、SQLite、pytest、React 19、TypeScript 6、Vitest、Testing Library、Vite、CSS。

---

## 文件与职责

- `apps/api/src/enroute_api/admin_regions/precompute.py`：每日三指标模型、区间跨日拆分、显式构建迁移、只读摘要聚合与响应格式。
- `apps/api/src/enroute_api/admin_regions/precompute_meta.py`：预计算算法签名升级，使旧 schema/旧数据明确失效。
- `scripts/prepare_admin_region_summary.py`：输出构建数量和无法解析行政区的足迹数量。
- `apps/api/tests/test_admin_region_precompute.py`：schema、迁移、区间归属、跨日拆分、查询协议、只读与回滚测试。
- `apps/web/src/layers/adminRegionSummaryDataSource.ts`：`regionMetrics` 响应类型和运行时校验。
- `apps/web/src/layers/adminRegionSummaryDataSource.test.ts`：三指标响应解析与非法值拒绝测试。
- `apps/web/src/layers/adminRegionSummaryCache.test.ts`：缓存 fixture 跟随新协议更新。
- `apps/web/src/components/adminRegionRanking.ts`：纯函数形式的口径取值、过滤、稳定排序、序号、显示值、无障碍值和柱长计算。
- `apps/web/src/components/adminRegionRanking.test.ts`：三口径排序、边界格式、同值排序和零值过滤测试。
- `apps/web/src/components/AdminRegionContextPanel.tsx`：B 方案文字切换控件、当前榜单和动态空状态。
- `apps/web/src/components/AdminRegionContextPanel.test.tsx`：切换按钮、`aria-pressed`、行文案、选择行为和错误状态测试。
- `apps/web/src/App.tsx`：会话级当前口径，以及切换后选中区域保留/清除规则。
- `apps/web/src/App.test.tsx`：默认口径、切换不请求、选择联动和时间/层级刷新测试。
- `apps/web/src/App.css`：右上角轻量文字切换、下划线、焦点态以及现有五行滚动高度保持。
- `README.md`：三指标接口协议、显式构建和写入边界。

## Task 0: 开工前确认隔离、基线和 SQLite 写入范围

**Files:**

- Inspect: `AGENTS.md`
- Inspect: `package.json`
- Inspect: `.gitignore`
- Inspect: `.env.example`
- Inspect: `README.md`
- Inspect: `apps/web/src/config/`
- Inspect: `apps/web/src/components/`
- Inspect: `apps/api/src/enroute_api/`

- [ ] **Step 1: 确认分支、worktree 和用户改动**

Run:

```powershell
git branch --show-current
git status --short --ignored
git worktree list
```

Expected: 当前目录为 `.worktrees/region-ranking-metrics`，分支为 `feat/region-ranking-metrics`，仅有本计划文件等已知改动；不得在 `master` 上实现。

- [ ] **Step 2: 搜索所有潜在 SQLite 危险写入并记录范围**

Run:

```powershell
rg -n "DELETE FROM visual_tiles|DROP TABLE|data/footprints\.sqlite|build_visual_tiles" apps scripts tests README.md
```

Expected: 实现只允许显式 `prepare:admin-region-summary` 事务替换 `admin_region_thumbnail_bases`、`admin_region_thumbnail_region_paths`、`admin_region_daily_stats`；不得新增对 `footprints`、`footprint_spatial`、`visual_tiles`、`admin_region_tiles` 的写入。

- [ ] **Step 3: 保存已获用户认可的基线事实**

Run:

```powershell
npm test
```

Expected: 只复现既有无关失败 `AccountingPage.integration.test.tsx > requests the latest imported month once when the untouched current month is empty`（期望 1 次、实际 0 次）；若出现其他失败，先停止并调查。

## Task 1: 扩展每日统计 schema，并让显式构建原子迁移旧表

**Files:**

- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py:62-137`
- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py:761-840`
- Modify: `apps/api/src/enroute_api/admin_regions/precompute_meta.py:1-30`
- Test: `apps/api/tests/test_admin_region_precompute.py:28-102`
- Test: `apps/api/tests/test_admin_region_precompute.py:800-930`

- [ ] **Step 1: 先写新 schema、旧表迁移和回滚测试**

在 `test_admin_region_precompute.py` 增加/更新断言：

```python
assert table_columns(connection, "admin_region_daily_stats") == [
    "depth",
    "day",
    "region_id",
    "footprint_count",
    "stay_duration_seconds",
    "travel_distance_meters",
]

connection.execute(
    """
    INSERT INTO admin_region_daily_stats (
      depth, day, region_id, footprint_count,
      stay_duration_seconds, travel_distance_meters
    ) VALUES (4, 20260716, '310117', 0, 60, 12.5)
    """,
)
```

再构造只有四列的旧 `admin_region_daily_stats`，调用 `replace_admin_region_summary_precompute` 后验证六列新结构和三项值；传入负时间或负距离记录触发约束失败后，验证旧表、缩略图表和签名均完整回滚。

- [ ] **Step 2: 运行测试确认失败原因是缺列/旧约束**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_region_precompute.py -k "schema or migrate or rollback" -q
```

Expected: FAIL，指出缺少 `stay_duration_seconds` / `travel_distance_meters` 或 `footprint_count > 0` 仍拒绝指标专用行。

- [ ] **Step 3: 扩展数据类和新建表 SQL**

将记录改为：

```python
@dataclass(frozen=True, order=True)
class AdminRegionDailyStat:
    depth: int
    day: int
    region_id: str
    footprint_count: int
    stay_duration_seconds: int
    travel_distance_meters: float
```

新表约束使用：

```sql
CHECK (footprint_count >= 0),
CHECK (stay_duration_seconds >= 0),
CHECK (travel_distance_meters >= 0),
CHECK (
  footprint_count > 0
  OR stay_duration_seconds > 0
  OR travel_distance_meters > 0
)
```

- [ ] **Step 4: 只在显式替换事务中用临时表迁移**

增加私有建表函数，让 `initialize_admin_region_summary_schema` 只负责新数据库的 `CREATE TABLE IF NOT EXISTS`。在 `replace_admin_region_summary_precompute` 的现有事务中：

```python
connection.execute("DROP TABLE IF EXISTS admin_region_daily_stats_next")
create_admin_region_daily_stats_table(
    connection,
    table_name="admin_region_daily_stats_next",
)
connection.executemany(
    """
    INSERT INTO admin_region_daily_stats_next (
      depth, day, region_id, footprint_count,
      stay_duration_seconds, travel_distance_meters
    ) VALUES (?, ?, ?, ?, ?, ?)
    """,
    (
        (
            row.depth,
            row.day,
            row.region_id,
            row.footprint_count,
            row.stay_duration_seconds,
            row.travel_distance_meters,
        )
        for row in daily_stat_rows
    ),
)
connection.execute("DROP TABLE admin_region_daily_stats")
connection.execute(
    "ALTER TABLE admin_region_daily_stats_next RENAME TO admin_region_daily_stats",
)
```

表名只能由内部常量选择，不拼接外部输入。不要在摘要 API 查询路径调用迁移函数。

- [ ] **Step 5: 升级签名并跑聚焦测试**

将：

```python
ADMIN_REGION_SUMMARY_ALGORITHM_SIGNATURE = "admin-region-summary-v4"
```

Run:

```powershell
python -m pytest apps/api/tests/test_admin_region_precompute.py -k "schema or signature or replace or rollback" -q
```

Expected: PASS；旧签名被判定过期，失败替换不留下 `_next` 表且旧摘要仍可读。

- [ ] **Step 6: 提交 schema 与迁移**

```powershell
git add apps/api/src/enroute_api/admin_regions/precompute.py apps/api/src/enroute_api/admin_regions/precompute_meta.py apps/api/tests/test_admin_region_precompute.py
git commit -m "feat: 扩展区域每日统计结构"
```

## Task 2: 按后一点归属并跨上海自然日拆分时间和距离

**Files:**

- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py:3-16`
- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py:386-515`
- Modify: `scripts/prepare_admin_region_summary.py`
- Test: `apps/api/tests/test_admin_region_precompute.py:675-760`
- Test: `apps/api/tests/test_admin_region_precompute.py:1286-1364`
- Test: `tests/test_prepare_admin_region_summary.py:16-60`

- [ ] **Step 1: 扩展测试插入辅助函数**

让测试 fixture 能显式提供区间距离：

```python
def insert_raw_footprint(
    connection: sqlite3.Connection,
    *,
    timestamp_seconds: int,
    region_id: str,
    distance: float = 0.0,
) -> None:
    connection.execute(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed,
          distance, heading, altitude, region_id
        ) VALUES (?, 121.0, 31.0, 1.0, 0.0, ?, 0.0, 0.0, ?)
        """,
        (timestamp_seconds, distance, region_id),
    )
```

- [ ] **Step 2: 写区间所有权与无断档阈值测试**

构造前一点属于 A、后一点属于 B，间隔 48 小时、后一点 `distance=1200.0`。断言：

```python
assert sum(row.stay_duration_seconds for row in b_depth4_rows) == 48 * 60 * 60
assert sum(row.travel_distance_meters for row in b_depth4_rows) == pytest.approx(1200.0)
assert sum(row.stay_duration_seconds for row in a_depth4_rows) == 0
```

同一测试还要在 depth 1..4 验证区间只进入后一点的祖先链；第一点只增加足迹数，不产生时间和距离。

- [ ] **Step 3: 写跨日拆分及浮点余量测试**

构造上海时间 `2026-07-15 23:59:30` 到 `2026-07-16 00:01:00` 的 90 秒、90 米区间，断言前日 30 秒/30 米、后日 60 秒/60 米；再构造跨两个完整自然日的长区间，断言中间日允许 `footprint_count == 0`，并验证：

```python
assert sum(row.stay_duration_seconds for row in interval_rows) == end_ts - start_ts
assert math.fsum(row.travel_distance_meters for row in interval_rows) == pytest.approx(distance)
```

- [ ] **Step 4: 写非法源值和无法解析区域的测试**

分别传入 `distance=-1`、`distance=math.inf`，并直接调用拆分函数传入相同/倒序时间戳，断言 `AdminRegionPrecomputeSourceError`；为无任何 1..4 层祖先链的 `region_id` 插入记录，断言不伪造统计，并在构建结果中报告无法解析的足迹数。国家级足迹缺少中国省/市/区祖先属于正常覆盖范围，不计入无法解析数。

- [ ] **Step 5: 运行测试确认算法尚未实现**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_region_precompute.py -k "daily_stats or interval or midnight or unresolved" -q
```

Expected: FAIL，当前实现只有足迹计数，没有时间/距离及跨日行。

- [ ] **Step 6: 实现可独立测试的跨日拆分函数**

使用时区感知日期，不设置任何最大间隔：

```python
from datetime import datetime, time as datetime_time, timedelta, timezone
from zoneinfo import ZoneInfo

SHANGHAI_TIME_ZONE = ZoneInfo("Asia/Shanghai")

@dataclass(frozen=True)
class AdminRegionIntervalDayShare:
    day: int
    duration_seconds: int
    travel_distance_meters: float

def split_interval_by_shanghai_day(
    start_timestamp: int,
    end_timestamp: int,
    travel_distance_meters: float,
) -> tuple[AdminRegionIntervalDayShare, ...]:
    if end_timestamp <= start_timestamp:
        raise AdminRegionPrecomputeSourceError("footprint timestamps are not strictly increasing")
    if not math.isfinite(travel_distance_meters) or travel_distance_meters < 0:
        raise AdminRegionPrecomputeSourceError("footprint distance must be finite and non-negative")
    total_duration = end_timestamp - start_timestamp
    cursor = start_timestamp
    shares: list[AdminRegionIntervalDayShare] = []
    allocated_distances: list[float] = []
    while cursor < end_timestamp:
        local_cursor = datetime.fromtimestamp(cursor, tz=timezone.utc).astimezone(
            SHANGHAI_TIME_ZONE,
        )
        next_midnight = datetime.combine(
            local_cursor.date() + timedelta(days=1),
            datetime_time.min,
            tzinfo=SHANGHAI_TIME_ZONE,
        )
        chunk_end = min(end_timestamp, int(next_midnight.timestamp()))
        if chunk_end <= cursor:
            raise AdminRegionPrecomputeSourceError("failed to advance Shanghai day split")
        duration = chunk_end - cursor
        if chunk_end == end_timestamp:
            chunk_distance = travel_distance_meters - math.fsum(allocated_distances)
        else:
            chunk_distance = travel_distance_meters * duration / total_duration
            allocated_distances.append(chunk_distance)
        shares.append(
            AdminRegionIntervalDayShare(
                day=encode_day(local_cursor.date()),
                duration_seconds=duration,
                travel_distance_meters=chunk_distance,
            ),
        )
        cursor = chunk_end
    return tuple(shares)
```

实现循环时用 UTC 时间戳计算秒数、上海本地午夜决定边界，并维护 `remaining_distance`，最后一片直接使用余量。禁止加入 `30 分钟` 或其他断档阈值。

- [ ] **Step 7: 在一次有序扫描中聚合三指标**

查询必须包含当前行分段距离：

```sql
SELECT timestamp_seconds, region_id, distance
FROM footprints
WHERE region_id IS NOT NULL
  AND TRIM(region_id) != ''
ORDER BY timestamp_seconds
```

每个点先按自身日期/祖先链增加 `footprint_count`；从第二点开始，把前一时间戳至当前时间戳的全部切片按当前点祖先链累加 `stay_duration_seconds` 和 `travel_distance_meters`。使用三个聚合映射的 key 并集产生记录，保留指标大于零但足迹数为零的每日行。

- [ ] **Step 8: 报告无法解析数并跑测试**

新增明确的每日构建结果，避免 tuple 附带隐式状态：

```python
@dataclass(frozen=True)
class AdminRegionDailyStatBuildResult:
    rows: tuple[AdminRegionDailyStat, ...]
    unresolved_footprint_count: int
```

`build_admin_region_daily_stat_rows` 返回该对象；只有一个点无法解析到任何 1..4 层祖先时才增加 `unresolved_footprint_count`。给最终 `AdminRegionSummaryPrecomputeResult` 增加：

```python
unresolved_footprint_count: int
```

`prepare_admin_region_summary.py` 将它打印为单独字段，不修改事实数据；同时更新 `tests/test_prepare_admin_region_summary.py` 的 `SimpleNamespace` 和输出断言。

Run:

```powershell
python -m pytest apps/api/tests/test_admin_region_precompute.py -k "daily_stats or interval or midnight or unresolved or empty_daily" -q
python -m pytest tests/test_prepare_admin_region_summary.py -q
```

Expected: PASS；48 小时区间完整累计，跨日总秒数和总距离守恒。

- [ ] **Step 9: 提交每日三指标算法**

```powershell
git add apps/api/src/enroute_api/admin_regions/precompute.py scripts/prepare_admin_region_summary.py apps/api/tests/test_admin_region_precompute.py tests/test_prepare_admin_region_summary.py
git commit -m "feat: 预计算区域时间与移动距离"
```

## Task 3: 让只读摘要接口一次返回全部区域指标

**Files:**

- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py:910-1125`
- Verify: `apps/api/src/enroute_api/main.py:164-189`
- Test: `apps/api/tests/test_admin_region_precompute.py:985-1066`

- [ ] **Step 1: 把接口测试改为 `regionMetrics` 协议**

测试数据覆盖“有足迹”“仅有时间/距离”两种区域，期望响应片段：

```python
"regionMetrics": [
    {
        "regionId": "310117",
        "name": "松江区",
        "footprintCount": 0,
        "stayDurationSeconds": 3600,
        "travelDistanceMeters": 1250.5,
        "bounds": {
            "west": 121.0,
            "south": 30.9,
            "east": 121.4,
            "north": 31.3,
        },
    },
]
```

断言 `visitedRegionIds`、`visitedCount`、`visitedPath` 仍只由 `footprint_count > 0` 决定；响应不含 `rankings` 和 `rank`。

- [ ] **Step 2: 写日期范围三字段求和和只读保护测试**

在范围内/外插入每日记录，断言三个字段只求和闭区间内的行。调用摘要 API 前后比较：

```python
protected_before = snapshot_protected_tables(connection)
payload = precompute.query_precomputed_admin_region_summary(
    database,
    depth=4,
    start_day=20260701,
    end_day=20260731,
)
protected_after = snapshot_protected_tables(connection)
assert protected_after == protected_before
```

保护快照至少包含 `footprints`、`footprint_spatial`（若存在）、`visual_tiles`、`admin_region_tiles`。

- [ ] **Step 3: 运行测试确认旧协议失败**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_region_precompute.py -k "query_precomputed_summary or readonly or stale" -q
```

Expected: FAIL，当前响应仍返回单一 `rankings` 且只聚合足迹数。

- [ ] **Step 4: 实现每日三字段聚合与格式化**

用一条分组 SQL 返回：

```sql
SELECT
  region_id,
  SUM(footprint_count),
  SUM(stay_duration_seconds),
  SUM(travel_distance_meters)
FROM admin_region_daily_stats
WHERE depth = ? AND day BETWEEN ? AND ?
GROUP BY region_id
HAVING SUM(footprint_count) > 0
    OR SUM(stay_duration_seconds) > 0
    OR SUM(travel_distance_meters) > 0
ORDER BY region_id
```

格式化函数不产生排序名次：

```python
def format_precomputed_admin_region_metric(
    row: sqlite3.Row,
    *,
    footprint_count: int,
    stay_duration_seconds: int,
    travel_distance_meters: float,
) -> dict[str, object]:
    return {
        "regionId": str(row[0]),
        "name": str(row[1]),
        "footprintCount": footprint_count,
        "stayDurationSeconds": stay_duration_seconds,
        "travelDistanceMeters": travel_distance_meters,
        "bounds": {"west": float(row[2]), "south": float(row[3]), "east": float(row[4]), "north": float(row[5])},
    }
```

元数据查询覆盖三指标 key 的并集；缩略图路径查询仍只接收有足迹的 `visitedRegionIds`。

- [ ] **Step 5: 验证只读 503 行为保持**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_region_precompute.py -k "query_precomputed_summary or readonly or stale or unavailable" -q
python -m pytest apps/api/tests/test_admin_region_summary.py -q
```

Expected: PASS；旧 schema/旧签名为 503 对应的 unavailable，不迁移、不扫描原始足迹兜底。

- [ ] **Step 6: 提交接口协议**

```powershell
git add apps/api/src/enroute_api/admin_regions/precompute.py apps/api/tests/test_admin_region_precompute.py
git commit -m "feat: 返回区域排行三项指标"
```

## Task 4: 更新前端数据源协议与缓存 fixture

**Files:**

- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.ts:4-113`
- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.test.ts`
- Modify: `apps/web/src/layers/adminRegionSummaryCache.test.ts`

- [ ] **Step 1: 先把数据源测试 fixture 改成三指标**

使用：

```ts
regionMetrics: [{
  regionId: '310117',
  name: '松江区',
  footprintCount: 12120,
  stayDurationSeconds: 3182400,
  travelDistanceMeters: 428913.42,
  bounds: { west: 121, south: 30.9, east: 121.4, north: 31.3 },
}]
```

增加非法负时间、非整数时间、负距离、`Infinity` 距离和遗留 `rankings` 协议的拒绝用例。

- [ ] **Step 2: 运行数据源测试确认失败**

Run:

```powershell
npm run test:web -- --run apps/web/src/layers/adminRegionSummaryDataSource.test.ts apps/web/src/layers/adminRegionSummaryCache.test.ts
```

Expected: FAIL，类型/校验器仍要求 `rankings` 和 `rank`。

- [ ] **Step 3: 改为未排序指标类型**

```ts
export type AdminRegionMetric = {
  regionId: string
  name: string
  footprintCount: number
  stayDurationSeconds: number
  travelDistanceMeters: number
  bounds: AdminRegionBounds
}

export type AdminRegionSummary = {
  depth: AdminRegionDepth
  visitedRegionIds: string[]
  visitedCount: number
  totalCount: number
  visitedPath: string
  regionMetrics: AdminRegionMetric[]
}
```

校验 `footprintCount` 和 `stayDurationSeconds` 为非负整数；距离为非负有限数。删除对响应 `rank` 的要求。

- [ ] **Step 4: 跑聚焦测试并提交**

Run:

```powershell
npm run test:web -- --run apps/web/src/layers/adminRegionSummaryDataSource.test.ts apps/web/src/layers/adminRegionSummaryCache.test.ts
```

Expected: PASS。

```powershell
git add apps/web/src/layers/adminRegionSummaryDataSource.ts apps/web/src/layers/adminRegionSummaryDataSource.test.ts apps/web/src/layers/adminRegionSummaryCache.test.ts
git commit -m "feat: 接收区域排行三项指标"
```

## Task 5: 用纯函数生成三种前端排行榜

**Files:**

- Create: `apps/web/src/components/adminRegionRanking.ts`
- Create: `apps/web/src/components/adminRegionRanking.test.ts`

- [ ] **Step 1: 写三口径排序、过滤和稳定同值测试**

覆盖：默认足迹排序；时间/距离排序不同；当前指标为零的区域被过滤；同值时先按中文名称、再按 `regionId`；输出 rank 为 `1..N`；最大值 ratio 为 1、非零最小值不低于 0.02。

- [ ] **Step 2: 写格式边界和完整无障碍值测试**

至少断言：

```ts
expect(formatAdminRegionRankingValue('footprint', 12120)).toBe('12,120')
expect(formatAdminRegionRankingValue('time', 59 * 60)).toBe('59 分钟')
expect(formatAdminRegionRankingValue('time', 90 * 60)).toBe('1.5 小时')
expect(formatAdminRegionRankingValue('time', 36 * 60 * 60)).toBe('1.5 天')
expect(formatAdminRegionRankingValue('distance', 999)).toBe('999 米')
expect(formatAdminRegionRankingValue('distance', 1250)).toBe('1.3 公里')
expect(formatAdminRegionRankingAriaValue('time', 5400)).toBe('累计时间 5,400 秒')
expect(formatAdminRegionRankingAriaValue('distance', 1250)).toBe('移动距离 1,250 米')
```

小于一分钟但大于零的时间显示至少 `1 分钟`，显示舍入不得参与排序或 ratio。

- [ ] **Step 3: 运行新测试确认模块不存在**

Run:

```powershell
npm run test:web -- --run apps/web/src/components/adminRegionRanking.test.ts
```

Expected: FAIL，模块尚未创建。

- [ ] **Step 4: 实现类型与纯函数**

```ts
export type AdminRegionRankingMetric = 'footprint' | 'time' | 'distance'

export type AdminRegionRankingRow = AdminRegionMetric & {
  rank: number
  metricValue: number
  displayValue: string
  ariaValue: string
  ratio: number
}

export function buildAdminRegionRanking(
  metrics: AdminRegionMetric[],
  metric: AdminRegionRankingMetric,
): AdminRegionRankingRow[] {
  const sorted = metrics
    .map((region) => ({ region, value: readMetricValue(region, metric) }))
    .filter(({ value }) => value > 0)
    .sort((left, right) =>
      right.value - left.value
      || left.region.name.localeCompare(right.region.name, 'zh-CN')
      || left.region.regionId.localeCompare(right.region.regionId),
    )
  const maxValue = sorted[0]?.value ?? 0
  return sorted.map(({ region, value }, index) => ({
    ...region,
    rank: index + 1,
    metricValue: value,
    displayValue: formatAdminRegionRankingValue(metric, value),
    ariaValue: formatAdminRegionRankingAriaValue(metric, value),
    ratio: maxValue > 0 ? Math.max(0.02, Math.min(1, value / maxValue)) : 0,
  }))
}
```

使用 `Intl.NumberFormat('zh-CN')`；小时、天、公里使用最多一位小数且不保留无意义 `.0`。

- [ ] **Step 5: 跑测试并提交**

Run:

```powershell
npm run test:web -- --run apps/web/src/components/adminRegionRanking.test.ts
```

Expected: PASS。

```powershell
git add apps/web/src/components/adminRegionRanking.ts apps/web/src/components/adminRegionRanking.test.ts
git commit -m "feat: 生成区域多口径排行榜"
```

## Task 6: 接入 B 方案切换控件和 App 选择联动

**Files:**

- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx:1-182`
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Modify: `apps/web/src/App.tsx:35-50`
- Modify: `apps/web/src/App.tsx:379-490`
- Modify: `apps/web/src/App.tsx:675-760`
- Modify: `apps/web/src/App.tsx:920-960`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.css:2337-2351`
- Modify: `apps/web/src/App.css:2440-2580`

- [ ] **Step 1: 写面板默认状态与切换控件测试**

面板 props 增加：

```ts
metric: AdminRegionRankingMetric
onMetricChange: (metric: AdminRegionRankingMetric) => void
```

断言标题弱提示为“排行依据”，右上角存在 `role="group"`、名称“排行依据”的 `足迹 / 时间 / 距离` 三按钮；当前按钮 `aria-pressed="true"`，点击“时间”调用一次 `onMetricChange('time')`。

- [ ] **Step 2: 写当前榜单、空状态、数值和行无障碍测试**

分别传入三种 metric，断言列表顺序、柱长 style、显示值和行 `aria-label` 改变；空榜文案分别为“本期暂无足迹数据”“本期暂无时间数据”“本期暂无距离数据”；错误状态仍能重试且切换控件保持可见。

- [ ] **Step 3: 写 App 切换不请求与选择保留/清除测试**

用 mock `loadAdminRegionSummary` 记录调用数：

1. 摘要加载一次后点击“时间”，调用数仍为 1。
2. 已选区域在时间榜 `metricValue > 0` 时保持 `selectedAdminRegion` 并不重复 map 聚焦。
3. 已选区域在距离榜为 0 时清除选中。
4. 改时间范围或行政层级仍发起新摘要请求，返回后当前口径保持不变。

- [ ] **Step 4: 运行测试确认 UI 尚未实现**

Run:

```powershell
npm run test:web -- --run apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/App.test.tsx
```

Expected: FAIL，缺少 metric props/控件，App 仍使用后端 `rankings`。

- [ ] **Step 5: 面板使用纯函数结果而非响应顺序**

```tsx
const rankings = buildAdminRegionRanking(summary?.regionMetrics ?? [], metric)

<div className="admin-region-ranking-card__metric-switch" role="group" aria-label="排行依据">
  {METRIC_OPTIONS.map((option) => (
    <button
      key={option.value}
      type="button"
      aria-pressed={metric === option.value}
      onClick={() => onMetricChange(option.value)}
    >
      {option.label}
    </button>
  ))}
</div>
```

`RankingRow` 接收 `AdminRegionRankingRow`，直接使用 `ranking.ratio`、`ranking.displayValue` 和 `ranking.ariaValue`；数值 `<strong title={ranking.ariaValue}>`，行名称为 ``第 ${rank} 名，${name}，${ariaValue}``。

- [ ] **Step 6: App 持有口径并实现选择清理**

```tsx
const [adminRegionRankingMetric, setAdminRegionRankingMetric] =
  useState<AdminRegionRankingMetric>('footprint')

const handleAdminRegionRankingMetricChange = (metric: AdminRegionRankingMetric) => {
  setAdminRegionRankingMetric(metric)
  setSelectedAdminRegion((selected) => {
    if (!selected || !currentAdminRegionSummary) return selected
    const remainsRanked = buildAdminRegionRanking(
      currentAdminRegionSummary.regionMetrics,
      metric,
    ).some((row) => row.regionId === selected.regionId)
    return remainsRanked ? selected : null
  })
}
```

把 `selectedAdminRegion` 类型改为 `AdminRegionMetric | null`；`MapboxCanvas` 现有结构化 prop 只依赖 `regionId` 和 `bounds`，无需修改其公开类型。不要把 metric 加入摘要 cache key、effect dependency 或请求参数。

- [ ] **Step 7: 实现 B 方案 CSS 且保持卡片几何不变**

右侧 header actions 容器同时容纳切换和错误重试。按钮无胶囊背景/边框；选中态使用主题色、较高字重和 `::after` 短下划线；补 `:focus-visible`。不要修改共享左栏选择器、排行榜五行可视高度或地图画布尺寸。

- [ ] **Step 8: 跑前端相关测试**

Run:

```powershell
npm run test:web -- --run apps/web/src/components/adminRegionRanking.test.ts apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/layers/adminRegionSummaryDataSource.test.ts apps/web/src/layers/adminRegionSummaryCache.test.ts apps/web/src/App.test.tsx
```

Expected: PASS；切换测试确认摘要 loader 调用数不增加。

- [ ] **Step 9: 提交 UI 与联动**

```powershell
git add apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/App.css
git commit -m "feat: 切换区域排行榜统计口径"
```

## Task 7: 同步文档并在真实数据副本上完成全量验证

**Files:**

- Modify: `README.md:148-160`
- Verify: all files changed in Tasks 1-6

- [ ] **Step 1: 更新 README 当前事实**

说明：

- `/api/admin-regions/summary` 返回 `regionMetrics`，每项含 `footprintCount`、`stayDurationSeconds`、`travelDistanceMeters`。
- 时间和距离从前一点到当前点的区间归属当前点区域，不做断档检测，并按上海自然日拆分。
- 运行时接口只读；旧 schema/签名返回 503。
- 只有 `npm run prepare:admin-region-summary` 可原子替换三张摘要预计算表，事实层和两类 tile 表不写入。

- [ ] **Step 2: 跑后端和前端聚焦套件**

Run:

```powershell
python -m pytest apps/api/tests/test_admin_region_precompute.py apps/api/tests/test_admin_region_summary.py -q
npm run test:web -- --run apps/web/src/components/adminRegionRanking.test.ts apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/layers/adminRegionSummaryDataSource.test.ts apps/web/src/layers/adminRegionSummaryCache.test.ts apps/web/src/App.test.tsx
```

Expected: PASS。

- [ ] **Step 3: 安全复制真实 SQLite 到 worktree**

不要直接构建根工作区持久数据库。验证目标仍位于 worktree 后复制：

```powershell
$source = (Resolve-Path 'D:\Coding\EnRoute\data\footprints.sqlite').Path
$worktree = (Resolve-Path '.').Path
$dataDir = Join-Path $worktree 'data'
$target = Join-Path $dataDir 'footprints.sqlite'
if (-not $target.StartsWith($worktree, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "SQLite target escaped worktree: $target"
}
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Copy-Item -LiteralPath $source -Destination $target
```

Expected: 副本位于 `.worktrees/region-ranking-metrics/data/footprints.sqlite` 且被 git 忽略。

- [ ] **Step 4: 对副本构建并证明保护表未变化**

先用只读 Python 快照 `footprints`、`footprint_spatial`、`visual_tiles`、`admin_region_tiles` 的 schema、行数以及稳定聚合/哈希；然后执行：

```powershell
npm run prepare:admin-region-summary -- --database data/footprints.sqlite
```

现有脚本已支持 `--database`；不得省略该参数或改用根工作区 DB。构建后重复只读快照并断言完全一致，同时检查：

```sql
SELECT
  COUNT(*),
  SUM(footprint_count),
  SUM(stay_duration_seconds),
  SUM(travel_distance_meters)
FROM admin_region_daily_stats;
```

Expected: 构建成功，三指标均为正；保护表快照前后一致；无任何自动 `visual_tiles` 构建。

- [ ] **Step 5: 执行仓库要求的完整验证**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected:

- `lint` PASS。
- `build` PASS。
- `npm test` 除获用户认可的 accounting 基线用例外无新增失败；若该基线已自然恢复，则要求全绿。

- [ ] **Step 6: 启动并做桌面浏览器验收**

先加载 `playwright` 或 `browser:control-in-app-browser` 技能，按其流程启动/控制浏览器：

```powershell
python start.py start
```

在桌面视口逐项验证：

- 右上角“足迹 / 时间 / 距离”是 B 方案轻量文字控件，选中项有主题色和短下划线，键盘焦点可见。
- 三种排序、单位、柱长、五行固定可视高度和内部滚动正确；切换无网络请求。
- 选择仍在新榜中时地图选中保留，不在时清除；点击任一榜单行仍按 `regionId`/`bounds` 聚焦。
- 时间范围和“国 / 省 / 市 / 区”切换会刷新同一组三指标；缩略图/到访数不随排行口径变化。
- 地图正常渲染，样式、标签/POI、2D、拖拽边界、回正/缩放/定位和右下工具条无回归；控制台无新增运行时错误。

截图只保存到忽略目录 `output/`，不得提交。验收后用 `python start.py stop` 清理进程。

- [ ] **Step 7: 自审完整性与占位符**

Run:

```powershell
git diff --check
rg -n "TODO|TBD|FIXME|placeholder|30\s*分钟|1800" apps/api/src/enroute_api/admin_regions apps/api/tests/test_admin_region_precompute.py apps/web/src README.md
git status --short --ignored
git log --oneline --decorate -8
```

Expected: `git diff --check` 无输出；没有功能占位符或误加断档阈值；仅源码/测试/README 为可提交改动，本地 DB、日志和截图保持 ignored。

- [ ] **Step 8: 提交 README 与必要的验收修正**

```powershell
git add README.md
git commit -m "docs: 更新区域排行三指标说明"
```

若浏览器验收产生代码修正，必须先补对应失败测试、验证通过，再用精确的中文约定式提交单独提交。

## Task 8: 完成前的证据复核

**Files:**

- Verify: repository state and all task outputs

- [ ] **Step 1: 使用完成前验证技能**

加载并遵循 `superpowers:verification-before-completion`，以本次最新命令输出为准，不复用旧日志声称成功。

- [ ] **Step 2: 汇总最终证据**

最终报告必须明确列出：

- 实现后的三种统计口径和区间所有权规则。
- 相关后端/前端聚焦测试结果、lint、build 和浏览器验收结果。
- 完整 `npm test` 是否只有已批准的 accounting 基线失败。
- 真实数据库副本构建结果以及四类保护表前后一致证据。
- 分支、worktree、提交列表和未执行任何远程写操作。

不要合并、push、创建 PR 或删除 worktree；这些操作需要用户后续明确选择。
