# 区域缩略图 z1 轮廓实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让区域右栏的世界与中国缩略图按自然比例完整显示，并让省、市、区使用现有 `z=1/x=1/y=0` 行政区瓦片呈现大陆、海南、台湾和南海诸岛。

**Architecture:** 后端摘要接口继续只返回 `viewBox/basePath/visitedPath`，但把行政区瓦片及其 `z/x/y` 上下文绑定成一个不可变值对象；世界使用 depth 1 的 z0，中国底图固定使用 depth 2 的 z1，当前到访覆盖使用所选 depth 的 z1。投影先把 MVT 局部坐标还原为全局经纬度，再以标准纬线 35 度修正的等距圆柱投影映射到 `320 x 180`；缺失瓦片只读回退到已有 z0/raw/bounds，不触发构建或数据库写入。

**Tech Stack:** Python 3.12、FastAPI、SQLite、Shapely、mapbox-vector-tile、React 19、TypeScript 6、Vitest、Playwright

---

## 文件结构

- 修改 `apps/api/src/enroute_api/admin_regions/thumbnail.py`：封装缩略图瓦片坐标上下文、选择 z1/z0 只读数据源、执行自然比例投影并保留离散岛屿组件。
- 修改 `apps/api/tests/test_admin_region_summary.py`：构造可指定 `z/x/y` 的合成 MVT，锁定 z1 选择、坐标还原、共享底图、南海组件、投影比例和无写入降级。
- 修改 `apps/web/src/components/AdminRegionContextPanel.tsx`：把无摘要时的 SVG 回退画幅同步为 `320 x 180`。
- 修改 `apps/web/src/components/AdminRegionContextPanel.test.tsx`：锁定服务端及回退 `viewBox`、`preserveAspectRatio` 和控件顺序。
- 修改 `apps/web/src/App.test.tsx`：同步摘要 fixture 的 `viewBox` 契约。
- 修改 `apps/web/src/components/mapLayout.test.ts`：锁定缩略图 `16 / 9` 比例。
- 修改 `apps/web/src/App.css`：将缩略图容器改为稳定的 `16 / 9`，不新增边框或二次拉伸。

### Task 1: 为缩略图瓦片绑定 z/x/y 上下文并优先读取中国 z1

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/thumbnail.py:41-287`
- Test: `apps/api/tests/test_admin_region_summary.py:350-419`
- Test helper: `apps/api/tests/test_admin_region_summary.py:977-1044`

- [ ] **Step 1: 扩展测试瓦片 helper，使测试能明确写入 z0 或 z1**

将 helper 签名和插入参数改为：

```python
def insert_thumbnail_tile(
    connection: sqlite3.Connection,
    *,
    depth: int,
    z: int = 0,
    x: int = 0,
    y: int = 0,
    included_region_ids: set[str] | None = None,
    x_offset: int = 0,
    adjacent: bool = False,
) -> bytes:
    tile_scale = 2 ** z

    def tile_point(global_x: int, global_y: int) -> list[int]:
        return [
            (global_x + x_offset) * tile_scale - x * 4096,
            global_y * tile_scale - y * 4096,
        ]

    second_top = 1600 if adjacent else 1640
    second_bottom = 1640 if adjacent else 1680
    features = [
        {
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    tile_point(3400, 1600),
                    tile_point(3430, 1600),
                    tile_point(3430, 1640),
                    tile_point(3400, 1640),
                    tile_point(3400, 1600),
                ]],
            },
            "properties": {"region_id": "310100", "level": depth, "kind": "fill"},
        },
        {
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    tile_point(3370, second_top),
                    tile_point(3400, second_top),
                    tile_point(3400, second_bottom),
                    tile_point(3370, second_bottom),
                    tile_point(3370, second_top),
                ]],
            },
            "properties": {"region_id": "330100", "level": depth, "kind": "fill"},
        },
    ]
    included_ids = {"310100", "330100"} if included_region_ids is None else included_region_ids
    selected_features = [
        feature
        for feature in features
        if feature["properties"]["region_id"] in included_ids
    ]
    tile = encode(
        [{"name": "admin_regions", "features": selected_features}],
        default_options={"extents": 4096, "y_coord_down": True},
    )
    connection.execute(
        """
        INSERT INTO admin_region_tiles (
          z, x, y, focus_region_id, depth, algorithm_signature,
          tile, feature_count, updated_at
        ) VALUES (?, ?, ?, 'world', ?, 'thumbnail-test-v1', ?, ?, 1)
        """,
        (z, x, y, depth, tile, len(selected_features)),
    )
    connection.commit()
    return tile
