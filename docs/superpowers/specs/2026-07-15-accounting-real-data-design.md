# EnRoute 真实记账数据持久化与界面校准设计

日期：2026-07-15

## 目标

将记账模块从前端演示数据原型升级为使用独立 SQLite 数据库的本地应用：导入用户现有账单、通过 API 读取和维护数据，并依据真实数据重新校准流水、账户和统计三页的信息密度与可视化。

本设计延续 `2026-07-14-accounting-workspaces-redesign-design.md` 已确定的页面职责、三栏同构、分类树、标签树和图表口径。本轮重点解决两项偏差：

1. 当前前端仍使用 7 条人为演示流水，页面实际比例和空状态与确认过的 mock 差异过大。
2. 真实外部账单尚未进入 EnRoute 自己的数据模型、数据库和 API。

## 已确认的源数据事实

源文件为 `external/账单@日常-全部-1349.csv`。虽然扩展名是 `.csv`，文件实际为 OLE2/BIFF Excel 工作簿，由 `Java Excel API v2.6.12` 生成，工作表名为“记账助手账单”。

表头固定为：

```text
类别 | 分类 | 金额 | 时间 | 账户 | 备注
```

当前文件包含：

- 1349 笔流水，时间范围为 2025-09-01 00:00 至 2026-06-18 14:10。
- 支出 1146 笔，合计 ¥56,952.95。
- 收入 162 笔，合计 ¥72,931.44。
- 转账 41 笔，合计 ¥40,770.47。
- 7 个基础账户。
- 29 个支出叶子分类、11 个收入叶子分类。
- 435 笔没有备注。
- 没有标签字段，不得从备注中自动猜测标签。
- 没有账户期初余额或余额快照。
- 转账行通过 `转出账户>转入账户` 表示方向。

源文件属于本地个人数据，继续由 `.gitignore` 排除，不提交 Git。

## 选择的架构

采用独立记账数据库方案：

```text
外部 BIFF 账单
    ↓ 显式导入脚本
data/accounting.sqlite
    ↓ AccountingStore
/api/accounting/*
    ↓ accountingDataSource
AccountingPage 与三个工作区
```

不采用静态 JSON，因为创建和编辑无法可靠持久化；不写入 `footprints.sqlite`，避免位置数据和财务数据耦合。

## SQLite 写入边界

新增数据库默认路径：

```text
data/accounting.sqlite
```

新增环境变量：

```text
ACCOUNTING_DB_PATH=data/accounting.sqlite
```

本轮所有记账写入只允许触碰 `accounting.sqlite`。不得打开、迁移、删除或更新 `data/footprints.sqlite`，不得执行任何 `visual_tiles` 写入，也不得调用 `build_visual_tiles`。

导入采用单个 SQLite 事务。重新导入同一来源时，只同步该 `source_key` 下 `origin = 'import'` 的记账记录；用户在 EnRoute 中创建的 `origin = 'manual'` 数据不得被覆盖或删除。

## 数据库结构

### `accounting_schema`

- `version INTEGER PRIMARY KEY`
- `applied_at TEXT NOT NULL`

### `accounting_imports`

- `source_key TEXT PRIMARY KEY`
- `source_path TEXT NOT NULL`
- `source_sha256 TEXT NOT NULL`
- `imported_at TEXT NOT NULL`
- `row_count INTEGER NOT NULL`
- `earliest_occurred_at TEXT NOT NULL`
- `latest_occurred_at TEXT NOT NULL`

### `accounting_accounts`

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL UNIQUE`
- `nature TEXT NOT NULL CHECK (nature IN ('asset', 'liability'))`
- `currency TEXT NOT NULL DEFAULT 'CNY'`
- `opening_balance_in_cents INTEGER NOT NULL`
- `opening_balance_at TEXT NOT NULL`
- `opening_balance_source TEXT NOT NULL CHECK (opening_balance_source IN ('import-zero-baseline', 'manual'))`
- `source_label TEXT`
- `brand_slug TEXT`
- `brand_label TEXT`
- `brand_color TEXT`
- `hidden INTEGER NOT NULL DEFAULT 0`
- `archived_at TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### `accounting_categories`

- `id TEXT PRIMARY KEY`
- `type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer'))`
- `name TEXT NOT NULL`
- `parent_id TEXT REFERENCES accounting_categories(id)`
- `sort_order INTEGER NOT NULL`
- `source_name TEXT`
- `archived_at TEXT`

同一类型、父节点和名称组合必须唯一。

### `accounting_tags`

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `parent_id TEXT REFERENCES accounting_tags(id)`
- `sort_order INTEGER NOT NULL`
- `archived_at TEXT`

当前导入不会生成标签行，但保留正式树状模型供站内创建和后续导入使用。

### `accounting_transactions`

