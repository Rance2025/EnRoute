# 玻璃面板材质一致性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the default shared glass opacity to `0.7`, allow slider value `0`, and make the footprint settings popover visually use the same frosted glass material as the other glass panels.

**Architecture:** Keep the global opacity preference in `navigationPreferences.ts`; existing stored user values continue to win because the read path only falls back to the default when storage is missing or invalid. Keep material ownership in shared `.glass-panel` CSS and remove any footprint-popover-specific visual overrides that make it diverge from the shared material.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS variables.

---

### Task 1: Update the opacity preference contract

**Files:**
- Modify: `apps/web/src/navigationPreferences.ts`
- Modify: `apps/web/src/navigationPreferences.test.ts`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: Write failing tests**

Update expectations so missing storage reads `0.7`, invalid storage reads `0.7`, low values clamp to `0`, and the settings slider has `min="0"` and value `0.7` on a fresh user profile.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm --workspace apps/web run test -- src/navigationPreferences.test.ts src/App.test.tsx src/components/mapLayout.test.ts --run
```

Expected: FAIL because implementation still defaults to `0.92` and min `0.1`.

- [ ] **Step 3: Implement minimal preference changes**

Set `DEFAULT_GLASS_PANEL_OPACITY = 0.7` and `GLASS_PANEL_OPACITY_MIN = 0`.

- [ ] **Step 4: Run tests to verify pass**

Run the same focused test command.

Expected: PASS.

### Task 2: Restore unified frosted material on the footprint settings popover

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: Write failing CSS contract test**

Add contract checks that `.glass-panel` owns a pseudo-element frost overlay and that `.footprint-style-popover` does not define its own `background`, `box-shadow`, `backdrop-filter`, or `-webkit-backdrop-filter`.

- [ ] **Step 2: Run CSS contract test to verify failure**

Run:

```powershell
npm --workspace apps/web run test -- src/components/mapLayout.test.ts --run
```

Expected: FAIL until the shared material provides the missing frosted overlay.

- [ ] **Step 3: Implement shared glass overlay**

Make `.glass-panel` `position: relative`, `overflow: hidden`, and `isolation: isolate`; add `.glass-panel::before` as a pointer-events-none white/edge highlight overlay. Keep `.footprint-style-popover` on `glass-panel glass-panel--solid glass-panel--compact`.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm --workspace apps/web run test -- src/navigationPreferences.test.ts src/App.test.tsx src/components/mapLayout.test.ts --run
```

Expected: PASS.

### Task 3: Verify, browser-check, commit, and merge locally

**Files:**
- Review: changed files from Tasks 1 and 2.

- [ ] **Step 1: Full verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 2: Browser verification**

Run the dev server on an available local port, open the app, confirm the general slider defaults to `0.7`, can move to `0`, and the footprint settings popover visually shows the same frosted material family as the surrounding glass panels.

- [ ] **Step 3: Commit**

Commit:

```powershell
git add apps/web/src/navigationPreferences.ts apps/web/src/navigationPreferences.test.ts apps/web/src/App.test.tsx apps/web/src/App.css apps/web/src/components/mapLayout.test.ts docs/superpowers/plans/2026-06-28-glass-panel-material-consistency.md
git commit -m "fix: 统一玻璃面板磨砂质感"
```
