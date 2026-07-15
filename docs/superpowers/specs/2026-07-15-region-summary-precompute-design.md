# 区域缩略图与摘要预计算设计

## 背景

区域页右栏已经具备国、省、市、区切换、时间范围联动、到访计数和排行榜，但当前摘要链路仍把大量工作放在请求期：

- `/api/admin-regions/summary` 每次从原始 `footprints` 递归归并祖先行政区。
- 缩略图请求期解码 `admin_region_tiles`、修复几何、合并行政区并输出 SVG path。
- 静态底图和动态到访覆盖打包在同一个响应中，摘要未返回前 SVG 完全为空。
- 前端只请求当前层级，没有按时间范围缓存；切换层级会重新等待同类计算。

当前真实数据库下，四个层级的递归摘要查询各约 `280-314 ms`。只读实验表明，将足迹按上海时区预聚合到“日 + 层级 + 行政区”后，当前数据仅产生约 `1,047` 行，深度 1-4 的范围查询中位数约为 `0.086 / 0.095 / 0.140 / 0.544 ms`。中国 Z1 最终 SVG 约 `7,663` 字符，浏览器创建和绘制该 path 的成本远低于 `1 ms`；瓶颈不是 SVG，而是请求期几何和原始足迹归并。

另有一个独立但会干扰区域页验收的可见性缺陷：`refreshFootprintLayer()` 在时间范围变化后删除并重建 `footprints-circle`，新图层默认可见；当 `footprintsVisible` 仍为 `false` 时，可见性 effect 的依赖没有变化，因此不会再次写入 `visibility: none`。结果是“在区域页显示足迹点”关闭时，切换时间或层级后仍可能重新出现大量足迹点。

## 已确认目标

1. 世界静态底图使用现有国家级 Z0 视觉等价瓦片。
2. 中国静态底图及省、市、区到访覆盖使用现有 Z1 视觉等价瓦片。
3. 中国缩略图不显示南海远端岛礁，不使用角落插图；完整保留海南岛本体和台湾岛。
4. 世界或中国静态底图先独立显示，不等待当前时间范围的动态摘要。
5. 每个行政区预先生成最终 SVG path；请求期只按已到访行政区 ID 拼接 path，不做几何 union。
6. 足迹按上海时区预聚合到每日四层行政区统计，使日、周、月、年和自定义日期范围都能快速汇总。
7. 进入区域页或时间范围变化时，并行预取国、省、市、区四层摘要，并按“时间范围 + 层级”缓存。
8. 动态到访覆盖、计数、排行榜和主地图过滤作为一个完整摘要原子更新；加载或失败不能清空静态底图。
9. 预计算缺失、签名过期或数据不完整时明确返回错误，普通请求不得退回原始足迹递归、MVT 解码或实时几何构建。
10. 修复区域页足迹关闭状态在时间和层级切换后失效的问题。
11. 不清理、不重建、不迁移现有 `visual_tiles` 或 `admin_region_tiles`。

## 方案选择

采用“SQLite 持久预计算 + 独立静态底图接口 + 四层并行摘要预取”。

没有采用请求期内存缓存，因为冷启动、首次层级访问和签名变化后仍会支付完整几何成本，也无法保证底图先显示。没有把 SVG 固化到前端源码，因为轮廓来源是本地持久行政区数据，前端构建产物不应成为第二份难以校验的数据真相。SQLite 新表与现有瓦片同库，可以复用行政区数据生命周期，同时保持普通 API 只读。

## 数据模型

### 静态底图表

```sql
CREATE TABLE admin_region_thumbnail_bases (
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
```

- `world` 固定来自 `depth=1, z/x/y=0/0/0`。
- `china` 固定来自 `depth=2, z/x/y=1/1/0`。
- 两行都保存最终 `320 x 180` SVG path，不在请求期重新投影或简化。

### 行政区 path 表

```sql
CREATE TABLE admin_region_thumbnail_region_paths (
  depth INTEGER NOT NULL,
  region_id TEXT NOT NULL,
  path TEXT NOT NULL,
  source_signature TEXT NOT NULL,
  algorithm_signature TEXT NOT NULL,
  PRIMARY KEY (depth, region_id),
  CHECK (depth BETWEEN 1 AND 4)
) WITHOUT ROWID;
```

