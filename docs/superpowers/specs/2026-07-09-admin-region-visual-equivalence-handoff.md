# 行政区瓦片视觉等价交接文档

> 日期：2026-07-09  
> 目的：给下一位实现者交接最新需求、已踩坑点、数据约束、验证标准。本文不是完成报告；当前分支存在未验证或失败的尝试，接手者应从需求和证据重新收敛实现。

## 当前结论

这轮行政区工作不要继续扩大范围。最新范围收敛为：

1. 全球只做 `level=1`，即国家级。
2. 中国国内做 `level=1..4`：国家、省级、市级、区县级。
3. 非国家级视图只显示中国国内行政区，不再叠加全球国家级边界。
4. 行政区层级切换控件放在右侧面板，不放在地图控制条上。
5. 进入区域视图时默认选中国家级，而不是中国区县级。

此前讨论过“国外国家/省份/城市三级、国内四级、上海五级”的方向，但已被最新需求覆盖。本阶段不要做上海五级，也不要做全球二级或三级。

## 当前工作区和数据事实

接手前必须重新确认当前机器状态，因为本分支已经经历过多次回退、备份、补丁和服务重启。

当前只读检查结果：

```text
D:\Coding\EnRoute\data\footprints.sqlite
  footprints=40441
  footprint_spatial=40441
  visual_tiles=63221
  admin_region_tiles=277

D:\Coding\EnRoute\.worktrees\admin-level-scope-cn\data\footprints.sqlite
  footprints=40441
  footprint_spatial=40441
  visual_tiles=63221
  admin_region_tiles=11924
```

这说明在该检查时，根目录和 worktree 的足迹事实层、空间索引、足迹视觉瓦片并没有被清空。用户看到“不加载”的现象不能直接归因为数据库被清空；必须继续从 API 锁、运行时请求、前端 source/layer、focus 参数和 MVT 内容逐层验证。

worktree 下已有备份：

```text
data\footprints.sqlite.backup-5177-baseline-20260709-122952
data\footprints.sqlite.backup-5177-good-20260709-115612
data\footprints.sqlite.backup-5196-before-edgefix-20260709-120120
data\footprints.sqlite.backup-5196-before-rollback-20260709-122952
data\footprints.sqlite.backup-5196-country5177-noantarctica-before-depth234-20260709-125453
```

不要在没有说明来源和目标的情况下互相覆盖这些数据库。尤其不要把只有国家级瓦片的库覆盖到需要 `level=2..4` 的 worktree 后，还声称省市区县已经可用。

## 数据和运行时约束

`data/footprints.sqlite` 是本地持久应用数据，不是临时缓存。

足迹渲染必须以 `visual_tiles` 为渲染事实源：

1. 地图足迹图层读取 `/api/map/tiles/footprints/{z}/{x}/{y}.mvt`。
2. 后端读取 `visual_tiles` 预计算结果并编码 MVT。
3. 缺行表示该 tile-time key 当前为空或没有可服务结果。
4. 缺行不能触发请求期 raw footprints fallback。
5. 缺行不能触发全量 rebuild。
6. 不能在普通地图请求、debug 请求、样式切换、投影切换时执行无范围的 `DELETE FROM visual_tiles`。

足迹视觉等价瓦片是已经花时间算好的资产，不是每个分支可以随手重算或清理的临时产物。开新分支、开新 worktree、复制环境、回退调试时，默认动作应是复制现有 `data\footprints.sqlite`，保留其中已经完成的 `visual_tiles`，而不是重新跑 `prepare:footprint-tiles`。如果某个新 worktree 没有预计算足迹点视觉等价瓦片，应先从可靠基线复制数据库；不要因为本地缺少预计算结果就清理、截断或重新计算现有瓦片。

增量修改也必须保留旧的足迹视觉等价结果：只有当新的构建器确实为明确受影响的 tile-time key 产出替代结果时，才允许覆盖这些 key。没有新预计算结果的 key 必须保持原样，不能被删除，不能被写成空结果，也不能被标记成全局损坏。

