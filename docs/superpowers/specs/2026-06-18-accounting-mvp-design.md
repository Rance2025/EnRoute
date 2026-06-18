# EnRoute Accounting MVP Design

Date: 2026-06-18

## Goal
Build the first accounting page inside the existing EnRoute React app. This MVP should make the accounting model visible and usable with a small set of demo data, while leaving import and backend storage for later.

## Product Context
EnRoute is one product for personal life data. Location, time, and money will eventually be sibling pages under one app. This phase adds the money page without replacing the current map page.

## Scope
- Add app-level navigation between the existing map page and a new accounting page.
- Keep map behavior intact.
- Use in-memory demo data for the first version.
- Support accounts, transactions, category trees, and tag trees in the UI.
- Use the same frontend application; do not create a separate app.
- Do not implement import, backend APIs, database storage, external raw-field retention, multi-currency, audit history, or complex statistical charts.

## Accounting Model

### Money
- First phase supports CNY only.
- Store money as integer cents.
- Display money as `xx.xx`.

### Accounts
- Accounts are user-configured and are never hard-deleted.
- Accounts can be hidden and archived.
- Accounts do not distinguish asset and liability types.
- Balances can be negative.
- Each account has `openingBalanceInCents` and `openingBalanceAt`.
- `createdAt` records when the account was created in EnRoute and does not drive financial calculations.

### Transactions
- Transaction types are `income`, `expense`, and `transfer`.
- Amounts are always positive cents.
- Income and expense require one account.
- Transfer requires a source account and a destination account, and the two accounts cannot be the same.
- Every transaction has `occurredAt` for the real event time and `createdAt` for the system record time.
- If a user does not choose an event time, `occurredAt` defaults to `createdAt`.
- Category and note can be empty.
- A transaction can have multiple tags.
- No merchant or counterparty field is required; free-form details belong in note.

### Categories
- Income, expense, and transfer each have their own category tree.
- All category trees use the same data model.
- A transaction can have at most one category, and the category must match its transaction type.
- Category trees support multiple levels.
- Any category node can be selected; leaf-only selection is not required.
- Categories are archived or migrated, not hard-deleted.

### Tags
- Tags are global and can cross transaction types and categories.
- Tags are tree-shaped and support multiple levels.
- A transaction can have multiple tags.
- Any tag node can be selected.
- Same-name tags are allowed under different parents; selectors should disambiguate by path.
- Tags are archived, not hard-deleted.

## UI Direction
The accounting page should feel like a restrained working surface: dense, calm, scannable, and consistent with the existing map product. It should show real controls and editable-looking structures, not a marketing landing page.

## First Version UI
- Global app navigation with `地图` and `记账`.
- Accounting overview with total balance, month income, month expense, and account count.
- Account balance list.
- Transaction list with type, amount, account flow, category path, tag paths, occurred time, and note.
- Transaction editor form for type, amount, accounts, occurred time, category, tags, and note.
- Category tree panel separated by income, expense, and transfer.
- Global tag tree panel.

## Verification
- Unit tests cover money formatting, account balance calculation, category path building, tag path building, and transfer validation.
- App tests cover navigation and accounting page rendering.
- Run `npm test -- --run`, `npm run lint`, and `npm run build`.
- Browser-check the accounting page at desktop and mobile widths.
