# 足迹瓦片视觉等价终态架构设计

## 目标

位置页的足迹点渲染必须从当前“视口请求 + 临时视觉等价抽稀”升级为“瓦片化 + 预计算视觉等价 cell + 实时 MVT 输出”。目标是支撑百万级以上足迹点，并让 Mapbox 只加载当前视口需要的瓦片。

本设计只覆盖足迹点。行政区划多边形 MVT、修改/删除既有足迹点、MVT 热点缓存不进入本阶段。

瓦片金字塔和地图相机都以 18 级为上限。视觉等价预计算覆盖 `z=0..18`，但只写入有足迹点落入的 `z/x/y/t_type/t` 组合。

瓦片化和视觉等价抽稀不是互相替代的两件事。瓦片化负责“只请求当前视口需要的空间块，并卸载移出视口的块”；视觉等价负责“在某个 tile 内，把屏幕上重合的足迹点压成一个代表点”。最终架构中，视觉等价发生在 tile 内，结果按 `z/x/y/t_type/t` 持久化。

核心约束：

```text
1. 原始足迹库只存 WGS-84。
2. visual_tiles 只存存在足迹点的 z/x/y/t_type/t。
3. 不存在足迹点的 z/x/y/t_type/t 不建行，缺行即为空。
4. dirty 只更新已有行，保留旧 cells；不存在的行不插 dirty 占位。
5. 代表点只按 cell 是否存在做 0/1 OR，不存 count。
6. MVT 第一阶段实时生成，不持久化。
```

## 坐标基准

足迹原始库以 WGS-84 为规范坐标。当前本地 `external\backUpData-all.csv` 被视为 WGS-84 来源数据，实施时必须用它全量重建 `data\footprints.sqlite`。

现有库中如果已经存了 GCJ-02 坐标，不能沿用。迁移时要删除或重建旧 SQLite 数据库，并确保导入后的 `footprints.longitude` / `footprints.latitude` 保持 WGS-84，不再在导入层转换成 GCJ-02。

Mapbox 和 MVT 都以 WGS-84 语义输入，经 WebMercator 投影到 tile 坐标。高德时代的 GCJ-02 存储不再作为足迹 canonical 数据。

本地源数据要求：

```text
source CSV: external\backUpData-all.csv
source coordinate system: WGS-84
target SQLite: data\footprints.sqlite
target coordinate system: WGS-84
```

实现时必须用源 CSV 全量重建目标 SQLite。现有 SQLite 只要疑似含有 GCJ-02 偏移，就不能作为迁移基线。

## 三层结构

### 1. 原始足迹层

原始足迹层是唯一事实源，继续使用 SQLite：

```sql
CREATE TABLE footprints (
  timestamp_seconds INTEGER PRIMARY KEY,
  longitude REAL NOT NULL,
  latitude REAL NOT NULL,
  accuracy REAL NOT NULL,
  speed REAL NOT NULL,
  distance REAL NOT NULL,
  heading REAL NOT NULL,
  altitude REAL NOT NULL,
  region_id TEXT,
  country_id TEXT
);

CREATE VIRTUAL TABLE footprint_spatial USING rtree(
  footprint_rowid,
  min_lng,
  max_lng,
  min_lat,
  max_lat
);
```

现有字段足够支撑第一版瓦片视觉等价。视觉代表点只依赖 `timestamp_seconds`、`longitude`、`latitude`，其余字段继续服务统计、区域归属和未来扩展。

`footprint_spatial` 是原始点空间索引，用于后台构建某个 `z/x/y` tile 时快速找到该 tile bbox 内的原始点。

原始足迹层不服务前端海量渲染。它只作为导入、统计、区域归属、后台重建视觉 tile 的事实源。前端地图请求不应直接拉取大批原始点。

### 2. 瓦片视觉索引与结果层

任务索引和视觉等价结果使用同一张 SQLite 表保存。逻辑上仍分为两类职责：`status` 是任务状态，`cells` 是视觉结果。

```sql
CREATE TABLE visual_tiles (
  z INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  t_type INTEGER NOT NULL,
  t INTEGER NOT NULL,
  status INTEGER NOT NULL,
  cells BLOB,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (z, x, y, t_type, t)
) WITHOUT ROWID;
```

`t_type` 使用整数枚举：

```text
0 = all
1 = year
2 = month
3 = day
```

`t` 使用整数编码：

```text
all   -> 0
year  -> 2026
month -> 202606
day   -> 20260623
```

状态：

```text
ready = 1
dirty = 2
```

存储规则：

```text
没有足迹点的 z/x/y/t_type/t 不建行。
有行 + ready 表示 cells 可直接服务。
有行 + dirty 表示已有 cells 可以作为旧 ready 结果返回，同时后台重建。
```

这是硬约束，不是优化项。`visual_tiles` 只存“存在足迹点”的 `z/x/y/t_type/t`；不存在足迹点的组合不能写入空 BLOB、不能写入 `empty` 状态、不能写入 count=0 行。请求某个 `z/x/y/t_type/t` 查不到行时，含义就是该组合为空，后端直接参与 OR 为 0。