```

- [ ] **Step 2: 写出 z1 优先选择、共享省级底图和只读降级的失败测试**

新增测试并用 trace callback 记录 SQL：

```python
@pytest.mark.parametrize("depth", [2, 3, 4])
def test_china_thumbnail_prefers_z1_tile_with_coordinate_context(
    connection: sqlite3.Connection,
    depth: int,
):
    insert_thumbnail_tile(connection, depth=2, z=0, x=0, y=0, x_offset=-600)
    insert_thumbnail_tile(connection, depth=2, z=1, x=1, y=0)
    if depth != 2:
        insert_thumbnail_tile(connection, depth=depth, z=1, x=1, y=0, x_offset=depth * 20)

    thumbnail = create_admin_region_thumbnail(
        connection,
        depth=depth,
        visited_region_ids={"310100"},
    )

    assert thumbnail["viewBox"] == "0 0 320 180"
    assert thumbnail["basePath"].startswith("M")
    assert thumbnail["visitedPath"].startswith("M")
```

补充一个省/市/区共享底图断言：三个层级分别插入 z1 后，`basePath` 必须完全相同，`visitedPath` 必须随当前 depth 改变。再补充缺失当前 depth z1 的测试，断言仍使用省级 z1 底图、到访从 raw/bounds 得到，并且 trace 中不存在 `INSERT`、`UPDATE`、`DELETE`、`DROP`、`CREATE`。

- [ ] **Step 3: 运行聚焦测试并确认 RED**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path apps/api/src)
python -m pytest apps/api/tests/test_admin_region_summary.py -k "z1 or shared_china_base or missing_current_tile" -q
```

Expected: FAIL；当前查询固定要求 `z=0/x=0/y=0`，返回 `viewBox` 仍是 `0 0 320 150`，且 z1 局部坐标无法按预期落位。

- [ ] **Step 4: 新增不可变瓦片值对象并让 Source 携带坐标上下文**

在 `AdminRegionThumbnailSource` 前新增：

```python
@dataclass(frozen=True)
class AdminRegionThumbnailTile:
    z: int
    x: int
    y: int
    content: bytes

    @property
    def key(self) -> tuple[int, int, int]:
        return self.z, self.x, self.y
```

并把 source 字段改为：

```python
tile: AdminRegionThumbnailTile | None = None
china_base_tile: AdminRegionThumbnailTile | None = None
```

定义唯一的选择规则：

```python
WORLD_THUMBNAIL_TILE = (0, 0, 0)
CHINA_THUMBNAIL_TILE = (1, 1, 0)

def preferred_thumbnail_tile_key(depth: int) -> tuple[int, int, int]:
    return WORLD_THUMBNAIL_TILE if depth == 1 else CHINA_THUMBNAIL_TILE
```

- [ ] **Step 5: 把 metadata/content 查询改为按明确 tile key 只读选择**

`read_admin_region_thumbnail_source()` 读取以下候选四元组：

```python
requested_tile_keys = {(depth, *preferred_thumbnail_tile_key(depth))}
if depth > 1:
    requested_tile_keys.update({
        (2, *CHINA_THUMBNAIL_TILE),
        (2, *WORLD_THUMBNAIL_TILE),
    })
```

查询结果必须包含 `z, x, y, depth`，metadata key 也必须包含四元组 `(depth, z, x, y)`；当前内容只接受所选 depth 的 preferred key，中国底图先取 `(depth=2,z=1,x=1,y=0)`，缺失时只读取 `(depth=2,z=0,x=0,y=0)`。当前 depth 的 z1 缺失时进入现有 raw/bounds 流程，不把 z0 当作到访覆盖，也不调用任何 builder。

