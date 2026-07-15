# Region Thumbnail and Depth Switch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复省、市、区缩略图破碎和非等比变形，将层级按钮移动到缩略图下方并移除外框，同时消除主地图切换行政区层级时闪现全部区域的问题。

**Architecture:** 后端继续只读现有 `z=0` 行政区 MVT，用统一的等比例投影生成世界/中国画幅，并让省、市、区共享省级瓦片合并出的固定中国轮廓；到访区域先合并投影几何再输出 path。前端让 `App` 拒绝把旧层级摘要传给新层级，`MapboxCanvas` 在创建行政区图层时直接写入过滤器，避免任何无过滤帧。

**Tech Stack:** Python 3.12、FastAPI、SQLite、Shapely、Mapbox Vector Tile、React 19、TypeScript 6、Mapbox GL JS、Vitest、Testing Library、CSS。

---

## 文件职责

- `apps/api/src/enroute_api/admin_regions/thumbnail.py`：只读缩略图源、等比例投影、固定中国底图、到访几何合并和 SVG path 缓存。
- `apps/api/tests/test_admin_region_summary.py`：投影比例、三级中国底图一致性、到访区域合并和摘要只读回归测试。
- `apps/web/src/components/AdminRegionContextPanel.tsx`：缩略图与层级控件的 DOM 顺序及 SVG 比例约束。
- `apps/web/src/components/AdminRegionContextPanel.test.tsx`：层级控件顺序、按钮和 SVG 属性契约。
- `apps/web/src/App.css` 与 `apps/web/src/components/mapLayout.test.ts`：无外框层级控件和稳定画幅。
- `apps/web/src/App.tsx` 与 `apps/web/src/App.test.tsx`：当前层级摘要有效性、加载态和地图可见 ID。
- `apps/web/src/components/MapboxCanvas.tsx` 与对应测试：行政区数据源重建时的原子图层过滤。

### Task 1: 让缩略图投影保持横纵比例

**Files:**
- Modify: `apps/api/tests/test_admin_region_summary.py:287`
- Modify: `apps/api/src/enroute_api/admin_regions/thumbnail.py:18-28,548-604`

- [ ] **Step 1: 写等比例投影失败测试**

```python
@pytest.mark.parametrize(
    ("depth", "frame"),
    [
        (1, thumbnail_module.WORLD_BOUNDS),
        (2, thumbnail_module.CHINA_BOUNDS),
        (3, thumbnail_module.CHINA_BOUNDS),
        (4, thumbnail_module.CHINA_BOUNDS),
    ],
)
def test_thumbnail_projection_uses_one_scale_for_both_axes(
    depth: int,
    frame: tuple[float, float, float, float],
):
    west, south, east, north = frame
    projected_west, projected_north, projected_east, projected_south = (
        thumbnail_module.project_geographic_bounds(west, south, east, north, depth=depth)
    )
    horizontal_scale = (projected_east - projected_west) / (east - west)
    vertical_scale = (projected_south - projected_north) / (north - south)

    assert horizontal_scale == pytest.approx(vertical_scale)
    assert projected_west >= thumbnail_module.VIEWBOX_PADDING
    assert projected_north >= thumbnail_module.VIEWBOX_PADDING
    assert projected_east <= thumbnail_module.VIEWBOX_WIDTH - thumbnail_module.VIEWBOX_PADDING
    assert projected_south <= thumbnail_module.VIEWBOX_HEIGHT - thumbnail_module.VIEWBOX_PADDING
```

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
$env:PYTHONPATH='apps/api/src'
python -m pytest apps/api/tests/test_admin_region_summary.py::test_thumbnail_projection_uses_one_scale_for_both_axes -q
```

Expected: FAIL；当前 X/Y 分别按 `320` 和 `150` 缩放，且 `VIEWBOX_PADDING` 尚不存在。

- [ ] **Step 3: 实现统一 contain 投影**

```python
VIEWBOX_PADDING = 6.0