行政区瓦片也应采用同样的原则：构建期生成可服务的 `admin_region_tiles`，运行时只按精确 key 读缓存并返回 bytes。缺行返回空，不做请求期修复。

如果需要修改任何会写 SQLite 的代码，先搜索并说明这些路径的写入范围：

```text
DELETE FROM visual_tiles
DROP TABLE
data/footprints.sqlite
build_visual_tiles
admin_region_tiles
build_admin_region_tiles
```

## 行政区瓦片范围

推荐把行政区瓦片 key 语义固定下来：

```text
focusRegionId=world
depth=1: 全球国家级，按中国世界观处理。
depth=2: 只包含中国省级。
depth=3: 只包含中国市级。
depth=4: 只包含中国区县级。
```

不要让点击某个国家后把 `focusRegionId` 改成该国家 ID，除非已经显式预计算了这个 focus 的瓦片。此前出现过类似请求：

```text
focusRegionId=overture:division:country:cn
```

如果数据库只存在 `focusRegionId=world`，这种请求会返回 204，表现就是区域图层空白。区域视图下可以保存“当前选中区域”用于 UI 高亮，但瓦片 source 的 focus 参数不能随便切到未预计算的 region id。

## UI 行为要求

右侧面板负责区域层级选择。地图控制条不放这个切换按钮。

区域调试信息建议统一命名：

```text
相机/瓦片层级
区域级别
可见瓦片
当前区域
```

切换到区域页或切换区域级别时，必须同时加载面和线：

1. 不允许先只显示 polygon fill，等用户再切一次 level 后 line 才出现。
2. 不允许只根据 HTTP 200 判断成功。
3. 必须验证 Mapbox source、fill layer、line layer 都已添加并绑定同一个 tile source。
4. 必须验证 rendered features 中能查到对应层级的面和线。

样式上，用户希望填充色和边界线更明显。后续调样式时要同时看国家级、省级、市级、区县级，不能只在一个 zoom 或一个 level 上看起来正常。

## 视觉等价要求

行政区的“视觉等价”必须在构建期或显式 patch 期完成，不应放在普通请求期。

本轮有过“运行时过滤”的尝试：API 收到请求后解码已有 MVT BLOB，过滤或改写边界线，再重新编码返回。这个方向不符合需求，原因是：

1. 用户做各 z 的视觉等价计算，本来就是为了预计算和提速。
2. 请求期解码、拓扑处理、重编码会把重活放回运行时。
3. 高并发或长 CPU 请求容易占住 SQLite connection lock，导致 API 超时。
4. 它会掩盖缓存瓦片本身不正确的问题，后续更难验证。

正确方向：

1. 对每个要服务的 `z/x/y/depth/focus` 在构建期生成最终 MVT。
2. 面、边界线、公共边界去重、tile edge 处理都写进最终 tile bytes。
3. 运行时只读 `admin_region_tiles` 并返回 bytes。
4. 算法改动时更新 algorithm signature，并通过显式构建或显式 patch 迁移。

用户已要求先做 `z0..z7`，每个 z 都要有。后续又要求把 `level=1..4` 的 `z8` 和 `z9` 也渲染出来，但要小步快跑，避免一次性重建导致内存爆炸。接手者应按 zoom 分批构建、分批验证、分批备份。

## 公共边界和缝隙处理

国家级最明显的问题是：中国边界精细度高于邻国边界时，相邻国家之间出现“真空地带”。这不是前端样式问题，应该在瓦片几何构建层解决。

目标：

1. 同一视觉等价下，相邻国家的填充面要视觉闭合，不留空洞。
2. 公共边界线只抽取一次，不要相邻两国各画一条导致重叠加粗。
3. 所有 level 的边界线都要做公共边界抽取，避免重复画线。
4. 面和线必须来自同一套最终几何或同一套 snapped/quantized tile 坐标，不能高缩放下出现 fill 和 line 有缝。
5. tile 边缘不要因为 buffer、clip 或 polygon repair 导致面和线错位。

