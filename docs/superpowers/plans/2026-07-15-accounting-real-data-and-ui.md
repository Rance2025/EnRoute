# EnRoute 真实记账数据与工作台重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 1349 笔外部账单可靠导入独立记账数据库，并把流水、账户、统计三页重构为达到已确认 Mock 信息密度、使用真实数据且所有编辑可持久化的记账工作台。

**Architecture:** 后端新增独立 `accounting` 领域包，导入器负责 BIFF 校验与幂等转换，`AccountingStore` 独占 `data/accounting.sqlite`，FastAPI 只通过该 Store 暴露数据集和写入接口。前端新增类型严格的数据源与加载状态，页面选择器继续使用现有纯函数，但工作区布局、图表和空状态按真实数据规模重新校准；足迹数据库与 `visual_tiles` 完全不进入写路径。

**Tech Stack:** Python 3.12、FastAPI、SQLite、xlrd、pytest、React 19、TypeScript 6、Vite 8、Vitest、Testing Library、原生 SVG/CSS、项目内浏览器控制能力。

---

## 文件结构与职责

### 后端新增

- `apps/api/src/enroute_api/accounting/models.py`：导入行、账户、分类和 API 写入模型的领域类型与校验常量。
- `apps/api/src/enroute_api/accounting/schema.py`：只创建/迁移 `accounting.sqlite` 中的记账表和索引。
- `apps/api/src/enroute_api/accounting/importer.py`：识别 BIFF、规范化 1349 行、生成稳定 ID、事务导入。
- `apps/api/src/enroute_api/accounting/store.py`：读取数据集，创建/编辑流水，调整账户资料和期初余额。
- `apps/api/src/enroute_api/accounting/router.py`：Pydantic 请求模型、HTTP 状态码和 `/api/accounting/*` 路由。
- `scripts/import_accounting.py`：仓库级显式导入命令，不在 API 请求中自动导入。
- `apps/api/tests/test_accounting_importer.py`：文件识别、金额、分类、账户、幂等和回滚测试。
- `apps/api/tests/test_accounting_api.py`：空库、读取与写入 API 契约测试。

### 前端新增或拆分

- `apps/web/src/accounting/accountingDataSource.ts`：fetch、响应校验和记账写入 API。
- `apps/web/src/accounting/accountingDataSource.test.ts`：网络成功、错误与请求体测试。
- `apps/web/src/accounting/realDataFixtures.ts`：仅供测试的高密度数据夹具，不被生产入口引用。
- `apps/web/src/components/accounting/AccountingLoadState.tsx`：加载、错误重试和空库导入引导。
- `apps/web/src/components/accounting/AccountContributionChart.tsx`：流水页真实账户净变动贡献图。
- `apps/web/src/components/accounting/EmptyTagsNotice.tsx`：源数据无标签时的一行紧凑说明。
- `apps/web/src/components/accounting/AccountingPage.integration.test.tsx`：真实加载、持久化和最新月份行为。

### 前端重点修改

- `apps/web/src/accounting/types.ts`：补充导入元数据、期初余额来源和 API DTO。
- `apps/web/src/components/AccountingPage.tsx`：从 API 加载，协调持久化、选择器、弹窗和壳层快照。
- `apps/web/src/components/accounting/LedgerWorkspace.tsx`：41/59 双区、高密度流水、净资产与分类/账户洞察。
- `apps/web/src/components/accounting/AccountsWorkspace.tsx`：缩小卡片轮替区，放大账户流水和余额分析。
- `apps/web/src/components/accounting/AnalyticsWorkspace.tsx`：长期趋势、分类树和真实账户贡献。
- `apps/web/src/components/accounting/NetWorthPanel.tsx`、`CategoryStackedColumns.tsx`、`CashflowTrendChart.tsx`：按真实规模重绘图形和标签。
- `apps/web/src/components/accounting/accounting.css`：同层玻璃、正确三栏比例、局部滚动和 1440×900 适配。
- `apps/web/src/App.tsx`：允许记账页一次性把默认“今天”定位至最新数据月份。

## Task 1：建立独立记账数据库模式

**Files:**

- Create: `apps/api/src/enroute_api/accounting/__init__.py`
- Create: `apps/api/src/enroute_api/accounting/schema.py`
- Create: `apps/api/src/enroute_api/accounting/models.py`
- Create: `apps/api/tests/test_accounting_schema.py`
- Modify: `apps/api/src/enroute_api/config.py`

- [ ] **Step 1: 写数据库隔离和表约束失败测试**

