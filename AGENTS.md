# AGENTS.md

本仓库是 `在途 EnRoute` 的前后端本地原型工程：前端应用使用 Vite + React + TypeScript 接入高德地图 JS API；后端服务使用 Python + FastAPI + SQLite 承载足迹数据导入、视口查询、抽稀和统计。当前阶段优先做好位置分页面的数据承载和地图体验。

## 协作流程：工单 → 独立 worktree → PR → 清理

- 一切需求与修复（新功能、UI 调整、bug 修复、文档与共享文件维护）必须先在 GitHub Issues 提工单，写清目标、范围、验收标准；无工单不开工。
- 实现一律在独立 worktree + 短期分支进行，不在 main 工作树上直接改（`AGENTS.md`/`.gitignore` 等共享文件的小幅维护除外）。
- 命名一律以工单编号为基准，保证 `#N 工单 ↔ 分支 ↔ worktree ↔ 提交/PR/合并信息` 任意一处可跳回工单：
  - 分支名 = `<范围>/<工单号>-<英文slug>`；范围取 `web`/`api`/`docs`/`scripts`/`cross`，slug 为 2~4 个英文小写短横线词，如 `docs/1-agents-workflow`。
  - worktree 目录 = 分支名的 `/` 换 `-`，落在仓库外兄弟目录 `../worktrees/EnRoute/` 下，如 `../worktrees/EnRoute/docs-1-agents-workflow`；一工单一 worktree。
  - 提交信息 = `<类型>(#<工单号>): <中文描述>`（类型沿用「提交规范」的前缀族）。
  - PR 标题与提交同构：`<类型>(#<工单号>): <标题>`；PR 描述带 `closes #N`。
  - 合并提交信息 = `merge(#<工单号>): <标题>（PR #<PR号>）`；经 API/工具合并时必须显式指定标题与信息，不接受平台默认合并信息。
- 短期分支对齐基线：能直接合就不对齐；确需对齐一律 `git rebase origin/main` 解冲突后 `git push --force-with-lease`；禁止往短期工单分支 merge 基线分支；main 已推送历史绝不改写。
- 合并由主代理按验收（审 diff + 跑测试通过）自主执行，不逐次确认；仅发版（release/tag）仍需逐次询问用户。
- 合并后清理：删除对应 worktree（先扫描并断开 junction/symlink 再 remove，禁止裸删）与短期分支（本地 `git branch -d` + 远端删除），不留残渣。

## 主代理调度制

- 主代理只做调度与验收：需求拆解、提工单、派发子代理、审查 diff、跑测试验收、向用户汇报；不在自己上下文直接改实现代码（`AGENTS.md`/`.gitignore` 等共享文件维护除外）。
- 所有实际修改派给子代理，一般一个子代理对应一个工单；子代理严格走「协作流程」（独立 worktree、工单号命名、提交格式）。
- 任务卡必填：目标 worktree 绝对路径、工单号、基线分支、验收标准（含须跑通的测试命令）、禁改面（禁改面固定含一条：不得在 worktree 内创建 junction/symlink）。
- 验收权归主代理：子代理自报"完成"不视为交付；主代理须亲自审查 diff + 跑通测试（至少 `npm test`、`npm run lint`、`npm run build`）后才向用户报完成。多个子代理并行时，各工单 worktree 物理隔离，主代理负责合并节奏与冲突上报（冲突由用户裁决）。

## 多 worktree 工作制

- 布局 = 兄弟目录集中式：主工作树固定为 main 日常 + `../worktrees/EnRoute/<分支目录>` 每个短期分支一个工作树；不在仓库内部目录开 worktree（避免污染扫描与提交面）。
- 提交前零假设：任何提交前先 `git branch --show-current` 确认所在工作树与分支，不用"我刚才切过"作依据。
- worktree 内严禁创建 junction/symlink（硬条款）；`external/`、`data/`、`output/` 等未跟踪本地资产只存在于主工作树，跨 worktree 使用一律指绝对路径，不得用链接代替。
- 清理先查链接，不裸删：任何 `git worktree remove` 或目录删除动作前，必须先检查目录内是否存在 reparse point（junction/symlink），确认无链接或已断链后才允许删除。

## 产品设想与阶段目标

`在途 EnRoute` 的长期目标不是只做一个类似足迹点显示的网站，而是逐步成为一个完整记录并展现个人全部人生数据的软件/网站。当前可优先结构化处理的数据来自用户现实中正在使用的三个外部 App。下面这些 App 名称只用于说明已有数据来源和后续能力参考对象，不是本项目的产品命名、模块命名或页面命名：

