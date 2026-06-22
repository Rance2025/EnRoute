# Map Layers

This folder is reserved for future EnRoute data overlays.

Do not render large location datasets as React DOM markers. For million-point scale,
prepare viewport-specific datasets and render with screen-space canvas pixels,
WebGL, heatmaps, clustering, or simplified line layers as appropriate.

Planned layer boundaries:

- `trackLayer`: simplified route lines by zoom level.
- `pointLayer`: AMap `MassMarks` footprint pixels fed by the local API snapshot contract. Raw points are imported into SQLite on the backend; the browser sends time range, zoom, viewport bounds, and a screen-space sampling cell size, then receives only representative points, exact metrics, selected bounds, and render debug counts. Sampling refreshes after `moveend`, `zoomend`, resize, or time-range changes, not during continuous movement.
- `adminRegionLayer`: AMap polygon overlays for the explicit region mode. The browser sends selected level, zoom, and viewport bbox to `/api/admin-regions`; footprint points are not displayed while this mode is active. Current visible levels are China province, city, district/county, and the Shanghai-only street/township layer using locally loaded AreaCity-derived GCJ-02 boundaries plus the local Shanghai level-5 source.
- `densityLayer`: heatmap or grid aggregation for low zoom levels. For tens of millions of points, extend the same server-side screen-space/tile contract with an offline precomputed pyramid keyed by time bucket, zoom, and tile; the browser should request viewport tiles instead of loading all raw points.
