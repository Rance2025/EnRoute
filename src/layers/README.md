# Map Layers

This folder is reserved for future EnRoute data overlays.

Do not render large location datasets as React DOM markers. For million-point scale,
prepare viewport-specific datasets and render with screen-space canvas pixels,
WebGL, heatmaps, clustering, or simplified line layers as appropriate.

Planned layer boundaries:

- `trackLayer`: simplified route lines by zoom level.
- `pointLayer`: AMap `MassMarks` footprint pixels. Raw points are parsed once and attached to a native high-volume point layer, preserving one rendered datum per footprint point so repeated samples keep their visual density. AMap owns projection during drag and zoom; React does not render individual points or refresh point data during map motion.
- `densityLayer`: heatmap or grid aggregation for low zoom levels. Worker aggregation helpers are kept for this future layer, not for the current pixel-equivalent footprint point layer.
