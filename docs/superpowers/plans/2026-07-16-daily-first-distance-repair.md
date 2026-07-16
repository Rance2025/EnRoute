# 每日首点距离补全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让增量足迹导入自动补算跨上海自然日的首个零距离点，并在经过备份与副本演练后原地修复现有 SQLite 事实数据和距离摘要。

**Architecture:** 新建无数据库依赖的距离规范化模块，`FootprintStore` 在每次插入或校验之前从 SQLite 查询时间前驱并调用该模块。显式维护命令复用同一规则，在经过 SQLite 在线备份和内容校验后，仅更新 `footprints.distance`，并在同一事务内重建 `admin_regions` 聚合与 `admin_region_daily_stats`；整个流程对 `visual_tiles` 只读并校验内容指纹未变。

**Tech Stack:** Python 3.12、SQLite、FastAPI 后端模块、pytest、unittest、Node/npm 仓库脚本。

---

## 文件职责

- 新建 `apps/api/src/enroute_api/footprints/distance.py`：时间点模型、上海自然日判断、Haversine 距离和每日首点规范化纯函数。
- 修改 `apps/api/src/enroute_api/footprints/store.py`：在 `INSERT OR IGNORE` 与冲突校验前查询数据库时间前驱并规范化新记录；拒绝非递增导入顺序。
- 新建 `apps/api/src/enroute_api/footprints/distance_repair.py`：扫描事实层、更新目标距离、重建依赖摘要、采集受保护表快照。
- 修改 `apps/api/src/enroute_api/admin_regions/precompute.py`：公开一个只替换 `admin_region_daily_stats` 的事务内 helper，不触碰缩略图表或视觉瓦片。
- 新建 `scripts/repair_daily_first_distances.py`：参数解析、SQLite 备份、备份验证、事务执行和结果输出。
- 修改 `package.json`：暴露 `repair:daily-first-distances` 显式维护命令。
- 新建 `apps/api/tests/test_footprint_distance.py`：纯规则测试。
- 修改 `apps/api/tests/test_footprints_api.py`：增量批次边界和冲突校验集成测试。
- 新建 `tests/test_repair_daily_first_distances.py`：备份、原地修复、摘要、幂等和回滚测试。
- 修改 `README.md`：记录 `distance` 的规范化口径和维护命令。

## Task 1：距离规范化纯函数

**Files:**
- Create: `apps/api/src/enroute_api/footprints/distance.py`
- Create: `apps/api/tests/test_footprint_distance.py`

- [ ] **Step 1: 写跨日首点与保留源值的失败测试**

在 `apps/api/tests/test_footprint_distance.py` 写入：

```python
from datetime import datetime, timezone

import pytest

from enroute_api.footprints.distance import (
    FootprintDistancePoint,
    normalize_daily_first_distance,
)


def timestamp(value: str) -> int:
    return int(datetime.fromisoformat(value).astimezone(timezone.utc).timestamp())


def point(*, value: str, longitude: float, latitude: float, distance: float):
    return FootprintDistancePoint(
        timestamp_seconds=timestamp(value),
        longitude=longitude,
        latitude=latitude,
        distance=distance,
    )


def test_normalizes_zero_distance_across_shanghai_days() -> None:
    previous = point(
        value="2026-06-11T23:56:24+08:00",
        longitude=119.414,
        latitude=32.198,
        distance=12,
    )
    current = point(
        value="2026-06-12T00:49:07+08:00",
        longitude=118.7969,
        latitude=32.0603,
        distance=0,
    )

    result = normalize_daily_first_distance(previous=previous, current=current)

    assert result == pytest.approx(69_800, rel=0.02)


@pytest.mark.parametrize(
    ("previous", "current", "expected"),
    [
        (None, point(value="2026-06-12T00:00:00+08:00", longitude=1, latitude=1, distance=0), 0),
        (
            point(value="2026-06-12T00:00:00+08:00", longitude=1, latitude=1, distance=5),
            point(value="2026-06-12T01:00:00+08:00", longitude=2, latitude=2, distance=0),
            0,
        ),
        (
            point(value="2026-06-11T23:59:00+08:00", longitude=1, latitude=1, distance=5),
            point(value="2026-06-12T00:01:00+08:00", longitude=2, latitude=2, distance=123),
            123,
        ),
        (
            point(value="2026-06-11T23:59:00+08:00", longitude=1, latitude=1, distance=5),
            point(value="2026-06-12T00:01:00+08:00", longitude=1, latitude=1, distance=0),
            0,
        ),
    ],
)
def test_preserves_non_candidates(previous, current, expected: float) -> None:
    assert normalize_daily_first_distance(previous=previous, current=current) == expected
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `python -m pytest apps/api/tests/test_footprint_distance.py -q`

Expected: FAIL，提示 `enroute_api.footprints.distance` 不存在。

- [ ] **Step 3: 实现最小距离模块**

在 `apps/api/src/enroute_api/footprints/distance.py` 实现：

```python
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

