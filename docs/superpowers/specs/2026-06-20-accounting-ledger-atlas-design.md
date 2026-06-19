# EnRoute Accounting Ledger Atlas Design

Date: 2026-06-20

## Goal

Redesign the accounting page into a polished Ledger Atlas workspace that is shaped by the real money backup in `external/`, connects every core accounting view to the shared time panel, and makes category and tag trees first-class visual structures.

## Approved Direction

The approved direction is option 1: use the real external money backup as the shaping source. The implementation must not commit private raw backup data. It should use the observed backup schema and committed representative fixtures to build the import-shaped accounting model and UI.

The product direction is Ledger Atlas:

- Keep the existing EnRoute shell, centered capsule navigation, shared left time panel, and calm map-adjacent visual system.
- Make the right accounting workspace a dense but refined app surface, not a marketing page and not a backend dashboard.
- Treat transaction flow, accounts, analytics, category tree, and tag tree as one connected financial data workspace.
- Use the left time panel as the authoritative scope for ledger rows, account period summaries, analytics, and tree totals.

## External Data Evidence

The local ignored money backup contains:

- `source.json`: 1,349 transaction records.
- `category.json`: 67 legacy category records.
- `fund.json`: 11 fund/account records.

Observed transaction fields:

- `amount`
- `category`
- `createTime`
- `fund`
- `recordTime`
- `remark`
- `uuid`

Observed category fields:

- `createTime`
- `hideTime`
- `name`
- `order`
- `updateTime`
- `uuid`

Observed fund fields:

- `createTime`
- `limit`
- `name`
- `order`
- `type`
- `updateTime`
- `uuid`

The backup provides category references and fund references but does not expose an obvious parent field for a tree. The redesigned UI therefore has two layers:

- Source mapping layer: legacy funds, categories, record time, create time, amount, remark, and raw ids.
- EnRoute semantic layer: EnRoute category trees and tag trees used to enrich imported transactions after conversion.

## Visual Thesis

Ledger Atlas should feel like a refined iPad-native personal data app built beside the map: pale sea and land surfaces, remote-mountain green, restrained expense red, thin translucent panels, crisp rows, and tree structures that feel spatial rather than decorative.

## Main Layout

The existing app shell remains:

- Global capsule navigation is fixed and centered.
- The left `TimeContextPanel` remains the shared time controller.
- The right workspace uses the same single-world workspace geometry as the map and other detail pages.
- The page avoids body-level scrolling on desktop; internal panels scroll.

The accounting page has four stable layers:

1. Scope bar
   - Shows the selected time range from the left panel.
   - Provides the `流水 / 账户 / 统计` accounting mode switch.
   - Uses concise operational copy, not explanatory marketing text.

2. Period summary band
   - Shows net flow, income, expense, transaction count, and active accounts.
   - Updates from the same filtered transaction set used by the active view.
   - Stays visually light and below the nav hierarchy.

3. Mode workspace
   - Ledger mode prioritizes transaction flow.
   - Accounts mode prioritizes period account movement.
   - Analytics mode prioritizes tree-driven financial insight.

4. Semantic graph area
   - Category and tag trees are visible, interactive accounting structures.
   - Trees carry totals, proportions, active states, and selected/focused states.
   - Trees are reused across modes with different emphasis.

## Ledger View

Ledger mode uses a transaction-flow layout:

- Main list groups transactions by occurred/record date.
- Each row shows type, amount, account/fund, legacy category, EnRoute category path, tag paths, time, and remark summary.
- Rows support selected state.
- Selected rows drive a transaction inspector.

The transaction inspector shows:

- Amount and transaction type.
- Source fund/account and legacy category mapping.
- EnRoute category assignment.
- EnRoute tag assignment.
- Record time and create time.
- Remark.
- Import status such as mapped, partial, or unmapped.

The taxonomy side of ledger mode supports:

- Category node click to focus/filter transactions.
- Tag node click to focus/filter transactions by EnRoute semantic tag.
- Visible totals and proportions for the current time range.

## Accounts View

Accounts mode should borrow the beauty of wallet-style cards but remain analytical.

Each account/fund card shows, for the current time range:

- Period opening estimate.
- Income inflow.
- Expense outflow.
- Transfer inflow/outflow if available later.
- Period closing estimate.
- Transaction count.
- Mapping status from `fund.json` to EnRoute account.

The accounts workspace contains:

- A visual account stack/grid with restrained depth.
- An account movement list for the selected account.
- A mapping panel for the 11 imported funds.

