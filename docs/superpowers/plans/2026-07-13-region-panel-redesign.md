# 区域页右侧栏重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将地图“区域”分区的右栏替换为随时间与行政层级联动的轻量足迹版图和足迹点排行榜，并把区域显示选项移入地图设置与底部配置弹层。

**Architecture:** 后端增加只读区域摘要查询，以一次集合聚合返回到访区域、排行、聚焦边界和两个紧凑 SVG path；主地图仍使用现有行政区 MVT。前端用独立数据源与区域右栏组件消费摘要，`App` 只保留跨设置、右栏和地图共享的状态，`MapboxCanvas` 负责可见区域过滤、足迹点可见性、业务边界可见性和排行选中聚焦。

**Tech Stack:** Python 3.12、FastAPI、SQLite recursive CTE、Shapely、React 19、TypeScript、Mapbox GL JS、Vitest、Testing Library、pytest。

---

## 文件结构

- Create `apps/api/src/enroute_api/admin_regions/summary.py`：只读时间聚合、层级祖先归并、排行与总数查询。
- Create `apps/api/src/enroute_api/admin_regions/thumbnail.py`：固定世界/中国画幅投影、量化与 SVG path 生成。
- Create `apps/api/tests/test_admin_region_summary.py`：摘要查询、API 契约、时间范围、缩略图和只读性测试。
- Modify `apps/api/src/enroute_api/footprints/store.py`：公开 `get_admin_region_summary`，复用现有时间规范化逻辑。
- Modify `apps/api/src/enroute_api/main.py`：注册 `/api/admin-regions/summary`。
- Create `apps/web/src/layers/adminRegionSummaryDataSource.ts`：摘要类型、URL 构造、响应校验与可取消请求。
- Create `apps/web/src/layers/adminRegionSummaryDataSource.test.ts`：数据源契约测试。
- Modify `apps/web/src/navigationPreferences.ts`：三个区域显示偏好。
- Modify `apps/web/src/navigationPreferences.test.ts`：默认值、持久化与存储失败测试。
- Modify `apps/web/src/layers/adminRegionVectorTileSource.ts`：排行选择填充层和精确区域过滤。
- Modify `apps/web/src/layers/adminRegionVectorTileSource.test.ts`：选择层过滤与样式测试。
- Modify `apps/web/src/components/MapboxCanvas.tsx`：外部可见区域 ID、足迹点、业务边界线、排行聚焦和选择填充。
- Modify `apps/web/src/components/MapboxCanvas.test.tsx`：图层联动、样式重载和 `fitBounds` 测试。
- Modify `apps/web/src/components/MapControls.tsx`：底图边界改名并增加业务区域边界线开关。
- Modify `apps/web/src/components/mapShellLayout.test.tsx`：底部配置、地图设置和 App 到地图的状态传递测试。
- Create `apps/web/src/components/AdminRegionContextPanel.tsx`：两张区域卡、摘要生命周期、重试和排行选择。
- Create `apps/web/src/components/AdminRegionContextPanel.test.tsx`：动态单位、固定五行、滚动、空数据、失败和请求取消测试。
- Modify `apps/web/src/App.tsx`：区域右栏替换、设置状态、摘要与主地图联动。
- Modify `apps/web/src/App.test.tsx`：区域右栏不影响其他分区和全局壳层的结构测试。
- Modify `apps/web/src/App.css`：足迹版图、排行卡、固定尺寸、滚动和小视口样式。
- Modify `README.md`：记录只读区域摘要端点和运行时不写瓦片的约束。

### Task 1: 实现只读区域层级聚合

**Files:**
- Create: `apps/api/src/enroute_api/admin_regions/summary.py`
- Create: `apps/api/tests/test_admin_region_summary.py`

- [ ] **Step 1: 写层级祖先、时间范围和稳定排行的失败测试**

在 `apps/api/tests/test_admin_region_summary.py` 创建内存数据库夹具，初始化足迹与行政区表，写入国家、省、市、区县链以及跨两个日期的足迹：

```python
from __future__ import annotations

import json
import sqlite3

from enroute_api.admin_regions.summary import query_admin_region_statistics
from enroute_api.footprints.store import initialize_schema


def seed_summary_fixture(connection: sqlite3.Connection) -> None:
    regions = [
        ("CN", "中国", 1, None, 73.0, 18.0, 135.0, 54.0),
        ("310000", "上海市", 2, "CN", 120.8, 30.6, 122.2, 31.9),
        ("330000", "浙江省", 2, "CN", 118.0, 27.0, 123.0, 31.5),
        ("310100", "上海市", 3, "310000", 120.8, 30.6, 122.2, 31.9),
        ("330100", "杭州市", 3, "330000", 118.3, 29.1, 120.8, 30.6),
        ("310115", "浦东新区", 4, "310100", 121.4, 30.8, 122.0, 31.4),
        ("330106", "西湖区", 4, "330100", 120.0, 30.1, 120.2, 30.4),
    ]
    geometry = json.dumps({
        "type": "Polygon",
        "coordinates": [[[120, 30], [122, 30], [122, 32], [120, 32], [120, 30]]],
    })
    for region_id, name, level, parent_id, west, south, east, north in regions:
        connection.execute(
            """
            INSERT INTO admin_regions (
              id, name, level, geometry, min_lng, min_lat, max_lng, max_lat
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (region_id, name, level, geometry, west, south, east, north),
        )
        if parent_id:
            connection.execute(
                "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
                (parent_id, region_id),
            )
    footprints = [
        (1781539200, "310115"),
        (1781539260, "310115"),
        (1781539320, "330106"),
        (1781625600, "330106"),
    ]
    connection.executemany(
        """
        INSERT INTO footprints (
          timestamp_seconds, longitude, latitude, accuracy, speed, distance,
          heading, altitude, region_id
        ) VALUES (?, 121, 31, 5, 0, 0, 0, 0, ?)
        """,
        footprints,
    )
    connection.commit()


def create_summary_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    seed_summary_fixture(connection)
    return connection


def test_query_admin_region_statistics_rolls_descendants_up_to_requested_depth():
    connection = create_summary_connection()

    result = query_admin_region_statistics(
        connection,
        depth=3,
        start_timestamp_seconds=1781539200,
        end_timestamp_seconds=1781625599,
    )

    assert result["totalCount"] == 2
    assert result["visitedRegionIds"] == ["310100", "330100"]
    assert result["rankings"] == [
        {
            "rank": 1,
            "regionId": "310100",
            "name": "上海市",
            "footprintCount": 2,
            "bounds": {"west": 120.8, "south": 30.6, "east": 122.2, "north": 31.9},
        },
        {
            "rank": 2,
            "regionId": "330100",
            "name": "杭州市",
            "footprintCount": 1,
            "bounds": {"west": 118.3, "south": 29.1, "east": 120.8, "north": 30.6},
        },
    ]


def test_query_admin_region_statistics_changes_with_time_and_depth():
    connection = create_summary_connection()

    result = query_admin_region_statistics(
        connection,
        depth=4,
        start_timestamp_seconds=1781625600,
        end_timestamp_seconds=1781711999,
    )

    assert result["totalCount"] == 2
    assert result["visitedRegionIds"] == ["330106"]
    assert result["rankings"][0]["name"] == "西湖区"
    assert result["rankings"][0]["footprintCount"] == 1
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `python -m pytest apps/api/tests/test_admin_region_summary.py -v`

Expected: FAIL，错误为 `ModuleNotFoundError: enroute_api.admin_regions.summary`。

- [ ] **Step 3: 用单次 recursive CTE 实现最小聚合**

在 `apps/api/src/enroute_api/admin_regions/summary.py` 实现：

```python
from __future__ import annotations

import sqlite3
from typing import Any