EARTH_MEAN_RADIUS_METERS = 6_371_008.8
SHANGHAI_TIME_ZONE = ZoneInfo("Asia/Shanghai")


@dataclass(frozen=True)
class FootprintDistancePoint:
    timestamp_seconds: int
    longitude: float
    latitude: float
    distance: float


def normalize_daily_first_distance(
    *,
    previous: FootprintDistancePoint | None,
    current: FootprintDistancePoint,
) -> float:
    validate_point(current)
    if previous is None or current.distance != 0:
        return current.distance
    validate_point(previous)
    if previous.timestamp_seconds >= current.timestamp_seconds:
        raise ValueError("previous footprint timestamp must be earlier than current timestamp")
    if shanghai_date(previous.timestamp_seconds) == shanghai_date(current.timestamp_seconds):
        return current.distance
    return haversine_distance_meters(previous, current)


def shanghai_date(timestamp_seconds: int):
    return datetime.fromtimestamp(
        timestamp_seconds,
        tz=timezone.utc,
    ).astimezone(SHANGHAI_TIME_ZONE).date()


def haversine_distance_meters(
    previous: FootprintDistancePoint,
    current: FootprintDistancePoint,
) -> float:
    previous_latitude = math.radians(previous.latitude)
    current_latitude = math.radians(current.latitude)
    latitude_delta = current_latitude - previous_latitude
    longitude_delta = math.radians(current.longitude - previous.longitude)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(previous_latitude)
        * math.cos(current_latitude)
        * math.sin(longitude_delta / 2) ** 2
    )
    return EARTH_MEAN_RADIUS_METERS * 2 * math.asin(math.sqrt(haversine))


def validate_point(point: FootprintDistancePoint) -> None:
    values = (point.longitude, point.latitude, point.distance)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("footprint coordinates and distance must be finite")
    if not -180 <= point.longitude <= 180 or not -90 <= point.latitude <= 90:
        raise ValueError("footprint coordinates are outside valid bounds")
    if point.distance < 0:
        raise ValueError("footprint distance must be non-negative")
```

- [ ] **Step 4: 增加异常输入和低质量大距离测试**

追加测试，断言负距离、NaN 坐标、倒序时间戳抛出 `ValueError`；构造 `accuracy`/`speed` 不参与函数输入的大距离点，断言仍返回有限正值。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `python -m pytest apps/api/tests/test_footprint_distance.py -q`

Expected: PASS。

- [ ] **Step 6: 提交纯函数**

```powershell
git add apps/api/src/enroute_api/footprints/distance.py apps/api/tests/test_footprint_distance.py
git commit -m "feat: 补算每日首点移动距离"
```

## Task 2：增量导入兼容每日首点

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/store.py:531-676`
- Modify: `apps/api/tests/test_footprints_api.py`

- [ ] **Step 1: 写增量批次边界失败测试**

在 `apps/api/tests/test_footprints_api.py` 使用现有临时 CSV/SQLite helper：先导入 6 月 11 日 23:56 的一条正距离记录，再把 CSV 替换为只含 6 月 12 日 00:49 的零距离记录并再次调用 `store.import_footprints()`。断言：

```python
row = store.connection.execute(
    "SELECT distance FROM footprints WHERE timestamp_seconds = ?",
    (current_timestamp,),
).fetchone()
assert float(row[0]) == pytest.approx(69_800, rel=0.02)
```

同时断言新记录的 `footprint_spatial` 行存在，且没有新增或修改任何 `visual_tiles` 行。

