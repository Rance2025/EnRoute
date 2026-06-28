# 玻璃面板透明程度设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slider-only global setting for the shared frosted glass panel opacity.

**Architecture:** Store the setting as a local UI preference in `navigationPreferences.ts`, let `App.tsx` own the state and expose it through a root CSS variable, and let `App.css` use that variable for the shared solid glass material. The setting lives in the existing `设置 > 通用` page beside other general UI preferences.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, localStorage, CSS variables.

---

### Task 1: Persist the Glass Panel Opacity Preference

**Files:**
- Modify: `apps/web/src/navigationPreferences.ts`
- Modify: `apps/web/src/navigationPreferences.test.ts`

- [ ] **Step 1: Write failing preference tests**

Add tests that import:

```ts
GLASS_PANEL_OPACITY_STORAGE_KEY,
readGlassPanelOpacity,
writeGlassPanelOpacity,
```

Cover:

```ts
expect(readGlassPanelOpacity(storageWithNoValue)).toBe(0.92)
expect(readGlassPanelOpacity(storageWithValue('0.48'))).toBe(0.48)
expect(readGlassPanelOpacity(storageWithValue('0.02'))).toBe(0.1)
expect(readGlassPanelOpacity(storageWithValue('1.4'))).toBe(1)
expect(readGlassPanelOpacity(storageThatThrows)).toBe(0.92)
writeGlassPanelOpacity(0.736, storage)
expect(storage.setItem).toHaveBeenCalledWith('enroute:glass-panel-opacity', '0.74')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts --run`

Expected: FAIL because the glass panel opacity preference exports do not exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/navigationPreferences.ts`, add:

```ts
export const GLASS_PANEL_OPACITY_STORAGE_KEY = 'enroute:glass-panel-opacity'
export const DEFAULT_GLASS_PANEL_OPACITY = 0.92
export const GLASS_PANEL_OPACITY_MIN = 0.1
export const GLASS_PANEL_OPACITY_MAX = 1
export const GLASS_PANEL_OPACITY_STEP = 0.01
```

Add `normalizeGlassPanelOpacity`, `readGlassPanelOpacity`, and `writeGlassPanelOpacity`. Round to two decimals after clamping.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts --run`

Expected: PASS.

### Task 2: Add the General Settings Slider

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Write failing App tests**

Add an App test that:

```ts
render(<App amapConfig={missingAmapConfig} />)
fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
const dialog = screen.getByRole('dialog', { name: '设置' })
const opacitySlider = within(dialog).getByLabelText('磨砂玻璃透明程度')
expect(opacitySlider).toHaveAttribute('type', 'range')
expect(opacitySlider).toHaveAttribute('min', '0.1')
expect(opacitySlider).toHaveAttribute('max', '1')
expect(opacitySlider).toHaveAttribute('step', '0.01')
expect(opacitySlider).toHaveValue('0.92')
expect(within(dialog).queryByLabelText('磨砂玻璃透明程度数值')).not.toBeInTheDocument()
expect(screen.getByRole('main')).toHaveStyle({ '--glass-panel-opacity': '0.92' })
fireEvent.change(opacitySlider, { target: { value: '0.48' } })
expect(opacitySlider).toHaveValue('0.48')
expect(screen.getByRole('main')).toHaveStyle({ '--glass-panel-opacity': '0.48' })
expect(window.localStorage.getItem('enroute:glass-panel-opacity')).toBe('0.48')
```

- [ ] **Step 2: Run App test to verify it fails**

Run: `npm --workspace apps/web run test -- src/App.test.tsx --run`

Expected: FAIL because the slider does not exist.

- [ ] **Step 3: Write minimal implementation**

In `App.tsx`, import the preference helpers, create `glassPanelOpacity` state, write `handleGlassPanelOpacityChange`, set `--glass-panel-opacity` on the root style, and render a range input in the general settings page. Use static text for the current value and no numeric input.

In `App.css`, replace the fixed `0.92` solid base alpha with:

```css
--glass-panel-opacity: 0.92;
--theme-mist-solid-base: rgba(239, 246, 244, var(--glass-panel-opacity));
```

Add compact styling for the new slider row.

- [ ] **Step 4: Run App test to verify it passes**

Run: `npm --workspace apps/web run test -- src/App.test.tsx --run`

Expected: PASS.

### Task 3: Verify and Review

**Files:**
- Review: `apps/web/src/navigationPreferences.ts`
- Review: `apps/web/src/App.tsx`
- Review: `apps/web/src/App.css`
- Review: `apps/web/src/navigationPreferences.test.ts`
- Review: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Run focused web tests**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts src/App.test.tsx --run`

Expected: PASS.

- [ ] **Step 2: Run required repository verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Self-review**

Check that the implementation:

- Keeps work off `master`.
- Uses only a slider for editing.
- Uses `0.1` min, `1` max, `0.01` step, and `0.92` default.
- Does not alter footprint point opacity behavior.
- Does not touch SQLite or map tile write paths.

- [ ] **Step 4: Commit**

Commit with:

```bash
git add docs/superpowers/specs/2026-06-28-glass-panel-opacity-setting-design.md docs/superpowers/plans/2026-06-28-glass-panel-opacity-setting.md apps/web/src/navigationPreferences.ts apps/web/src/navigationPreferences.test.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/App.css
git commit -m "feat: 增加玻璃面板透明度设置"
```
