# Map Layers

This folder is reserved for future EnRoute data overlays.

Do not render large location datasets as React DOM markers. For million-point scale,
prepare viewport-specific datasets and render with AMap Loca, heatmaps, clustering,
or simplified line layers.

Planned layer boundaries:

- `trackLayer`: simplified route lines by zoom level.
- `pointLayer`: visible-footprint points for the current viewport.
- `densityLayer`: heatmap or grid aggregation for low zoom levels.