```python
def test_initialize_accounting_schema_only_writes_requested_database(tmp_path):
    accounting_db = tmp_path / "accounting.sqlite"
    footprint_db = tmp_path / "footprints.sqlite"
    footprint_db.write_bytes(b"untouched-footprint-sentinel")

    initialize_accounting_schema(accounting_db)

    assert footprint_db.read_bytes() == b"untouched-footprint-sentinel"
    with sqlite3.connect(accounting_db) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'",
            )
        }
    assert {
        "accounting_schema",
        "accounting_imports",
        "accounting_accounts",
        "accounting_categories",
        "accounting_tags",
        "accounting_transactions",
        "accounting_transaction_tags",
    } <= tables
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `python -m pytest apps/api/tests/test_accounting_schema.py -q`

Expected: FAIL，`enroute_api.accounting.schema` 尚不存在。

- [ ] **Step 3: 实现模式初始化和配置路径**

```python
SCHEMA_VERSION = 1

def initialize_accounting_schema(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(ACCOUNTING_SCHEMA_SQL)
        connection.execute(
            "INSERT OR IGNORE INTO accounting_schema(version, applied_at) VALUES (?, ?)",
            (SCHEMA_VERSION, datetime.now(timezone.utc).isoformat()),
        )
```

在 `Settings` 新增：

```python
accounting_db_path: Path = Path("data/accounting.sqlite")
```

并在 `from_env()` 读取 `ACCOUNTING_DB_PATH`。SQL 只包含设计文档列出的记账表、外键、唯一约束和读取索引；不得引用 `footprints`、`visual_tiles` 或任何足迹路径。

- [ ] **Step 4: 运行模式测试**

Run: `python -m pytest apps/api/tests/test_accounting_schema.py -q`

Expected: PASS。

- [ ] **Step 5: 提交数据库骨架**

```powershell
git add apps/api/src/enroute_api/accounting apps/api/src/enroute_api/config.py apps/api/tests/test_accounting_schema.py
git commit -m "feat: 建立独立记账数据库模式"
```

## Task 2：实现 BIFF 外部账单规范化与幂等导入

**Files:**

- Create: `apps/api/src/enroute_api/accounting/importer.py`
- Create: `apps/api/tests/test_accounting_importer.py`
- Create: `scripts/import_accounting.py`
- Modify: `apps/api/pyproject.toml`
- Modify: `package.json`

- [ ] **Step 1: 写行转换、账户拆分和分类树失败测试**

```python
def test_normalize_rows_preserves_types_accounts_and_cents():
    rows = [
        ["支出", "午餐", 12.34, "2026-06-18 12:00", "微信 - 日常", "面馆"],
        ["收入", "工资", 5172.41, "2026-06-15 10:56", "微信 - 日常", "实习工资"],
        ["转账", "", 200, "2026-06-18 12:20", "微信 - 日常>花呗", "还款"],
    ]

    normalized = normalize_rows(rows, source_key="fixture")

    assert [row.amount_in_cents for row in normalized] == [1234, 517241, 20000]
    assert normalized[2].from_account_name == "微信 - 日常"
    assert normalized[2].to_account_name == "花呗"
    assert normalized[0].category_path == ("餐饮", "午餐")
    assert normalized[1].category_path == ("劳动所得", "工资")
```

- [ ] **Step 2: 写 BIFF 校验、幂等、人工数据保护和事务回滚失败测试**

```python
def test_reimport_is_idempotent_and_preserves_manual_rows(tmp_path, workbook_fixture):
    db_path = tmp_path / "accounting.sqlite"
    import_accounting_workbook(workbook_fixture, db_path)
    insert_manual_transaction(db_path, transaction_id="manual-1")
    set_manual_opening_balance(db_path, account_name="微信 - 日常", cents=88800)

    import_accounting_workbook(workbook_fixture, db_path)

    assert count_imported_transactions(db_path) == 3
    assert transaction_exists(db_path, "manual-1")
    assert account_opening_balance(db_path, "微信 - 日常") == (88800, "manual")
```

另写坏表头、金额为零、错误转账方向、坏时间和第二行失败后零条落库测试。

- [ ] **Step 3: 运行导入测试确认红灯**

Run: `python -m pytest apps/api/tests/test_accounting_importer.py -q`

Expected: FAIL，导入器尚不存在。

- [ ] **Step 4: 实现精确规范化与稳定 ID**

```python
def amount_to_cents(value: object) -> int:
    cents = int((Decimal(str(value)).quantize(Decimal("0.01")) * 100))
    if cents <= 0:
        raise AccountingImportError("金额必须大于 0")
    return cents

def source_record_id(fields: Sequence[str], occurrence: int) -> str:
    canonical = "\u001f".join((*fields, str(occurrence)))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
```

使用 OLE2 签名 `D0 CF 11 E0 A1 B1 1A E1`、六列表头精确匹配、`xlrd.open_workbook()` 和一个显式 SQLite 事务。账户、父分类、叶分类和交易使用确定性 ID；重新导入只删除同一 `source_key` 的 `origin='import'` 交易关联后重建，人工交易和 `opening_balance_source='manual'` 始终保留。

- [ ] **Step 5: 增加显式导入命令和依赖**

`apps/api/pyproject.toml` 加入 `xlrd>=2.0,<3`。脚本参数：

```python
parser.add_argument("--source", type=Path, default=Path("external/账单@日常-全部-1349.csv"))
parser.add_argument("--database", type=Path, default=Path("data/accounting.sqlite"))
```

根 `package.json` 加入：

```json
"prepare:accounting": "python scripts/import_accounting.py"
```

- [ ] **Step 6: 运行导入测试与命令帮助**

Run: `python -m pytest apps/api/tests/test_accounting_importer.py -q; python scripts/import_accounting.py --help`

Expected: 测试 PASS；帮助中出现 `--source` 与 `--database`。

- [ ] **Step 7: 提交导入器**

```powershell
git add apps/api/src/enroute_api/accounting/importer.py apps/api/tests/test_accounting_importer.py apps/api/pyproject.toml scripts/import_accounting.py package.json
git commit -m "feat: 导入外部真实账单"
```

## Task 3：实现 AccountingStore 与 API 持久化契约

**Files:**

- Create: `apps/api/src/enroute_api/accounting/store.py`
- Create: `apps/api/src/enroute_api/accounting/router.py`
- Create: `apps/api/tests/test_accounting_api.py`
- Modify: `apps/api/src/enroute_api/main.py`

- [ ] **Step 1: 写空库、数据集和写入失败测试**

```python
def test_accounting_dataset_returns_empty_shape_for_new_database(client):
    response = client.get("/api/accounting/dataset")
    assert response.status_code == 200
    assert response.json() == {
        "accounts": [], "transactions": [], "categories": [], "tags": [],
        "imports": [], "legacyCategories": [], "legacyFunds": [],
    }

def test_create_then_edit_expense_persists(client, seeded_accounting_db):
    created = client.post("/api/accounting/transactions", json={
        "type": "expense", "amountInCents": 1880,
        "occurredAt": "2026-06-18T12:30:00",
        "accountId": "account-wechat", "categoryId": "expense-lunch",
        "tagIds": [], "note": "午餐",
    })
    assert created.status_code == 201
    transaction_id = created.json()["id"]
    updated = client.put(f"/api/accounting/transactions/{transaction_id}", json={
        **created.json(), "amountInCents": 2080,
    })
    assert updated.status_code == 200
    assert updated.json()["amountInCents"] == 2080
```

同时覆盖转账两端相同、分类类型不符、未知账户、未知标签、导入记录编辑和账户期初余额调整。

- [ ] **Step 2: 运行 API 测试确认红灯**

Run: `python -m pytest apps/api/tests/test_accounting_api.py -q`

Expected: FAIL，记账路由不存在。

- [ ] **Step 3: 实现 Store 序列化和事务写入**

```python
class AccountingStore:
    def get_dataset(self) -> dict[str, object]: ...
    def create_transaction(self, draft: TransactionWrite) -> dict[str, object]: ...
    def update_transaction(self, transaction_id: str, draft: TransactionWrite) -> dict[str, object]: ...
    def update_account(self, account_id: str, patch: AccountPatch) -> dict[str, object]: ...
```

`get_dataset()` 按 `occurred_at DESC, id DESC` 返回 camelCase；金额始终为整数分。写入前统一验证交易类型、账户方向、分类类型和标签引用，失败抛出领域异常，路由转为 400 或 404。

- [ ] **Step 4: 注册独立路由**

```python
accounting_store = AccountingStore(resolved_settings.accounting_db_path)
app.include_router(create_accounting_router(accounting_store), prefix="/api/accounting")
```

不得把导入操作放进 `create_app()` 或任何 GET 请求。

- [ ] **Step 5: 运行 API 测试**

Run: `python -m pytest apps/api/tests/test_accounting_schema.py apps/api/tests/test_accounting_importer.py apps/api/tests/test_accounting_api.py -q`

Expected: PASS。

- [ ] **Step 6: 提交记账 API**

```powershell
git add apps/api/src/enroute_api/accounting/store.py apps/api/src/enroute_api/accounting/router.py apps/api/src/enroute_api/main.py apps/api/tests/test_accounting_api.py
git commit -m "feat: 提供记账数据持久化接口"
```

## Task 4：建立前端真实数据源与加载状态

**Files:**

- Create: `apps/web/src/accounting/accountingDataSource.ts`
- Create: `apps/web/src/accounting/accountingDataSource.test.ts`
- Create: `apps/web/src/accounting/realDataFixtures.ts`
- Create: `apps/web/src/components/accounting/AccountingLoadState.tsx`
- Modify: `apps/web/src/accounting/types.ts`
- Modify: `apps/web/src/components/AccountingPage.tsx`
- Create: `apps/web/src/components/accounting/AccountingPage.integration.test.tsx`

- [ ] **Step 1: 写 fetch 契约和生产入口失败测试**

```ts
it('loads the production dataset from the accounting API', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(realisticAccountingDataset))
  await expect(loadAccountingDataset()).resolves.toEqual(realisticAccountingDataset)
  expect(fetchMock).toHaveBeenCalledWith('/api/accounting/dataset', expect.any(Object))
})