- `id TEXT PRIMARY KEY`
- `type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer'))`
- `amount_in_cents INTEGER NOT NULL CHECK (amount_in_cents > 0)`
- `occurred_at TEXT NOT NULL`
- `account_id TEXT REFERENCES accounting_accounts(id)`
- `from_account_id TEXT REFERENCES accounting_accounts(id)`
- `to_account_id TEXT REFERENCES accounting_accounts(id)`
- `category_id TEXT REFERENCES accounting_categories(id)`
- `note TEXT`
- `origin TEXT NOT NULL CHECK (origin IN ('import', 'manual'))`
- `source_key TEXT`
- `source_record_id TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

收入和支出必须具有 `account_id`；转账必须具有两个不同的 `from_account_id` 和 `to_account_id`。`source_key + source_record_id` 对导入记录唯一。

### `accounting_transaction_tags`

- `transaction_id TEXT NOT NULL REFERENCES accounting_transactions(id) ON DELETE CASCADE`
- `tag_id TEXT NOT NULL REFERENCES accounting_tags(id)`
- 主键为 `(transaction_id, tag_id)`。

## 导入规则

### 文件识别和校验

导入器先检查 OLE2 签名，再用 `xlrd` 读取第一个工作表。依赖加入 API Python 依赖，不依赖本机偶然安装状态。

导入前必须校验：

- 工作表至少包含一行表头和一行数据。
- 六列表头完全匹配。
- 类别只能是支出、收入或转账。
- 金额可精确转换为正整数分。
- 时间可转换为本地时间 ISO 字符串。
- 非转账行账户不为空。
- 转账账户必须恰好包含一个 `>`，且两端非空、不同。

任何一行失败时整个事务回滚，不产生部分导入。

### 幂等记录标识

源文件没有 UUID。导入器将标准化后的类别、分类、金额分、发生时间、账户和备注连接后计算 SHA-256；若未来出现完全相同的重复行，再附加同内容在文件中的出现序号。相同文件重复导入得到相同 `source_record_id`，不会重复插入。

### 账户

基础账户由普通账户列和转账两端并集得到。

资产账户：

- 微信 - 日常
- 攒钱理财
- 专款

负债账户：

- 花呗
- 美团月付
- 京东白条
- 抖音月付

所有账户以 2025-09-01 00:00 为期初点，期初余额为 0，`opening_balance_source` 为 `import-zero-baseline`。这不是绝对真实资产快照；界面必须显示“按导入账单推算”。用户在账户页调整后改为 `manual`，此后重新导入不得覆盖人工期初余额。

### 分类树

原始分类名全部保留为叶节点，并按类型归入下列父级：

支出：

- 餐饮：早餐、午餐、晚餐、夜宵、聚餐、饮料。
- 出行住宿：交通、酒店。
- 居住通信：住房、水电、通信。
- 日常生活：日用品、卫生、服饰、理发、维修、购物。
- 文教成长：学习、图书、考试、学费、软件、数码。
- 娱乐体验：娱乐、演出。
- 健康公益：医疗、捐赠。
- 人情往来：红包。
- 其他支出：其他。

收入：

- 劳动所得：工资、奖金、补贴。
- 家庭与专项：生活费、专款。
- 资金回流：退款、红包、收钱。
- 投资与其他：投资收益、意外所得、其他收入。

转账：

- 账户往来：账户转账。

叶节点通过 `source_name` 保留与外部文件的精确映射。导入器不得按备注二次分类。

## API

新增 `AccountingStore`，使用独立 SQLite 连接和行工厂。

### 读取

`GET /api/accounting/dataset`

返回账户、分类、标签、流水和导入元数据。字段使用前端现有 `AccountingDataset` 对应的 camelCase JSON。流水默认按发生时间倒序。

### 流水写入

- `POST /api/accounting/transactions`
- `PUT /api/accounting/transactions/{transaction_id}`

服务端执行金额、账户、转账方向、分类类型和标签引用校验。站内创建记录使用 `origin = 'manual'`；编辑导入记录只修改 EnRoute 数据库，不回写外部文件。

### 账户写入

`PATCH /api/accounting/accounts/{account_id}`

支持名称、性质、期初余额、期初日期、品牌、隐藏和归档字段。调整期初余额后将 `opening_balance_source` 改为 `manual`。

## 前端数据流

新增 `accountingDataSource`：

- 初始加载真实数据集。
- 显示明确的加载状态和 API 错误恢复入口。
- 创建、编辑和账户调整先等待 API 成功，再更新页面状态。
- API 失败时保留弹窗输入并显示错误，不做假成功。
- `ledgerAtlasDataset` 仅留在单元测试夹具中，不再作为生产页面初始化数据。

首次进入记账页时，若共享时间选择仍是未修改的“今天”且该日无账单，页面在数据加载后定位到最新有数据月份，即当前文件的 2026 年 6 月。用户主动选择过的时间范围不得被自动改写，“回到今天”仍然有效。

## 页面校准

### 通用原则

- 保持左、中、右同层玻璃面板，不改变共享左栏外部几何。
- 2048×1152 下继续以约 450 / 956 / 450 px 为目标。
- 中栏使用统一外层玻璃容器，内部卡片减少嵌套边框和过度圆角。
- 标题、指标和图表优先使用真实数据；没有数据时不渲染巨大的空图。
- 支出和负债继续使用冷灰蓝，不使用红色。
- 所有主要金额使用分组千位和两位小数。

### 流水页

- 保持流水 41%、洞察 59% 的横向关系。
- 左侧流水列从顶部工具栏延伸到中栏底部，真实月份中应显示高密度日期分组和独立滚动。
- 右侧上半部为期末净资产、资产/负债对向条和期初/收入/支出/期末桥接图。
- 右侧下半部优先展示真实收入/支出分类堆叠图和账户净变动贡献。
- 当标签为空时，标签卡收缩为一行数据说明，不再占据半块空白；释放空间给分类图和账户贡献。
- 右栏显示真实范围、账户口径、推算基准和导入批次，不再显示“本地原型”。

### 账户页

- 卡片轮替区限制在左上区域，不让六张卡片以过大重叠占据整列。
- 只渲染当前卡、前一张和后一张；其他账户通过序号和滚轮/点击/键盘进入。
- 左下账户流水与右侧余额阶梯图共同占据主要高度。
- 右下优先展示该账户真实分类构成；无标签时使用紧凑说明，不保留大块空卡。
- 负债账户显示“欠款”绝对值，但计算仍使用负数余额。
- 所有零基准账户显示“按导入账单推算”；人工调整后显示“已设置期初余额”。

### 统计页

- 使用真实 2025-09 至 2026-06 数据展示长期收支趋势。
- 分类树以新增父级和原始叶级呈现直接金额与聚合金额。
- 标签树为空时不渲染无意义关系图，改为紧凑说明和标签创建入口。
- 右栏显示跨账户贡献、当前分类焦点和真实导入范围。

## 空状态

- 当选中日期没有流水时仍保留创建入口，但净资产和账户余额继续显示截至该日的推算存量。
- 当整个数据库为空时显示导入引导，而不是演示数据。
- 当前真实数据无标签时明确写“源账单未包含标签”，不能写成数据故障。
- 当前范围分类或标签为空时，相关图表让位给仍有数据的模块。

## 测试策略

### 导入和数据库

- OLE2 文件签名与表头校验。
- 1349 行模型的收入、支出和转账转换。
- 金额到整数分的精确转换。
- 7 个账户拆分和性质映射。
- 转账方向拆分。
- 分类父子映射。
- 同文件重复导入不重复。
- 重新导入不覆盖人工期初余额或手工流水。
- 任一坏行导致事务回滚。
- 测试数据库与 `footprints.sqlite` 完全隔离。

自动化测试不依赖被忽略的个人源文件；使用小型内存行夹具和临时 SQLite。最终本地导入验证再使用真实文件，并只报告统计结果。

### API

- 数据集读取契约。
- 创建和编辑三类流水。
- 账户期初余额调整。
- 分类类型、账户和标签引用错误。
- 数据库不存在时返回空数据集而不是 500。

### 前端

- API 加载、失败和重试。
- 最新有数据月份自动定位仅发生一次。
- 真实大数据量下选择器和图表口径。
- 创建、编辑和账户调整等待持久化成功。
- 无标签时不出现大块空卡。
- 流水、账户和统计页的数据联动。

## 浏览器验收

最终必须使用项目提供的浏览器控制能力检查真实数据库页面：

- 2048×1152：三栏比例、玻璃同构、流水 41/59、账户卡片尺度。
- 1440×900：无横向溢出，图表标签和流水仍可读。
- 流水页加载 2026 年 6 月真实流水并可滚动。
- 账户轮替每次只移动一张，滚轮不带动页面。
- 新增、详情、编辑和期初余额调整可持久化。
- 统计页真实趋势和分类层级可读。
- 无标签时空间被重新利用。
- 控制台无 React、SVG、网络和运行时错误。

浏览器不可用时不得把单元测试或截图检查冒充浏览器验收；必须明确报告阻塞。

## 本地导入与交付

新增命令：

```powershell
npm run prepare:accounting
```

默认读取 `external/账单@日常-全部-1349.csv` 并写入 `data/accounting.sqlite`，同时支持 `--source` 和 `--database` 覆盖路径。

功能分支完成并本地合并后，在主工作区显式执行真实导入、重启前后端服务，再进行最终浏览器验收。数据库、外部账单、日志和截图均不提交 Git。