def project_geographic_position(
    longitude: float,
    latitude: float,
    *,
    depth: int,
) -> tuple[float, float]:
    west, south, east, north = WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS
    available_width = VIEWBOX_WIDTH - VIEWBOX_PADDING * 2
    available_height = VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2
    scale = min(
        available_width / (east - west),
        available_height / (north - south),
    )
    content_width = (east - west) * scale
    content_height = (north - south) * scale
    offset_x = (VIEWBOX_WIDTH - content_width) / 2
    offset_y = (VIEWBOX_HEIGHT - content_height) / 2
    return (
        offset_x + (longitude - west) * scale,
        offset_y + (north - latitude) * scale,
    )


def project_geographic_geometry(geometry: BaseGeometry, *, depth: int) -> BaseGeometry:
    def project(x, y, z=None):
        del z
        return project_geographic_position(float(x), float(y), depth=depth)

    return transform(project, force_2d(geometry)).simplify(0.6, preserve_topology=True)


def project_tile_position(x: float, y: float, *, depth: int) -> tuple[float, float]:
    longitude = x / MVT_EXTENT * 360.0 - 180.0
    mercator_y = math.pi - 2.0 * math.pi * y / MVT_EXTENT
    latitude = math.degrees(math.atan(math.sinh(mercator_y)))
    return project_geographic_position(longitude, latitude, depth=depth)


def project_geographic_bounds(
    west: float,
    south: float,
    east: float,
    north: float,
    *,
    depth: int,
) -> tuple[float, float, float, float]:
    north_west = project_geographic_position(west, north, depth=depth)
    south_east = project_geographic_position(east, south, depth=depth)
    return normalize_bounds((*north_west, *south_east))
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

```powershell
$env:PYTHONPATH='apps/api/src'
python -m pytest apps/api/tests/test_admin_region_summary.py::test_thumbnail_projection_uses_one_scale_for_both_axes apps/api/tests/test_admin_region_summary.py::test_thumbnail_uses_fixed_world_and_china_frames_without_presentation_attributes -q
```

Expected: PASS。旧测试若依赖具体起始坐标，只移除具体 `startswith("M...")` 断言，保留固定 viewBox、path 非空和单小数位契约。

- [ ] **Step 5: 提交等比例投影**

```powershell
git add apps/api/src/enroute_api/admin_regions/thumbnail.py apps/api/tests/test_admin_region_summary.py
git commit -m "fix: 保持区域缩略图等比投影"
```

### Task 2: 生成固定中国底图并合并到访几何

**Files:**
- Modify: `apps/api/tests/test_admin_region_summary.py:325-458,821-885`
- Modify: `apps/api/src/enroute_api/admin_regions/thumbnail.py:7-16,40-66,91-153,244-453,607-647`

- [ ] **Step 1: 写三级固定底图与到访合并失败测试**

给 `insert_thumbnail_tile` 增加 `adjacent: bool = False`；当它为真时，第二个矩形使用 `y=1600..1640`，与第一个矩形共享完整边，而不是只接触一个角。然后新增：

```python
def test_province_city_and_district_share_one_gapless_china_base(
    connection: sqlite3.Connection,
):
    insert_thumbnail_tile(connection, depth=2, adjacent=True)
    insert_thumbnail_tile(connection, depth=3, x_offset=120, adjacent=True)
    insert_thumbnail_tile(connection, depth=4, x_offset=240, adjacent=True)

    province = create_admin_region_thumbnail(connection, depth=2, visited_region_ids=set())
    city = create_admin_region_thumbnail(connection, depth=3, visited_region_ids=set())
    district = create_admin_region_thumbnail(connection, depth=4, visited_region_ids=set())

    assert province["basePath"] == city["basePath"] == district["basePath"]
    assert province["basePath"].count("M") == 1


def test_thumbnail_unions_adjacent_visited_regions_before_writing_path(
    connection: sqlite3.Connection,
):
    insert_thumbnail_tile(connection, depth=3, adjacent=True)
    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=3,
        visited_region_ids={"310100", "330100"},
    )

    assert thumbnail["visitedPath"].count("M") == 1
```

- [ ] **Step 2: 运行新测试并确认 RED**

```powershell
$env:PYTHONPATH='apps/api/src'
python -m pytest apps/api/tests/test_admin_region_summary.py::test_province_city_and_district_share_one_gapless_china_base apps/api/tests/test_admin_region_summary.py::test_thumbnail_unions_adjacent_visited_regions_before_writing_path -q
```

