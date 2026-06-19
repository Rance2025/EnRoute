# Map Layers

This folder is reserved for future EnRoute data overlays.

Do not render large location datasets as React DOM markers. For million-point scale,
prepare viewport-specific datasets and render with screen-space canvas pixels,
WebGL, heatmaps, clustering, or simplified line layers as appropriate.

Planned layer boundaries:

- `trackLayer`: simplified route lines by zoom level.
- `pointLayer`: AMap `MassMarks` footprint pixels. Raw points are parsed once, aggregated in a worker to current-viewport 1px screen-grid representatives, then attached to a native high-volume point layer so AMap owns projection during drag and zoom; React does not render individual points.
- `densityLayer`: heatmap or grid aggregation for low zoom levels.