- [ ] **Step 6: 运行聚焦测试并确认 GREEN**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path apps/api/src)
python -m pytest apps/api/tests/test_admin_region_summary.py -k "z1 or shared_china_base or missing_current_tile" -q
```

Expected: PASS；trace 仅包含 `SELECT`/PRAGMA/事务语句。

- [ ] **Step 7: 提交数据源选择改动**

```powershell
git add apps/api/src/enroute_api/admin_regions/thumbnail.py apps/api/tests/test_admin_region_summary.py
git commit -m "fix: 缩略图读取中国z1行政区瓦片"
```

### Task 2: 修正投影比例并完整保留南海离散组件

**Files:**
- Modify: `apps/api/src/enroute_api/admin_regions/thumbnail.py:18-29`
- Modify: `apps/api/src/enroute_api/admin_regions/thumbnail.py:401-595`
- Modify: `apps/api/src/enroute_api/admin_regions/thumbnail.py:690-811`
- Test: `apps/api/tests/test_admin_region_summary.py:287-349`
- Test: `apps/api/tests/test_admin_region_summary.py:420-480`

- [ ] **Step 1: 写出自然比例、z1 坐标还原和南海组件保留的失败测试**

把原来的“经纬一度同尺度”断言改为标准纬线修正：

```python
@pytest.mark.parametrize("depth", [1, 2, 3, 4])
def test_thumbnail_projection_uses_standard_parallel_correction(depth: int):
    frame = WORLD_BOUNDS if depth == 1 else CHINA_BOUNDS
    west, south, east, north = frame
    projected = project_geographic_bounds(west, south, east, north, depth=depth)
    horizontal_scale = (projected[2] - projected[0]) / (east - west)
    vertical_scale = (projected[3] - projected[1]) / (north - south)

    assert horizontal_scale / vertical_scale == pytest.approx(
        math.cos(math.radians(35.0)),
    )
    assert projected[0] >= VIEWBOX_PADDING
    assert projected[1] >= VIEWBOX_PADDING
    assert projected[2] <= VIEWBOX_WIDTH - VIEWBOX_PADDING
    assert projected[3] <= VIEWBOX_HEIGHT - VIEWBOX_PADDING
```

增加 z1 局部坐标测试，分别验证 `(z=0,x=0,y=0,local=2048/2048)` 还原到约 `(0,0)`，以及 `(z=1,x=1,y=0,local=0/4096)` 还原到约 `(0,0)`。增加一个合成 depth 2 z1 tile，包含大陆、海南、台湾和北纬 17 度以南的两个离散小多边形，断言 `basePath.count("M") >= 5` 且 path bounds 全部落在 `320 x 180` 内。

- [ ] **Step 2: 运行投影与几何测试并确认 RED**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path apps/api/src)
python -m pytest apps/api/tests/test_admin_region_summary.py -k "projection or tile_position or south_china_sea or fixed_world" -q
```

Expected: FAIL；当前横纵比例为 1、z1 坐标按 z0 解读、北纬 17 度以南组件被裁掉，且画幅仍为 150 高。

- [ ] **Step 3: 更新画幅、地理范围和标准纬线常量**

```python
VIEWBOX_WIDTH = 320.0
VIEWBOX_HEIGHT = 180.0
VIEWBOX_PADDING = 6.0
VIEWBOX = "0 0 320 180"
STANDARD_PARALLEL_DEGREES = 35.0
LONGITUDE_SCALE = math.cos(math.radians(STANDARD_PARALLEL_DEGREES))
WORLD_BOUNDS = (-180.0, -58.0, 180.0, 85.0)
CHINA_BOUNDS = (73.0, 4.0, 136.0, 55.0)
```

- [ ] **Step 4: 让地理投影使用修正后的横向距离并保持统一 SVG 尺度**

`project_geographic_position()` 按以下公式计算：

```python
projected_width = (east - west) * LONGITUDE_SCALE
projected_height = north - south
scale = min(available_width / projected_width, available_height / projected_height)
content_width = projected_width * scale
content_height = projected_height * scale
offset_x = (VIEWBOX_WIDTH - content_width) / 2
offset_y = (VIEWBOX_HEIGHT - content_height) / 2
return (
    offset_x + (longitude - west) * LONGITUDE_SCALE * scale,
    offset_y + (north - latitude) * scale,
)
```

