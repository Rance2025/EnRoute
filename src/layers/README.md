# Map Layers

This folder is reserved for future EnRoute data overlays.

Do not render large location datasets as React DOM markers. For million-point scale,
prepare viewport-specific datasets and render with screen-space canvas pixels,
AMap Loca/WebGL, heatmaps, clustering, or simplified line layers as appropriate.

Planned layer boundaries:

- `trackLayer`: simplified route lines by zoom level.
- `pointLayer`: canvas-rendered footprint pixels. Raw points are parsed once, then projected and deduplicated in screen space after `moveend` and `zoomend`; React does not render individual points.
- `densityLayer`: heatmap or grid aggregation for low zoom levels.
