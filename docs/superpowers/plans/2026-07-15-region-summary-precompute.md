# 区域缩略图与摘要预计算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让世界/中国缩略图静态底图立即显示，并把四层动态到访摘要改为持久预计算后的快速并行读取，同时修复隐藏足迹点在图层重建后回显的问题。

**Architecture:** 在现有 `data/footprints.sqlite` 中新增三张独立预计算表，由显式维护命令原子构建；普通 API 只通过只读连接读取最终 SVG path 和每日统计，不解码 MVT、不做几何 union、不递归扫描原始足迹。前端把静态底图与动态摘要拆成两个数据源，并用有界会话缓存并行预取四个层级。

**Tech Stack:** Python 3.12、FastAPI、SQLite、Shapely、React 19、TypeScript 6、Vitest、pytest、Mapbox GL JS

---

### Task 1: 建立预计算 schema、签名与只读就绪校验

**Files:**
- Create: `apps/api/src/enroute_api/admin_regions/precompute.py`
- Create: `apps/api/tests/test_admin_region_precompute.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`

- [ ] **Step 1: 写 schema 与约束失败测试**

在新测试中对临时 SQLite 调用 `initialize_admin_region_summary_schema(connection)`，断言三张表均为 `WITHOUT ROWID`，主键分别为 `scope`、`(depth, region_id)`、`(depth, day, region_id)`，并验证非法 scope、depth 和非正 `footprint_count` 被拒绝。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `python -m pytest apps/api/tests/test_admin_region_precompute.py -k schema -q`

Expected: FAIL，模块或初始化函数尚不存在。

- [ ] **Step 3: 写最小 schema 实现**

在 `precompute.py` 中定义三个就绪键和初始化函数：

```python
THUMBNAIL_BASE_SIGNATURE_KEY = "adminRegionThumbnailBasePrecomputeSignature"
THUMBNAIL_PATH_SIGNATURE_KEY = "adminRegionThumbnailPathPrecomputeSignature"
DAILY_STATS_SIGNATURE_KEY = "adminRegionDailyStatsPrecomputeSignature"

def initialize_admin_region_summary_schema(connection: sqlite3.Connection) -> None:
    connection.executescript("""
    CREATE TABLE IF NOT EXISTS admin_region_thumbnail_bases (
      scope TEXT PRIMARY KEY,
      view_box TEXT NOT NULL,
      path TEXT NOT NULL,
      source_depth INTEGER NOT NULL,
      source_z INTEGER NOT NULL,
      source_x INTEGER NOT NULL,
      source_y INTEGER NOT NULL,
      source_signature TEXT NOT NULL,
      algorithm_signature TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (scope IN ('world', 'china'))
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS admin_region_thumbnail_region_paths (
      depth INTEGER NOT NULL,
      region_id TEXT NOT NULL,
      path TEXT NOT NULL,
      source_signature TEXT NOT NULL,
      algorithm_signature TEXT NOT NULL,
      PRIMARY KEY (depth, region_id),
      CHECK (depth BETWEEN 1 AND 4)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS admin_region_daily_stats (
      depth INTEGER NOT NULL,
      day INTEGER NOT NULL,
      region_id TEXT NOT NULL,
      footprint_count INTEGER NOT NULL,
      PRIMARY KEY (depth, day, region_id),
      CHECK (depth BETWEEN 1 AND 4),
      CHECK (footprint_count > 0)
    ) WITHOUT ROWID;
    """)
```

只新增表，不删除或重建任何既有表；把初始化挂到现有 `initialize_schema()`。

- [ ] **Step 4: 写签名来源与失效失败测试**

构造四行必需行政区瓦片，锁定底图签名只覆盖国家 Z0 和省级 Z1，逐区域 path 签名覆盖深度 1-4 的指定源瓦片；签名必须包含算法版本、瓦片坐标、瓦片算法签名、更新时间和 BLOB 字节数。再断言缺行或源行变化后就绪校验失败。

- [ ] **Step 5: 实现确定性签名与只读就绪校验并跑 GREEN**

Run: `python -m pytest apps/api/tests/test_admin_region_precompute.py -k "schema or signature" -q`

Expected: PASS。

- [ ] **Step 6: 提交 Task 1**

```powershell
git add apps/api/src/enroute_api/admin_regions/precompute.py apps/api/src/enroute_api/footprints/store.py apps/api/tests/test_admin_region_precompute.py
git commit -m "feat: 建立区域摘要预计算表"
```

