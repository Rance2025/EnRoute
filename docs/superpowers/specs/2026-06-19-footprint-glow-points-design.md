# Footprint Glow Points Design

Date: 2026-06-19

## Goal
Render the first EnRoute location data layer as tiny glow points on the existing AMap surface. The layer should make tens of thousands of local sample points visible now, while keeping a path toward million-scale data without treating every raw point as a permanent on-screen marker.

## Current Sample
The local sample file is `external/backUpData-all.csv`. It contains 40,441 rows with these columns:

```text
dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude
```

Field interpretation for the first implementation:

- `dataTime`: Unix timestamp in seconds.
- `longitude` and `latitude`: decimal coordinates used for map rendering.
- `accuracy`: positioning quality signal in meters; keep it in the parsed model, but do not filter by it in the first visible version.
- `speed`, `distance`, `heading`, and `altitude`: movement metadata; preserve them for future track and quality views.
- `locType`, `isBackForeground`, and `stepType`: categorical metadata; the current sample has one value for each, so do not build UI around them yet.

The file is personal location data and must stay local. Do not commit `external/` or derived local public data files.

## Product Behavior
The first visible layer is a quiet field of small light points. It should not show text labels, marker icons, counts, or cluster bubbles. When the map is zoomed far out, many raw points are visually indistinguishable, so they should collapse into fewer representative glow points. When the user zooms in, those representatives split into finer points after the map settles.

Interaction priority:

- During drag and zoom, keep the existing rendered points in place so the map remains smooth.
- After `moveend` or `zoomend`, recompute the visible representative points for the final viewport and fractional zoom.
- Keep the old layer visible until the new result is ready, then swap the data once.

## Rendering Strategy
Use AMap Loca 2.0 for drawing. EnRoute should not render point DOM nodes and should not hand-roll map projection drawing on a React canvas. Loca handles the high-performance WebGL point layer. EnRoute handles data parsing, viewport selection, and screen-space aggregation.

The point layer should use `Loca.PointLayer` with a small pixel radius, mild blur, and `lighter` blending. The visual goal is "small glow points", not marker pins.

## Aggregation Strategy
Use screen-space aggregation after the map settles:

1. Convert each candidate point to Web Mercator world pixels at the current real zoom.
2. Divide projected pixels into a grid whose cell size is measured in screen pixels.
3. Put points in the same cell into one bucket.
4. Emit one representative point per bucket.
5. Preserve bucket `count` so style can slightly increase opacity or radius without showing numbers.

Representative point rule:

- Use the average projected position of the bucket and unproject it back to coordinates.
- Track the earliest and latest timestamps in the bucket.
- Track the minimum accuracy in the bucket for future quality filtering.

This makes stable map states visually equivalent at any zoom level, without recalculating every animation frame.

## Data Flow
The first implementation should use this flow:

```text
local CSV file
  -> CSV parser
  -> normalized FootprintPoint[]
  -> map settle event
  -> viewport filter with padding
  -> screen-space aggregation at final zoom
  -> GeoJSON FeatureCollection
  -> Loca.PointLayer
```

For the first sample size, a worker is still preferred because aggregation is tied to map interactions and will become more expensive as imports grow. The pure aggregation function must be unit-tested outside the worker.

## Boundaries
This phase does not implement:

- import UI
- database storage
- timeline filtering
- track lines
- labels or popups
- cluster bubbles
- server-side tiles
- Mapbox integration

The design should leave room for those features by keeping all footprint data logic under `src/layers/`.

## Testing
Core tests should cover:

- CSV parsing and invalid row handling.
- Timestamp parsing as seconds, not milliseconds.
- Screen-space aggregation merging points that are indistinguishable at the current zoom.
- Aggregation splitting more points as zoom increases.
- Debounced settle behavior: no worker request during active zoom/move, one request after the final event.
- Loca layer lifecycle creates, updates, and destroys without leaking map resources.

Browser verification should confirm:

- The base map still renders with the current 2D restrictions and controls.
- Points appear only when local sample data is configured.
- Drag and zoom remain smooth.
- Points update after the map settles.
- No AMap or Loca runtime errors appear in the console.

