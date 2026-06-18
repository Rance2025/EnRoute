# EnRoute AMap Base Map Design

Date: 2026-06-18

## Goal
Build the first web version of EnRoute as a full-screen AMap-based map surface. This phase focuses on bringing in the domestic map, making the map visually close to a polished lifetime-footprint product, and leaving clear extension points for future track and point layers.

## Scope
- Use Vite, React, and TypeScript.
- Load AMap JS API 2.0 through a dedicated loader service.
- Read `VITE_AMAP_KEY` and `VITE_AMAP_SECURITY_CODE` from local environment variables.
- Render a full-screen dark AMap surface with light overlay UI.
- Brand text: `在途 EnRoute`.
- Provide basic controls: locate, reset view, zoom in, zoom out, theme cycling.
- Show a useful configuration fallback when credentials are missing.
- Do not implement real GPS points, tracks, storage, import, or account features in this phase.

## Visual Direction
The map should feel calm, dark, and inspection-friendly: a full-bleed map, low UI chrome, restrained glass panels, and a single warm accent. The first screen should be the product surface itself, not a landing page.

## Architecture
- `src/config/amap.ts`: environment parsing and default map constants.
- `src/services/amapLoader.ts`: AMap JS API loading and testable credential validation.
- `src/components/AmapCanvas.tsx`: map lifecycle, controls, theme switching, and error states.
- `src/components/MapControls.tsx`: icon controls around the map.
- `src/layers/`: future track/point layer boundary.

## Future Data Scale
Future million-point rendering will not use React DOM markers. It should use data simplification, viewport loading, clustering/aggregation, and AMap Loca or other WebGL layer techniques.