The account model must still allow negative balances and must not force asset/liability distinctions in this phase.

## Analytics View

Analytics mode is a tree-led financial insight surface, not a generic dashboard.

It includes:

- Period net flow focus.
- Income and expense category composition.
- Account contribution.
- Tag cross-analysis.
- Category tree and tag tree panels with amounts, share bars, and selected states.

Category tree behavior:

- Income, expense, and transfer categories are separated.
- Legacy categories can be mapped into EnRoute categories.
- Node totals are calculated from the current time range.
- Nodes can be selected to filter or focus the workspace.

Tag tree behavior:

- Tags are global and cross transaction types.
- Tags represent EnRoute semantics such as life stage, trip/place, relationship, and topic.
- One transaction may have multiple tags.
- Tag node totals are calculated from all transactions carrying that tag or a descendant tag.

## Data Model Direction

The UI should use committed sample data shaped by the external backup. Raw `external/` files remain ignored.

The standard model should include:

- `ImportedMoneySourceRecord`
- `ImportedMoneyCategory`
- `ImportedMoneyFund`
- `AccountingTransaction`
- `AccountingAccount`
- `AccountingCategory`
- `AccountingTag`
- `AccountingDataset`
- `TimeRangeSelection`

Money is stored as integer cents. Display uses fixed CNY yuan formatting.

The date used for filtering is the real transaction occurrence/record time. Create time is retained for source audit display and must not drive period analytics.

## Data Flow

The accounting data flow has three layers:

1. Import adapter
   - Converts the external backup shape into EnRoute accounting records.
   - Preserves source ids and source mapping metadata.
   - Does not expose private raw backup data in committed files.

2. Standard selectors
   - Filter transactions by left-panel time range.
   - Derive period metrics.
   - Derive account period summaries.
   - Derive category tree stats.
   - Derive tag tree stats.

3. View components
   - Render ledger, account, analytics, and taxonomy surfaces from derived data.
   - Do not perform ad hoc calculations inline when selectors can express the shared behavior.

## Component Boundaries

Planned boundaries:

- `AccountingPage`: mode state, time-range input, page shell.
- `accountingDataAdapter`: backup-shaped records to standard accounting dataset.
- `accountingSelectors`: time filtering and derived period stats.
- `LedgerWorkspace`: transaction list and inspector.
- `AccountsWorkspace`: account cards, account movement, source fund mapping.
- `AnalyticsWorkspace`: period analytics and tree-led insight.
- `TaxonomyTreePanel`: reusable category/tag tree visualization.
- `TransactionInspector`: selected transaction detail and mapping state.

Current `AccountingPage.tsx` should be split because it has too much UI and calculation responsibility.

## Interaction Rules

- Changing the left time panel updates all accounting totals and rows.
- Switching accounting modes preserves the selected time range.
- Selecting a transaction opens the inspector.
- Selecting a category node focuses the workspace on that category and descendants.
- Selecting a tag node focuses the workspace on that tag and descendants.
- Empty period states show real empty-state UI rather than fake totals.
- Missing mapping is shown as unmapped instead of silently inventing a classification.

## Motion

Motion is restrained:

- Mode changes use light opacity and vertical offset transitions.
- Tree expand/collapse uses height and opacity transitions.
- Amount bars animate when the time range changes.
- Transaction selection uses row highlight and inspector transition.

No decorative motion should compete with accounting readability.

## Visual Constraints

- Avoid a generic dashboard-card mosaic.
- Avoid a marketing hero section.
- Avoid heavy borders, thick shadows, and dense saturated palettes.
- Cards are allowed only where they are the interaction, such as account cards and transaction rows.
- Tree UI should use stable indentation, guide lines, node markers, bars, and selection states.
- Text must fit at desktop and mobile widths.
- Desktop layout should avoid body scrolling; mobile may scroll the accounting page.

## Verification Requirements

Automated tests must cover:

- Import-shaped record conversion into accounting records.
- Time-range filtering.
- Period metrics.
- Account period summaries.
- Category tree totals and descendant aggregation.
- Tag tree totals and descendant aggregation.
- Mode rendering and time-range coupling.
- Empty states.

Manual/browser verification must cover:

- Ledger, accounts, and analytics views render without overlap.
- Left time panel changes update visible accounting summaries.
- Category tree and tag tree are visibly structured and useful.
- Desktop and mobile layouts fit without incoherent overlap.
- Existing map view behavior remains intact.

Final verification commands:

```powershell
npm test -- --run
npm run lint
npm run build
```

Because this is visual UI work, browser verification is required after implementation.
