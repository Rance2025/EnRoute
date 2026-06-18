# AGENTS.md

本仓库是 `在途 EnRoute` 的前端原型工程：使用 Vite + React + TypeScript 接入高德地图 JS API，先完成全屏地图底座、地图风格、基础地图控件，后续再叠加轨迹点和海量点图层。

## 项目结构

```text
src/
  components/        地图画布、浮动控件等 React 组件
  config/            高德地图配置、默认视角、相机/缩放逻辑
  services/          高德 JS API 加载封装
  types/             高德运行时的本地 TypeScript 声明
  layers/            后续轨迹层、点图层预留目录
docs/
  superpowers/       设计说明和实施计划
public/              静态资源
```

## 常用命令

- 安装依赖：`npm install`
- 本地开发：`npm run dev`
- 单元测试：`npm test -- --run`
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

- React 19
- TypeScript 6
- Vite 8
- Vitest
- ESLint
- 高德地图 JS API 2.0
- `@amap/amap-jsapi-loader`
- `lucide-react`

## 开发流程

- 开工前先看 `git status --short --ignored`，确认当前工作区和忽略规则。
- 不覆盖用户已有改动；遇到无关改动时保持原样。
- 对行为变更优先补测试，再改实现。地图相机、缩放、配置、UI 文案和布局约束都应有针对性测试。
- 视觉类改动除了测试、lint、build，还要用浏览器实测，必要时保存本地截图；截图属于本地调试产物，不提交。
- 修改高德控件位置时优先使用高德 API 的 `position` 参数，不要用复杂 CSS 覆盖高德内部控件位置，避免运行时坐标计算异常。
- 后续海量点和轨迹渲染不要用 React DOM marker 堆叠；优先考虑高德 Loca/WebGL、视口加载、聚合、抽稀和服务端切片。

## 验证要求

完成实现或修复后，提交前至少运行：

```powershell
npm test -- --run
npm run lint
npm run build
```

如果改动影响地图视觉或交互，还要用浏览器验证：

- 地图是否正常渲染。
- 远山黛样式、隐藏标签、隐藏 POI 点层是否仍符合预期。
- 回正、缩放、定位等按钮是否可用。
- 右下角罗盘和工具条是否布局合理。
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
- `src/config/`
- `src/components/`