- [ ] **Step 5: 用 tile context 将 MVT 局部坐标还原到全局 Web Mercator**

把 tile 投影入口改为显式接收 `AdminRegionThumbnailTile`：

```python
def project_tile_position(
    x: float,
    y: float,
    *,
    tile: AdminRegionThumbnailTile,
    depth: int,
) -> tuple[float, float]:
    tile_count = 2 ** tile.z
    global_x = tile.x * MVT_EXTENT + x
    global_y = tile.y * MVT_EXTENT + y
    world_extent = MVT_EXTENT * tile_count
    longitude = global_x / world_extent * 360.0 - 180.0
    mercator_y = math.pi - 2.0 * math.pi * global_y / world_extent
    latitude = math.degrees(math.atan(math.sinh(mercator_y)))
    return project_geographic_position(longitude, latitude, depth=depth)
```

`project_tile_geometry()`、`project_tile_bounds()`、`build_tile_base_path()` 和 `build_china_base_tile_path()` 必须一路透传同一个 tile 值对象；中国 base 使用 depth 2 tile 的 context，visited 使用当前 depth tile 的 context。

- [ ] **Step 6: 保留离散多边形组件再简化**

中国底图不再在 tile 局部坐标中用 `preserve_topology=False` 预简化。先 `make_valid/force_2d`，按行政区合并并投影到 SVG，再使用 `simplify(0.6, preserve_topology=True)`；`bounded_geometry_path()` 的逐级简化也改用 `preserve_topology=True`。继续移除省际共享边和内部孔洞，但不平移、拼接或另画南海插图。

- [ ] **Step 7: 运行整个缩略图 API 测试并确认 GREEN**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path apps/api/src)
python -m pytest apps/api/tests/test_admin_region_summary.py -k "thumbnail" -q
```

Expected: PASS；响应只包含 `viewBox/basePath/visitedPath`，所有路径仍满足长度上限。

- [ ] **Step 8: 提交投影与几何改动**

```powershell
git add apps/api/src/enroute_api/admin_regions/thumbnail.py apps/api/tests/test_admin_region_summary.py
git commit -m "fix: 修正区域缩略图轮廓比例"
```

### Task 3: 同步前端 16:9 画幅契约

**Files:**
- Modify: `apps/web/src/components/AdminRegionContextPanel.tsx:56-70`
- Modify: `apps/web/src/components/AdminRegionContextPanel.test.tsx:13-22`
- Modify: `apps/web/src/App.test.tsx:110-135`
- Modify: `apps/web/src/components/mapLayout.test.ts:2008-2031`
- Modify: `apps/web/src/App.css:2366-2371`

- [ ] **Step 1: 先把组件、fixture 与布局测试期望改为新契约**

在组件测试中使用：

```typescript
thumbnail: {
  viewBox: '0 0 320 180',
  basePath: 'M0 0L320 0L320 180L0 180Z',
  visitedPath: 'M10 10L80 10L80 60L10 60Z',
},
```

增加无 summary 时的断言：

```typescript
const fallbackThumbnail = screen.getByLabelText('城市足迹缩略图')
expect(fallbackThumbnail).toHaveAttribute('viewBox', '0 0 320 180')
expect(fallbackThumbnail).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
```

在 `mapLayout.test.ts` 中把 CSS 断言改为 `aspect-ratio: 16 / 9`，并保留 depth control 位于 SVG 后方、外层 `padding: 0`、`border-radius: 0`、`background: transparent` 的断言。

- [ ] **Step 2: 运行前端聚焦测试并确认 RED**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts src/App.test.tsx
```

Expected: FAIL；组件回退仍是 `320 x 150`，CSS 仍是 `32 / 15`。

- [ ] **Step 3: 修改组件回退画幅与 CSS 比例**

`AdminRegionContextPanel.tsx`：

```tsx
viewBox={summary?.thumbnail.viewBox ?? '0 0 320 180'}
preserveAspectRatio="xMidYMid meet"
```

`App.css`：

```css
.admin-region-atlas-card__thumbnail {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
}
```