### Task 2: 原子构建静态底图、逐区域 path 与每日四层统计

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py`
- Modify: `apps/api/src/enroute_api/admin_regions/thumbnail.py`
- Modify: `apps/api/tests/test_admin_region_precompute.py`
- Create: `scripts/prepare_admin_region_summary.py`
- Create: `tests/test_prepare_admin_region_summary.py`
- Modify: `package.json`

- [ ] **Step 1: 写 Z0/Z1 来源、裁切和逐区域 path 失败测试**

使用现有 MVT fixture 构造世界 Z0、深度 2-4 的中国 Z1；断言 `world` 来源为 `(1,0,0,0)`，`china` 来源为 `(2,1,1,0)`，中国底图及动态 path 完整保留海南与台湾、裁掉 `17.5°N` 以南远端组件，并为每个 feature 的稳定 `region_id` 单独保存最终 path。

- [ ] **Step 2: 运行几何构建测试并确认 RED**

Run: `python -m pytest apps/api/tests/test_admin_region_precompute.py -k "base_paths or region_paths or china_clip" -q`

Expected: FAIL，构建函数尚不存在。

- [ ] **Step 3: 提取并实现离线 path 构建**

复用 `thumbnail.py` 已有瓦片解码、坐标还原、投影、修复和 path 量化 helper；新增离线构建入口，使底图与每个行政区都在同一 `320 x 180` 坐标系产出最终字符串。中国裁切边界仅用于缩略图 path，不修改 tile、region ID 或统计范围。

- [ ] **Step 4: 写上海时区每日聚合失败测试**

插入跨上海午夜的足迹和四层祖先树，期望输出形如：

```python
assert daily_rows == [
    (1, 20260715, "CN", 2),
    (2, 20260715, "310000", 2),
    (3, 20260715, "310100", 2),
    (4, 20260715, "310101", 2),
]
```

同时覆盖缺 `region_id`、重复祖先路径和多个日期。

- [ ] **Step 5: 实现一次读取与内存聚合**

构建器一次读取 `footprints(timestamp_seconds, region_id)`、`admin_region_tree` 与 `admin_regions(id, level)`，在内存中解析每个 region 的深度祖先并按 `(depth, YYYYMMDD, region_id)` 累计；禁止在足迹循环中逐行查询 SQLite。

- [ ] **Step 6: 写原子替换和保护既有瓦片失败测试**

构建前后比较 `visual_tiles` 与 `admin_region_tiles` 的行数、哈希摘要和元数据；在写入第二张新表时故意抛错，断言事务回滚后旧的三张预计算表和三个就绪签名完全保留。

- [ ] **Step 7: 实现单事务替换**

仅允许：

```sql
DELETE FROM admin_region_thumbnail_bases;
DELETE FROM admin_region_thumbnail_region_paths;
DELETE FROM admin_region_daily_stats;
```

随后批量插入新结果并在同一事务最后写三个就绪签名。不得调用 `build_visual_tiles`、`build_admin_region_tiles`、`clear_admin_region_tiles`，不得写 `visual_tiles` 或 `admin_region_tiles`。

- [ ] **Step 8: 增加显式 CLI 与仓库脚本测试**

`scripts/prepare_admin_region_summary.py` 接受 `--database`，默认 `data/footprints.sqlite`；`package.json` 增加：

```json
"prepare:admin-region-summary": "python scripts/prepare_admin_region_summary.py"
```

Run: `python -m pytest apps/api/tests/test_admin_region_precompute.py tests/test_prepare_admin_region_summary.py -q`

Expected: PASS。

- [ ] **Step 9: 提交 Task 2**

```powershell
git add apps/api/src/enroute_api/admin_regions/precompute.py apps/api/src/enroute_api/admin_regions/thumbnail.py apps/api/tests/test_admin_region_precompute.py scripts/prepare_admin_region_summary.py tests/test_prepare_admin_region_summary.py package.json
git commit -m "feat: 预绘制区域缩略图与每日摘要"
```

### Task 3: 用只读快路径替换请求期递归与几何计算

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Modify: `apps/api/tests/test_admin_region_summary.py`
- Modify: `apps/api/tests/test_footprints_api.py`

- [ ] **Step 1: 写静态底图接口与 503 失败测试**

锁定 `GET /api/admin-regions/thumbnail-bases` 的 `viewBox/signature/bases.world.path/bases.china.path` 响应；缺表、空表、缺签名、过期签名分别返回 HTTP 503 和稳定错误码 `admin_region_thumbnail_precompute_unavailable`。

- [ ] **Step 2: 写动态摘要快路径失败测试**

预置每日统计和逐区域 path，断言日期范围求和、稳定排行、空范围、南极排除与 `visitedPath` 按 `region_id` 排序拼接。给旧 `query_admin_region_statistics()`、MVT 解码和缩略图 union 打上“调用即失败”的补丁，证明请求期不触碰慢路径。

- [ ] **Step 3: 运行接口测试并确认 RED**

Run: `python -m pytest apps/api/tests/test_admin_region_summary.py apps/api/tests/test_footprints_api.py -k "precomputed or thumbnail_bases or unavailable" -q`

Expected: FAIL，接口仍返回内嵌 thumbnail 并读取原始足迹。

- [ ] **Step 4: 实现只读查询与独立连接**

新增以下两个公开函数；内部统一使用 `open_readonly_connection(db_path)`，该 helper 用 `Path.resolve().as_posix()` 生成 `file:` URI，并设置 `row_factory = sqlite3.Row`：

```python
def read_admin_region_thumbnail_bases(db_path: Path) -> dict[str, object]:
    with open_readonly_connection(db_path) as connection:
        require_current_precompute_signature(connection, THUMBNAIL_BASE_SIGNATURE_KEY)
        rows = connection.execute(
            "SELECT scope, view_box, path FROM admin_region_thumbnail_bases ORDER BY scope",
        ).fetchall()
        if {str(row["scope"]) for row in rows} != {"world", "china"}:
            raise AdminRegionPrecomputeUnavailable("thumbnail bases are incomplete")
        return format_thumbnail_bases(rows)