def query_admin_region_statistics(
    connection: sqlite3.Connection,
    *,
    depth: int,
    start_timestamp_seconds: int,
    end_timestamp_seconds: int,
) -> dict[str, Any]:
    if depth not in {1, 2, 3, 4}:
        raise ValueError("depth must be one of 1, 2, 3, or 4")

    country_scope_filter = ""
    if depth == 1:
        country_scope_filter = """
          AND lower(r.name) != 'antarctica'
          AND lower(r.id) NOT IN ('aq', 'ata', '010', 'country:aq', 'country:ata')
          AND lower(r.id) NOT LIKE '%:aq'
          AND lower(r.id) NOT LIKE '%:ata'
        """

    ranking_rows = connection.execute(
        f"""
        WITH RECURSIVE ancestry(footprint_rowid, region_id) AS (
          SELECT rowid, region_id
          FROM footprints
          WHERE timestamp_seconds BETWEEN :start AND :end
            AND region_id IS NOT NULL
            AND region_id != ''
          UNION ALL
          SELECT ancestry.footprint_rowid, tree.parent_id
          FROM ancestry
          JOIN admin_region_tree AS tree ON tree.child_id = ancestry.region_id
        )
        SELECT
          r.id,
          r.name,
          r.min_lng,
          r.min_lat,
          r.max_lng,
          r.max_lat,
          COUNT(ancestry.footprint_rowid) AS footprint_count
        FROM admin_regions AS r
        JOIN ancestry ON ancestry.region_id = r.id
        WHERE r.level = :depth
        {country_scope_filter}
        GROUP BY r.id, r.name, r.min_lng, r.min_lat, r.max_lng, r.max_lat
        HAVING COUNT(ancestry.footprint_rowid) > 0
        ORDER BY footprint_count DESC, r.name ASC, r.id ASC
        """,
        {
            "depth": depth,
            "start": start_timestamp_seconds,
            "end": end_timestamp_seconds,
        },
    ).fetchall()
    total_count = int(connection.execute(
        f"""
        SELECT COUNT(*)
        FROM admin_regions AS r
        WHERE r.level = :depth
        {country_scope_filter}
        """,
        {"depth": depth},
    ).fetchone()[0])
    rankings = [
        {
            "rank": index + 1,
            "regionId": str(row["id"]),
            "name": str(row["name"]),
            "footprintCount": int(row["footprint_count"]),
            "bounds": {
                "west": float(row["min_lng"]),
                "south": float(row["min_lat"]),
                "east": float(row["max_lng"]),
                "north": float(row["max_lat"]),
            },
        }
        for index, row in enumerate(ranking_rows)
    ]
    return {
        "depth": depth,
        "visitedRegionIds": sorted(row["regionId"] for row in rankings),
        "visitedCount": len(rankings),
        "totalCount": total_count,
        "rankings": rankings,
    }
```

- [ ] **Step 4: 运行聚合测试并确认通过**

Run: `python -m pytest apps/api/tests/test_admin_region_summary.py -v`

Expected: 2 tests PASS。

- [ ] **Step 5: 提交聚合查询**

```powershell
git add apps/api/src/enroute_api/admin_regions/summary.py apps/api/tests/test_admin_region_summary.py
git commit -m "feat: 增加行政区足迹排行聚合"
```

### Task 2: 生成轻量缩略图并开放摘要 API

**Files:**
- Create: `apps/api/src/enroute_api/admin_regions/thumbnail.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Modify: `apps/api/tests/test_admin_region_summary.py`

- [ ] **Step 1: 写 SVG path、API 校验和只读性的失败测试**

追加以下测试，并定义完整的临时客户端夹具。客户端先用只有表头的 CSV 完成正常数据库初始化，再写入 Task 1 的区域与足迹夹具，避免绕过 `FootprintStore.ensure_ready()`：

```python
from fastapi.testclient import TestClient

from enroute_api.admin_regions.thumbnail import create_admin_region_thumbnail
from enroute_api.config import Settings
from enroute_api.main import create_app


def create_test_client_with_summary_fixture(tmp_path):
    data_path = tmp_path / "footprints.csv"
    data_path.write_text(
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,"
        "isBackForeground,stepType,altitude\n",
        encoding="utf-8",
    )
    db_path = tmp_path / "footprints.sqlite"
    client = TestClient(create_app(settings=Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )))
    assert client.get("/api/footprints").status_code == 200
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        seed_summary_fixture(connection)
    return client, db_path


def test_create_admin_region_thumbnail_uses_world_and_china_frames_without_lines():
    connection = create_summary_connection()

    world = create_admin_region_thumbnail(connection, depth=1, visited_region_ids={"CN"})
    china = create_admin_region_thumbnail(connection, depth=3, visited_region_ids={"310100"})

    assert world["viewBox"] == "0 0 320 150"
    assert china["viewBox"] == "0 0 320 150"
    assert world["basePath"].startswith("M")
    assert world["visitedPath"].startswith("M")
    assert china["basePath"].startswith("M")
    assert "stroke" not in json.dumps(china)


def test_admin_region_summary_api_returns_compact_thumbnail_and_rankings(tmp_path):
    client, db_path = create_test_client_with_summary_fixture(tmp_path)

    response = client.get(
        "/api/admin-regions/summary",
        params={"depth": 3, "start": "2026-06-16", "end": "2026-06-16"},
    )

    assert response.status_code == 200
    assert response.json()["visitedCount"] == 2
    assert response.json()["totalCount"] == 2
    assert response.json()["thumbnail"]["viewBox"] == "0 0 320 150"
    assert response.json()["rankings"][0]["name"] == "上海市"

    with sqlite3.connect(db_path) as connection:
        before = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("footprints", "visual_tiles", "admin_region_tiles")
        }
    client.get(
        "/api/admin-regions/summary",
        params={"depth": 4, "start": "2026-06-16", "end": "2026-06-17"},
    )
    with sqlite3.connect(db_path) as connection:
        after = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("footprints", "visual_tiles", "admin_region_tiles")
        }
    assert after == before


def test_admin_region_summary_api_rejects_unknown_depth(tmp_path):
    client, _ = create_test_client_with_summary_fixture(tmp_path)

    response = client.get("/api/admin-regions/summary?depth=5")

    assert response.status_code == 400
    assert response.json() == {"detail": "depth must be one of 1, 2, 3, or 4"}


def test_admin_region_summary_api_returns_gray_base_for_empty_range(tmp_path):
    client, _ = create_test_client_with_summary_fixture(tmp_path)

    response = client.get(
        "/api/admin-regions/summary",
        params={"depth": 3, "start": "2030-01-01", "end": "2030-01-01"},
    )

    assert response.status_code == 200
    assert response.json()["visitedCount"] == 0
    assert response.json()["rankings"] == []
    assert response.json()["thumbnail"]["basePath"].startswith("M")
    assert response.json()["thumbnail"]["visitedPath"] == ""
```

- [ ] **Step 2: 运行测试并确认缺少缩略图与路由**

Run: `python -m pytest apps/api/tests/test_admin_region_summary.py -v`

Expected: FAIL，缺少 `thumbnail` 模块且 `/api/admin-regions/summary` 返回 404。

- [ ] **Step 3: 实现固定画幅的两条 SVG path**

在 `apps/api/src/enroute_api/admin_regions/thumbnail.py` 使用 Shapely 简化投影后的多边形，并把全部区域与到访区域分别拼成一个 path：