- [ ] **Step 2: 运行单测并确认 RED**

Run: `python -m pytest apps/api/tests/test_footprints_api.py -k "daily_first or incremental" -q`

Expected: FAIL，当前数据库保存 `0.0`。

- [ ] **Step 3: 在 store 中查询前驱并规范化**

在 `store.py` 导入 `FootprintDistancePoint` 和 `normalize_daily_first_distance`，新增：

```python
def normalize_import_point_distance(
    connection: sqlite3.Connection,
    point: dict[str, Any],
) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT timestamp_seconds, longitude, latitude, distance
        FROM footprints
        WHERE timestamp_seconds < ?
        ORDER BY timestamp_seconds DESC
        LIMIT 1
        """,
        (int(point["timestampSeconds"]),),
    ).fetchone()
    previous = None if row is None else FootprintDistancePoint(
        timestamp_seconds=int(row["timestamp_seconds"]),
        longitude=float(row["longitude"]),
        latitude=float(row["latitude"]),
        distance=float(row["distance"]),
    )
    current = FootprintDistancePoint(
        timestamp_seconds=int(point["timestampSeconds"]),
        longitude=float(point["longitude"]),
        latitude=float(point["latitude"]),
        distance=float(point["distance"]),
    )
    normalized_distance = normalize_daily_first_distance(previous=previous, current=current)
    return {**point, "distance": normalized_distance}
```

在 `import_footprints` 的循环中先检查有效 CSV 记录时间戳严格递增，再调用该 helper，把返回记录传给 `insert_footprint_if_new` 和 `mark_affected_visual_tiles_dirty`。只有实际插入新坐标点时才沿用现有 visual tile dirty 规则；既有行校验不写瓦片。

- [ ] **Step 4: 写同源原始 CSV 对已修复行的冲突校验测试**

构造数据库中跨日当前点已保存补算距离、CSV 中同一点仍为 `distance=0` 的场景。调用导入后断言不抛 `Conflicting footprint row`、`new_count == 0` 且数据库距离保持补算值。

- [ ] **Step 5: 写倒序 CSV 事务回滚测试**

CSV 依次提供较晚、较早的两个新时间戳。断言导入抛出 `ValueError("footprint CSV timestamps must be strictly increasing")`，并且两条记录、空间索引、meta 和 visual tile 状态均未提交。

- [ ] **Step 6: 运行增量导入测试并确认 GREEN**

Run: `python -m pytest apps/api/tests/test_footprints_api.py -k "daily_first or incremental or timestamp" -q`

Expected: PASS。

- [ ] **Step 7: 运行全部足迹 API 测试**

Run: `python -m pytest apps/api/tests/test_footprints_api.py -q`

Expected: PASS。

- [ ] **Step 8: 提交导入修复**

```powershell
git add apps/api/src/enroute_api/footprints/store.py apps/api/tests/test_footprints_api.py
git commit -m "fix: 兼容增量导入每日首点距离"
```

## Task 3：事务内事实修复与距离摘要替换

**Files:**
- Create: `apps/api/src/enroute_api/footprints/distance_repair.py`
- Modify: `apps/api/src/enroute_api/admin_regions/precompute.py:573-668,990-1092`
- Create: `tests/test_repair_daily_first_distances.py`

- [ ] **Step 1: 写只更新目标行的失败测试**

在 `tests/test_repair_daily_first_distances.py` 创建含两日记录、同日零值、跨日同坐标、`footprint_spatial`、一个 sentinel `visual_tiles` 行和最小行政区树的临时数据库。调用期望 API：

```python
result = repair_daily_first_distances(connection)

self.assertEqual(result.scanned_count, 5)
self.assertEqual(result.candidate_count, 2)
self.assertEqual(result.updated_count, 1)
self.assertGreater(result.added_distance_meters, 0)
```

断言同日零值、跨日同坐标零值不变，跨日异坐标变为正值，`footprints`、`footprint_spatial`、`visual_tiles` 行数及 sentinel blob 完全不变。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `python -m unittest tests.test_repair_daily_first_distances -v`

Expected: ERROR，`distance_repair` 模块不存在。

- [ ] **Step 3: 实现扫描、快照和目标 UPDATE**