- 深度 1 来自国家级 Z0；深度 2-4 分别来自对应层级的 Z1 `1/1/0` 瓦片。
- 每行已经完成瓦片坐标还原、固定画幅投影、裁切、修复、简化和路径量化。
- 同一层级的所有 path 使用完全相同的投影与量化规则。请求期按稳定的 `region_id` 顺序直接连接字符串，作为一个 SVG `<path>` 的多个子路径输出，不再调用 Shapely union。

### 每日行政区统计表

```sql
CREATE TABLE admin_region_daily_stats (
  depth INTEGER NOT NULL,
  day INTEGER NOT NULL,
  region_id TEXT NOT NULL,
  footprint_count INTEGER NOT NULL,
  PRIMARY KEY (depth, day, region_id),
  CHECK (depth BETWEEN 1 AND 4),
  CHECK (footprint_count > 0)
) WITHOUT ROWID;
```

- `day` 使用现有 `YYYYMMDD` 编码和上海时区日期口径。
- 构建时把每个足迹的最细 `region_id` 沿 `admin_region_tree` 归并到深度 1-4，再按日聚合。
- 任意日期范围只需按 `depth` 与 `day BETWEEN start AND end` 查询并对 `region_id` 求和。
- `totalCount`、名称和排行聚焦 bounds 继续从轻量的 `admin_regions` 元数据读取，不访问其 geometry 字段。
- 深度 1 的分母和排行继续排除南极洲；深度 2-4 继续只使用当前中国行政区范围，统计口径不因缩略图裁切变化。

### 就绪签名

使用 `footprint_meta` 保存三类就绪签名：

- `adminRegionThumbnailBasePrecomputeSignature`
- `adminRegionThumbnailPathPrecomputeSignature`
- `adminRegionDailyStatsPrecomputeSignature`

底图签名只覆盖国家级 Z0 与省级 Z1 两行源瓦片；逐行政区 path 签名覆盖深度 1 的 Z0 和深度 2-4 的 Z1，共四行必需源瓦片。签名包含预计算算法版本及相应瓦片的 `(depth, z, x, y, algorithm_signature, updated_at, byte_length)`。静态底图接口只校验底图签名，摘要接口只校验 path 与每日统计签名，因此动态预计算失效不会连带清空仍然有效的静态底图。

仓库内会改变 `footprints.region_id`、足迹行或行政区树的写入路径必须删除每日统计就绪签名；会改变相关行政区瓦片的写入路径必须按受影响层级删除底图或逐行政区 path 签名。显式构建成功并提交事务后才重新写入签名。普通 API 不设置签名、不补数据，也不把“表存在但为空”视为 ready。

## 预计算构建器

新增显式命令：

```powershell
npm run prepare:admin-region-summary
```

构建器执行以下步骤：

1. 以只读方式核对国家 Z0、中国省级 Z1，以及深度 2-4 对应 Z1 源瓦片均存在且签名可接受。
2. 生成世界和中国两个最终底图 path。
3. 生成深度 1-4 的逐行政区最终 path。
4. 一次读取足迹与行政区树，生成四层每日统计。
5. 在一个 SQLite 事务中替换三张新表并写入就绪签名；任何步骤失败则回滚，保留上一次完整结果。

中国缩略图使用固定南界约 `17.5°N`。裁切只发生在缩略图 path 构建中：海南最南端仍留有安全余量，台湾完整保留，南海远端离散组件被裁掉。该边界不改变行政区 ID、到访计数、排行榜、主地图 MVT 或全屏地图边界。

构建器的写入范围严格限定为：

- `admin_region_thumbnail_bases`
- `admin_region_thumbnail_region_paths`
- `admin_region_daily_stats`
- 上述三个 `footprint_meta` 就绪键

允许在该事务内执行的删除也只针对这三张新表。构建器不得调用 `build_visual_tiles`、`clear_admin_region_tiles` 或 `build_admin_region_tiles`，不得执行 `DELETE FROM visual_tiles`、`DELETE FROM admin_region_tiles` 或任何 `DROP TABLE`。

## API 设计

### 静态底图

```text
GET /api/admin-regions/thumbnail-bases
```

