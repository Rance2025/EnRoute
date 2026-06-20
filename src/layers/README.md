# Map Layers

This folder is reserved for future EnRoute data overlays.

Do not render large location datasets as React DOM markers. For million-point scale,
prepare viewport-specific datasets and render with screen-space canvas pixels,
WebGL, heatmaps, clustering, or simplified line layers as appropriate.

Planned layer boundaries:

- `trackLayer`: simplified route lines by zoom level.
- `pointLayer`: AMap `MassMarks` footprint pixels fed by a Worker screen-space sampling pipeline. Raw points stay in memory for exact time-range metrics and bounds, but only one representative per visible marker-sized screen cell is sent to `MassMarks`. Sampling refreshes after `moveend`, `zoomend`, resize, or time-range changes, not during continuous movement.
- `densityLayer`: heatmap or grid aggregation for low zoom levels. For tens of millions of points, move the same screen-space/tile contract behind a server or offline precomputed pyramid keyed by time bucket, zoom, and tile; the browser should request viewport tiles instead of loading all raw points.