在 `distance_repair.py` 定义：

```python
@dataclass(frozen=True)
class DailyFirstDistanceRepairResult:
    scanned_count: int
    candidate_count: int
    updated_count: int
    added_distance_meters: float


@dataclass(frozen=True)
class ProtectedTableSnapshot:
    footprint_count: int
    spatial_count: int
    visual_tile_count: int
    visual_tile_sha256: str


def repair_daily_first_distances(
    connection: sqlite3.Connection,
) -> DailyFirstDistanceRepairResult:
    rows = connection.execute(
        "SELECT timestamp_seconds, longitude, latitude, distance FROM footprints ORDER BY timestamp_seconds"
    ).fetchall()
    previous = None
    updates = []
    candidate_count = 0
    for row in rows:
        current = FootprintDistancePoint(
            timestamp_seconds=int(row[0]),
            longitude=float(row[1]),
            latitude=float(row[2]),
            distance=float(row[3]),
        )
        normalized = normalize_daily_first_distance(previous=previous, current=current)
        if previous is not None and current.distance == 0 and shanghai_date(
            previous.timestamp_seconds
        ) != shanghai_date(current.timestamp_seconds):
            candidate_count += 1
        if normalized != current.distance:
            updates.append((normalized, current.timestamp_seconds))
        previous = current
    connection.executemany(
        "UPDATE footprints SET distance = ? WHERE timestamp_seconds = ? AND distance = 0",
        updates,
    )
    return DailyFirstDistanceRepairResult(
        scanned_count=len(rows),
        candidate_count=candidate_count,
        updated_count=len(updates),
        added_distance_meters=math.fsum(distance for distance, _timestamp in updates),
    )
```

`snapshot_protected_tables` 按 `z,x,y,t_type,t` 排序，将键、状态、cells、计数和 updated_at 以长度前缀编码送入 SHA-256；不可只比较行数。

- [ ] **Step 4: 为每日摘要增加定向替换 helper**

在 `precompute.py` 新增 `replace_admin_region_daily_stats(connection, build_result)`：验证 rows 非空；只对 `admin_region_daily_stats` 执行 `DELETE` 与 `executemany INSERT`；最后用 `create_admin_region_daily_stats_source_signature` 设置 `DAILY_STATS_SIGNATURE_KEY`。不得调用缩略图构建函数，不得写 `admin_region_thumbnail_bases`、`admin_region_thumbnail_region_paths`、`visual_tiles` 或 `admin_region_tiles`。

- [ ] **Step 5: 将摘要重建纳入 repair 事务**

仅当 `updated_count > 0` 时依次调用：

```python
rebuild_admin_region_stats_from_footprints(connection)
daily_build = build_admin_region_daily_stat_rows(connection)
replace_admin_region_daily_stats(connection, daily_build)
```

在调用前后比较 `ProtectedTableSnapshot`；任何计数或 visual tile SHA-256 变化都抛出 `DailyFirstDistanceRepairError`，让外层事务回滚。

- [ ] **Step 6: 写摘要与幂等测试**

断言 `admin_regions.travel_distance_meters` 和 `admin_region_daily_stats.travel_distance_meters` 增加补入距离；第二次执行返回 `updated_count == 0`，并且事实行、摘要行、签名和受保护表快照均不变。

- [ ] **Step 7: 写摘要失败回滚测试**

使用 `unittest.mock.patch` 让 `replace_admin_region_daily_stats` 抛异常，在 `with connection:` 调用修复；断言事务退出后目标 `distance` 仍为零，所有摘要及受保护表与调用前一致。

- [ ] **Step 8: 运行维护核心测试并确认 GREEN**

Run: `python -m unittest tests.test_repair_daily_first_distances -v`

Expected: PASS。

- [ ] **Step 9: 提交维护核心**

```powershell
git add apps/api/src/enroute_api/footprints/distance_repair.py apps/api/src/enroute_api/admin_regions/precompute.py tests/test_repair_daily_first_distances.py
git commit -m "feat: 原地修复每日首点事实距离"
```

## Task 4：带验证备份的显式维护命令

**Files:**
- Create: `scripts/repair_daily_first_distances.py`
- Modify: `tests/test_repair_daily_first_distances.py`
- Modify: `package.json`