```python
from __future__ import annotations

import json
import sqlite3
from functools import lru_cache
from typing import Iterable

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, shape
from shapely.ops import transform

VIEWBOX_WIDTH = 320.0
VIEWBOX_HEIGHT = 150.0
WORLD_BOUNDS = (-180.0, -58.0, 180.0, 85.0)
CHINA_BOUNDS = (73.0, 17.0, 136.0, 55.0)


def create_admin_region_thumbnail(
    connection: sqlite3.Connection,
    *,
    depth: int,
    visited_region_ids: set[str],
) -> dict[str, str]:
    country_filter = "" if depth != 1 else """
      AND lower(name) != 'antarctica'
      AND lower(id) NOT IN ('aq', 'ata', '010', 'country:aq', 'country:ata')
      AND lower(id) NOT LIKE '%:aq'
      AND lower(id) NOT LIKE '%:ata'
    """
    rows = connection.execute(
        f"""
        SELECT id, geometry
        FROM admin_regions
        WHERE level = ?
        {country_filter}
        ORDER BY id
        """,
        (depth,),
    ).fetchall()
    paths = [
        (str(row["id"]), project_geometry_path(str(row["geometry"]), depth))
        for row in rows
    ]
    return {
        "viewBox": "0 0 320 150",
        "basePath": "".join(path for _, path in paths),
        "visitedPath": "".join(
            path for region_id, path in paths if region_id in visited_region_ids
        ),
    }


@lru_cache(maxsize=8192)
def project_geometry_path(geometry_json: str, depth: int) -> str:
    west, south, east, north = WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS
    geometry = shape(json.loads(geometry_json))

    def project(x, y, z=None):
        projected_x = (x - west) / (east - west) * VIEWBOX_WIDTH
        projected_y = (north - y) / (north - south) * VIEWBOX_HEIGHT
        return (projected_x, projected_y) if z is None else (projected_x, projected_y, z)

    return geometry_to_svg_path(transform(project, geometry).simplify(0.6, preserve_topology=True))


def geometry_to_svg_path(geometry) -> str:
    polygons: Iterable[Polygon]
    if isinstance(geometry, Polygon):
        polygons = [geometry]
    elif isinstance(geometry, MultiPolygon):
        polygons = geometry.geoms
    elif isinstance(geometry, GeometryCollection):
        polygons = [item for item in geometry.geoms if isinstance(item, Polygon)]
    else:
        return ""
    return "".join(polygon_to_svg_path(polygon) for polygon in polygons)


def polygon_to_svg_path(polygon: Polygon) -> str:
    return ring_to_svg_path(polygon.exterior.coords) + "".join(
        ring_to_svg_path(interior.coords) for interior in polygon.interiors
    )


def ring_to_svg_path(coordinates) -> str:
    points = list(coordinates)
    if not points:
        return ""
    head = f"M{points[0][0]:.1f} {points[0][1]:.1f}"
    tail = "".join(f"L{x:.1f} {y:.1f}" for x, y in points[1:])
    return f"{head}{tail}Z"
```

- [ ] **Step 4: 接入 FootprintStore 和 FastAPI 路由**

在 `FootprintStore` 增加只读方法，调用现有 `normalize_metrics_input` 后合并 Task 1 的统计和缩略图：

```python
def get_admin_region_summary(
    self,
    *,
    depth: int,
    range_value: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, object]:
    with self._connection_lock:
        self.ensure_ready()
        normalized = normalize_metrics_input(
            self.connection,
            range_value=range_value,
            start_date=start_date,
            end_date=end_date,
        )
        time_range = normalized["timeRange"]
        summary = query_admin_region_statistics(
            self.connection,
            depth=depth,
            start_timestamp_seconds=int(time_range["startTimestampSeconds"]),
            end_timestamp_seconds=int(time_range["endTimestampSeconds"]),
        )
        return {
            **summary,
            "thumbnail": create_admin_region_thumbnail(
                self.connection,
                depth=depth,
                visited_region_ids=set(summary["visitedRegionIds"]),
            ),
        }
```

在 `main.py` 注册：

```python
@app.get("/api/admin-regions/summary")
def get_admin_region_summary(
    depth: int,
    range: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> dict[str, object]:
    if depth not in {1, 2, 3, 4}:
        raise HTTPException(status_code=400, detail="depth must be one of 1, 2, 3, or 4")
    try:
        return store.get_admin_region_summary(
            depth=depth,
            range_value=range,
            start_date=start,
            end_date=end,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
```

- [ ] **Step 5: 运行后端摘要测试和完整 API 测试**

Run: `python -m pytest apps/api/tests/test_admin_region_summary.py apps/api/tests/test_footprints_api.py -v`

Expected: 全部 PASS，且无 SQLite lock 或写入计数变化。

- [ ] **Step 6: 提交摘要 API**

```powershell
git add apps/api/src/enroute_api/admin_regions/thumbnail.py apps/api/src/enroute_api/footprints/store.py apps/api/src/enroute_api/main.py apps/api/tests/test_admin_region_summary.py
git commit -m "feat: 提供区域足迹摘要接口"
```

### Task 3: 增加前端区域摘要数据源

**Files:**
- Create: `apps/web/src/layers/adminRegionSummaryDataSource.ts`
- Create: `apps/web/src/layers/adminRegionSummaryDataSource.test.ts`

- [ ] **Step 1: 写 URL、响应校验和取消请求的失败测试**

```typescript
import { describe, expect, it, vi } from 'vitest'

import { loadAdminRegionSummary } from './adminRegionSummaryDataSource'

describe('adminRegionSummaryDataSource', () => {
  it('requests the selected depth and date range', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      depth: 3,
      visitedRegionIds: ['310100'],
      visitedCount: 1,
      totalCount: 333,
      thumbnail: { viewBox: '0 0 320 150', basePath: 'M0 0Z', visitedPath: 'M1 1Z' },
      rankings: [{
        rank: 1,
        regionId: '310100',
        name: '上海市',
        footprintCount: 8,
        bounds: { west: 120.8, south: 30.6, east: 122.2, north: 31.9 },
      }],
    })))
    const signal = new AbortController().signal

    const result = await loadAdminRegionSummary({
      baseUrl: '/api/admin-regions/summary',
      depth: 3,
      timeRange: {
        mode: 'custom', start: '2026-01-01', end: '2026-07-13',
        anchorDate: '2026-07-13',
      },
      signal,
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin-regions/summary?depth=3&start=2026-01-01&end=2026-07-13',
      { signal },
    )
    expect(result.rankings[0].regionId).toBe('310100')
  })

  it('rejects malformed summaries', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ rankings: 'broken' })))

    await expect(loadAdminRegionSummary({
      baseUrl: '/api/admin-regions/summary',
      depth: 1,
      timeRange: { mode: 'day', start: '2026-07-13', end: '2026-07-13', anchorDate: '2026-07-13' },
      signal: new AbortController().signal,
      fetcher,
    })).rejects.toThrow('Invalid admin-region summary response')
  })
})
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `npx vitest run apps/web/src/layers/adminRegionSummaryDataSource.test.ts --maxWorkers=1`

Expected: FAIL，无法导入 `adminRegionSummaryDataSource`。

- [ ] **Step 3: 实现类型、URL 和结构化校验**

创建导出的 `AdminRegionSummary`、`AdminRegionRanking`、`AdminRegionBounds` 类型：

```typescript
export type AdminRegionBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type AdminRegionRanking = {
  rank: number
  regionId: string
  name: string
  footprintCount: number
  bounds: AdminRegionBounds
}

export type AdminRegionSummary = {
  depth: AdminRegionDepth
  visitedRegionIds: string[]
  visitedCount: number
  totalCount: number
  thumbnail: { viewBox: string; basePath: string; visitedPath: string }
  rankings: AdminRegionRanking[]
}
```

实现请求函数：

```typescript
import type { TimeRangeSelection } from '../time/timeRange'
import type { AdminRegionDepth } from './adminRegionVectorTileSource'

