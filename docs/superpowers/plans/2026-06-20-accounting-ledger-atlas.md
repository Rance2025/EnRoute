# Accounting Ledger Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Ledger Atlas accounting workspace with import-shaped data, time-range-driven views, and visual category/tag trees.

**Architecture:** Split the current monolithic accounting page into import-shaped data, selectors, and focused UI components. Use committed representative data shaped by the ignored external money backup, while keeping private raw backup files uncommitted.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, lucide-react.

---

## File Structure

- Create `src/accounting/importedMoney.ts`: representative import-shaped records and adapter helpers.
- Create `src/accounting/selectors.ts`: time-range filtering, metrics, account summaries, tree stats.
- Create `src/accounting/ledgerAtlasData.ts`: committed demo dataset shaped from the import adapter plus EnRoute semantic category/tag enrichment.
- Create `src/components/accounting/TaxonomyTreePanel.tsx`: reusable visual tree panel.
- Create `src/components/accounting/LedgerWorkspace.tsx`: ledger rows and transaction inspector.
- Create `src/components/accounting/AccountsWorkspace.tsx`: account cards and account movement.
- Create `src/components/accounting/AnalyticsWorkspace.tsx`: analytics and tree-led insight.
- Modify `src/components/AccountingPage.tsx`: orchestrate mode, selection, derived data, and layout.
- Modify `src/components/TimeContextPanel.tsx`: make accounting summary values derive from real accounting dataset helpers instead of static copy.
- Modify `src/App.css`: Ledger Atlas visual system and responsive behavior.
- Modify `src/accounting/types.ts`: extend types for source mapping and tree stats.
- Modify `src/App.test.tsx`: update UI expectations for Ledger Atlas.
- Create `src/accounting/importedMoney.test.ts`.
- Create `src/accounting/selectors.test.ts`.

## Tasks

### Task 1: Import-Shaped Accounting Data

**Files:**
- Modify: `src/accounting/types.ts`
- Create: `src/accounting/importedMoney.ts`
- Create: `src/accounting/importedMoney.test.ts`
- Create: `src/accounting/ledgerAtlasData.ts`

- [ ] Write failing tests for import-shaped record conversion:
  - epoch millisecond `recordTime` maps to ISO time.
  - amount yuan maps to integer cents.
  - fund/category ids are preserved as source mapping.
  - missing semantic mapping becomes `unmapped`.
- [ ] Run `npm test -- --run src/accounting/importedMoney.test.ts` and verify failure.
- [ ] Implement the adapter and representative committed fixtures.
- [ ] Run the focused test and verify pass.

### Task 2: Shared Selectors

**Files:**
- Create: `src/accounting/selectors.ts`
- Create: `src/accounting/selectors.test.ts`

- [ ] Write failing tests for:
  - `filterTransactionsByTimeRange`
  - `getPeriodMetrics`
  - `getAccountPeriodSummaries`
  - `getCategoryTreeStats`
  - `getTagTreeStats`
- [ ] Run `npm test -- --run src/accounting/selectors.test.ts` and verify failure.
- [ ] Implement selector functions.
- [ ] Run focused selector tests and verify pass.

### Task 3: Component Split and Ledger View

**Files:**
- Create: `src/components/accounting/TaxonomyTreePanel.tsx`
- Create: `src/components/accounting/LedgerWorkspace.tsx`
- Modify: `src/components/AccountingPage.tsx`
- Modify: `src/App.test.tsx`

- [ ] Write failing rendering tests for:
  - accounting page shows Ledger Atlas scope bar.
  - ledger view shows transaction list, inspector, category tree, and tag tree.
  - changing left time range changes visible accounting scope text.
- [ ] Run focused app tests and verify failure.
- [ ] Implement components and page orchestration.
- [ ] Run focused app tests and verify pass.

### Task 4: Accounts and Analytics Views

**Files:**
- Create: `src/components/accounting/AccountsWorkspace.tsx`
- Create: `src/components/accounting/AnalyticsWorkspace.tsx`
- Modify: `src/components/AccountingPage.tsx`
- Modify: `src/App.test.tsx`

- [ ] Write failing rendering tests for:
  - accounts view shows period account cards and imported fund mapping.
  - analytics view shows category composition and tag cross-analysis.
  - mode switching preserves the time-scoped summary.
- [ ] Run focused app tests and verify failure.
- [ ] Implement accounts and analytics components.
- [ ] Run focused app tests and verify pass.

### Task 5: Time Panel Coupling and Visual CSS

**Files:**
- Modify: `src/components/TimeContextPanel.tsx`
- Modify: `src/App.css`
- Modify: `src/App.test.tsx`

- [ ] Write/update failing tests for accounting summary values in the left time panel.
- [ ] Run focused tests and verify failure.
- [ ] Wire summary values to accounting dataset selectors.
- [ ] Implement Ledger Atlas styling, responsive layout, taxonomy tree visuals, and interaction states.
- [ ] Run focused tests and verify pass.

### Task 6: Full Verification and Commit

**Files:**
- All changed implementation files.

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Start dev server and browser-check desktop and mobile accounting views.
- [ ] Commit implementation with `feat: 重做记账图谱工作台`.