- [ ] **Step 1: 写 CLI 备份先于写入的失败测试**

在 repo 测试中调用 `main(["--database", db, "--backup", backup])`。断言 backup 存在、`PRAGMA integrity_check` 为 `ok`、backup 保留修复前的零距离、原库包含修复后的正距离，并且 stdout 含 backup 路径、扫描数、候选数、更新数和补入总距离。

- [ ] **Step 2: 写备份失败不写原库的测试**

把 `--backup` 指向已存在文件，断言命令失败且原库所有表逐行不变。再 patch 备份验证返回失败，断言同样不打开写事务。

- [ ] **Step 3: 运行 CLI 测试并确认 RED**

Run: `python -m unittest tests.test_repair_daily_first_distances -v`

Expected: FAIL，脚本不存在或 `main` 未定义。

- [ ] **Step 4: 实现 CLI**

脚本流程必须是：

```python
source = sqlite3.connect(database)
backup_connection = sqlite3.connect(backup)
source.backup(backup_connection)
backup_connection.close()
source.close()
verify_database_backup(database, backup)

connection = sqlite3.connect(database)
connection.row_factory = sqlite3.Row
try:
    with connection:
        before = snapshot_protected_tables(connection)
        result = repair_daily_first_distances(connection)
        after = snapshot_protected_tables(connection)
        if before != after:
            raise DailyFirstDistanceRepairError("protected footprint tables changed")
finally:
    connection.close()
```

默认 backup 名称为 `data/footprints.sqlite.backup-before-daily-first-distance-YYYYMMDD-HHMMSS`。若数据库或必需表不存在、backup 已存在、`integrity_check` 失败或四张关键表计数不一致，必须在任何事实写入前失败。

- [ ] **Step 5: 增加 package 命令**

在 `package.json` scripts 增加：

```json
"repair:daily-first-distances": "python scripts/repair_daily_first_distances.py"
```

- [ ] **Step 6: 运行 CLI 和 package 元数据测试**

Run: `python -m unittest tests.test_repair_daily_first_distances tests.test_api_project_metadata -v`

Expected: PASS。

- [ ] **Step 7: 提交显式命令**

```powershell
git add scripts/repair_daily_first_distances.py tests/test_repair_daily_first_distances.py package.json
git commit -m "chore: 增加足迹距离安全修复命令"
```

