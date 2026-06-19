# Footprint Opacity Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slider-only footprint point opacity setting from `0.3` to `1`, defaulting to the existing `0.82` value.

**Architecture:** Extend the existing `FootprintStyle` model with `opacity`, normalize it beside size and color, persist it through the existing `enroute.footprintStyle` key, and pass it to `createMassFootprintLayer`. The native MassMarks layer remains the renderer; opacity is encoded into the SVG icon's `fill-opacity`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, AMap JS API MassMarks.

---

### Task 1: Style Model And Layer

**Files:**
- Modify: `src/layers/footprintStyle.ts`
- Modify: `src/layers/massFootprintLayer.ts`
- Test: `src/layers/footprintStyle.test.ts`
- Test: `src/layers/massFootprintLayer.test.ts`

- [ ] Add failing tests for default opacity `0.82`, custom opacity encoding, rounding to `0.01`, invalid fallback, and clamping to `0.3` through `1`.
- [ ] Implement opacity normalization and MassMarks option wiring.
- [ ] Run `npm test -- --run src/layers/footprintStyle.test.ts src/layers/massFootprintLayer.test.ts`.

### Task 2: Canvas Persistence Wiring

**Files:**
- Modify: `src/components/AmapCanvas.tsx`
- Test: `src/components/AmapCanvas.footprints.test.tsx`

- [ ] Add failing tests proving stored opacity is normalized and passed to `createMassFootprintLayer`.
- [ ] Implement the minimal wiring if the existing normalized style path does not already cover it.
- [ ] Run `npm test -- --run src/components/AmapCanvas.footprints.test.tsx`.

### Task 3: Toolbar Slider

**Files:**
- Modify: `src/components/MapControls.tsx`
- Test: `src/components/mapShellLayout.test.tsx`

- [ ] Add a failing interaction test proving the popover includes a slider-only opacity control with min `0.3`, max `1`, step `0.01`.
- [ ] Implement the opacity row using the existing popover row style and no number input.
- [ ] Run `npm test -- --run src/components/mapShellLayout.test.tsx`.

### Task 4: Required Verification

**Files:**
- No direct edits expected.

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
