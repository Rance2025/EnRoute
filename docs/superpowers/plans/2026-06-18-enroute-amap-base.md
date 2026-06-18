# EnRoute AMap Base Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-screen React/TypeScript AMap base map for 在途 EnRoute.

**Architecture:** Use Vite for the app shell, a small AMap config module for environment parsing, a loader service for JS API loading, and isolated React components for map lifecycle and controls. Future track and point layers live under `src/layers` and are not implemented yet.

**Tech Stack:** Vite, React, TypeScript, Vitest, Testing Library, AMap JS API 2.0, lucide-react.

---

### Task 1: Scaffold app and dependencies

**Files:**
- Create: `package.json`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `src/*`

- [ ] Create Vite React TypeScript app in the current directory.
- [ ] Install runtime dependency `@amap/amap-jsapi-loader` and `lucide-react`.
- [ ] Install test dependencies `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` if not already present.

### Task 2: Add testable AMap config and loader

**Files:**
- Create: `src/config/amap.ts`
- Create: `src/services/amapLoader.ts`
- Create: `src/config/amap.test.ts`

- [ ] Write tests for missing config and valid config parsing.
- [ ] Verify tests fail before implementation.
- [ ] Implement config parsing and AMap loader helpers.
- [ ] Verify tests pass.

### Task 3: Build full-screen UI and fallback state

**Files:**
- Create: `src/components/AmapCanvas.tsx`
- Create: `src/components/MapControls.tsx`
- Modify: `src/App.tsx`, `src/App.css`, `src/main.tsx`
- Create: `src/App.test.tsx`

- [ ] Write a test that missing config renders a credential setup message.
- [ ] Verify the test fails before implementation.
- [ ] Implement app shell, full-screen map canvas, controls, and fallback.
- [ ] Verify tests pass.

### Task 4: Environment and layer placeholders

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `src/layers/README.md`

- [ ] Document local AMap environment variables.
- [ ] Ensure `.env.local` is ignored.
- [ ] Add notes for future million-point rendering layers.

### Task 5: Verify and run

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run build`.
- [ ] Start the dev server and inspect the UI with a browser.