Expected: FAIL；当前三个深度各自生成 `basePath`，且 `visitedPath` 只是字符串拼接。

- [ ] **Step 3: 扩展缓存模型并一次读取当前/省级 tile**

```python
from dataclasses import dataclass, field
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, box, shape


@dataclass(frozen=True)
class AdminRegionThumbnailPath:
    region_id: str
    path: str
    coarse_path: str
    bounds: tuple[float, float, float, float]
    geometry: BaseGeometry | None = field(default=None, compare=False, repr=False)


@dataclass(frozen=True)
class AdminRegionThumbnailSource:
    cache_key: tuple[object, ...]
    depth: int
    mode: str
    tile: bytes = b""
    china_base_tile: bytes = b""
    geometry_rows: tuple[tuple[str, str], ...] = ()
    bounds_rows: tuple[tuple[str, float, float, float, float], ...] = ()
    cached_paths: AdminRegionThumbnailPaths | None = None
```

`read_admin_region_thumbnail_source` 使用 `requested_depths = sorted({depth, 2} if depth > 1 else {depth})`，在同一条 metadata 查询和同一条 content 查询中读取当前 depth 与 depth 2。cache key 必须同时包含两者的 `(algorithm_signature, updated_at, feature_count, tile_length)`；返回 source 时设置：

```python
tile=tiles_by_depth[depth]
china_base_tile=tiles_by_depth.get(2, b"") if depth > 1 else b""
```

若省级 tile 缺失，`china_base_tile` 为空并沿用当前 tile，且不得触发构建或写库。

- [ ] **Step 4: 实现固定轮廓、裁剪和到访合并**

```python
def clip_thumbnail_geometry(geometry: BaseGeometry) -> BaseGeometry:
    frame = box(
        VIEWBOX_PADDING,
        VIEWBOX_PADDING,
        VIEWBOX_WIDTH - VIEWBOX_PADDING,
        VIEWBOX_HEIGHT - VIEWBOX_PADDING,
    )
    return force_2d(geometry).intersection(frame)


def remove_polygon_holes(geometry: BaseGeometry) -> BaseGeometry:
    shells = [Polygon(polygon.exterior) for polygon in iter_polygons(geometry)]
    return safe_union(shells, grid_size=0.1) if shells else GeometryCollection()


def merge_visited_region_paths(paths: Iterable[AdminRegionThumbnailPath]) -> str:
    resolved = list(paths)
    geometries = [path.geometry for path in resolved if path.geometry is not None]
    if geometries:
        merged = safe_union(geometries, grid_size=0.1).simplify(
            0.6,
            preserve_topology=True,
        )
        detailed = bounded_geometry_path(merged)
        if detailed:
            return detailed
    return join_bounded_region_paths(resolved)
```

从现有 `build_tile_thumbnail_paths` 抽出 `decode_fill_geometries(tile)`，返回 `dict[str, list[BaseGeometry]]`。每个 region union 后投影、裁剪，把未简化 geometry 存入 `AdminRegionThumbnailPath.geometry`，path 使用其 `simplify(0.6, preserve_topology=True)`。

`depth == 1` 保留世界 base；`depth > 1` 使用 `source.china_base_tile or source.tile` 的全部 fill，按现有 `TILE_SIMPLIFY_UNITS` 与 `TILE_UNION_GRID_UNITS` 合并，以 `depth=2` 投影、裁剪并移除 holes：

```python
base_tile = source.china_base_tile or source.tile
base_groups = grouped_geometries if base_tile == source.tile else decode_fill_geometries(base_tile)
base_geometries = [
    geometry.simplify(TILE_SIMPLIFY_UNITS, preserve_topology=False)
    for geometries in base_groups.values()
    for geometry in geometries
]
base_geometry = safe_union(base_geometries, grid_size=TILE_UNION_GRID_UNITS)
base_depth = 1 if source.depth == 1 else 2
projected_base = clip_thumbnail_geometry(
    project_tile_geometry(base_geometry, depth=base_depth, simplify=False),
)
if source.depth > 1:
    projected_base = remove_polygon_holes(projected_base)
base_path = bounded_geometry_path(projected_base.simplify(0.6, preserve_topology=True))
```

