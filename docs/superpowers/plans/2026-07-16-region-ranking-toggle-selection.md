# Region Ranking Toggle Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a selected administrative-region ranking row to clear itself on a second click and make its selected bar visibly darker than both default and hover states.

**Architecture:** Keep `selectedAdminRegion` owned by `App` and replace the direct state-setter callback with one functionally updated toggle handler. Keep the presentational ranking component unchanged, and express the stronger selected state through the existing `.is-selected` CSS contract.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, CSS contract tests, Vite, Playwright/browser acceptance.

---

### Task 1: Toggle the selected ranking from the App state owner

**Files:**
- Modify: `apps/web/src/App.test.tsx:557`
- Modify: `apps/web/src/App.tsx:402-490`
- Modify: `apps/web/src/App.tsx:922-930`

- [ ] **Step 1: Write the failing repeated-click regression test**

Add this test beside the existing administrative-region selection test in `apps/web/src/App.test.tsx`:

```tsx
it('clears the selected administrative region when its ranking is clicked again', async () => {
  render(<App amapConfig={missingAmapConfig} />)
  await settleLazyImports()

  fireEvent.click(within(screen.getByRole('navigation', { name: '二级导航' }))
    .getByRole('button', { name: '区域' }))

  const map = screen.getByTestId('mapbox-canvas')
  const rankingRow = await screen.findByRole('button', { name: /第 1 名 中国/ })

  fireEvent.click(rankingRow)
  expect(map).toHaveAttribute('data-selected-admin-region-id', 'CN')

  fireEvent.click(rankingRow)

  expect(map).not.toHaveAttribute('data-selected-admin-region-id')
  expect(rankingRow).not.toHaveClass('is-selected')
  expect(rankingRow).not.toHaveAttribute('aria-current')
})
```

- [ ] **Step 2: Run the regression test and verify RED**

Run from `apps/web`:

```powershell
& '..\..\node_modules\.bin\vitest.cmd' run src/App.test.tsx -t "clears the selected administrative region when its ranking is clicked again"
```

Expected: FAIL because the second click leaves `data-selected-admin-region-id="CN"`, `.is-selected`, and `aria-current="location"` in place.

- [ ] **Step 3: Add the minimal App-owned toggle handler**

Add this callback near the existing administrative-region handlers in `apps/web/src/App.tsx`:

```tsx
const handleAdminRegionSelect = useCallback((nextRegion: AdminRegionRanking) => {
  setSelectedAdminRegion((currentRegion) => (
    currentRegion?.regionId === nextRegion.regionId ? null : nextRegion
  ))
}, [])
```

Then replace the panel callback:

```tsx
onRegionSelect={handleAdminRegionSelect}
```

Do not change `AdminRegionContextPanel`, `RankingRow`, or `MapboxCanvas`; their current prop contracts already propagate the resulting selected or null state.

- [ ] **Step 4: Run the regression test and verify GREEN**

Run:

```powershell
& '..\..\node_modules\.bin\vitest.cmd' run src/App.test.tsx -t "clears the selected administrative region when its ranking is clicked again"
```

Expected: PASS, with the map selection attribute and ranking selection semantics removed after the second click.

- [ ] **Step 5: Run the complete App test file**

Run:

```powershell
& '..\..\node_modules\.bin\vitest.cmd' run src/App.test.tsx
```

Expected: all tests in `src/App.test.tsx` PASS.

- [ ] **Step 6: Commit the behavior change**

```powershell
git add -- apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "fix: 支持重复点击取消区域选中"
```

### Task 2: Strengthen the selected ranking bar color

**Files:**
- Modify: `apps/web/src/components/mapLayout.test.ts:2071-2165`
- Modify: `apps/web/src/App.css:2590-2596`

- [ ] **Step 1: Change the CSS contract test to require the dark selected color**

In `apps/web/src/components/mapLayout.test.ts`, keep the hover assertion unchanged and replace only the selected fill assertion:

```ts
expect(hoverFillRule).toContain('background: #2c8572')
expect(selectedFillRule).toContain('background: #123f35')
```

- [ ] **Step 2: Run the focused CSS contract test and verify RED**

Run from `apps/web`:

```powershell
& '..\..\node_modules\.bin\vitest.cmd' run src/components/mapLayout.test.ts -t "renders administrative region rankings as a compact trackless bar chart"
```

Expected: FAIL because the current selected rule still contains `background: #2c8572`.

- [ ] **Step 3: Apply the minimal selected-color change**

Change only the selected fill rule in `apps/web/src/App.css`:

```css
.admin-region-ranking-card__row.is-selected .admin-region-ranking-card__bar span {
  background: #123f35;
}
```

