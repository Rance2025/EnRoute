# Map Layers

This folder is reserved for future EnRoute data overlays.

Do not render large location datasets as React DOM markers. For million-point
scale, prepare tile-specific datasets and render with WebGL/vector layers.

Planned layer boundaries:

- `trackLayer`: simplified route lines by zoom level.
- `pointLayer`: Mapbox vector-tile footprint points fed by `/api/map/tiles/footprints/{z}/{x}/{y}.mvt`. Raw WGS-84 points are imported into SQLite on the backend, then precomputed into `visual_tiles` cells keyed by `z/x/y/t_type/t`. The browser requests only visible MVT tiles and renders a plain circle layer, not heatmap or cluster bubbles.
- `adminRegionLayer`: legacy AMap polygon overlay code for the explicit region
  mode. The active Mapbox surface currently shows a migration notice for this
  mode; the future Mapbox-compatible region layer should keep `/api/admin-regions`
  as the data contract while moving boundary rendering off AMap.
- `densityLayer`: optional future low-zoom aggregation. The current footprint layer intentionally keeps 0/1 visual-cell semantics and does not send per-cell counts to the frontend.
