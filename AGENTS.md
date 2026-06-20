# AGENTS.md

## Superpowers 使用要求

- 无论任务大小、类型和紧急程度，Agent 开始任何回复、分析、计划、修改、验证或提问前，都必须先使用适用的 superpowers 技能；如果不确定是否适用，也必须先检查并使用相关 superpowers 技能。
- 这条要求高于本文件其他普通开发流程要求；除非用户后续明确修改本要求，否则不得以任务简单、只是查看文件、只是回答问题、只是修文档、需要先了解上下文等理由跳过 superpowers。
- superpowers 流程要求在分支上工作：开始任何实现、修复、文档维护或仓库配置修改前，必须先确认当前不在 `master`/`main` 等主分支；如需隔离工作区，应按 `using-git-worktrees` 技能创建并验证 worktree，再继续执行。

本仓库是 `在途 EnRoute` 的前后端本地原型工程：前端应用使用 Vite + React + TypeScript 接入高德地图 JS API；后端服务使用 Python + FastAPI + SQLite 承载足迹数据导入、视口查询、抽稀和统计。当前阶段优先做好位置分页面的数据承载和地图体验。

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
- 修改高德控件位置时优先使用高德 API 的 `position` 参数，不要用复杂 CSS 覆盖高德内部控件位置，避免运行时坐标计算异常。当前地图不使用高德 `ControlBar`/罗盘。
- 后续海量点和轨迹渲染不要用 React DOM marker 堆叠；优先考虑高德 Loca/WebGL、视口加载、聚合、抽稀和服务端切片。

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

不要使用括号作用域，例如使用 `feat: 接入高德地图底座`，不要写 `feat(map): ...`。

Merge commit 也使用中文格式，例如：

```text
merge: 合并地图底座初始化
```

## 远程操作约束

默认只做本地修改、本地提交和本地验证。未经用户明确要求，不执行任何远程写操作，包括：

- `git push`
- 创建或更新远程分支
- 创建或更新 PR
- force push
- 修改远程 issue、评论或标签

只读查询可以按任务需要执行；涉及凭据时不要输出 token、key 或其他敏感信息。

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