Leave the default `#3d8f7d` and hover `#2c8572` rules unchanged. Keep this selected rule after the hover rule so an already selected bar stays dark while hovered.

- [ ] **Step 4: Run the focused CSS contract test and verify GREEN**

Run:

```powershell
& '..\..\node_modules\.bin\vitest.cmd' run src/components/mapLayout.test.ts -t "renders administrative region rankings as a compact trackless bar chart"
```

Expected: PASS.

- [ ] **Step 5: Run the complete CSS contract test file**

Run:

```powershell
& '..\..\node_modules\.bin\vitest.cmd' run src/components/mapLayout.test.ts
```

Expected: all tests in `src/components/mapLayout.test.ts` PASS.

- [ ] **Step 6: Commit the visual change**

```powershell
git add -- apps/web/src/App.css apps/web/src/components/mapLayout.test.ts
git commit -m "fix: 增强区域排行选中柱对比"
```

### Task 3: Verify the integrated behavior and desktop presentation

**Files:**
- Verify: `apps/web/src/App.tsx`
- Verify: `apps/web/src/App.css`
- Verify: `apps/web/src/App.test.tsx`
- Verify: `apps/web/src/components/AdminRegionContextPanel.test.tsx`
- Verify: `apps/web/src/components/mapLayout.test.ts`

- [ ] **Step 1: Run all directly affected frontend tests**

Run from `apps/web`:

```powershell
& '..\..\node_modules\.bin\vitest.cmd' run src/App.test.tsx src/components/AdminRegionContextPanel.test.tsx src/components/mapLayout.test.ts
```

Expected: all directly affected tests PASS.

- [ ] **Step 2: Run the full repository test command and record the known baseline separately**

Run from the repository root:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
```

Expected current baseline: the new and affected tests PASS, while the existing `AccountingPage.integration.test.tsx:100` test may still fail because `onRequestTimeRangeChange` is called zero times instead of once. Do not edit accounting code or its test in this task.

Because `npm test` stops after the web failure, run the remaining suites explicitly:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:api
& 'C:\Program Files\nodejs\npm.cmd' run test:repo
```

Expected: both commands PASS.

- [ ] **Step 3: Run static verification**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build
git diff --check HEAD~2
```

Expected: lint and build exit 0; `git diff --check` prints no errors.

- [ ] **Step 4: Prepare ignored local runtime inputs without changing tracked data**

Copy the root workspace's ignored environment file and known-good persistent database into the isolated worktree without printing secrets:

```powershell
Copy-Item -LiteralPath '..\..\.env.local' -Destination '.env.local'
New-Item -ItemType Directory -Force -Path 'data' | Out-Null
Copy-Item -LiteralPath '..\..\data\footprints.sqlite' -Destination 'data\footprints.sqlite'
```

Before starting services, verify read-only row counts from the copied database and confirm `visual_tiles` is non-empty. Do not rebuild, delete, or otherwise write SQLite tables.

- [ ] **Step 5: Start an isolated desktop acceptance stack**

Run:

```powershell
python start.py start --host 127.0.0.1 --frontend-port 5193 --api-port 5198 --runtime-dir output/start-manager-ranking-toggle
```

Expected: frontend responds at `http://127.0.0.1:5193/` and API responds on port `5198`.

- [ ] **Step 6: Verify the real browser interaction at a desktop viewport**

At `1440 x 900`, open `http://127.0.0.1:5193/`, enter the map's “区域” page, select the “省” level, and click a ranking row such as 上海市. Verify:

1. The row receives `.is-selected` and `aria-current="location"`.
2. Its bar computes to `rgb(18, 63, 53)` (`#123f35`), while an unselected bar remains `rgb(61, 143, 125)` (`#3d8f7d`).
3. The map selection fill appears and the first click focuses the region.
4. Clicking the same row again removes `.is-selected` and `aria-current`, clears the map selection fill, and does not trigger a new fit or default-view reset.
5. Clicking a different row selects the new region normally.
6. No new console errors or warnings appear.

- [ ] **Step 7: Stop the temporary services**

Run:

```powershell
python start.py stop --host 127.0.0.1 --frontend-port 5193 --api-port 5198 --runtime-dir output/start-manager-ranking-toggle
```

Expected: temporary frontend and API listeners stop, with no processes left on ports `5193` or `5198`.

- [ ] **Step 8: Record final repository state**

Run:

```powershell
git status --short --ignored
git log -3 --oneline
```

Expected: no tracked modifications remain; only ignored local dependencies, runtime inputs, build output, and acceptance artifacts may appear.