## Task 5：文档与代码级完整验证

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-16-daily-first-distance-repair.md`

- [ ] **Step 1: 更新 README**

在足迹数据说明中明确：`distance` 是上一有效足迹到当前足迹的米制距离；导入器只在外部 App 把上海自然日首点写成零时用 WGS-84 Haversine 补算；原始 CSV 不修改；维护命令必须先备份。记录：

```powershell
npm run repair:daily-first-distances -- --database data/footprints.sqlite
```

并说明该命令不写 `footprint_spatial` 或 `visual_tiles`。

- [ ] **Step 2: 检查 SQLite 危险写入边界**

Run: `rg -n "DELETE FROM visual_tiles|DROP TABLE|data/footprints.sqlite|build_visual_tiles" apps scripts tests README.md`

Expected: 新代码不存在 `DELETE FROM visual_tiles`、`DROP TABLE footprints` 或 `build_visual_tiles` 调用；唯一新增的无范围删除只针对显式维护事务中的 `admin_region_daily_stats`。

- [ ] **Step 3: 运行针对性测试**

```powershell
python -m pytest apps/api/tests/test_footprint_distance.py apps/api/tests/test_footprints_api.py -q
python -m unittest tests.test_repair_daily_first_distances -v
```

Expected: PASS。

- [ ] **Step 4: 运行 API 和仓库测试**

```powershell
npm run test:api
npm run test:repo
```

Expected: API 297 项加新增项全部通过；repo 39 项加新增项全部通过。

- [ ] **Step 5: 运行 lint 与 build**

```powershell
npm run lint
npm run build
```

Expected: PASS。

- [ ] **Step 6: 运行全量 npm test 并记录已知基线失败**

Run: `npm test`

Expected: 本次新增和后端测试全部通过；若仍只有 `AccountingPage.integration.test.tsx` 的“空当前月自动请求最近导入月”失败，记录为已知基线，不修改记账代码。

- [ ] **Step 7: 提交 README**

```powershell
git add README.md docs/superpowers/plans/2026-07-16-daily-first-distance-repair.md
git commit -m "docs: 说明每日首点距离修复口径"
```

## Task 6：真实数据库副本演练

**Files:**
- Read only source: `D:/Coding/EnRoute/data/footprints.sqlite`
- Local ignored rehearsal: `output/daily-first-distance-rehearsal/footprints.sqlite`

- [ ] **Step 1: 确认磁盘空间和服务状态**

Run: `Get-PSDrive -Name D; python start.py status`

Expected: D 盘可用空间至少 4 GiB；API 与 web 均未运行。若服务运行，执行 `python start.py stop` 并再次确认。

- [ ] **Step 2: 创建真实库演练副本**

使用 SQLite backup API 从根数据库复制到 worktree 的 ignored `output/daily-first-distance-rehearsal/footprints.sqlite`，然后只读运行 `PRAGMA integrity_check` 并核对：

```text
footprints=40441
footprint_spatial=40441
visual_tiles=63221
admin_region_daily_stats=1050
```

- [ ] **Step 3: 在副本执行带备份修复**

```powershell
npm run repair:daily-first-distances -- --database output/daily-first-distance-rehearsal/footprints.sqlite
```

Expected: `scanned=40441`、`candidates=133`、`updated=125`、补入距离约 `178043.732` 米，且命令打印已验证 backup 路径。

- [ ] **Step 4: 只读核对副本结果**

核对 `PRAGMA integrity_check=ok`；三张事实/视觉表行数不变；`visual_tiles` SHA-256 与修复前一致；零距离记录剩余 9 条（全局首条加 8 条同坐标每日首点）；南京时间戳 `1781206147` 的距离约 69,839.799 米；区域日摘要签名存在且距离总和包含补入距离。

- [ ] **Step 5: 幂等复跑副本**

再次运行命令并指定新的 backup 路径。

Expected: `updated=0`、补入距离为零、所有数据与摘要指纹不变。

## Task 7：本地集成与根数据库安全修复

**Files:**
- Local branch/worktree only; no remote writes.
- Runtime data: `D:/Coding/EnRoute/data/footprints.sqlite`
- Backup: `D:/Coding/EnRoute/data/footprints.sqlite.backup-before-daily-first-distance-<timestamp>`

- [ ] **Step 1: 使用 finishing-a-development-branch 检查并本地合并**

确认分支 clean、提交完整、针对性测试/API/repo/lint/build 结果可追溯；在根目录 `master` 执行非快进本地合并，提交信息：

```text
merge: 合并每日首点距离修复
```

不执行 push、PR 或任何远程写入。

- [ ] **Step 2: 根目录再次确认服务已停和数据库未漂移**

Run: `python start.py status`

只读核对当前仍为 40,441/40,441/63,221/1,050 行、134 条零距离、候选 133 条；若与副本演练输入不一致则停止，不写库。

- [ ] **Step 3: 执行根库修复命令**

```powershell
npm run repair:daily-first-distances -- --database data/footprints.sqlite
```

必须先看到备份创建和验证成功，之后才允许事务 UPDATE。Expected: 与副本演练相同的 125 条更新和约 178,043.732 米增量。

- [ ] **Step 4: 验证备份和修复后原库**

备份：`integrity_check=ok`、134 条零距离、南京记录仍为 0、四表行数与修复前一致。

原库：`integrity_check=ok`、9 条零距离、南京记录约 69,839.799 米、事实与空间索引 40,441 行、visual tiles 63,221 行且 SHA-256 与备份一致、区域摘要可由只读 API 查询且签名有效。

- [ ] **Step 5: 启动并做只读运行时冒烟验证**

启动后请求全时段 metrics 与区域 summary，确认距离总量增加、API 无签名 stale 错误、地图足迹读取正常。随后按用户原有服务状态决定保持运行或停止；不执行视觉瓦片构建。

- [ ] **Step 6: 清理 worktree**

确认根 `master` 包含全部提交且数据备份路径已记录，再删除 `fix/daily-first-distance` worktree 和已合并本地分支。保留数据库备份，不删除。