`dirty` 只用于已有行，表示这行已有旧 `cells` 可返回，但结果已经过期，需要后台重建。同一个 `z/x/y/t_type/t` 不会因为 dirty 另建第二行；更新状态时使用同一主键覆盖同一行。

如果新增点落入一个过去没有记录的 `z/x/y/t_type/t`，不要先向 `visual_tiles` 插入 dirty 占位行。后台构建器可以把这个键作为待构建候选；请求期间因为查不到行仍然视为空。构建完成且确实有 cells 后，才插入该主键的 ready 行。

本阶段不新增单独任务表。候选键只在导入流程、后台构建批次或进程内队列中传递；`visual_tiles` 表本身只保存 ready/dirty 的实际结果行。

第一阶段不把 `algo_version` 放入主键。视觉算法配置固定为一个全局值；算法变更时，批量把已有 `visual_tiles` 标记为 dirty，后台重建并覆盖同一行。

`updated_at` 是该行唯一更新时间。没有 `created_at`，没有 `built_at`，没有单独任务表。`status` 和 `cells` 在同一行里表达任务状态和结果。

### 3. MVT 输出层

MVT 第一阶段不持久化。请求到来时，后端从 ready/dirty 的 `cells` 读取视觉代表点，按时间组合做 OR，然后实时编码成 MVT 返回给 Mapbox。

真正昂贵的是原始点到视觉 cell 的预计算；MVT 编码只是输出格式。只有当实测 MVT 编码成为瓶颈时，才增加热点 MVT 缓存。

Mapbox source 的最大瓦片级别设置为 18。相机 zoom 小于 18 时，请求对应整数瓦片层级；相机 zoom 到 18 后请求 `z=18`；相机不允许超过 18，因此不会请求 `z=19+`。

第一阶段的批量构建脚本服务当前 4 万级本地数据重建，用于把 WGS-84 原始库一次性预计算到 `z=0..18`。它不是百万级增量构建器的最终形态。未来进入百万级后，应改为导入后按受影响的 tile-time key 分块或增量调度，避免对 `all/day/month/year * z0..18` 做重复全库扫描。

## cells BLOB 格式

`cells` 是 SQLite BLOB，不是 JSON。它保存一个 tile-time 单元内所有视觉 cell 的代表点。

建议二进制格式：

```text
Header
  magic        4 bytes  "EVTC"
  version      1 byte   1
  cell_count   4 bytes  uint32 little-endian

Records, repeated cell_count times
  cell_id      4 bytes  uint32 little-endian
  footprint_id 8 bytes  int64 little-endian
  geom_x       2 bytes  uint16 little-endian
  geom_y       2 bytes  uint16 little-endian
```

每条 record 固定 16 bytes。

字段语义：

```text
cell_id:
  tile 内视觉 cell 编号，用于 OR 去重。

footprint_id:
  代表原始点 id。当前使用 timestamp_seconds。

geom_x / geom_y:
  tile 内几何坐标。实时生成 MVT 时直接使用。
```

`cell_id` 编码：

```text
cell_id = cell_y * cells_per_row + cell_x
```

`cells_per_row` 由 MVT extent 和视觉 cell 尺寸决定，属于视觉算法配置。第一版应固定配置，避免同一份 cells 因算法参数变化产生不同解释。

`cells` 不存 count。视觉等价的合并逻辑只关心某个 `cell_id` 是否存在足迹点，存在就是 1，不存在就是 0。前端不根据同一 cell 内原始点数量改变样式。

## 视觉等价代表点规则

每个 `z/x/y/t_type/t` 的构建流程：

```text
1. 由 z/x/y 计算 WGS-84 tile bbox。
2. 使用 footprint_spatial RTree 查 bbox 内原始点。
3. 使用 t_type/t 过滤时间范围。
4. 显式 ORDER BY timestamp_seconds ASC。
5. 逐点投影到 tile 坐标。
6. 计算 cell_id。
7. 每个 cell_id 第一次出现的原始点成为代表点。
8. 如果至少有一个 cell，写入 visual_tiles.cells。
9. 如果没有任何 cell，删除该 z/x/y/t_type/t 的旧行。
```

必须显式时间排序，因为“第一个进入 cell 的点”是业务规则。不能依赖 SQLite 当前查询计划的默认返回顺序。

代表点不算 cell 中心，不比较距离，不累计 count。前端只需要知道该 cell 是否存在足迹点，以及画哪一个代表点。

## 时间预计算

预计算四类时间 bucket：

```text
all
year
month
day
```

自定义时间段拆成最少 bucket：

```text
整年 -> year
整月 -> month
零散日期 -> day
全量 -> all
```

示例：

```text
2024-02-10 到 2026-03-09
= 2024-02-10..2024-02-29 的 day
+ 2024-03..2024-12 的 month
+ 2025 的 year
+ 2026-01..2026-02 的 month
+ 2026-03-01..2026-03-09 的 day
```