“每个国家各自计算各自的边界”和“公共边界线只画一次”并不矛盾。建议做法是：

1. 对每个行政区先生成本行政区的最终填充面。
2. 在同一 tile 坐标系下对所有填充面做 snap/quantize。
3. 从最终面集合抽取边界 segment。
4. 对相同 segment 做规范化 key，例如端点排序后的 tile 坐标。
5. 只输出一次公共 segment；必要时保留左右行政区 ID 用于 debug。
6. 外海岸线和没有邻接面的边界仍然输出一次。

不要用前端 line opacity、line width 或 fill antialias 去掩盖几何缝隙。样式可以增强可见性，但不能修正 topology。

## 中国世界观和特殊地区

国家级必须按中国世界观处理。接手者至少要单独检查：

```text
藏南 / Arunachal Pradesh
港澳
台湾
南海诸岛和岛屿类几何
中国-印度边界
中国与周边国家边界是否出现空洞或重叠
```

非国家级只显示中国国内行政区，不显示其他国家的国家级轮廓线。

注意：Mapbox Streets 的 `admin` 数据主要是边界线，不是本项目任意行政区填充面的业务源。中国更细层级仍应使用项目可控的本地行政区源和构建流程。

浏览器验证中国优先行为时，不要只查一个 layer。历史上相关实现同时存在 `admin-regions-fill` 和 `admin-regions-china-fill` 之类的层；只查其中一个会误判台湾、藏南等覆盖关系。

## 其他国家和地区注意事项

南极洲不应作为国家出现在国家级瓦片中。如果源数据包含 `AQ`、`ATA`、`Antarctica` 或类似记录，应在构建期过滤，不要运行时临时隐藏。

格陵兰必须在国家级有填充面。此前用户发现国家级没有格陵兰，且后续又出现只有线没有面的情况。接手者需要检查：

1. 源数据是否包含 Greenland。
2. normalize 后是否被误过滤。
3. MVT 编码是否输出 polygon fill。
4. 前端 fill layer 是否能渲染该 feature。

港澳台在国家级、中国国内层级、选中状态和统计归属上都要明确处理。至少不要在国家级把台湾错误归到其他国家，也不要在中国国内视图漏掉港澳台相关区域。

## 已观察到的问题和不要再犯

以下是本轮已经暴露的问题，接手者不要把它们当成已经修好：

1. “页面能打开”不是成功。必须看到区域面、边界线和足迹点实际渲染。
2. HTTP 200 不是成功。MVT 可能有 bytes，但前端 layer/filter/source/focus 不匹配仍然不显示。
3. 只看截图不够。争议边界、缝隙、重叠必须解码 MVT 后量化检查。
4. 不要在请求期做行政区 MVT decode/filter/re-encode。
5. 不要让普通 API 请求持有 SQLite connection lock 后做长 CPU 工作。
6. 不要把 missing row 解释成全局损坏，更不能自动全量 rebuild。
7. 不要广泛删除 `visual_tiles` 或覆盖 `footprints.sqlite` 来“修复显示”。
8. 不要用 `recorded_at` 查询足迹；当前足迹主键和时间字段是 `timestamp_seconds`。
9. 不要只修国家级，忘记省市区县高 zoom 下 fill 和 line 的缝隙。
10. 不要只构建到 `z4` 却在 UI 上让用户以为 `z7` 或 `z9` 已经完成。
11. 不要把只有国家级的 5177 基线库直接当成完整解决方案；它可能比后续尝试“更能显示”，但不代表满足最新层级和边界要求。
12. 开分支或开 worktree 时不要默认重算足迹视觉等价瓦片；应复制可靠基线的 `data\footprints.sqlite`，保留 `visual_tiles`。
13. 增量修改行政区瓦片时，不要顺手清理没有新预计算结果的足迹 `visual_tiles`。行政区和足迹瓦片是两套资产，不能互相牵连。