响应一次返回两个很小的持久 path：

```json
{
  "viewBox": "0 0 320 180",
  "signature": "...",
  "bases": {
    "world": { "path": "M...Z" },
    "china": { "path": "M...Z" }
  }
}
```

该接口只读 `admin_region_thumbnail_bases` 和就绪元数据。它与时间范围和当前层级无关，因此前端可在应用启动后立即预取并在整个会话中复用。

### 动态摘要

```text
GET /api/admin-regions/summary?depth=3&start=2026-01-01&end=2026-07-15
```

响应不再携带静态 `basePath`，只返回当前 key 的完整动态状态：

```json
{
  "depth": 3,
  "visitedRegionIds": ["310100", "330100"],
  "visitedCount": 2,
  "totalCount": 392,
  "visitedPath": "M...Z",
  "rankings": [
    {
      "rank": 1,
      "regionId": "310100",
      "name": "上海市",
      "footprintCount": 8426,
      "bounds": {
        "west": 120.8,
        "south": 30.6,
        "east": 122.2,
        "north": 31.9
      }
    }
  ]
}
```

摘要执行顺序为：

1. 把 `start/end` 编码为上海时区的 `YYYYMMDD` 边界，从每日统计表汇总各区域点数；`range=all` 直接汇总该表的全部日期，不再读取原始足迹时间边界。
2. 与 `admin_regions` 的名称和 bounds 联接并稳定排序。
3. 从逐区域 path 表批量读取已到访 ID 的 path，按 ID 连接为 `visitedPath`。
4. 一次返回覆盖、计数、排行和主地图过滤 ID。

摘要读取使用独立的 SQLite `mode=ro` 连接，不占用 `FootprintStore` 的全局连接锁，使四个层级请求可以真正并发。请求期禁止读取原始 `footprints`、`admin_region_tree`、行政区 geometry 或瓦片 BLOB。

### 缺失与过期

- 静态底图预计算不可用时，底图接口返回 HTTP `503` 和稳定错误码。
- 每日统计或逐区域 path 不可用时，对应摘要返回 HTTP `503`。
- 输入日期和 depth 仍按现有规则返回 `400`。
- 任何 `503` 都不触发后台构建、原始几何回退、bounds 矩形回退或旧慢查询。

## 前端数据流

### 静态底图先显示

`App` 启动后即发起一次底图请求，并把结果保存在会话级内存缓存。区域页第一张卡按当前层级选择：

- 国：`bases.world.path`
- 省、市、区：`bases.china.path`

底图状态与动态摘要状态完全分离。时间范围变化、四层摘要加载、摘要失败或重试都不得把已有底图 path 设为空。

### 四层并行预取

进入区域页以及区域页内时间范围变化时，同时发起深度 `1, 2, 3, 4` 四个摘要请求。数据源维护：

- 已完成缓存：key 为 `start + end + depth`。
- 进行中请求去重：相同 key 只保留一个 Promise。
- 有界会话缓存：最多保留最近 8 个时间范围，即 32 个深度结果。
- 重试绕过当前 key 的失败状态并替换成功结果，不缓存失败响应。

每个缓存值是一份完整 `AdminRegionSummary`。前端只在一个响应校验完成后同时替换 `visitedPath`、计数、排行和 `visitedRegionIds`，不逐字段提交。切换到已预取层级时直接读缓存，不再发请求。

当新时间范围或未命中层级尚未就绪时：

- 静态底图继续显示。
- 动态覆盖和排行榜使用固定尺寸加载状态，不显示旧 key 的数据。
- 主地图在“显示全部行政区”关闭时使用空 ID 过滤，绝不闪现全部行政区。
- 新摘要到达后，动态 SVG、计数、排行和主地图过滤在同一次状态更新中出现。

离开区域页或时间范围再次变化时取消旧请求；旧响应不得覆盖新 key。

## 足迹可见性修复

`MapboxCanvas` 增加保存最新 `footprintsVisible` 的 ref。每次 `refreshFootprintLayer()` 创建 `footprints-circle` 时，图层定义直接携带当前 `layout.visibility`，而不是依赖随后可能不运行的 effect 修正。

可见性 effect 继续处理普通开关变化和样式重载，但“图层创建时状态正确”成为不变量。回归场景必须覆盖：

