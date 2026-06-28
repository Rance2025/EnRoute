# 玻璃面板透明程度设置设计

## 背景

统一透明磨砂玻璃面板当前由 `App.css` 中的共享 CSS 变量控制，实际面板使用 `--solid-glass-panel-bg` 和 `glass-panel--solid` 样式。用户希望把这个透明程度放进“设置 > 通用”，作为全局可调参数。

## 目标

- 在“设置 > 通用”新增“磨砂玻璃透明程度”设置项。
- 控件只使用滑杆，不提供数字输入框或文本输入框。
- 滑杆范围为 `0.1` 到 `1`，默认值为当前视觉值 `0.92`。
- 步进为 `0.01`，拖动后立即更新当前界面并写入本地偏好。
- 所有使用统一 `glass-panel--solid` 材质的面板都跟随这个参数。

## 非目标

- 不新增其他主题。
- 不改地图、记账、日程业务逻辑。
- 不修改足迹点透明度滑杆；它仍属于地图足迹显示设置。
- 不做远程 push 或 PR。

## 交互设计

通用页保留现有“顶部导航样式”和“界面色调”设置，并新增一个普通设置区：

- 标题：`磨砂玻璃透明程度`
- 控件：`input type="range"`
- 范围：`min="0.1"`、`max="1"`、`step="0.01"`
- 当前值用静态文本展示，例如 `0.92`；该文本不是输入控件。

## 数据与持久化

继续使用 `apps/web/src/navigationPreferences.ts` 管理 UI 偏好：

- 新增 storage key：`enroute:glass-panel-opacity`
- 默认值：`0.92`
- 读取时只接受有限数字；低于 `0.1` 归一化到 `0.1`，高于 `1` 归一化到 `1`
- 读取和写入 storage 失败时静默回退，不能阻塞 UI

`App.tsx` 在根 `.app-shell` 上写入：

```ts
'--glass-panel-opacity': glassPanelOpacity.toString()
```

`App.css` 使用该变量构造统一面板背景的 alpha 通道，使所有 `glass-panel--solid` 面板共享同一个透明程度。

## 测试要求

- 偏好测试覆盖默认值、读取有效值、范围钳制、写入格式和 storage 异常。
- App 测试覆盖通用页存在滑杆、滑杆范围和默认值正确、没有对应数值输入框。
- App 测试覆盖拖动滑杆后根 CSS 变量更新，并写入 `enroute:glass-panel-opacity`。

## 验证

- `npm --workspace apps/web run test -- src/navigationPreferences.test.ts src/App.test.tsx --run`
- `npm test`
- `npm run lint`
- `npm run build`
- 视觉验证：打开设置通用页，拖动滑杆，确认各玻璃面板透明程度变化且无数字输入框。
