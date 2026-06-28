# Footprint Tile Z16 Ceiling Design

Date: 2026-06-28

## Goal

The location page and footprint visual-tile database should stop at zoom 16. Existing z17 and z18 precomputed `visual_tiles` rows are redundant and can be removed from the local SQLite database.

## Design

Use one shared frontend constant for the footprint tile ceiling and set both the Mapbox camera `maxZoom` and vector source `maxzoom` to 16. The debug tile metrics request should clamp the integer tile zoom to the same ceiling so a camera at 16 never asks the backend for z17 or z18 metrics.

Set the backend `MAX_VISUAL_TILE_ZOOM` to 16 and update the visual-tile build CLI default `--max-zoom` to that constant. Import-time dirty marking will then only mark affected tiles through z16 because it already iterates through `MAX_VISUAL_TILE_ZOOM`.

## Data Cleanup

After code changes, delete local ignored SQLite rows where `visual_tiles.z > 16` from `data/footprints.sqlite`. The database is ignored local state, so this cleanup should not be committed, but the command and resulting max zoom should be reported.

## Tests

Update focused tests to expect z16 in the frontend vector source, Mapbox initialization, debug clamp behavior, backend max zoom validation, CLI default help text, import dirty marking, and MVT dirty rebuild coverage. Then run the repo verification commands.
