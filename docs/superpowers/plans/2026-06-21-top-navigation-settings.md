# Top Navigation Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a selectable-logo top navigation with default pure-icon page entries and a centered settings dialog that toggles between pure-icon and mixed icon+text navigation.

**Architecture:** Keep the change in the React frontend. Add a small navigation preference module for localStorage reads/writes, render the top navigation directly in `App.tsx` because the logo segment has a different width from page icon segments, and keep the settings entry inside the shared `TimeContextPanel` footer row. The centered settings dialog is app-level state and only controls the navigation style.

**Tech Stack:** React 19, TypeScript, lucide-react, Vitest, Testing Library, CSS contract tests.

---

### Task 1: Navigation Preference Storage

**Files:**
- Create: `apps/web/src/navigationPreferences.ts`
- Create: `apps/web/src/navigationPreferences.test.ts`

- [ ] **Step 1: Write failing tests for localStorage defaults and persistence**

Create `apps/web/src/navigationPreferences.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import {
  NAVIGATION_STYLE_STORAGE_KEY,
  readNavigationStyle,
  writeNavigationStyle,
} from './navigationPreferences'

function createStorage(initialValue?: string) {
  const values = new Map<string, string>()
  if (initialValue !== undefined) values.set(NAVIGATION_STYLE_STORAGE_KEY, initialValue)

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  } as Pick<Storage, 'getItem' | 'setItem'>
}

describe('navigationPreferences', () => {
  it('defaults to icon style when storage is empty or invalid', () => {
    expect(readNavigationStyle(createStorage())).toBe('icon')
    expect(readNavigationStyle(createStorage('wide'))).toBe('icon')
  })

  it('reads and writes the mixed navigation style', () => {
    const storage = createStorage('mixed')

    expect(readNavigationStyle(storage)).toBe('mixed')

    writeNavigationStyle('icon', storage)

    expect(storage.setItem).toHaveBeenCalledWith(NAVIGATION_STYLE_STORAGE_KEY, 'icon')
  })

  it('falls back without throwing when storage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('blocked') }),
      setItem: vi.fn(() => { throw new Error('blocked') }),
    } as Pick<Storage, 'getItem' | 'setItem'>

    expect(readNavigationStyle(storage)).toBe('icon')
    expect(() => writeNavigationStyle('mixed', storage)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run preference tests and verify they fail**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts --run`

Expected: FAIL because `./navigationPreferences` does not exist.

- [ ] **Step 3: Implement preference helpers**

Create `apps/web/src/navigationPreferences.ts`:

```ts
export type NavigationStyle = 'icon' | 'mixed'

export const NAVIGATION_STYLE_STORAGE_KEY = 'enroute:navigation-style'

export function readNavigationStyle(
  storage: Pick<Storage, 'getItem'> | undefined = getBrowserStorage(),
): NavigationStyle {
  try {
    const storedValue = storage?.getItem(NAVIGATION_STYLE_STORAGE_KEY)

    return storedValue === 'mixed' ? 'mixed' : 'icon'
  } catch {
    return 'icon'
  }
}

export function writeNavigationStyle(
  style: NavigationStyle,
  storage: Pick<Storage, 'setItem'> | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(NAVIGATION_STYLE_STORAGE_KEY, style)
  } catch {
    // Local preference writes should never block the UI.
  }
}

function getBrowserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}
```

- [ ] **Step 4: Run preference tests and verify they pass**