1. 进入区域页且“在区域页显示足迹点”关闭。
2. 时间范围变化导致足迹 source/layer 重建。
3. 连续切换国、省、市、区。
4. `footprints-circle` 始终为 `visibility: none`，切回足迹页后恢复为 `visible`。

## 性能与验收标准

在当前本地数据库和服务已启动的前提下：

- 静态底图接口不得执行几何解码或 union，首次本地请求目标低于 `50 ms`，后续会话内层级切换无网络等待。
- 单层摘要 SQL 目标低于 `5 ms`，四层并行请求端到端目标低于 `100 ms`；浏览器验收以 `200 ms` 内完成四层动态状态为上限，避免把机器调度噪声写成脆弱单测。
- 人为把摘要响应延迟 `500 ms` 时，世界或中国底图仍先可见且不闪空。
- 层级切换命中缓存时，不新增 summary 网络请求。
- 请求期调用旧的 MVT 解码、Shapely union 或原始足迹递归函数应由测试直接判为失败。

## 测试设计

### 后端

- 新表 schema、主键、`WITHOUT ROWID` 和正数约束。
- 世界 Z0、中国 Z1 来源选择与签名校验。
- 中国裁切后完整保留海南和台湾，排除 `17.5°N` 以南远端组件。
- 深度 1-4 每个行政区 path 预绘制，省、市、区共享中国静态底图。
- 上海时区跨日、祖先归并、日期范围求和、稳定排行和空范围。
- 缺表、缺行、缺签名和算法签名过期均返回 `503`，不进入慢速回退。
- 摘要只访问新统计/path 表与 `admin_regions` 非 geometry 字段。
- 构建前后 `visual_tiles` 与 `admin_region_tiles` 的行数、内容摘要和签名保持完全不变。
- 构建中故意抛错时事务回滚，上一次完整预计算仍保留。

### 前端

- 底图请求与四个摘要请求彼此独立，底图可在摘要未完成时渲染。
- 每个时间范围恰好并行请求四个深度；层级切换命中缓存。
- 旧时间范围响应、AbortError、单层失败和重试行为。
- 动态覆盖、计数、排行和主地图过滤原子更新。
- 加载与错误不清空静态底图，不改变卡片尺寸。
- 足迹图层在隐藏状态下经历时间变化、层级切换和样式重载后仍隐藏。

### 浏览器

- 桌面 `1440 x 900` 与移动 `390 x 844` 检查世界、中国和四层切换。
- 中国构图完整显示大陆、海南、台湾，不显示南海远端岛礁，也没有角落插图。
- 世界和中国保持当前自然比例及 `16:9` 稳定画幅，不被 CSS 非等比拉伸。
- 人为延迟动态摘要，确认底图先显示；动态完成后整组更新。
- 快速切换时间和层级，主地图不闪现全部行政区，足迹开关关闭时不回显点。
- 排行最多显示五行并可滚动，控制台无 Mapbox 运行时错误。

完成实现后仍需运行：

```powershell
npm test
npm run lint
npm run build
```

## 文档与本地数据迁移

- `README.md` 增加 `npm run prepare:admin-region-summary`，并说明普通 API 只读预计算、缺失时返回明确错误。
- 实现验证先在 worktree 的已复制 SQLite 基线上运行构建器并核对三张新表。
- 合入主分支后，如需让当前本地服务立即使用新快路径，只对主工作区数据库执行这一新增显式构建器；执行前后核对 `visual_tiles=63,221` 与 `admin_region_tiles=95,020` 未变化。
- 不运行 `prepare:footprint-tiles` 或 `prepare:admin-region-tiles`，不清理任何既有视觉瓦片。

## 非目标

- 不改变全屏地图的行政区几何、边界线、世界观、语言或瓦片算法。
- 不改变到访计数和排行榜“按足迹点数量”的产品口径。
- 不在缩略图中增加标签、描边、海洋、交互、南海插图或第二个地图实例。
- 不预计算所有可能的日期范围组合；每日统计已经能精确覆盖任意日期范围。
- 不把预计算缺失修复放进普通请求或应用启动路径。
- 不修改足迹页、统计页或其他右侧栏设计。