- 一生足迹：代表位置数据，包括轨迹、地点和足迹点。
- TODO 清单：代表时间数据，包括日程、待办和人生事件的时间线。
- 记账助手：代表金钱数据，包括收入、开销和资产流动。

产品形态上，位置、日程、记账应是三个并列的核心分页面；未来可以有一个主页面统一汇总和交叉展示这些数据，但当前阶段暂不实现主页面。现阶段的第一目标是把位置分页面做好，先把位置数据的展示底座、地图体验、轨迹/点位承载能力和后续导入空间打牢。

位置数据当前不要设计成站内直接记录；后续更可能以导入式流程承接外部 App 导出的既有数据，并参考这些 App 中已经被用户验证有效的交互和数据组织方式。记账方向后续计划独立实现站内记录、管理和分析能力，但在正式讨论前不要提前改动架构或塞入当前地图阶段。

## 项目结构

```text
apps/
  web/               React + Vite 前端应用
    src/
      components/    地图画布、浮动控件等 React 组件
      config/        高德地图配置、默认视角、相机/缩放逻辑
      services/      高德 JS API 加载封装
      types/         高德运行时的本地 TypeScript 声明
      layers/        轨迹层、点图层和足迹数据源
  api/               Python + FastAPI 后端服务
    src/enroute_api/ API、足迹导入、SQLite 查询、抽稀和统计
    tests/           后端契约测试
docs/
  superpowers/       设计说明和实施计划
scripts/             仓库级启动、检查脚本
tests/               仓库级工具测试
external/            本地原始导入数据，不提交
data/                本地 SQLite 数据库和持久应用数据，不提交
output/              本地日志、PID、截图和运行输出，不提交
```

## 常用命令

- 安装前端依赖：`npm install`
- 安装后端依赖：`npm run install:api`
- 本地启动前后端：`python start.py start`
- 本地开发前端：`npm run dev`
- 本地开发后端：`npm run api`
- 单元测试：`npm test`
- Lint：`npm run lint`
- 生产构建：`npm run build`

本地开发默认使用 Vite 端口 `5173`。如果需要固定地址，使用：

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

## 环境变量

在仓库根目录创建 `.env.local`，内容参考 `.env.example`：

```env
VITE_AMAP_KEY=your-amap-web-js-api-key
VITE_AMAP_SECURITY_CODE=your-amap-security-js-code
```

不要提交 `.env.local`、真实 key、日志、构建产物、本地截图或浏览器调试输出。`.gitignore` 必须覆盖这些本地文件，`.env.example` 需要保留可提交。

## 技术栈

- 前端应用：React 19、TypeScript 6、Vite 8、Vitest、ESLint
- 后端服务：Python 3.12、FastAPI、SQLite、pytest
- 高德地图 JS API 2.0
- `@amap/amap-jsapi-loader`
- `lucide-react`

## 开发流程

- 开工前先看 `git status --short --ignored`，确认当前工作区和忽略规则。
- 不覆盖用户已有改动；遇到无关改动时保持原样。
- 对行为变更优先补测试，再改实现。地图相机、缩放、配置、UI 文案和布局约束都应有针对性测试。
- 视觉类改动除了测试、lint、build，还要用浏览器实测，必要时保存本地截图；截图属于本地调试产物，不提交。
- 当前阶段前端视觉与交互只面向电脑尺寸（桌面视口）；手机尺寸适配暂不纳入实现或浏览器验收范围。除非用户后续明确启动移动端适配，不要为了手机布局调整桌面结构或把移动端问题扩进当前任务。
- 跨导航页的左侧时间/数据面板必须保持同构；其位置、外边距、内边距、间距、背景和溢出策略应由共享左栏选择器统一控制，不要为了某个分页面在 `.app-shell--<view>` 下单独改动左侧面板位置或尺寸。若页面内容需要对齐，优先调整右侧工作区布局，不能破坏左侧同构区域。
- 修改高德控件位置时优先使用高德 API 的 `position` 参数，不要用复杂 CSS 覆盖高德内部控件位置，避免运行时坐标计算异常。当前地图不使用高德 `ControlBar`/罗盘。
- 后续海量点和轨迹渲染不要用 React DOM marker 堆叠；优先考虑高德 Loca/WebGL、视口加载、聚合、抽稀和服务端切片。

## SQLite 与视觉瓦片数据约定

