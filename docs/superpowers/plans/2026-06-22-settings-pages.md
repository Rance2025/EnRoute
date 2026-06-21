# 设置分页与地图统计浮窗配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tabbed settings dialog and move the map render statistics panel behind a persisted map setting that defaults off.

**Architecture:** Keep UI preferences in `apps/web/src/navigationPreferences.ts` beside the existing navigation style preference. `App.tsx` owns the settings dialog tab state and passes a `debugPanelVisible` prop into `AmapCanvas`. CSS updates stay in `App.css` with contract coverage in `mapLayout.test.ts`.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, localStorage, existing CSS.

---

### Task 1: Persist the Map Debug Panel Preference

**Files:**
- Modify: `apps/web/src/navigationPreferences.ts`
- Modify: `apps/web/src/navigationPreferences.test.ts`

- [ ] **Step 1: Write the failing preference tests**

Add tests for `MAP_DEBUG_PANEL_VISIBLE_STORAGE_KEY`, `readMapDebugPanelVisible`, and `writeMapDebugPanelVisible`.

- [ ] **Step 2: Run the preference tests**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts --run`

Expected: fail because the map debug panel preference functions do not exist.

- [ ] **Step 3: Implement the preference helpers**

Add the new storage key and boolean read/write helpers. Default is `false`; only stored string `true` means visible.

- [ ] **Step 4: Re-run the preference tests**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts --run`

Expected: pass.

- [ ] **Step 5: Commit**

Commit: `feat: 增加地图统计浮窗偏好`

### Task 2: Add Settings Pages and the Map Debug Toggle

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/AmapCanvas.tsx`

- [ ] **Step 1: Write failing App tests**

Cover:
- settings dialog exposes `通用 / 地图 / 记账 / 日程` page buttons.
- default map debug panel is hidden.
- map page toggle shows the debug panel and persists `enroute:map-debug-panel-visible=true`.
- persisted `true` shows the debug panel on reload.

- [ ] **Step 2: Run App tests**

Run: `npm --workspace apps/web run test -- src/App.test.tsx --run`

Expected: fail because pages, toggle, and prop do not exist.

- [ ] **Step 3: Implement minimal App behavior**

Add settings page state, tab buttons, page-specific content, map debug visibility state, and pass `debugPanelVisible` to `AmapCanvas`.

- [ ] **Step 4: Update AmapCanvas**

Add optional `debugPanelVisible?: boolean` prop and render `FootprintDebugPanel` only when true.

- [ ] **Step 5: Re-run App tests**

Run: `npm --workspace apps/web run test -- src/App.test.tsx --run`

Expected: pass.

- [ ] **Step 6: Commit**

Commit: `feat: 增加设置分页和地图统计开关`

### Task 3: Style the Two-Column Dialog

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: Write failing CSS contract assertions**

Assert the settings panel uses a wider non-fullscreen width, a two-column body, page list styles, setting row styles, and a mobile fallback.

- [ ] **Step 2: Run layout tests**

Run: `npm --workspace apps/web run test -- src/components/mapLayout.test.ts --run`

Expected: fail because the new selectors are absent.

- [ ] **Step 3: Implement styles**

Style:
- `.settings-dialog__panel` wider but capped.
- `.settings-dialog__body` two columns.
- `.settings-dialog__tabs` vertical page navigation.
- `.settings-dialog__content` right-side content.
- `.settings-switch-row` for the map toggle.
- mobile media query stacks tabs and content.

- [ ] **Step 4: Re-run layout tests**

Run: `npm --workspace apps/web run test -- src/components/mapLayout.test.ts --run`

Expected: pass.

- [ ] **Step 5: Commit**

Commit: `style: 完善设置弹窗分页布局`

### Task 4: Verify End-to-End

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused tests**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts src/App.test.tsx src/components/mapLayout.test.ts --run`

Expected: pass.

- [ ] **Step 2: Run full verification**

Run:
- `npm test`
- `npm run lint`
- `npm run build`

Expected: all pass.

- [ ] **Step 3: Browser verify**

Open local Vite server from this worktree. Verify:
- setting opens from time panel.
- tabs switch between 通用、地图、记账、日程.
- map statistics panel is hidden by default.
- map tab switch shows/hides the statistics panel.
- persisted visible setting survives reload.

- [ ] **Step 4: Commit any final fixes**

If browser verification requires fixes, commit with an appropriate Chinese conventional subject.