def query_precomputed_admin_region_summary(
    db_path: Path, *, depth: int, start_day: int, end_day: int
) -> dict[str, object]:
    with open_readonly_connection(db_path) as connection:
        require_current_precompute_signature(connection, THUMBNAIL_PATH_SIGNATURE_KEY)
        require_current_precompute_signature(connection, DAILY_STATS_SIGNATURE_KEY)
        return query_summary_rows(
            connection,
            depth=depth,
            start_day=start_day,
            end_day=end_day,
        )
```

两者使用 `sqlite3.connect(f"file:{quoted_path}?mode=ro", uri=True)`；摘要 SQL 只访问三张新表、`footprint_meta` 和 `admin_regions` 的 `id/name/level/bounds`，不经过 `FootprintStore.connection` 的全局锁。

- [ ] **Step 5: 更新 FastAPI 路由与错误映射**

保留现有日期/depth 的 400 语义；预计算不可用统一映射为 503。动态摘要移除 `thumbnail.basePath`，新增顶层 `visitedPath`；静态底图改走独立路由。

- [ ] **Step 6: 跑 GREEN 并测量 SQL**

Run: `python -m pytest apps/api/tests/test_admin_region_summary.py apps/api/tests/test_footprints_api.py -q`

Expected: PASS；真实数据库单层摘要读取目标 `< 5 ms`，四层并行 API 目标 `< 100 ms`。

- [ ] **Step 7: 提交 Task 3**

```powershell
git add apps/api/src/enroute_api/admin_regions/precompute.py apps/api/src/enroute_api/footprints/store.py apps/api/src/enroute_api/main.py apps/api/tests/test_admin_region_summary.py apps/api/tests/test_footprints_api.py
git commit -m "feat: 区域摘要切换为只读预计算快路径"
```

### Task 4: 前端拆分静态底图并并行缓存四层摘要

**Files:**
- Create: `apps/web/src/layers/adminRegionThumbnailBaseDataSource.ts`
- Create: `apps/web/src/layers/adminRegionThumbnailBaseDataSource.test.ts`
- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.ts`
- Modify: `apps/web/src/layers/adminRegionSummaryDataSource.test.ts`
- Create: `apps/web/src/layers/adminRegionSummaryCache.ts`
- Create: `apps/web/src/layers/adminRegionSummaryCache.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`

- [ ] **Step 1: 写静态底图独立渲染失败测试**

让底图 Promise 先完成、四个摘要 Promise 保持 pending，断言区域卡已经用 `world` 或 `china` path 渲染；摘要失败、重试和时间变化不能清空已完成底图。

- [ ] **Step 2: 写四层预取与缓存失败测试**

同一时间范围应立即发出 depth `1,2,3,4` 四个请求；相同 key 去重，层级切换命中缓存不增加请求；缓存仅保留最近 8 个时间范围，失败不缓存，AbortError 不显示错误，旧范围响应不能覆盖新范围。

- [ ] **Step 3: 运行前端聚焦测试并确认 RED**

Run: `npm run test:web -- --run apps/web/src/layers/adminRegionSummaryCache.test.ts apps/web/src/App.test.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx`

Expected: FAIL，当前 App 仅请求所选层级且底图嵌在摘要中。

- [ ] **Step 4: 实现两个数据源与有界缓存**

静态底图数据源在模块级去重一次会话请求；摘要缓存 key 为 `${start}:${end}:${depth}`，维护 completed、inflight 与按时间范围的 LRU。公开 API：