it('does not initialize the production page with ledgerAtlasDataset', () => {
  const source = readFileSync('src/components/AccountingPage.tsx', 'utf8')
  expect(source).not.toContain('ledgerAtlasDataset')
})
```

- [ ] **Step 2: 运行数据源测试确认红灯**

Run: `npm run test:web -- --run src/accounting/accountingDataSource.test.ts src/components/accounting/AccountingPage.integration.test.tsx`

Expected: FAIL，数据源和真实加载尚不存在。

- [ ] **Step 3: 实现严格 API 数据源**

```ts
export async function loadAccountingDataset(signal?: AbortSignal): Promise<AccountingDataset> {
  return requestAccountingJson('/api/accounting/dataset', { signal })
}

export async function createAccountingTransaction(draft: TransactionWriteDto) {
  return requestAccountingJson('/api/accounting/transactions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
  })
}
```

同文件实现更新流水和 PATCH 账户；非 2xx 读取 FastAPI `detail`，抛出用户可读错误。`AccountingDataset` 新增 `imports` 和账户 `openingBalanceSource`，保留 `legacyCategories`、`legacyFunds` 为空数组以兼容现有选择器。

- [ ] **Step 4: 改造 AccountingPage 加载状态**

页面初始值为 `null`，effect 使用 `AbortController` 加载；加载中显示紧凑骨架，失败显示错误和“重试”，空库显示 `npm run prepare:accounting` 引导。测试夹具只能从测试文件导入，生产模块不得引用 demo 数据。

- [ ] **Step 5: 运行前端数据源测试**

Run: `npm run test:web -- --run src/accounting/accountingDataSource.test.ts src/components/accounting/AccountingPage.integration.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交真实数据源**