OR 发生在 cell 层：

```text
读取同一个 z/x/y 下多个 bucket 的 cells
按 cell_id 去重
保留第一个出现的 record
实时编码 MVT
```

这里的 OR 只关心 0/1：

```text
cell 存在 -> 1
cell 不存在 -> 0
```

不向前端输出 count，也不按 count 改变点样式。跨 bucket OR 后，同一个 `cell_id` 只保留一个代表 record；后出现的同 `cell_id` record 被丢弃。

## 请求路径

Mapbox 请求：

```text
GET /api/map/tiles/footprints/{z}/{x}/{y}.mvt?start=2024-02-10&end=2026-03-09
```

后端流程：

```text
1. 把 start/end 拆成 all/year/month/day bucket。
2. 对每个 bucket 查 visual_tiles 的 z/x/y/t_type/t 行。
3. 查不到行视为空。
4. 查到 ready 行使用 cells。
5. 查到 dirty 行返回旧 cells，同时排队重建。
6. 多个 cells 按 cell_id OR。
7. 编码为 MVT 返回。
```

如果所有 bucket 都查不到行，返回空 MVT。

缺行不会触发创建空索引，也不会触发插入 dirty 占位行。只有当后台构建任务确认某个 `z/x/y/t_type/t` 构建出了至少一个 cell 时，才允许插入 ready 行。已有 ready 行因为新增数据过期时，才更新为 dirty。

运行时瓦片请求和瓦片 debug 请求都不能把“原始足迹数量大于 0 但某个 `visual_tiles` 查询为空”解释成全局预计算损坏，也不能因此自动执行整库 `build_visual_tiles`。地图样式、语言、投影或前端图层配置变化只影响浏览器和 Mapbox source/layer 状态，不是重建 SQLite 视觉瓦片的理由。

`visual_tiles` 是持久化预计算夹层，而不是请求缓存。日常读取、时间切换、样式切换和 debug 只能读取已有 ready/dirty 行；若缺行，语义就是该 tile-time key 当前没有可服务的预计算结果，参与 OR 为 0。只有显式运行 `npm run prepare:footprint-tiles`、原始足迹兼容性重建、视觉算法签名迁移，或者明确的受影响 key 增量重建，才允许写入或删除预计算行。

维护 `visual_tiles` 时要优先保留已完成结果。批量构建脚本可以按明确的 `z + t_type` 范围先删除后重建；单个 dirty 重建只能覆盖或删除同一个 `z/x/y/t_type/t`；追加导入新足迹时只标记已有受影响行 dirty，不向缺失 key 写入占位。避免执行无范围的 `DELETE FROM visual_tiles`，除非它和原始足迹重建、算法签名迁移这类显式破坏性流程绑定。

## 后台构建路径

导入新的 WGS-84 足迹数据后：

```text
1. 找出新增点涉及的 day/month/year/all。
2. 计算新增点在 `z=0..18` 每一级落入的 z/x/y。
3. 对已经存在的 z/x/y/t_type/t 行执行 `UPDATE status = dirty, updated_at = :now`。
4. 对不存在的 z/x/y/t_type/t 不插入占位行，只把键交给后台构建器。
5. 后台任务使用 RTree + 时间过滤重建 cells。
6. 重建后如果有 cells，对同一主键执行 upsert，写入 cells、status=ready、updated_at=:now。
7. 重建后如果没有 cells，删除该 z/x/y/t_type/t 行。
```

第一阶段不考虑修改/删除历史点。本阶段只处理从 `external\backUpData-all.csv` 全量重建，以及追加导入后标记相关 tile-time 为 dirty。

## 时间字段

`updated_at` 是唯一时间字段，使用 Unix 毫秒。

语义：

```text
这条 visual tile 记录最近一次变化时间。
```

变化包括：

```text
首次写入 ready cells
标记 dirty
重建完成覆盖 cells
```

不单独保留 `created_at` 或 `built_at`。

## WGS-84 重建要求

实施前必须从 `external\backUpData-all.csv` 重新生成原始足迹库：

```text
1. 删除或迁移旧 data\footprints.sqlite。
2. 使用 FOOTPRINT_COORDINATE_SYSTEM=wgs84。
3. 修改导入逻辑，使 WGS-84 来源坐标按 WGS-84 存储，不再转换 GCJ-02。
4. 验证 footprints 和 footprint_spatial 行数一致。
5. 抽样比对 CSV 经纬度和 SQLite 经纬度，确认未发生 GCJ-02 偏移。
```

这是瓦片化和 Mapbox MVT 的基础约束。

## 暂不进入范围

```text
1. 修改/删除既有足迹点后的精细 dirty 传播。
2. MVT 持久化缓存。
3. 行政区划多边形 MVT。
4. count 聚合样式、热力图或聚合气泡。
5. 多算法版本并存。
```
