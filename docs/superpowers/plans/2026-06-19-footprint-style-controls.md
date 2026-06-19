# Footprint Style Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact map-toolbar settings popover for adjusting footprint point size and color.

**Architecture:** Keep rendering on the existing native AMap `MassMarks` layer. React owns a small `FootprintStyleSettings` state in `AmapCanvas`, passes it to `createMassFootprintLayer`, and recreates the MassMarks layer when settings change so AMap still owns projection during map movement.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, lucide-react, AMap JS API MassMarks.

---

### Task 1: MassMarks Style Options

**Files:**
- Modify: `src/layers/massFootprintLayer.ts`
- Test: `src/layers/massFootprintLayer.test.ts`

- [ ] Add a failing test proving the default point icon is `1.5px`, centered at `0.75`, and uses the theme accent color.
- [ ] Add a failing test proving custom `pixelSize` and `color` are encoded into the SVG icon and AMap `Size`/`Pixel`.
- [ ] Implement the minimal defaults and option handling.
- [ ] Run `npm test -- --run src/layers/massFootprintLayer.test.ts`.

### Task 2: Canvas Wiring

**Files:**
- Modify: `src/components/AmapCanvas.tsx`
- Test: `src/components/AmapCanvas.footprints.test.tsx`

- [ ] Add a failing test proving `AmapCanvas` passes default footprint style settings to `createMassFootprintLayer`.
- [ ] Add a failing test proving changing toolbar size/color recreates the native layer and reuses already loaded raw points.
- [ ] Implement local footprint style state and a layer recreation helper that destroys the previous layer.
- [ ] Run `npm test -- --run src/components/AmapCanvas.footprints.test.tsx`.

### Task 3: Toolbar Popover

**Files:**
- Modify: `src/components/MapControls.tsx`
- Modify: `src/App.css`
- Test: `src/components/mapShellLayout.test.tsx`
- Test: `src/components/mapLayout.test.ts`

- [ ] Add a failing interaction test for opening the settings popover and changing size/color.
- [ ] Add CSS source tests for compact toolbar button sizing and popover positioning.
- [ ] Implement a `Settings2` toolbar icon button, size range/number inputs, color input, and accent swatches.
- [ ] Run `npm test -- --run src/components/mapShellLayout.test.tsx src/components/mapLayout.test.ts`.

### Task 4: Verification

**Files:**
- No direct edits expected.

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Browser-check the dev page: open settings, adjust size/color, confirm no console errors.