不增加 SVG 边框、背景框、transform 或固定高度；底图和到访 path 仍只使用 fill。

- [ ] **Step 4: 运行前端聚焦测试并确认 GREEN**

Run:

```powershell
npm --workspace apps/web run test -- --run src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts src/App.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 提交前端契约改动**

```powershell
git add apps/web/src/components/AdminRegionContextPanel.tsx apps/web/src/components/AdminRegionContextPanel.test.tsx apps/web/src/App.test.tsx apps/web/src/components/mapLayout.test.ts apps/web/src/App.css
git commit -m "fix: 同步区域缩略图十六比九画幅"
```

### Task 4: 真实数据、浏览器与完整回归验收

**Files:**
- Verify only: `data/footprints.sqlite`
- Local output only: `output/playwright/region-thumbnail-depth-switch/`

- [ ] **Step 1: 在真实数据库上只读记录验收前行数**

Run:

```powershell
@'
import sqlite3
db = sqlite3.connect('data/footprints.sqlite')
for table in ('footprints', 'footprint_spatial', 'visual_tiles', 'admin_region_tiles'):
    print(table, db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0])
db.close()
'@ | python -
```

Expected: 四张表均输出当前基线；本步骤和后续验收都不得运行 `prepare:admin-region-tiles`、`prepare:footprint-tiles` 或任何清理语句。

- [ ] **Step 2: 用真实 API 响应验证三个中国层级共享底图且路径完整**

请求独立 worktree API 的 depth 1/2/3/4 摘要，断言四个响应均为 `viewBox == "0 0 320 180"`，depth 2/3/4 的 `basePath` 完全相同、非空且长度小于 `MAX_THUMBNAIL_PATH_LENGTH`，各层级 `visitedPath` 随时间和 depth 独立变化。解析 path 命令，确认中国底图包含多个离散 `M` 组件，坐标都在 `[0,320] x [0,180]`。

- [ ] **Step 3: 在 1440x900 浏览器逐级验收并保存本地截图**

使用已启动的 worktree Web `http://127.0.0.1:5183`，依次切换国、省、市、区：

- 世界轮廓比例自然，无横向压扁或 CSS 拉伸。
- 中国大陆、海南、台湾、南海诸岛按真实相对位置连续完整显示，无角落插图和插图框。
- 省、市、区底图轮廓完全一致，到访强调色随层级及时间范围变化。
- 国/省/市/区按钮位于缩略图下方，按钮组外侧无框。
- 排行最大可见五行且可滚动，文字和控件无重叠。
- 快速连续切级时主地图不闪现全部行政区，不重置相机。
- 控制台无 React、Mapbox 或 API 错误。

截图仅保存到 `output/playwright/region-thumbnail-depth-switch/`，不加入 Git。

- [ ] **Step 4: 在 390x844 浏览器重复关键验收**

确认 SVG 比例不变形、岛屿仍可辨认、右栏内容不横向溢出，层级按钮和排行榜不重叠。保存本地截图但不提交。

- [ ] **Step 5: 运行完整验证**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Expected: 所有命令退出码为 0；构建只生成被忽略的 `apps/web/dist/`。

- [ ] **Step 6: 复核数据库行数没有变化**

重复 Step 1 的只读计数命令。

Expected: `footprints`、`footprint_spatial`、`visual_tiles`、`admin_region_tiles` 与验收前逐项相同。

- [ ] **Step 7: 提交验收所需的剩余测试修正（仅在存在 tracked diff 时）**

```powershell
git status --short
git add apps/api/tests apps/web/src
git commit -m "test: 补充区域缩略图真实比例回归"
```

若 `git status --short` 为空则跳过本提交；不得提交 `data/`、`output/`、`.env.local`、日志、PID 或截图。

- [ ] **Step 8: 请求代码审查并准备本地合并**

使用 `superpowers:requesting-code-review` 对照设计文档和本计划审查 diff；修复发现后重新运行 Step 5。随后使用 `superpowers:finishing-a-development-branch`，先把本地 `master` 新增的藏南国家边界线补丁合入/解决冲突，再按用户要求本地合并，不执行 `git push`。