- `data/footprints.sqlite` 是本地持久应用数据，不是临时缓存；`footprints` / `footprint_spatial` 是原始事实层，`visual_tiles` 是已经完成计算的足迹视觉等价预计算层。
- 地图瓦片读取、瓦片 debug、地图样式/语言/投影切换等运行时路径只能读取 `visual_tiles`，不能因为缺行、空结果或样式切换自动全量重建，不能执行无范围的 `DELETE FROM visual_tiles`。
- `visual_tiles` 缺行的语义是该 `z/x/y/t_type/t` 当前为空或没有可服务的预计算结果，不是全局损坏信号。若发现 `footprints > 0` 但 `visual_tiles = 0`，先按本地数据异常排查并向用户报告，不要在请求路径自动修复。
- 允许清理或重建 `visual_tiles` 的场景只有：用户明确要求重建、运行 `npm run prepare:footprint-tiles`、原始足迹兼容性重建、视觉算法签名迁移、或明确受影响 tile-time key 的增量重建。
- 追加或修改足迹时，应保留已有 ready 行，只把已经存在且受影响的 `visual_tiles` 行标记 dirty；缺失 key 不写 dirty 占位，等显式构建器产出非空 cells 后再插入 ready 行。
- 修改任何会写入 SQLite 的代码前，必须先搜索 `DELETE FROM visual_tiles`、`DROP TABLE`、`data/footprints.sqlite`、`build_visual_tiles`，说明写入范围，并补测试证明不会误删已完成预计算瓦片。
- SQLite 可以支持多读和单写并发，但本项目当前没有把全量构建设计成常规运行时写入路径。小范围 dirty 重建可以和读取共存；全量 `npm run prepare:footprint-tiles` 应视为显式维护任务，执行前应确认服务状态和用户意图，不能由地图请求自动触发。

## 验证要求

完成实现或修复后，提交前至少运行：

```powershell
npm test
npm run lint
npm run build
```

如果改动影响地图视觉或交互，还要用浏览器验证：

- 地图是否正常渲染。
- 远山黛样式、隐藏标签、隐藏 POI 点层是否仍符合预期。
- 回正、缩放、定位等按钮是否可用。
- 地图是否保持 2D，不能俯仰或旋转，且不展示高德罗盘。
- 拖拽是否被限制在配置边界内，不能拖出顶部或边缘空白区域。
- 右下角自定义工具条是否布局合理。
- 控制台是否出现高德运行时错误。

## 文档维护

- README 只记录当前仍成立的仓库级事实、启动方式和阶段性说明。
- 较大的方案、设计取舍、未来架构计划写入 `docs/`，不要塞进 README。
- 涉及核心行为变化时，同步检查 README 和 docs 是否需要更新。核心行为包括：启动命令、环境变量、地图样式、默认视野、控件交互、数据层方案、海量点策略和外部 API 约定。

## 提交规范

使用中文约定式提交，格式为：

```text
<type>: <中文摘要>
```

常用 `type`：

- `feat`: 新功能或用户可见能力
- `fix`: 缺陷修复
- `chore`: 工程配置、依赖、脚手架、仓库维护
- `docs`: 文档更新
- `test`: 测试补充或调整
- `refactor`: 不改变外部行为的结构调整

不要使用括号作用域，例如使用 `feat: 接入高德地图底座`，不要写 `feat(map): ...`。括号仅用于引用工单号：`<类型>(#N): <中文摘要>`（见「协作流程」）。

Merge commit 使用 `merge(#<工单号>): <标题>（PR #<PR号>）` 格式，例如：

```text
merge(#1): 确立工单 worktree PR 协作流程（PR #2）
```

## 远程操作约束

- 例行 `git pull` / `git push`（main 及短期工单分支）以及工单/PR 的创建、合并，由主代理按「协作流程」自主执行，无需逐次确认。
- 仍需逐次确认的高危远程操作：建仓/删仓、改写已推送历史（main 的 force-push / rebase）、发版 tag、修改他人 issue/评论或标签。
- 推送前必须完成离线检查：`git status --short --branch`、核对 `.gitignore`、选择性暂存（不直接 `git add .`）、`git diff --cached --check`、凭据与大文件扫描。
- 凭据只经 Git Credential Manager 使用，远程 API 取用时经 `git credential fill` 单进程获取；不得在聊天、命令行参数、URL 或文件中输出/保存 token、key 等敏感信息。

## Agent 重新进入清单

开始主要工作前快速检查：

- `AGENTS.md`
- `package.json`
- `.gitignore`
- `.env.example`
- `README.md`
- `apps/web/src/config/`
- `apps/web/src/components/`
- `apps/api/src/enroute_api/`