给 `project_tile_geometry` / `project_geographic_geometry` 增加 `simplify: bool = True`；`False` 只 transform。raw/bounds fallback 分别把投影 geometry 或 `box(*bounds)` 写入 path。bounds fallback 同样设置 `geometry=box(*viewbox_bounds)`。响应改为：

```python
"visitedPath": merge_visited_region_paths(selected_paths),
```

- [ ] **Step 5: 运行 API 文件测试并确认 GREEN**

```powershell
$env:PYTHONPATH='apps/api/src'
python -m pytest apps/api/tests/test_admin_region_summary.py -q
```

Expected: PASS。旧“两个 visited path 直接相加等于 base”断言改为单区域 path 不同、空集合为空、相邻集合合并；缓存只解码一次、缺失 ID bounds 回退和表计数只读断言保持通过。

- [ ] **Step 6: 提交中国底图修复**

```powershell
git add apps/api/src/enroute_api/admin_regions/thumbnail.py apps/api/tests/test_admin_region_summary.py
git commit -m "fix: 修复中国区域缩略图轮廓"
```

### Task 3: 把层级控件移到缩略图下方并移除外框

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx:98-132`
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx:48-76`
- Modify: `apps/web/src/components/mapLayout.test.ts:130-145`
- Modify: `apps/web/src/App.css:2334-2371`

- [ ] **Step 1: 写 DOM 顺序和 CSS 外框失败测试**

在组件测试首个用例中补充：

```tsx
const thumbnail = screen.getByLabelText('城市足迹缩略图')
const depthControl = screen.getByRole('group', { name: '行政区层级' })
expect(
  thumbnail.compareDocumentPosition(depthControl) & Node.DOCUMENT_POSITION_FOLLOWING,
).toBeTruthy()
expect(thumbnail).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
```

在 `mapLayout.test.ts` 增加：

```ts
it('keeps the region depth control unframed below the thumbnail', () => {
  const controlRule = cssRule('.admin-region-atlas-card__depth-control')

  expect(controlRule).toMatch(/padding:\s*0;/)
  expect(controlRule).toMatch(/border-radius:\s*0;/)
  expect(controlRule).toMatch(/background:\s*transparent;/)
  expect(adminRegionContextPanelSource.indexOf('admin-region-atlas-card__thumbnail'))
    .toBeLessThan(adminRegionContextPanelSource.indexOf('<DepthControl'))
})
```

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
npm run test:web -- src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts --maxWorkers=1
```

Expected: FAIL；当前 `<DepthControl>` 位于 `<svg>` 前，容器仍有 `padding: 6px` 和背景。

- [ ] **Step 3: 调整 DOM 与样式**

把 `<DepthControl>` 移到 `</svg>` 后，并给 SVG 增加：

```tsx
preserveAspectRatio="xMidYMid meet"
```

更新 CSS：

```css
.admin-region-atlas-card__depth-control {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.admin-region-atlas-card__thumbnail {
  display: block;
  width: 100%;
  aspect-ratio: 32 / 15;
  overflow: hidden;
}
```

四个按钮保留现有高度、独立浅色底、选中强调色和 focus 行为。

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

```powershell
npm run test:web -- src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts --maxWorkers=1
```

Expected: PASS。

- [ ] **Step 5: 提交右栏布局修正**

```powershell
git add apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/components/mapLayout.test.ts apps/web/src/App.css
git commit -m "fix: 调整区域层级控件位置"
```

### Task 4: 原子应用主地图行政区过滤器

**Files:**
- Modify: `apps/web/src/App.test.tsx:111-137,430-447`
- Modify: `apps/web/src/App.tsx:324-332,399-402,587-628,764-770`
- Modify: `apps/web/src/components/MapboxCanvas.test.tsx:963-1029`
- Modify: `apps/web/src/components/MapboxCanvas.tsx:248-269,378-413,840-942`

- [ ] **Step 1: 写 App 旧摘要隔离失败测试**

```tsx
const provinceSummaryFixture = {
  ...adminRegionSummaryFixture,
  depth: 2 as const,
  visitedRegionIds: ['310000'],
  visitedCount: 1,
  totalCount: 34,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((currentResolve) => {
    resolve = currentResolve
  })
  return { promise, resolve }
}

it('uses an empty region filter while a newly selected depth is loading', async () => {
  const provinceRequest = deferred<typeof provinceSummaryFixture>()
  vi.mocked(loadAdminRegionSummary)
    .mockResolvedValueOnce(adminRegionSummaryFixture)
    .mockImplementationOnce(() => provinceRequest.promise)

  render(<App amapConfig={missingAmapConfig} />)
  await settleLazyImports()
  fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
    .getByRole('button', { name: '区域' }))
  await waitFor(() => expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
    'data-admin-region-visible-ids',
    'CN',
  ))

  fireEvent.click(screen.getByRole('button', { name: '省' }))

  expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
    'data-admin-region-visible-ids',
    '',
  )
  expect(screen.getByText('-- / -- 省级行政区')).toBeInTheDocument()

  await act(async () => provinceRequest.resolve(provinceSummaryFixture))
  await waitFor(() => expect(screen.getByTestId('mapbox-canvas')).toHaveAttribute(
    'data-admin-region-visible-ids',
    '310000',
  ))
})
```

- [ ] **Step 2: 写 Mapbox 新图层初始过滤失败测试**

现有 depth 更新测试的初始 props 增加 `adminRegionVisibleIds={['310115']}`，切到 depth 1 时传 `adminRegionVisibleIds={[]}`。重建后直接读取 layer specification：

```tsx
const fillLayer = mapRecords[0].layers.find((layer) => (
  typeof layer === 'object' && layer !== null && 'id' in layer &&
  layer.id === 'admin-regions-fill'
)) as { filter?: unknown }
const lineLayer = mapRecords[0].layers.find((layer) => (
  typeof layer === 'object' && layer !== null && 'id' in layer &&
  layer.id === 'admin-regions-line'
)) as { filter?: unknown }