```powershell
git add apps/web/src/accounting/accountingDataSource.ts apps/web/src/accounting/accountingDataSource.test.ts apps/web/src/accounting/realDataFixtures.ts apps/web/src/accounting/types.ts apps/web/src/components/AccountingPage.tsx apps/web/src/components/accounting/AccountingLoadState.tsx apps/web/src/components/accounting/AccountingPage.integration.test.tsx
git commit -m "feat: 接入记账真实数据源"
```

## Task 5：持久化创建、编辑和账户调整并定位最新数据月

**Files:**

- Modify: `apps/web/src/components/AccountingPage.tsx`
- Modify: `apps/web/src/components/accounting/TransactionDialog.tsx`
- Modify: `apps/web/src/components/accounting/AccountManagementDialog.tsx`
- Modify: `apps/web/src/components/accounting/AccountingPage.integration.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: 写等待 API 成功和失败保留输入测试**

```ts
it('keeps the edit dialog open when persistence fails', async () => {
  updateAccountingTransactionMock.mockRejectedValueOnce(new Error('数据库写入失败'))
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  expect(await screen.findByText('数据库写入失败')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
```

另测成功后只替换 API 返回记录、账户 PATCH 成功后更新快照、按钮提交期间禁用且不重复发送。

- [ ] **Step 2: 写自动定位最新月份的一次性测试**

当共享范围仍是初始“今天”、当天无流水且导入元数据最新日期为 `2026-06-18` 时，仅调用一次 `onRequestTimeRangeChange` 切换到 `2026-06-01—2026-06-30`；用户主动选择后不再改写，“回到今天”仍可停留今天。

- [ ] **Step 3: 运行集成测试确认红灯**

Run: `npm run test:web -- --run src/components/accounting/AccountingPage.integration.test.tsx src/App.test.tsx`

Expected: FAIL，当前保存仍为会话内更新。

- [ ] **Step 4: 实现持久化协调**

`AccountingPage` 的保存回调改为 `async`，调用数据源后再更新 `dataset`；弹窗接收 `saving`、`saveError` 并只在成功后关闭。账户调整同理。自动定位通过 `useRef(false)` 和显式 `timeRangeOrigin`/初始范围判断避免循环。

- [ ] **Step 5: 运行持久化集成测试**

Run: `npm run test:web -- --run src/components/accounting/AccountingPage.integration.test.tsx src/components/accounting/TransactionDialog.test.tsx src/App.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交持久化交互**

```powershell
git add apps/web/src/components/AccountingPage.tsx apps/web/src/components/accounting/TransactionDialog.tsx apps/web/src/components/accounting/AccountManagementDialog.tsx apps/web/src/components/accounting/AccountingPage.integration.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: 持久化记账编辑与时间定位"
```

## Task 6：按 Mock 水平重做流水页信息架构与图表

**Files:**

- Modify: `apps/web/src/components/accounting/LedgerWorkspace.tsx`
- Modify: `apps/web/src/components/accounting/NetWorthPanel.tsx`
- Modify: `apps/web/src/components/accounting/CategoryStackedColumns.tsx`
- Create: `apps/web/src/components/accounting/AccountContributionChart.tsx`
- Create: `apps/web/src/components/accounting/EmptyTagsNotice.tsx`
- Create: `apps/web/src/components/accounting/LedgerWorkspace.test.tsx`
- Modify: `apps/web/src/accounting/insightSelectors.ts`
- Modify: `apps/web/src/accounting/insightSelectors.test.ts`

- [ ] **Step 1: 写 41/59、真实密度和无标签空间复用失败测试**

测试 2026 年 6 月夹具至少渲染 5 个日期组和可滚动流水；右侧显示期末净资产、期间净变动、收入、支出、资产、负债、前五分类和账户贡献。标签为空时只出现一行“源账单未包含标签”，不得渲染大尺寸 `.tag-amount-table`。

- [ ] **Step 2: 写分类堆叠和桥接图数据测试**

选择器返回收入前五分类、支出前五分类以及各自“其他”；总柱高度按收入/支出总额共享刻度，各段面积严格对应金额。桥接顺序固定为 `期初净资产 → 收入 → 支出 → 期末净资产`，转账不改变净资产。

- [ ] **Step 3: 运行流水页测试确认红灯**

Run: `npm run test:web -- --run src/components/accounting/LedgerWorkspace.test.tsx src/accounting/insightSelectors.test.ts`

Expected: FAIL，真实数据密度和账户贡献尚未实现。

- [ ] **Step 4: 重组流水工作区**

```tsx
<div className="ledger-workspace__stream">...</div>
<div className="ledger-workspace__insights">
  <NetWorthPanel ... />
  <CategoryStackedColumns ... />
  <AccountContributionChart ... />
  {dataset.tags.length === 0 ? <EmptyTagsNotice /> : <TagAmountTable ... />}
</div>
```

流水列约 41%，洞察列约 59%；日期标题吸顶，行高控制在可同时看见 7—10 条，金额、账户、分类和时间保持单行层级，详情仍由整行点击打开。

- [ ] **Step 5: 重绘净资产、分类和账户贡献**

净资产卡上方展示期末值与“按导入账单推算”；资产/负债使用远山黛与冷灰蓝对向条。桥接图使用簇形柱/堆叠段，收入与支出共享纵轴，不使用红色。分类只标注前五叶级与“其他”，tooltip/可访问摘要给出精确金额。

- [ ] **Step 6: 运行流水页测试**

Run: `npm run test:web -- --run src/components/accounting/LedgerWorkspace.test.tsx src/components/accounting/NetWorthPanel.test.tsx src/components/accounting/CategoryStackedColumns.test.tsx src/accounting/insightSelectors.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交流水页重构**

```powershell
git add apps/web/src/components/accounting/LedgerWorkspace.tsx apps/web/src/components/accounting/LedgerWorkspace.test.tsx apps/web/src/components/accounting/NetWorthPanel.tsx apps/web/src/components/accounting/CategoryStackedColumns.tsx apps/web/src/components/accounting/AccountContributionChart.tsx apps/web/src/components/accounting/EmptyTagsNotice.tsx apps/web/src/accounting/insightSelectors.ts apps/web/src/accounting/insightSelectors.test.ts
git commit -m "feat: 重做真实数据流水工作台"
```

## Task 7：重做账户页比例、轮替与真实账户洞察

**Files:**

- Modify: `apps/web/src/components/accounting/AccountsWorkspace.tsx`
- Modify: `apps/web/src/components/accounting/AccountsWorkspace.test.tsx`
- Modify: `apps/web/src/components/accounting/AccountCardCarousel.tsx`
- Modify: `apps/web/src/components/accounting/AccountCardCarousel.test.tsx`
- Modify: `apps/web/src/components/accounting/AccountBalanceStepChart.tsx`
- Modify: `apps/web/src/components/AccountingPage.tsx`

- [ ] **Step 1: 写真实七账户和空间占比失败测试**

断言轮替 DOM 仅有前一张、当前张、后一张；卡片舞台不超过账户页左区高度的 34%；账户流水占左区剩余主要高度。右区显示期初、期末、净变动、收入、支出、转入/转出、余额阶梯和前五分类；无标签只显示紧凑说明。

- [ ] **Step 2: 写资产/负债基准显示测试**

`openingBalanceSource='import-zero-baseline'` 显示“按导入账单推算”；`manual` 显示“已设置期初余额”。负债卡使用冷灰蓝，欠款展示绝对值，选择器中的余额保持负数。

- [ ] **Step 3: 运行账户页测试确认红灯**

Run: `npm run test:web -- --run src/components/accounting/AccountsWorkspace.test.tsx src/components/accounting/AccountCardCarousel.test.tsx`

Expected: FAIL，当前卡片舞台和空标签区域过大。

- [ ] **Step 4: 重组账户页**

左区采用 `minmax(210px, 31%) minmax(0, 1fr)` 纵向结构；右区采用“指标带 + 余额主图 + 分类/说明”结构。卡片轮替保留一次一张、滚轮阻止页面滚动、点击和方向键；隐藏账户默认不进入轮替，归档账户不显示。

- [ ] **Step 5: 校正余额阶梯和来源说明**

余额图首点严格为范围期初，末点严格为范围期末；转账在对应账户产生跃迁。图下显示账户性质、币种、导入起点和基准来源，不再显示“本地原型”。

- [ ] **Step 6: 运行账户页测试**

Run: `npm run test:web -- --run src/components/accounting/AccountsWorkspace.test.tsx src/components/accounting/AccountCardCarousel.test.tsx src/components/accounting/AccountBalanceStepChart.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交账户页重构**

```powershell
git add apps/web/src/components/accounting/AccountsWorkspace.tsx apps/web/src/components/accounting/AccountsWorkspace.test.tsx apps/web/src/components/accounting/AccountCardCarousel.tsx apps/web/src/components/accounting/AccountCardCarousel.test.tsx apps/web/src/components/accounting/AccountBalanceStepChart.tsx apps/web/src/components/AccountingPage.tsx
git commit -m "feat: 重做真实账户轮替工作台"
```

## Task 8：重做统计页真实趋势与分类层级

**Files:**

- Modify: `apps/web/src/components/accounting/AnalyticsWorkspace.tsx`
- Modify: `apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx`
- Modify: `apps/web/src/components/accounting/CashflowTrendChart.tsx`
- Modify: `apps/web/src/components/accounting/CashflowTrendChart.test.tsx`
- Modify: `apps/web/src/components/accounting/TaxonomyTreePanel.tsx`
- Modify: `apps/web/src/components/accounting/TaxonomyTreePanel.test.tsx`
- Modify: `apps/web/src/components/AccountingPage.tsx`

- [ ] **Step 1: 写十个月真实趋势和父子分类失败测试**

以 2025-09 至 2026-06 夹具断言趋势按月显示收入、支出和净额；分类树显示父级聚合金额和原始叶级直接金额；选择节点后右栏快照展示完整路径、直接/聚合值和主要账户。

- [ ] **Step 2: 写空标签和页面空间失败测试**

没有标签时不渲染标签×分类图或大型空树；分类面板扩展到下半部主要宽度，旁边显示账户贡献和口径说明。页面内部不新增第三级导航。

- [ ] **Step 3: 运行统计页测试确认红灯**

Run: `npm run test:web -- --run src/components/accounting/AnalyticsWorkspace.test.tsx src/components/accounting/CashflowTrendChart.test.tsx src/components/accounting/TaxonomyTreePanel.test.tsx`

Expected: FAIL，当前统计布局仍按演示标签数据分配空间。

- [ ] **Step 4: 重组统计画布**

顶部主趋势占约 45% 高度；下方分类层级占主宽，账户贡献和口径占窄列。趋势共享金额刻度，收入/支出用相邻柱，净额用远山黛折线；负净额用冷灰蓝而不是红色。分类树默认展开父级，节点条宽按聚合金额，直接值另列显示，避免把父子值相加。

- [ ] **Step 5: 运行统计页测试**

Run: `npm run test:web -- --run src/components/accounting/AnalyticsWorkspace.test.tsx src/components/accounting/CashflowTrendChart.test.tsx src/components/accounting/TaxonomyTreePanel.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交统计页重构**

```powershell
git add apps/web/src/components/accounting/AnalyticsWorkspace.tsx apps/web/src/components/accounting/AnalyticsWorkspace.test.tsx apps/web/src/components/accounting/CashflowTrendChart.tsx apps/web/src/components/accounting/CashflowTrendChart.test.tsx apps/web/src/components/accounting/TaxonomyTreePanel.tsx apps/web/src/components/accounting/TaxonomyTreePanel.test.tsx apps/web/src/components/AccountingPage.tsx
git commit -m "feat: 重做真实记账统计画布"
```

## Task 9：统一玻璃层级、桌面比例和双分辨率布局

**Files:**

- Modify: `apps/web/src/components/accounting/accounting.css`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`
- Modify: `apps/web/src/components/mapShellLayout.test.tsx`
- Modify: `apps/web/src/components/accounting/AccountingPage.integration.test.tsx`

- [ ] **Step 1: 写样式源契约失败测试**

断言中栏外层和左右玻璃面板使用同一背景、边框、内高光和外阴影 token；2048×1152 目标列宽约 450/956/450；流水内部 41/59；记账子页不存在覆盖共享左栏位置、外边距、宽高或溢出的选择器；支出/负债图表类不含红色色值。

- [ ] **Step 2: 写 1440×900 紧凑契约**

断言桌面断点仍为三栏，中心最小宽度可容纳两内栏，`body` 无横向滚动，流水/树/账户行使用局部滚动；主内容可用高度减去顶栏后不产生页面级纵向滚动。

- [ ] **Step 3: 运行布局测试确认红灯**

Run: `npm run test:web -- --run src/components/mapLayout.test.ts src/components/mapShellLayout.test.tsx src/components/accounting/AccountingPage.integration.test.tsx`

Expected: FAIL，当前内部卡片尺寸和真实数据密度不满足契约。

- [ ] **Step 4: 使用统一 token 重写记账布局 CSS**

```css
.accounting-page {
  background: var(--panel-glass-background);
  border: var(--panel-glass-border);
  box-shadow: var(--panel-glass-shadow), var(--panel-glass-inset);
  overflow: hidden;
}

.ledger-workspace {
  grid-template-columns: minmax(0, 41fr) minmax(0, 59fr);
}
```

减少卡套卡边框，使用留白、细分隔线和背景层级组织内容；流水列表、分类树独立滚动。只调整中间工作区及其内部，不在 `.app-shell--accounting-*` 下改共享左栏几何。

- [ ] **Step 5: 完成 2048×1152 与 1440×900 响应式规则**

2048 下保持约 22.2% / 46.8% / 22.2%；1440 下压缩外边距、字号和图表标签密度，但不把三栏改成不对称窄条，也不牺牲创建入口和关键金额。小于桌面断点才转纵向布局。

- [ ] **Step 6: 运行布局与全量前端测试**

Run: `npm run test:web`

Expected: 前端测试全部 PASS，无 React `act`、NaN 或 SVG 属性警告。

- [ ] **Step 7: 提交视觉重构**

```powershell
git add apps/web/src/components/accounting/accounting.css apps/web/src/App.css apps/web/src/components/mapLayout.test.ts apps/web/src/components/mapShellLayout.test.tsx apps/web/src/components/accounting/AccountingPage.integration.test.tsx
git commit -m "feat: 校准记账工作台密度与玻璃层级"
```

## Task 10：导入真实账单、浏览器验收与交付

**Files:**

- Modify if required by observed defects: `apps/web/src/components/accounting/*`
- Modify if required by observed defects: `apps/web/src/components/AccountingPage.tsx`
- Modify if required by observed defects: `apps/web/src/App.css`
- Modify if repository facts changed: `README.md`

- [ ] **Step 1: 在工作树临时数据库执行真实导入并核对统计**

Run:

```powershell
npm run prepare:accounting -- --database data/accounting.sqlite --source "external/账单@日常-全部-1349.csv"
```

Expected: 1349 笔；支出 1146/¥56,952.95，收入 162/¥72,931.44，转账 41/¥40,770.47；7 个账户；范围 2025-09-01 至 2026-06-18。命令不得修改 `data/footprints.sqlite`。

- [ ] **Step 2: 运行全部自动化门禁**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Expected: 全部 PASS；`git diff --check` 无输出。

- [ ] **Step 3: 使用独立端口启动工作树服务**

避免覆盖主工作区现有服务。API 使用 `ENROUTE_API_PORT=5188` 和工作树 `ACCOUNTING_DB_PATH`，Vite 使用 `127.0.0.1:5183` 并代理到 5188。记录 PID 到被忽略的 `output/`，不提交日志和截图。

- [ ] **Step 4: 用项目浏览器能力验收 2048×1152**

检查流水页默认定位 2026 年 6 月；三栏约 450/956/450；左中右玻璃同层；流水/洞察 41/59；至少可见 7 条真实流水；净资产、桥接、前五分类和账户贡献均有真实值；无巨型空标签卡；控制台和网络面板无错误。

- [ ] **Step 5: 验收账户与统计交互**

账户页逐次滚轮、点击、键盘轮替，确认一次一张且页面不滚动；余额、分类和流水跟随。统计页确认 2025-09 至 2026-06 趋势、父子分类金额、节点焦点与账户贡献。创建一笔临时手工流水、刷新确认存在、编辑后再刷新确认更新；验收完成后通过 API 恢复或在工作树临时库删除该测试记录，不修改外部文件。

- [ ] **Step 6: 用项目浏览器能力验收 1440×900**

检查无横向溢出、主要金额和图例不重叠、弹窗在视口内、局部滚动有效、左右共享面板没有被页面专用 CSS 改位。保存截图到被忽略的 `output/` 供本地比对，不提交。

- [ ] **Step 7: 修复浏览器发现的问题并复验**

每个观察到的问题先补最窄的失败测试，再用 `apply_patch` 修复；重复 Task 2、4、5、6。浏览器不可用时明确记录阻塞，不得用单元测试代替浏览器验收结论。

- [ ] **Step 8: 完成最终验证并检查提交范围**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
git status --short --ignored
```

Expected: 所有门禁通过；未跟踪/忽略项中仅有预期数据库、日志和截图；Git 提交不包含 `external/`、`data/*.sqlite`、`output/` 或密钥。

- [ ] **Step 9: 提交浏览器验收修正**

若产生修正，按实际文件精确暂存后提交：

```powershell
git commit -m "fix: 完成真实记账工作台验收修正"
```

没有代码修正时不创建空提交。

- [ ] **Step 10: 本地合并、主库导入与重启**

按 `superpowers:finishing-a-development-branch` 检查工作树和提交后，本地合并到主分支；在主工作区显式执行 `npm run prepare:accounting` 写入主工作区 `data/accounting.sqlite`，再用 `python start.py restart` 重启服务。最后访问标准端口复核真实账单可见；不 push、不创建远程 PR。

## 完成定义

- 生产记账页不再引用 `ledgerAtlasDataset` 或静态演示流水。
- 外部 BIFF 文件被幂等导入独立 `data/accounting.sqlite`，1349 笔统计完全匹配，足迹库和 `visual_tiles` 未被写入。
- 创建、编辑流水和调整账户期初余额均经 API 持久化，刷新后仍存在；失败不会假成功。
- 默认“今天”无数据时只自动定位一次到最新数据月，用户后续时间选择不被抢夺。
- 流水页保持 41/59、真实高密度瀑布、净资产桥接、前五分类和账户贡献，无大块空标签卡。
- 账户页卡片轮替区尺度克制，账户流水和余额分析成为主体，七账户真实联动。
- 统计页展示真实十个月趋势与两级分类树，不添加第三级导航或无意义标签关系图。
- 三栏比例和玻璃材质同构，支出/负债图表不使用红色，2048×1152 与 1440×900 浏览器验收通过。
- `npm test`、`npm run lint`、`npm run build` 与 `git diff --check` 全部通过。