本轮曾观察到 API 进程高 CPU、SQLite 锁、足迹 metrics/tile 请求超时。停止 API 进程后 DB 可读，这更像运行时锁或长请求问题，不是数据库清空的证据。后续必须用日志、进程、请求耗时和 SQLite 只读查询分开证明。

## 推荐实现路径

接手者应先把当前失败尝试和目标架构分开。可以选择基于较好的 5177 瓦片备份继续修，也可以重做 builder，但不要把 runtime filter 作为最终方案。

推荐架构：

1. 行政区源数据 normalize。
2. 应用最新 scope：全球 `level=1`，中国 `level=1..4`。
3. 应用中国世界观。
4. 构建期过滤南极洲。
5. 保留格陵兰国家级面。
6. 对国家级做邻接 gap assignment，使国家填充视觉闭合。
7. 所有层级做公共边界抽取。
8. 同一 tile 坐标系下生成 fill 和 line，避免高 zoom 缝隙。
9. 按 `z/depth/focus` 分批写入 `admin_region_tiles`。
10. 记录 algorithm signature。
11. 运行时只读缓存。

如果要 patch 现有瓦片，不要一次性清表。先限定：

```text
depth 范围
z 范围
focusRegionId
algorithm_signature
受影响 tile key 数量
备份文件名
回滚方式
```

再执行增量 patch。

开新 worktree 或交给别人继续做时，应把数据库复制流程写清楚：

```text
1. 先停止正在持有数据库的 API/Vite 调试进程。
2. 从确认可用的基线复制 data\footprints.sqlite 到目标 worktree。
3. 只读检查 footprints、footprint_spatial、visual_tiles、admin_region_tiles 行数。
4. 不运行 prepare:footprint-tiles，除非用户明确要求重建足迹视觉等价瓦片。
5. 后续只对行政区相关表或明确受影响的 admin tile key 做增量构建。
```

## 验证清单

后续实现不能只靠单元测试。最低验证包括：

```powershell
npm test
npm run lint
npm run build
```

行政区瓦片需要额外验证：

1. 只读查询 `footprints`、`footprint_spatial`、`visual_tiles`、`admin_region_tiles` 行数。
2. 解码 `depth=1` 的 `z0/z3/z7/z8/z9` 样本瓦片，确认国家级有 features。
3. 解码 `depth=2/3/4` 的中国样本瓦片，确认省、市、区县有 features。
4. 国家级没有南极洲。
5. 国家级有格陵兰 polygon fill。
6. 中国、台湾、藏南、港澳、南海岛屿按中国世界观检查。
7. 中国与邻国边界没有明显空洞。
8. 高 zoom 下 fill 和 line 不错位、不留缝。
9. 公共边界线没有重复画导致加粗。
10. 切换区域 tab 后第一次加载就有面和线，不需要再切换 level。
11. 切换到足迹 tab 后足迹仍然显示，metrics 和 footprint tile 请求不超时。

浏览器验证时至少走这些动作：

```text
打开位置页
切到区域
确认默认是国家级
切换国家级、省级、市级、区县级
每次确认面和线都出现
移动到中国西部边界和东北/东南沿海检查缝隙
移动到格陵兰检查国家级填充
移动到南极洲确认不作为国家显示
切到足迹确认足迹点仍显示
打开控制台确认没有 Mapbox layer/source 错误
```

如果使用自动化验证，必须查询 Mapbox rendered features，而不是只判断 DOM 或截图文件存在。

## 交接提醒

当前用户已经明确不希望继续在运行时“补救”。接手者应先把需求文档、数据备份、当前分支差异和可验证基线对齐，再小步构建。每次只改一个维度，例如先做国家级去南极洲和格陵兰，再做 `z0..z7`，再做 `z8/z9`，再做公共边界抽取。每一步都要能回滚，并在文档或提交信息里说明写了哪些 tile key。