expect(fillLayer.filter).toEqual([
  'all',
  ['==', ['get', 'kind'], 'fill'],
  ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
  ['in', ['get', 'region_id'], ['literal', []]],
])
expect(lineLayer.filter).toEqual([
  'all',
  ['==', ['get', 'kind'], 'line'],
  ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
  ['any', ['in', ['get', 'region_id'], ['literal', []]]],
])
```

- [ ] **Step 3: 运行测试并确认 RED**

```powershell
npm run test:web -- src/App.test.tsx src/components/MapboxCanvas.test.tsx --maxWorkers=1
```

Expected: FAIL；`App` 仍把旧摘要 ID 用于新 depth，且新建 layer 没有区域过滤。

- [ ] **Step 4: 让 App 只暴露当前层级摘要**

```tsx
const currentAdminRegionSummary = adminRegionSummary?.depth === adminRegionDepth
  ? adminRegionSummary
  : null
const adminRegionVisibleIds = showAllAdminRegions
  ? null
  : currentAdminRegionSummary?.visitedRegionIds ?? []
```

右栏改传 `summary={currentAdminRegionSummary}`。切级立即进入加载态：

```tsx
const handleAdminRegionDepthChange = useCallback((nextDepth: AdminRegionDepth) => {
  setSelectedAdminRegion(null)
  setAdminRegionSummaryStatus('loading')
  setAdminRegionDepth(nextDepth)
}, [])
```

摘要 effect 创建 abort controller 后执行：

```tsx
setAdminRegionSummary(null)
setAdminRegionSummaryStatus('loading')
```

失败时摘要保持 `null`，地图继续接收 `[]`，不回退为全部区域。

- [ ] **Step 5: 创建图层时同步写入过滤器**

```tsx
const adminRegionVisibleIdsRef = useRef(adminRegionVisibleIds)
const adminRegionActiveOnlyRef = useRef(adminRegionActiveOnly)
adminRegionVisibleIdsRef.current = adminRegionVisibleIds
adminRegionActiveOnlyRef.current = adminRegionActiveOnly