Run: `npm --workspace apps/web run test -- src/navigationPreferences.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Commit preference module**

Run:

```powershell
git add apps/web/src/navigationPreferences.ts apps/web/src/navigationPreferences.test.ts
git commit -m "feat: 增加导航样式偏好存储"
```

### Task 2: App Top Navigation Behavior

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Add failing App tests for default icon navigation, logo selection, settings toggle, and persistence**

In `apps/web/src/App.test.tsx`, update imports to include `beforeEach`, then add `window.localStorage.clear()` in `beforeEach`. Add tests:

```ts
  it('defaults to pure icon top navigation with a selectable logo overview segment', () => {
    render(<App amapConfig={missingAmapConfig} />)

    const mainNav = screen.getByRole('navigation', { name: '主导航' })

    expect(within(mainNav).getByRole('button', { name: '在途 EnRoute' })).toBeInTheDocument()
    expect(within(mainNav).getByRole('button', { name: '地图' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(mainNav).getByRole('button', { name: '记账' })).toHaveAttribute('title', '记账')
    expect(within(mainNav).queryByText('地图')).not.toBeInTheDocument()
    expect(within(mainNav).queryByText('记账')).not.toBeInTheDocument()
    expect(within(mainNav).queryByText('日程')).not.toBeInTheDocument()

    fireEvent.click(within(mainNav).getByRole('button', { name: '在途 EnRoute' }))

    expect(within(mainNav).getByRole('button', { name: '在途 EnRoute' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('main')).toHaveClass('app-shell--overview')
    expect(screen.getByLabelText('在途 EnRoute 概览工作区')).toBeInTheDocument()
  })

  it('opens a centered settings dialog from the time panel and toggles mixed navigation labels', () => {
    render(<App amapConfig={missingAmapConfig} />)

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))

    const dialog = screen.getByRole('dialog', { name: '设置' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '纯 icon' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: '图文混合' }))

    const mainNav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(mainNav).getByText('地图')).toBeInTheDocument()
    expect(within(mainNav).getByText('记账')).toBeInTheDocument()
    expect(window.localStorage.getItem('enroute:navigation-style')).toBe('mixed')
  })

  it('restores the persisted mixed navigation style on reload', () => {
    window.localStorage.setItem('enroute:navigation-style', 'mixed')

    render(<App amapConfig={missingAmapConfig} />)

    const mainNav = screen.getByRole('navigation', { name: '主导航' })

    expect(within(mainNav).getByText('地图')).toBeInTheDocument()
    expect(within(mainNav).getByText('记账')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run App tests and verify they fail**

Run: `npm --workspace apps/web run test -- src/App.test.tsx --run`

Expected: FAIL because the logo segment is not selectable, settings is absent, and persistence is not implemented.

- [ ] **Step 3: Implement top navigation and settings state in App**

Modify `apps/web/src/App.tsx`:

- Import `CalendarDays`, `MapPinned`, `Wallet`, `X` and `type LucideIcon` from `lucide-react`.
- Import `NavigationStyle`, `readNavigationStyle`, `writeNavigationStyle`.
- Replace `viewOptions` with app-specific top navigation items, including enabled `overview`, `map`, `accounting`, `schedule`.
- Add `navigationStyle` and `isSettingsOpen` state.
- Render a custom top nav with a thumb using calculated pixel widths.
- Render overview and schedule placeholders instead of routing every non-map view to accounting.
- Pass `onOpenSettings={() => setIsSettingsOpen(true)}` to `TimeContextPanel`.
- Render a centered settings dialog when `isSettingsOpen` is true.

Use these helper shapes in `App.tsx`:

```ts
type TopNavigationItem = {
  value: AppView
  label: string
  icon?: LucideIcon
  kind: 'brand' | 'page'
}

const topNavigationItems: TopNavigationItem[] = [
  { value: 'overview', label: '在途 EnRoute', kind: 'brand' },
  { value: 'map', label: '地图', icon: MapPinned, kind: 'page' },
  { value: 'accounting', label: '记账', icon: Wallet, kind: 'page' },
  { value: 'schedule', label: '日程', icon: CalendarDays, kind: 'page' },
]

const navigationStyleOptions: Array<SegmentedOption<NavigationStyle>> = [
  { value: 'icon', label: '纯 icon' },
  { value: 'mixed', label: '图文混合' },
]
```

- [ ] **Step 4: Run App tests and verify they pass**

Run: `npm --workspace apps/web run test -- src/App.test.tsx --run`

Expected: PASS.

- [ ] **Step 5: Commit App behavior**

Run:

```powershell
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: 重构顶部导航入口"
```

### Task 3: Time Panel Settings Entry and Centered Dialog Styling

**Files:**
- Modify: `apps/web/src/components/TimeContextPanel.tsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: Write failing CSS/source contract tests**

In `apps/web/src/components/mapLayout.test.ts`, add assertions to existing time panel layout tests:

```ts
    expect(timeContextPanelSource).toContain('aria-label="打开设置"')
    expect(timeContextPanelSource).toContain('className="time-context-panel__footer"')
    expect(cssRule('.time-context-panel__footer')).toContain('align-self: end')
    expect(cssRule('.time-settings-button')).toContain('width: 44px')
    expect(cssRule('.settings-dialog')).toContain('position: fixed')
    expect(cssRule('.settings-dialog__panel')).toContain('width: min(360px, calc(100vw - 32px))')
    expect(cssRule('.app-shell--map .time-context-panel__footer')).toBe('')
    expect(cssRule('.app-shell--accounting .time-context-panel__footer')).toBe('')
```

- [ ] **Step 2: Run layout tests and verify they fail**

Run: `npm --workspace apps/web run test -- src/components/mapLayout.test.ts --run`

Expected: FAIL because settings footer and dialog CSS are absent.

- [ ] **Step 3: Implement TimeContextPanel setting entry**

Modify `apps/web/src/components/TimeContextPanel.tsx`:

```ts
import { Settings } from 'lucide-react'
```

Add prop:

```ts
  onOpenSettings?: () => void
```

Destructure it and render after `.time-panel-content`:

```tsx
        <footer className="time-context-panel__footer" aria-label="应用设置">
          <button
            type="button"
            className="time-settings-button"
            aria-label="打开设置"
            title="设置"
            onClick={onOpenSettings}
          >
            <Settings size={18} strokeWidth={1.9} aria-hidden="true" />
            <span>设置</span>
          </button>
        </footer>
```

- [ ] **Step 4: Add CSS for nav, settings entry, and dialog**

Modify `apps/web/src/App.css`:

- Add top nav custom grid/thumb styles under the current `.app-nav` area.
- Add `.time-context-panel__footer` and `.time-settings-button` styles near time panel styles.
- Add `.settings-dialog`, `.settings-dialog__backdrop`, `.settings-dialog__panel`, `.settings-dialog__close`, `.settings-dialog__section`, and `.settings-navigation-tabs` styles near app-level styles.
- Use non-view-specific selectors for the time panel footer.

- [ ] **Step 5: Run layout tests and App tests**

Run:

```powershell
npm --workspace apps/web run test -- src/components/mapLayout.test.ts --run
npm --workspace apps/web run test -- src/App.test.tsx --run
```

Expected: PASS.

- [ ] **Step 6: Commit panel and CSS work**

Run:

```powershell
git add apps/web/src/components/TimeContextPanel.tsx apps/web/src/App.css apps/web/src/components/mapLayout.test.ts
git commit -m "feat: 增加导航设置弹窗"
```

### Task 4: Focused Regression and Browser Verification

**Files:**
- Modify if needed: `apps/web/src/App.test.tsx`
- Modify if needed: `apps/web/src/components/SegmentedControl.test.tsx`

- [ ] **Step 1: Run focused frontend tests**

Run:

```powershell
npm --workspace apps/web run test -- src/navigationPreferences.test.ts src/App.test.tsx src/components/mapLayout.test.ts src/components/SegmentedControl.test.tsx --run
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Browser verify the UI**

Start dev server from the worktree:

```powershell
npm run dev -- --host 127.0.0.1 --port 5178
```

Verify in browser:

- Default top nav is pure icon.
- Logo segment is selectable and goes to overview placeholder.
- Settings button appears at the left time panel lower-left.
- Settings dialog is centered and non-fullscreen.
- Switching to mixed shows labels in the top nav and persists after reload.
- Map still renders or the missing-key state still displays without console errors.

- [ ] **Step 4: Commit any test polish**

If browser verification reveals small test or CSS polish, commit with:

```powershell
git add apps/web/src
git commit -m "test: 补充导航设置验证"
```