```ts
loadAdminRegionThumbnailBases(options): Promise<AdminRegionThumbnailBases>
prefetchAdminRegionSummaries(options): PromiseSettledResult<AdminRegionSummary>[]
getCachedAdminRegionSummary(timeRange, depth): AdminRegionSummary | null
retryAdminRegionSummary(options): Promise<AdminRegionSummary>
```

- [ ] **Step 5: 原子接入 App 与右栏**

`AdminRegionContextPanel` 分别接收 `thumbnailBasePath` 和完整动态 summary；SVG base path 永远来自静态底图状态，visited path、计数、排行和主地图 `visitedRegionIds` 只从同一个当前 key summary 读取。未就绪时主地图过滤传空数组，禁止闪现全部行政区。

- [ ] **Step 6: 跑 GREEN**

Run: `npm run test:web -- --run apps/web/src/layers/adminRegionThumbnailBaseDataSource.test.ts apps/web/src/layers/adminRegionSummaryDataSource.test.ts apps/web/src/layers/adminRegionSummaryCache.test.ts apps/web/src/App.test.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交 Task 4**

```powershell
git add apps/web/src/layers/adminRegionThumbnailBaseDataSource.ts apps/web/src/layers/adminRegionThumbnailBaseDataSource.test.ts apps/web/src/layers/adminRegionSummaryDataSource.ts apps/web/src/layers/adminRegionSummaryDataSource.test.ts apps/web/src/layers/adminRegionSummaryCache.ts apps/web/src/layers/adminRegionSummaryCache.test.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx
git commit -m "feat: 并行预取四层区域摘要"
```

### Task 5: 修复隐藏足迹点在图层重建后回显

**Files:**
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`

- [ ] **Step 1: 写图层重建失败测试**

以 `footprintsVisible={false}` 渲染，触发时间范围变化导致 `footprints-circle` 删除重建，再连续切换行政区深度和触发 style reload；每次新建 layer 的 `layout.visibility` 都必须是 `none`。切回足迹页并传 `true` 后必须为 `visible`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm run test:web -- --run apps/web/src/components/MapboxCanvas.test.tsx -t "keeps rebuilt footprint layer hidden"`

Expected: FAIL，新建 layer 未携带隐藏状态。

- [ ] **Step 3: 用 ref 保证创建时可见性正确**

维护 `footprintsVisibleRef.current = footprintsVisible`，并在 `refreshFootprintLayer()` 的 `addLayer` 定义中加入：

```ts
layout: {
  visibility: footprintsVisibleRef.current ? 'visible' : 'none',
},
```

保留现有 effect 处理普通 prop 变化和样式重载。

- [ ] **Step 4: 跑 GREEN 并提交**

Run: `npm run test:web -- --run apps/web/src/components/MapboxCanvas.test.tsx`

```powershell
git add apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "fix: 保持区域页足迹图层隐藏状态"
```

### Task 6: 显式构建本地预计算、性能与浏览器验收

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-region-summary-precompute-design.md` only if implementation evidence changes a documented fact

- [ ] **Step 1: 更新当前事实文档**

README 增加 `npm run prepare:admin-region-summary`，说明它是显式维护命令；普通 API 只读预计算，缺失或过期返回 503，不会重建或退回慢路径。

- [ ] **Step 2: 对 worktree 数据库执行显式构建并核对保护边界**

先记录 `visual_tiles` 与 `admin_region_tiles` 的 count/hash/signature，再运行：

```powershell
npm run prepare:admin-region-summary
```

随后确认三张新表有完整数据、三个就绪签名存在，且既有两张瓦片表的 count/hash/signature 完全不变。

- [ ] **Step 3: 启动前后端并采样性能**

使用 `python start.py restart`，采样静态底图首次请求、四层并发摘要与缓存层级切换。目标：底图 `< 50 ms`、单层 SQL `< 5 ms`、四层端到端 `< 100 ms`；记录观察值，不把墙钟阈值写进易抖动单测。

- [ ] **Step 4: 浏览器验收桌面和移动端**

用 Playwright 在 `1440 x 900` 与 `390 x 844` 检查：底图先显示；中国保留大陆、海南、台湾并裁掉南海远端组件；国省市区切换命中缓存；主地图不闪全量行政区；足迹关闭时不回显；排行榜最多五行且可滚动；控制台无 Mapbox 错误。

- [ ] **Step 5: 完整验证**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: 全部退出码为 0；仅包含本计划范围内的提交和文档改动。

- [ ] **Step 6: 最终代码审查与分支收尾**

逐条对照设计的 11 个目标，审查请求期 SQL 表访问、SQLite 写入范围和前端原子状态更新。随后使用 `superpowers:requesting-code-review` 与 `superpowers:finishing-a-development-branch`，按用户选择完成本地合并或保留分支；不执行远程写入。