export async function loadAdminRegionSummary({
  baseUrl = '/api/admin-regions/summary',
  depth,
  timeRange,
  signal,
  fetcher = fetch,
}: {
  baseUrl?: string
  depth: AdminRegionDepth
  timeRange: TimeRangeSelection
  signal: AbortSignal
  fetcher?: typeof fetch
}): Promise<AdminRegionSummary> {
  const params = new URLSearchParams({
    depth: String(depth),
    start: timeRange.start,
    end: timeRange.end,
  })
  const response = await fetcher(`${baseUrl}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`Admin-region summary request failed: ${response.status}`)
  const payload: unknown = await response.json()
  if (!isAdminRegionSummary(payload)) {
    throw new Error('Invalid admin-region summary response')
  }
  return payload
}
```

使用以下校验器逐项检查响应，不能只做类型断言：

```typescript
function isAdminRegionSummary(value: unknown): value is AdminRegionSummary {
  if (!isRecord(value)) return false
  return isAdminRegionDepth(value.depth) &&
    Array.isArray(value.visitedRegionIds) &&
    value.visitedRegionIds.every((item) => typeof item === 'string') &&
    isNonNegativeInteger(value.visitedCount) &&
    isNonNegativeInteger(value.totalCount) &&
    isThumbnail(value.thumbnail) &&
    Array.isArray(value.rankings) &&
    value.rankings.every(isRanking)
}

function isThumbnail(value: unknown) {
  return isRecord(value) &&
    typeof value.viewBox === 'string' &&
    typeof value.basePath === 'string' &&
    typeof value.visitedPath === 'string'
}

function isRanking(value: unknown): value is AdminRegionRanking {
  return isRecord(value) &&
    isNonNegativeInteger(value.rank) && value.rank > 0 &&
    typeof value.regionId === 'string' &&
    typeof value.name === 'string' &&
    isNonNegativeInteger(value.footprintCount) &&
    isBounds(value.bounds)
}

function isBounds(value: unknown) {
  return isRecord(value) &&
    ['west', 'south', 'east', 'north'].every((key) => (
      typeof value[key] === 'number' && Number.isFinite(value[key])
    ))
}

function isAdminRegionDepth(value: unknown): value is AdminRegionDepth {
  return value === 1 || value === 2 || value === 3 || value === 4
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
```

- [ ] **Step 4: 运行数据源测试**

Run: `npx vitest run apps/web/src/layers/adminRegionSummaryDataSource.test.ts --maxWorkers=1`

Expected: 2 tests PASS。

- [ ] **Step 5: 提交数据源**

```powershell
git add apps/web/src/layers/adminRegionSummaryDataSource.ts apps/web/src/layers/adminRegionSummaryDataSource.test.ts
git commit -m "feat: 增加区域摘要前端数据源"
```

### Task 4: 增加并持久化区域显示偏好

**Files:**
- Modify: `apps/web/src/navigationPreferences.ts`
- Modify: `apps/web/src/navigationPreferences.test.ts`

- [ ] **Step 1: 写三个偏好的失败测试**

```typescript
it('uses the required defaults for region display preferences', () => {
  expect(readShowAllAdminRegions(createStorage())).toBe(false)
  expect(readShowFootprintsInRegionMode(createStorage())).toBe(false)
  expect(readAdminRegionLinesVisible(createStorage())).toBe(true)
})

it('persists region display preferences independently', () => {
  const storage = createStorage()

  writeShowAllAdminRegions(true, storage)
  writeShowFootprintsInRegionMode(true, storage)
  writeAdminRegionLinesVisible(false, storage)

  expect(storage.setItem).toHaveBeenCalledWith(SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY, 'true')
  expect(storage.setItem).toHaveBeenCalledWith(SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY, 'true')
  expect(storage.setItem).toHaveBeenCalledWith(ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY, 'false')
})
```

- [ ] **Step 2: 运行测试并确认导出缺失**

Run: `npx vitest run apps/web/src/navigationPreferences.test.ts --maxWorkers=1`

Expected: FAIL，缺少偏好 key 与读写函数。

- [ ] **Step 3: 用正向命名实现默认值**

在 `navigationPreferences.ts` 增加：

```typescript
export const SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY = 'enroute:show-all-admin-regions'
export const SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY = 'enroute:show-footprints-in-region-mode'
export const ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY = 'enroute:admin-region-lines-visible'

export function readShowAllAdminRegions(storage = getBrowserStorage()) {
  return readHiddenByDefaultPreference(SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY, storage)
}

export function writeShowAllAdminRegions(value: boolean, storage = getBrowserStorage()) {
  writeBooleanPreference(SHOW_ALL_ADMIN_REGIONS_STORAGE_KEY, value, storage)
}

export function readShowFootprintsInRegionMode(storage = getBrowserStorage()) {
  return readHiddenByDefaultPreference(SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY, storage)
}

export function writeShowFootprintsInRegionMode(value: boolean, storage = getBrowserStorage()) {
  writeBooleanPreference(SHOW_FOOTPRINTS_IN_REGION_MODE_STORAGE_KEY, value, storage)
}

export function readAdminRegionLinesVisible(storage = getBrowserStorage()) {
  return readVisibleByDefaultPreference(ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY, storage)
}

export function writeAdminRegionLinesVisible(value: boolean, storage = getBrowserStorage()) {
  writeBooleanPreference(ADMIN_REGION_LINES_VISIBLE_STORAGE_KEY, value, storage)
}

function readHiddenByDefaultPreference(
  key: string,
  storage: Pick<Storage, 'getItem'> | undefined,
) {
  try {
    return storage?.getItem(key) === 'true'
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 运行偏好测试**

Run: `npx vitest run apps/web/src/navigationPreferences.test.ts --maxWorkers=1`

Expected: 全部 PASS。

- [ ] **Step 5: 提交偏好**

```powershell
git add apps/web/src/navigationPreferences.ts apps/web/src/navigationPreferences.test.ts
git commit -m "feat: 保存区域页显示偏好"
```

### Task 5: 让 Mapbox 接受外部摘要并支持排行聚焦

**Files:**
- Modify: `apps/web/src/layers/adminRegionVectorTileSource.ts`
- Modify: `apps/web/src/layers/adminRegionVectorTileSource.test.ts`
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`

- [ ] **Step 1: 写选择填充层的失败测试**

```typescript
it('creates a dedicated selected-region fill layer', () => {
  const layer = createAdminRegionSelectionFillLayer('310100')

  expect(layer.id).toBe('admin-regions-selection-fill')
  expect(layer.type).toBe('fill')
  expect(layer.filter).toEqual([
    'all',
    ['==', ['get', 'kind'], 'fill'],
    ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    ['==', ['get', 'region_id'], '310100'],
  ])
  expect(layer.paint).toMatchObject({ 'fill-opacity': 0.36 })
})
```

- [ ] **Step 2: 运行图层测试并确认选择层缺失**

Run: `npx vitest run apps/web/src/layers/adminRegionVectorTileSource.test.ts --maxWorkers=1`

Expected: FAIL，缺少 `createAdminRegionSelectionFillLayer`。

- [ ] **Step 3: 添加选择层常量、过滤器和图层工厂**

```typescript
export const ADMIN_REGION_SELECTION_FILL_LAYER_ID = 'admin-regions-selection-fill'

export function createAdminRegionSelectionFillFilter(regionId?: string): AdminRegionLayerFilter {
  return [
    'all',
    ['==', ['get', 'kind'], 'fill'],
    ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    regionId
      ? ['==', ['get', 'region_id'], regionId]
      : ['==', ['get', 'region_id'], ''],
  ]
}

export function createAdminRegionSelectionFillLayer(regionId?: string): LayerSpecification {
  return {
    id: ADMIN_REGION_SELECTION_FILL_LAYER_ID,
    type: 'fill',
    source: ADMIN_REGION_VECTOR_SOURCE_ID,
    'source-layer': ADMIN_REGION_VECTOR_SOURCE_LAYER,
    slot: 'top',
    filter: createAdminRegionSelectionFillFilter(regionId),
    paint: {
      'fill-color': '#0b4f47',
      'fill-opacity': 0.36,
      'fill-antialias': false,
    },
  }
}
```

- [ ] **Step 4: 写 Mapbox 可见性、过滤和聚焦的失败测试**

在 `MapboxCanvas.test.tsx` 增加：

```typescript
it('uses externally supplied region ids and keeps the selection visible without lines', async () => {
  const { rerender } = render(
    <MapboxCanvas
      adminRegionUnlockEnabled
      adminRegionDepth={3}
      adminRegionVisibleIds={['310100']}
      adminRegionLinesVisible={false}
      footprintsVisible={false}
      selectedAdminRegion={{
        regionId: '310100',
        bounds: { west: 120.8, south: 30.6, east: 122.2, north: 31.9 },
      }}
    />,
  )
  act(() => mapRecords[0].emit('load'))

  expect(mapRecords[0].setFilterCalls).toContainEqual([
    'admin-regions-fill',
    createAdminRegionFillFilter(['310100']),
  ])
  expect(mapRecords[0].setLayoutPropertyCalls).toContainEqual([
    'admin-regions-line', 'visibility', 'none',
  ])
  expect(mapRecords[0].setLayoutPropertyCalls).toContainEqual([
    'footprints-circle', 'visibility', 'none',
  ])
  expect(mapRecords[0].fitBoundsCalls).toContainEqual([
    [[120.8, 30.6], [122.2, 31.9]],
    expect.objectContaining({ padding: expect.any(Number) }),
  ])
  expect(getMockLayerVisibility(mapRecords[0], 'admin-regions-selection-fill')).toBe('visible')

  rerender(<MapboxCanvas adminRegionUnlockEnabled adminRegionVisibleIds={null} />)
  expect(mapRecords[0].setFilterCalls).toContainEqual([
    'admin-regions-fill', createAdminRegionFillFilter(),
  ])

  mapRecords[0].setLayoutPropertyCalls = []
  act(() => mapRecords[0].emit('style.load'))
  expect(mapRecords[0].setLayoutPropertyCalls).toContainEqual([
    'admin-regions-line', 'visibility', 'visible',
  ])
  expect(mapRecords[0].setLayoutPropertyCalls).toContainEqual([
    'footprints-circle', 'visibility', 'visible',
  ])
})
```

同时把 mock record 增加 `setLayoutPropertyCalls`，在 mock `setLayoutProperty` 中记录调用。

- [ ] **Step 5: 运行 Mapbox 测试并确认新 props 与行为缺失**

Run: `npx vitest run apps/web/src/components/MapboxCanvas.test.tsx --maxWorkers=1`

Expected: FAIL，缺少新 props、选择层和可见性调用。

- [ ] **Step 6: 改为由 App 提供区域过滤并应用图层状态**

对 `MapboxCanvasProps` 增加：

```typescript
adminRegionVisibleIds?: string[] | null
adminRegionLinesVisible?: boolean
footprintsVisible?: boolean
selectedAdminRegion?: {
  regionId: string
  bounds: { west: number; south: number; east: number; north: number }
} | null
```

`adminRegionVisibleIds` 的默认值保持 `undefined`，其余默认值分别为 `true`、`true`、`null`。`undefined` 暂时保留现有 `adminRegionActiveOnly` 兼容路径，使本任务提交后旧调用者与旧测试仍保持绿色；当 App 在 Task 8 始终传入数组或 `null` 时，画布不得发起 `/api/admin-regions/active` 请求。现有兼容端点和旧 prop 可以保留，但区域页主路径只使用外部摘要 ID。

添加选择层时顺序固定为 fill、line、selection fill；移除时按相反顺序。用三个 effect 分别执行：

```typescript
if (adminRegionVisibleIds !== undefined) {
  applyAdminRegionLayerFilters(adminRegionVisibleIds)
}

map.setLayoutProperty(
  ADMIN_REGION_LINE_LAYER_ID,
  'visibility',
  adminRegionLinesVisible ? 'visible' : 'none',
)

map.setLayoutProperty(
  FOOTPRINT_CIRCLE_LAYER_ID,
  'visibility',
  footprintsVisible ? 'visible' : 'none',
)
```

选择变化时调用 `map.setFilter(ADMIN_REGION_SELECTION_FILL_LAYER_ID, createAdminRegionSelectionFillFilter(selectedAdminRegion?.regionId))`；存在 bounds 时执行：

```typescript
map.fitBounds(
  [
    [selectedAdminRegion.bounds.west, selectedAdminRegion.bounds.south],
    [selectedAdminRegion.bounds.east, selectedAdminRegion.bounds.north],
  ],
  { padding: 72, duration: 600 },
)
```

这些 effect 必须依赖 `styleLoadRevision` 与 `styleMutationReady`，确保样式重载后恢复。

- [ ] **Step 7: 运行图层与 Mapbox 测试**

Run: `npx vitest run apps/web/src/layers/adminRegionVectorTileSource.test.ts apps/web/src/components/MapboxCanvas.test.tsx --maxWorkers=1`

Expected: 全部 PASS；更新旧测试中移除图层的预期，使 selection fill 包含在区域图层生命周期中。

- [ ] **Step 8: 提交地图联动**

```powershell
git add apps/web/src/layers/adminRegionVectorTileSource.ts apps/web/src/layers/adminRegionVectorTileSource.test.ts apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "feat: 联动区域排行与地图图层"
```

### Task 6: 扩展底部配置弹层

**Files:**
- Modify: `apps/web/src/components/MapControls.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.tsx`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: 写两个行政边界开关彼此独立的失败测试**

```typescript
it('separates base-map and region boundary switches', async () => {
  render(<App amapConfig={configuredAmap} />)
  await settleLazyImports()
  fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))

  const popover = screen.getByRole('dialog', { name: '足迹显示设置' })
  const baseSwitch = within(popover).getByRole('switch', { name: '显示底图行政边界' })
  const regionSwitch = within(popover).getByRole('switch', { name: '显示区域边界线' })

  expect(baseSwitch).toHaveAttribute('aria-checked', 'true')
  expect(regionSwitch).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(regionSwitch)
  expect(regionSwitch).toHaveAttribute('aria-checked', 'false')
  expect(baseSwitch).toHaveAttribute('aria-checked', 'true')
})
```

- [ ] **Step 2: 运行布局测试并确认新开关不存在**

Run: `npx vitest run apps/web/src/components/mapShellLayout.test.tsx --maxWorkers=1`

Expected: FAIL，找不到“显示区域边界线”，旧文案仍为“显示行政边界”。

- [ ] **Step 3: 增加 props、改名并复用现有 switch 结构**

向 `MapControlsProps` 与 `FootprintStylePopoverProps` 增加：

```typescript
adminRegionLinesVisible?: boolean
onAdminRegionLinesVisibleChange?: (visible: boolean) => void
```

`MapControls` 和 `FootprintStylePopover` 都要解构 `adminRegionLinesVisible = true`，并把值与回调逐层传递，避免未传 prop 的旧调用者改变默认行为。

同时向 `MapboxCanvasProps` 增加 `onAdminRegionLinesVisibleChange?: (visible: boolean) => void`，并把 Task 5 已有的 `adminRegionLinesVisible` 与该回调传给 `MapControls`。在 `MapboxCanvas.test.tsx` 增加：

```typescript
it('routes the region boundary toolbar switch through the real canvas', async () => {
  const onAdminRegionLinesVisibleChange = vi.fn()
  mockMapboxRuntime()
  const { MapboxCanvas } = await import('./MapboxCanvas')
  render(
    <MapboxCanvas
      accessToken="test-mapbox-token"
      adminRegionLinesVisible
      onAdminRegionLinesVisibleChange={onAdminRegionLinesVisibleChange}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '足迹显示设置' }))
  fireEvent.click(screen.getByRole('switch', { name: '显示区域边界线' }))

  expect(onAdminRegionLinesVisibleChange).toHaveBeenCalledWith(false)
})
```

把现有文案改为“显示底图行政边界”，并紧随其后增加：

```tsx
{onAdminRegionLinesVisibleChange ? (
  <button
    type="button"
    role="switch"
    aria-checked={adminRegionLinesVisible}
    className={adminRegionLinesVisible
      ? 'footprint-style-popover__switch is-active'
      : 'footprint-style-popover__switch'}
    onClick={() => onAdminRegionLinesVisibleChange(!adminRegionLinesVisible)}
  >
    <span className="footprint-style-popover__label">显示区域边界线</span>
    <span className="footprint-style-popover__switch-control" aria-hidden="true" />
  </button>
) : null}
```

- [ ] **Step 4: 运行布局测试**

Run: `npx vitest run apps/web/src/components/mapShellLayout.test.tsx --maxWorkers=1`

Expected: 新测试 PASS，现有地名、底图边界、地图形态和足迹样式测试继续 PASS。

- [ ] **Step 5: 提交底部配置**

```powershell
git add apps/web/src/components/MapControls.tsx apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx apps/web/src/components/mapShellLayout.test.tsx
git commit -m "feat: 区分底图与区域边界开关"
```

### Task 7: 构建足迹版图与五行排行榜组件

**Files:**
- Create: `apps/web/src/components/AdminRegionContextPanel.tsx`
- Create: `apps/web/src/components/AdminRegionContextPanel.test.tsx`

- [ ] **Step 1: 写动态文案、缩略图、五行滚动和点击的失败测试**

```typescript
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AdminRegionContextPanel } from './AdminRegionContextPanel'

const summary = {
  depth: 3 as const,
  visitedRegionIds: ['310100', '330100', '320100', '320500', '330200', '330300'],
  visitedCount: 6,
  totalCount: 333,
  thumbnail: { viewBox: '0 0 320 150', basePath: 'M0 0L1 0Z', visitedPath: 'M0 0L0 1Z' },
  rankings: Array.from({ length: 6 }, (_, index) => ({
    rank: index + 1,
    regionId: `region-${index + 1}`,
    name: `城市${index + 1}`,
    footprintCount: 60 - index,
    bounds: { west: 120, south: 30, east: 121, north: 31 },
  })),
}

it('renders the active depth label and all rankings inside a five-row viewport', () => {
  render(
    <AdminRegionContextPanel
      depth={3}
      summary={summary}
      status="ready"
      onDepthChange={vi.fn()}
      onRegionSelect={vi.fn()}
      onRetry={vi.fn()}
    />,
  )

  expect(screen.getByText('6')).toBeInTheDocument()
  expect(screen.getByText('/ 333')).toBeInTheDocument()
  expect(screen.getByText('城市')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '城市足迹排行' })).toBeInTheDocument()
  const list = screen.getByRole('list', { name: '城市足迹排行' })
  expect(within(list).getAllByRole('button')).toHaveLength(6)
  expect(list).toHaveClass('admin-region-ranking-card__list')
})

it('changes levels and selects a ranking row', () => {
  const onDepthChange = vi.fn()
  const onRegionSelect = vi.fn()
  render(
    <AdminRegionContextPanel
      depth={3}
      summary={summary}
      status="ready"
      onDepthChange={onDepthChange}
      onRegionSelect={onRegionSelect}
      onRetry={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: '区' }))
  fireEvent.click(screen.getByRole('button', { name: '第1名 城市1 60个足迹点' }))

  expect(onDepthChange).toHaveBeenCalledWith(4)
  expect(onRegionSelect).toHaveBeenCalledWith(summary.rankings[0])
})

it('renders stable empty and error states', () => {
  const { rerender } = render(
    <AdminRegionContextPanel
      depth={1}
      summary={{ ...summary, depth: 1, visitedRegionIds: [], visitedCount: 0, rankings: [] }}
      status="ready"
      onDepthChange={vi.fn()}
      onRegionSelect={vi.fn()}
      onRetry={vi.fn()}
    />,
  )
  expect(screen.getByText('本期暂无足迹')).toBeInTheDocument()

  rerender(
    <AdminRegionContextPanel
      depth={1}
      summary={null}
      status="error"
      onDepthChange={vi.fn()}
      onRegionSelect={vi.fn()}
      onRetry={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: '重新加载区域摘要' })).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行组件测试并确认模块缺失**

Run: `npx vitest run apps/web/src/components/AdminRegionContextPanel.test.tsx --maxWorkers=1`

Expected: FAIL，无法导入组件。

- [ ] **Step 3: 实现三层组件和动态层级元数据**

在同一文件中导出组合组件，内部保留两个小组件。层级元数据必须是唯一文案来源：

```typescript
const DEPTH_META = {
  1: { button: '国', unit: '国家', rankingTitle: '国家足迹排行', scope: '国家级' },
  2: { button: '省', unit: '省级行政区', rankingTitle: '省级足迹排行', scope: '省级' },
  3: { button: '市', unit: '城市', rankingTitle: '城市足迹排行', scope: '市级' },
  4: { button: '区', unit: '区县', rankingTitle: '区县足迹排行', scope: '区县级' },
} satisfies Record<AdminRegionDepth, {
  button: string
  unit: string
  rankingTitle: string
  scope: string
}>
```

组件先计算 `const displaySummary = summary?.depth === depth ? summary : null`。层级切换后的新请求完成前显示固定 skeleton，不能把旧层级的计数和 path 配上新层级单位；同一层级仅时间变化时可以继续显示上一次成功摘要。

缩略图只渲染：

```tsx
<svg
  className="admin-region-atlas-card__thumbnail"
  viewBox={summary.thumbnail.viewBox}
  role="img"
  aria-label={`${meta.scope}足迹版图`}
>
  <path
    className="admin-region-atlas-card__base"
    d={summary.thumbnail.basePath}
    fillRule="evenodd"
  />
  <path
    className="admin-region-atlas-card__visited"
    d={summary.thumbnail.visitedPath}
    fillRule="evenodd"
  />
</svg>
```

排行使用 `<ol>` 和整行 `<button>`；进度宽度使用 `totalCount > 0 ? visitedCount / totalCount : 0`，通过 CSS 自定义属性传递百分比，不能让内容改变卡片几何。

- [ ] **Step 4: 运行组件测试**

Run: `npx vitest run apps/web/src/components/AdminRegionContextPanel.test.tsx --maxWorkers=1`

Expected: 全部 PASS。

- [ ] **Step 5: 提交区域卡组件**

```powershell
git add apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx
git commit -m "feat: 构建区域版图与足迹排行卡"
```

### Task 8: 在 App 中接入摘要、设置和区域右栏

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`

- [ ] **Step 1: 扩展 MapboxCanvas 测试替身以暴露新 props**

在 `mapShellLayout.test.tsx` 的 `MapboxCanvas` mock 中删除 `adminRegionActiveOnly`，增加并写入 data attribute：

```typescript
'data-admin-region-visible-ids': adminRegionVisibleIds === undefined
  ? 'legacy'
  : adminRegionVisibleIds === null
    ? 'all'
    : adminRegionVisibleIds.join(','),
'data-admin-region-lines-visible': String(adminRegionLinesVisible),
'data-footprints-visible': String(footprintsVisible),
'data-selected-admin-region-id': selectedAdminRegion?.regionId,
```

并把 `adminRegionLinesVisible` 与回调继续传入 `MapControls`。

- [ ] **Step 2: 写地图设置默认值和区域右栏联动的失败测试**

在测试文件顶部定义 `adminRegionSummaryFixture`，并 mock 数据源返回它：

```typescript
const adminRegionSummaryFixture = {
  depth: 1 as const,
  visitedRegionIds: ['CN'],
  visitedCount: 1,
  totalCount: 200,
  thumbnail: { viewBox: '0 0 320 150', basePath: 'M0 0Z', visitedPath: 'M1 1Z' },
  rankings: [{
    rank: 1,
    regionId: 'CN',
    name: '中国',
    footprintCount: 120,
    bounds: { west: 73, south: 18, east: 135, north: 54 },
  }],
}

vi.mock('../layers/adminRegionSummaryDataSource', async () => {
  const actual = await vi.importActual('../layers/adminRegionSummaryDataSource')
  return {
    ...actual,
    loadAdminRegionSummary: vi.fn(async () => adminRegionSummaryFixture),
  }
})

import { loadAdminRegionSummary } from '../layers/adminRegionSummaryDataSource'
```

然后增加：

```typescript
it('shows the region cards and uses visited ids by default', async () => {
  render(<App amapConfig={configuredAmap} />)
  await settleLazyImports()
  fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
    .getByRole('button', { name: '区域' }))

  expect(await screen.findByRole('heading', { name: '足迹版图' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '国家足迹排行' })).toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: '仅显示当前时间有足迹的区域' }))
    .not.toBeInTheDocument()
  expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
    'data-admin-region-visible-ids',
    adminRegionSummaryFixture.visitedRegionIds.join(','),
  )
  expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute('data-footprints-visible', 'false')
})

it('moves region range and footprint switches into map settings', async () => {
  render(<App amapConfig={configuredAmap} />)
  await settleLazyImports()
  fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
  const dialog = screen.getByRole('dialog', { name: '设置' })
  fireEvent.click(within(dialog).getByRole('button', { name: '地图' }))

  const showAll = within(dialog).getByRole('switch', { name: '显示全部行政区' })
  const showPoints = within(dialog).getByRole('switch', { name: '在区域页显示足迹点' })
  expect(showAll).toHaveAttribute('aria-checked', 'false')
  expect(showPoints).toHaveAttribute('aria-checked', 'false')

  fireEvent.click(showAll)
  fireEvent.click(showPoints)
  expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute('data-admin-region-visible-ids', 'all')
  expect(window.localStorage.getItem('enroute:show-all-admin-regions')).toBe('true')
  expect(window.localStorage.getItem('enroute:show-footprints-in-region-mode')).toBe('true')
})

it('focuses a ranking row and clears selection when depth changes', async () => {
  render(<App amapConfig={configuredAmap} />)
  await settleLazyImports()
  fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
    .getByRole('button', { name: '区域' }))
  fireEvent.click(await screen.findByRole('button', { name: /第1名/ }))
  expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
    'data-selected-admin-region-id',
    adminRegionSummaryFixture.rankings[0].regionId,
  )
  fireEvent.click(screen.getByRole('button', { name: '市' }))
  expect(screen.getByTestId('mapbox-canvas')).not.toHaveAttribute('data-selected-admin-region-id')
})

it('aborts a stale summary request when depth changes', async () => {
  const signals: AbortSignal[] = []
  vi.mocked(loadAdminRegionSummary).mockImplementation(({ signal }) => {
    signals.push(signal)
    return new Promise(() => undefined)
  })
  render(<App amapConfig={configuredAmap} />)
  await settleLazyImports()
  fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
    .getByRole('button', { name: '区域' }))
  await vi.waitFor(() => expect(signals).toHaveLength(1))

  fireEvent.click(screen.getByRole('button', { name: '市' }))
  await vi.waitFor(() => expect(signals).toHaveLength(2))

  expect(signals[0].aborted).toBe(true)
  expect(signals[1].aborted).toBe(false)
})

it('keeps the default map filter empty when the first summary request fails', async () => {
  vi.mocked(loadAdminRegionSummary).mockRejectedValueOnce(new Error('offline'))
  render(<App amapConfig={configuredAmap} />)
  await settleLazyImports()
  fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
    .getByRole('button', { name: '区域' }))

  expect(await screen.findByRole('button', { name: '重新加载区域摘要' })).toBeInTheDocument()
  expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
    'data-admin-region-visible-ids',
    '',
  )
})
```

- [ ] **Step 3: 运行 App 布局测试并确认旧右栏与设置导致失败**

Run: `npx vitest run apps/web/src/App.test.tsx apps/web/src/components/mapShellLayout.test.tsx --maxWorkers=1`

Expected: FAIL，区域右栏仍显示“当前分区/图层与状态”，设置中缺少两个开关。

- [ ] **Step 4: 在 App 中建立摘要生命周期和正向设置状态**

增加状态：

```typescript
const [showAllAdminRegions, setShowAllAdminRegions] = useState(readShowAllAdminRegions)
const [showFootprintsInRegionMode, setShowFootprintsInRegionMode] = useState(
  readShowFootprintsInRegionMode,
)
const [adminRegionLinesVisible, setAdminRegionLinesVisible] = useState(
  readAdminRegionLinesVisible,
)
const [adminRegionSummary, setAdminRegionSummary] = useState<AdminRegionSummary | null>(null)
const [adminRegionSummaryStatus, setAdminRegionSummaryStatus] = useState<
  'idle' | 'loading' | 'ready' | 'error'
>('idle')
const [selectedAdminRegion, setSelectedAdminRegion] = useState<AdminRegionRanking | null>(null)
const [adminRegionSummaryRevision, setAdminRegionSummaryRevision] = useState(0)
```

仅在 `view === 'map' && activeSecondaryNavId === 'regions'` 时发请求；使用完整 effect：

```typescript
useEffect(() => {
  if (view !== 'map' || activeSecondaryNavId !== 'regions') {
    setAdminRegionSummaryStatus('idle')
    return
  }
  const abortController = new AbortController()
  setAdminRegionSummaryStatus('loading')
  loadAdminRegionSummary({
    depth: adminRegionDepth,
    timeRange: selectedTimeRange,
    signal: abortController.signal,
  }).then((summary) => {
    if (abortController.signal.aborted) return
    setAdminRegionSummary(summary)
    setAdminRegionSummaryStatus('ready')
  }).catch((error: unknown) => {
    if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return
    }
    setAdminRegionSummaryStatus('error')
  })
  return () => abortController.abort()
}, [
  activeSecondaryNavId,
  adminRegionDepth,
  adminRegionSummaryRevision,
  selectedTimeRange,
  view,
])
```

新请求开始时保留上次 summary，第一次加载使用固定 skeleton；成功时更新 summary，失败且不是 AbortError 时进入 error。

计算地图 props：

```typescript
const isRegionMode = view === 'map' && activeSecondaryNavId === 'regions'
const adminRegionVisibleIds = showAllAdminRegions
  ? null
  : adminRegionSummary?.visitedRegionIds ?? []
const footprintsVisible = !isRegionMode || showFootprintsInRegionMode
```

切换时间、层级或离开区域模式时清除 `selectedAdminRegion`：

```typescript
useEffect(() => {
  setSelectedAdminRegion(null)
}, [activeSecondaryNavId, adminRegionDepth, selectedTimeRange, view])
```

- [ ] **Step 5: 仅在区域模式替换右栏两张卡**

在 `right-context-panel__stack` 内分支：

```tsx
{isRegionMode ? (
  <AdminRegionContextPanel
    depth={adminRegionDepth}
    summary={adminRegionSummary}
    status={adminRegionSummaryStatus}
    onDepthChange={setAdminRegionDepth}
    onRegionSelect={setSelectedAdminRegion}
    onRetry={() => setAdminRegionSummaryRevision((current) => current + 1)}
  />
) : (
  <DefaultRightContextCards
    view={view}
    activeSecondaryNavId={activeSecondaryNavId}
    footprintMetrics={footprintMetrics}
  />
)}
```

在 `App.tsx` 文件底部定义 `DefaultRightContextCards`，把当前两个 section 原样移动进去，不包含任何区域层级按钮：

```tsx
function DefaultRightContextCards({
  view,
  activeSecondaryNavId,
  footprintMetrics,
}: {
  view: AppView
  activeSecondaryNavId: SecondaryNavId
  footprintMetrics: FootprintMetrics
}) {
  return (
    <>
      <section
        className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__summary"
        aria-label="当前分区摘要"
      >
        <span className="right-context-panel__eyebrow">当前分区</span>
        <strong>{secondaryNavItemsByView[view].find((item) => item.id === activeSecondaryNavId)?.label ?? '概览'}</strong>
        <p>{getRightContextSummary(view, activeSecondaryNavId)}</p>
      </section>
      <section
        className="glass-panel glass-panel--solid glass-panel--card right-context-panel__glass right-context-panel__legend"
        aria-label="图层与状态"
      >
        <span className="right-context-panel__eyebrow">
          {view === 'map' ? '图层与状态' : '工作区状态'}
        </span>
        <div className="right-context-panel__rows">
          {getRightContextRows(view, activeSecondaryNavId, footprintMetrics).map((row) => (
            <div className="right-context-panel__row" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
```

不要修改左侧 `TimeContextPanel` 或其他页面的 `.right-context-panel__stack` 几何。

- [ ] **Step 6: 在“设置 > 地图”加入两个 switch 并连接底部边界线**

复用 `settings-switch-row`，按顺序显示：显示全部行政区、在区域页显示足迹点、显示地图统计浮窗。handler 同时更新 state 和对应 write 函数：

```typescript
const handleShowAllAdminRegionsChange = useCallback((visible: boolean) => {
  setShowAllAdminRegions(visible)
  writeShowAllAdminRegions(visible)
}, [])
const handleShowFootprintsInRegionModeChange = useCallback((visible: boolean) => {
  setShowFootprintsInRegionMode(visible)
  writeShowFootprintsInRegionMode(visible)
}, [])
const handleAdminRegionLinesVisibleChange = useCallback((visible: boolean) => {
  setAdminRegionLinesVisible(visible)
  writeAdminRegionLinesVisible(visible)
}, [])
```

两个新增设置行使用：

```tsx
<button
  type="button"
  role="switch"
  aria-checked={showAllAdminRegions}
  className={showAllAdminRegions ? 'settings-switch-row is-active' : 'settings-switch-row'}
  onClick={() => handleShowAllAdminRegionsChange(!showAllAdminRegions)}
>
  <span>显示全部行政区</span>
  <span className="settings-switch-row__control" aria-hidden="true" />
</button>
<button
  type="button"
  role="switch"
  aria-checked={showFootprintsInRegionMode}
  className={showFootprintsInRegionMode ? 'settings-switch-row is-active' : 'settings-switch-row'}
  onClick={() => handleShowFootprintsInRegionModeChange(!showFootprintsInRegionMode)}
>
  <span>在区域页显示足迹点</span>
  <span className="settings-switch-row__control" aria-hidden="true" />
</button>
```

向 `LazyMapboxCanvas` 传入：

```tsx
adminRegionVisibleIds={adminRegionVisibleIds}
adminRegionLinesVisible={adminRegionLinesVisible}
footprintsVisible={footprintsVisible}
selectedAdminRegion={selectedAdminRegion}
onAdminRegionLinesVisibleChange={handleAdminRegionLinesVisibleChange}
```

- [ ] **Step 7: 实现固定卡片尺寸与五行滚动 CSS**

在 `App.css` 添加独立类，不在 `.app-shell--map` 下改左栏：

```css
.admin-region-context-panel {
  display: grid;
  gap: 14px;
  min-height: 0;
}

.admin-region-atlas-card,
.admin-region-ranking-card {
  padding: 18px;
  border-radius: 20px;
}

.admin-region-atlas-card__thumbnail {
  display: block;
  width: 100%;
  aspect-ratio: 32 / 15;
}

.admin-region-atlas-card__base { fill: rgba(23, 35, 31, 0.13); }
.admin-region-atlas-card__visited { fill: #2c8572; }

.admin-region-ranking-card {
  --admin-region-rank-row-height: 49px;
  min-height: 0;
}

.admin-region-ranking-card__list {
  max-height: calc(var(--admin-region-rank-row-height) * 5);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.admin-region-ranking-card__row {
  min-height: var(--admin-region-rank-row-height);
}
```

补齐标题、计数、进度、四段按钮、排行条和 hover/focus 样式；所有文本容器使用 `min-width: 0` 和省略策略，不能改变行高。

- [ ] **Step 8: 运行区域组件、App 与布局测试**

Run: `npx vitest run apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/App.test.tsx apps/web/src/components/mapShellLayout.test.tsx --maxWorkers=1`

Expected: 全部 PASS，区域模式使用新卡片，足迹/统计/记账右栏测试不变。

- [ ] **Step 9: 提交应用集成**

```powershell
git add apps/web/src/App.tsx apps/web/src/App.css apps/web/src/App.test.tsx apps/web/src/components/mapShellLayout.test.tsx
git commit -m "feat: 重设计区域页右侧信息栏"
```

### Task 9: 完成契约文档与全链路验证

**Files:**
- Modify: `README.md`
- Verify: all changed files

- [ ] **Step 1: 更新 README 的只读接口说明**

在行政区 API 段增加准确事实：

```markdown
The region sidebar reads `GET /api/admin-regions/summary?depth=...&start=...&end=...`
for the current time-range visit count, compact thumbnail paths, ranking rows,
and map-focus bounds. This endpoint is read-only: it does not rebuild or mutate
`admin_region_tiles`, `visual_tiles`, or raw footprint rows.
```

- [ ] **Step 2: 运行完整自动化验证**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected:

- web: 现有 435 项加本功能新增测试全部 PASS。
- api: 现有 145 项加摘要测试全部 PASS。
- repo: 现有 36 项全部 PASS。
- lint: exit code 0。
- build: TypeScript 与 Vite 生产构建 exit code 0。

- [ ] **Step 3: 准备浏览器验证所需的忽略数据，不重建瓦片**

确认目标 worktree 不存在数据库时，从主工作区复制已完成的数据库；不运行任何 prepare/rebuild 命令：

```powershell
$sourceDb = 'D:\Coding\EnRoute\data\footprints.sqlite'
$targetDir = 'D:\Coding\EnRoute\.worktrees\region-panel-redesign\data'
$targetDb = Join-Path $targetDir 'footprints.sqlite'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
if (-not (Test-Path $targetDb)) {
  Copy-Item -LiteralPath $sourceDb -Destination $targetDb
}
```

同样仅在 worktree 缺失时复制 `.env.local`，不要在终端输出内容：

```powershell
$targetEnv = 'D:\Coding\EnRoute\.worktrees\region-panel-redesign\.env.local'
if (-not (Test-Path $targetEnv)) {
  Copy-Item -LiteralPath 'D:\Coding\EnRoute\.env.local' -Destination $targetEnv
}
```

- [ ] **Step 4: 启动独立端口并检查服务**

分别启动 API 5179 与前端 5174，避免占用主工作区端口：

```powershell
$env:ENROUTE_API_PORT = '5179'
npm run api
```

另一个终端：

```powershell
$env:ENROUTE_API_PORT = '5179'
npm run dev -- --host 127.0.0.1 --port 5174
```

Expected: `http://127.0.0.1:5174` 返回 200，`http://127.0.0.1:5179/api/admin-regions/summary?depth=1&range=all` 返回 JSON 200。

- [ ] **Step 5: 用浏览器验证桌面与窄视口**

在 1440x900 与 390x844 视口验证：

1. 进入地图“区域”，默认只显示本期到访行政区且不显示足迹点。
2. 第一张卡在国级显示世界，在省/市/区显示中国；单位依次为国家、省级行政区、城市、区县。
3. 左侧日、周、月、年、自定义切换会刷新计数、强调填充和排行。
4. 第二张卡正好显示五条；鼠标滚轮和触控滚动可访问后续记录。
5. 点击排行后主地图聚焦并强化该区域。
6. “显示全部行政区”只改变主地图，不改变右栏本期统计。
7. “在区域页显示足迹点”只影响区域分区，切到足迹分区仍显示点。
8. “显示底图行政边界”和“显示区域边界线”可以分别开关。
9. 地图样式切换后以上状态仍保持。
10. 控制台无 Mapbox 错误，卡片、导航、底部工具栏和地图不重叠。

保存截图到忽略的 `output/region-panel-redesign/`，不要加入 Git。

- [ ] **Step 6: 检查写入范围和工作树**

Run:

```powershell
rg -n "DELETE FROM visual_tiles|DROP TABLE|build_visual_tiles" apps/api/src apps/web/src
git diff --check
git status --short
```

Expected: 本功能代码没有新增 SQLite 写入或视觉瓦片构建调用；仅有预期源文件和 README 改动，忽略的数据库、环境文件、日志和截图不出现在 `git status --short`。

- [ ] **Step 7: 提交文档和验证收尾**

```powershell
git add README.md
git commit -m "docs: 记录区域摘要只读接口"
```

提交后再次运行 `git status --short`，Expected: 无输出。
