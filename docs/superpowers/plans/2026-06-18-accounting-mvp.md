# Accounting MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first usable accounting page to the existing EnRoute React app, backed by typed demo data and tested accounting helpers.

**Architecture:** Keep the map and accounting pages as sibling views under `App`. Put accounting domain types, demo data, and pure calculations under `src/accounting/`, and keep the page UI in `src/components/AccountingPage.tsx`. The MVP uses in-memory state and does not introduce backend or import code.

**Tech Stack:** Vite, React 19, TypeScript, Vitest, Testing Library, lucide-react.

---

### Task 1: Accounting Domain Helpers

**Files:**
- Create: `src/accounting/types.ts`
- Create: `src/accounting/money.ts`
- Create: `src/accounting/trees.ts`
- Create: `src/accounting/balances.ts`
- Test: `src/accounting/accounting.test.ts`

- [ ] Write failing tests for CNY cents formatting, account balance calculations, same-account transfer validation, category path lookup, and tag path lookup.
- [ ] Run `npm test -- --run src/accounting/accounting.test.ts` and verify the tests fail because modules do not exist.
- [ ] Implement the accounting types and pure helpers.
- [ ] Run `npm test -- --run src/accounting/accounting.test.ts` and verify the tests pass.

### Task 2: Demo Dataset

**Files:**
- Create: `src/accounting/demoData.ts`
- Modify: `src/accounting/accounting.test.ts`

- [ ] Add failing tests that demo transactions reference existing accounts, categories of the correct type, and existing tags.
- [ ] Run `npm test -- --run src/accounting/accounting.test.ts` and verify the tests fail because demo data does not exist.
- [ ] Implement a small demo dataset with accounts, category trees, tag trees, and transactions.
- [ ] Run `npm test -- --run src/accounting/accounting.test.ts` and verify the tests pass.

### Task 3: Unified App Navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/App.test.tsx`

- [ ] Add failing tests that the app renders navigation for `地图` and `记账`, starts on the map page, and can switch to the accounting page.
- [ ] Run `npm test -- --run src/App.test.tsx` and verify the tests fail.
- [ ] Implement app-level navigation while preserving the map page and existing map tests.
- [ ] Run `npm test -- --run src/App.test.tsx` and verify the tests pass.

### Task 4: Accounting Page UI

**Files:**
- Create: `src/components/AccountingPage.tsx`
- Modify: `src/App.css`
- Modify: `src/App.test.tsx`

- [ ] Add failing tests for accounting overview totals, account list, transaction list, editor fields, category tree, and tag tree.
- [ ] Run `npm test -- --run src/App.test.tsx` and verify the tests fail.
- [ ] Implement `AccountingPage` using demo data and local state for the editor draft.
- [ ] Run `npm test -- --run src/App.test.tsx` and verify the tests pass.

### Task 5: Final Verification

**Files:**
- Review: `src/accounting/*`
- Review: `src/components/AccountingPage.tsx`
- Review: `src/App.tsx`
- Review: `src/App.css`

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Start the dev server and inspect `地图` and `记账` with a browser.
- [ ] Check desktop and mobile layouts for text overflow and incoherent overlap.
