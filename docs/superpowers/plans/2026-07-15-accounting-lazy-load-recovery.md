# 记账页懒加载失败恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 记账模块加载失败时保留应用外壳并提供重新加载入口，避免整页黑屏。

**Architecture:** 新增一个局部 React Error Boundary，只包裹记账页的懒加载边界。正常加载路径保持不变；失败时由边界渲染中间工作区提示，顶部、左右栏仍由 `App` 保持挂载。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、CSS

---

### Task 1: 用回归测试复现懒加载失败

**Files:**
- Create: `apps/web/src/App.accountingLoadFailure.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
vi.mock('./components/AccountingPage', () => Promise.reject(new Error('chunk unavailable')))

it('keeps the application shell visible when the accounting chunk fails', async () => {
  render(<App amapConfig={missingAmapConfig} />)
  fireEvent.click(screen.getByRole('button', { name: '记账' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('记账页面加载失败')
  expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  expect(screen.getByLabelText('时间范围面板')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace apps/web test -- App.accountingLoadFailure.test.tsx`

Expected: FAIL because the rejected lazy import is not caught and no alert is rendered.

### Task 2: 增加局部恢复边界

**Files:**
- Create: `apps/web/src/components/WorkspaceLoadBoundary.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Implement the minimal boundary**

```tsx
export class WorkspaceLoadBoundary extends Component<Props, State> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return <section role="alert"><strong>记账页面加载失败</strong><button onClick={() => window.location.reload()}>重新加载</button></section>
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: Wrap only the accounting lazy workspace**

```tsx
<WorkspaceLoadBoundary>
  <Suspense fallback={null}>
    <LazyAccountingPage {...props} />
  </Suspense>
</WorkspaceLoadBoundary>
```

- [ ] **Step 3: Add restrained fallback styling**

Use existing glass tokens, neutral green-gray text, and no red warning color.

- [ ] **Step 4: Run the focused test**

Run: `npm --workspace apps/web test -- App.accountingLoadFailure.test.tsx`

Expected: PASS with the outer shell and recovery action visible.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/App.accountingLoadFailure.test.tsx apps/web/src/components/WorkspaceLoadBoundary.tsx apps/web/src/App.tsx apps/web/src/App.css
git commit -m "fix: 避免记账模块加载失败后黑屏"
```

### Task 3: 完整验证并恢复标准服务

**Files:**
- No source changes expected.

- [ ] **Step 1: Run verification**

Run: `npm test`, `npm run lint`, `npm run build`, `git diff --check`.

Expected: all commands exit with code 0.

- [ ] **Step 2: Merge locally and restart**

Merge `fix/accounting-black-screen` into `master`, stop the temporary port `5373`, then run `python start.py start` from `D:\Coding\EnRoute`.

- [ ] **Step 3: Verify service state**

Run: `python start.py status` and confirm the frontend responds on `http://127.0.0.1:5173/`.