const resolveCurrentAdminRegionIds = useCallback((): string[] | null => {
  const visibleIds = adminRegionVisibleIdsRef.current
  if (visibleIds !== undefined) return visibleIds
  return adminRegionActiveOnlyRef.current
    ? activeAdminRegionIdsRef.current ?? []
    : null
}, [])
```

扩展 refresh：

```tsx
const refreshAdminRegionLayers = useCallback((
  currentTileUrl: string,
  depth: AdminRegionDepth,
  focusRegionId: string,
  regionIds: string[] | null,
) => {
  const map = mapRef.current
  if (!map) return
  removeAdminRegionLayers()
  map.addSource(
    ADMIN_REGION_VECTOR_SOURCE_ID,
    createAdminRegionVectorTileSource({
      tileUrl: createMapboxTileUrl(currentTileUrl),
      focusRegionId,
      depth,
    }),
  )
  const activeRegionIds = regionIds ?? undefined
  map.addLayer(createAdminRegionFillLayer(activeRegionIds))
  map.addLayer(createAdminRegionLineLayer(activeRegionIds))
  map.addLayer(createAdminRegionSelectionFillLayer())
}, [removeAdminRegionLayers])
```

调用时增加 `resolveCurrentAdminRegionIds()`；过滤 effect 改用同一 resolver，并把 `adminRegionDepth` 加入依赖，确保 source 重建后再次同步。后续 visible IDs 变化只调用 `setFilter`，不重建 source。

- [ ] **Step 6: 运行前端聚焦测试并确认 GREEN**

```powershell
npm run test:web -- src/App.test.tsx src/components/MapboxCanvas.test.tsx --maxWorkers=1
```

Expected: PASS；`null` 仍表示显示全部，外部 ID 仍覆盖 legacy active endpoint，切级不重置视口。

- [ ] **Step 7: 提交无闪烁切换**

```powershell
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/MapboxCanvas.tsx apps/web/src/components/MapboxCanvas.test.tsx
git commit -m "fix: 消除行政区切级闪烁"
```

### Task 5: 完整验证与浏览器验收

**Files:**
- Verify only unless a test reveals a scoped defect.

- [ ] **Step 1: 复制只读本地数据基线**

只复制忽略文件，不运行任何重建：

```powershell
$source = Resolve-Path 'D:\Coding\EnRoute\data\footprints.sqlite'
$targetDir = 'D:\Coding\EnRoute\.worktrees\region-thumbnail-depth-switch\data'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $targetDir 'footprints.sqlite') -Force
```

Expected: worktree DB 存在；源数据库未修改，Git 仍忽略 `data/`。

- [ ] **Step 2: 运行全部自动化检查**

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Expected: web、api、repo 全部测试通过；lint/build 成功；无 whitespace error。

- [ ] **Step 3: 启动独立验证服务**

读取主工作区 `.env.local` 注入子进程但不复制或输出密钥。选择未占用端口，例如 web `5183`、api `5188`，日志写入 worktree `output/`。不得停止主工作区现有 `5173/5178` 服务。

- [ ] **Step 4: 桌面浏览器验证**

在 `1440 × 900`：

1. 打开地图区域页并切到“全部”时间。
2. 依次查看国、省、市、区。
3. 确认省/市/区共享完整中国轮廓，比例自然，无大片裂缝。
4. 确认按钮位于缩略图下方且没有外层背景框。
5. 快速往返切换四级，确认没有全部行政区帧且相机未重置。
6. 确认排行榜仍显示五行并可滚动。
7. 确认地图为 2D、无罗盘，底部工具条、回正、缩放、定位和配置按钮仍可用。

- [ ] **Step 5: 移动浏览器验证**

在 `390 × 844` 重复四级切换，确认缩略图、按钮、文本和排行榜不重叠，滚动区域几何稳定。

- [ ] **Step 6: 检查控制台与本地产物**

Expected: console `0 errors / 0 warnings`。截图只保存到 `output/playwright/region-thumbnail-depth-switch/`，保持 ignored，不提交。

- [ ] **Step 7: 检查提交范围**

```powershell
git status --short --branch
git log --oneline --decorate -8
git diff master...HEAD --stat
```

Expected: 只有规格、计划、缩略图、右栏布局和切级过滤相关改动；无数据库、环境变量、日志、截图或构建产物进入 Git。
