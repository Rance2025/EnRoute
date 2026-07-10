# 在途 EnRoute

Full-stack local prototype for a future lifetime-footprint product.

## Project Layout

```text
apps/
  web/        React + Vite frontend application.
  api/        Python + FastAPI backend service.
docs/         Design notes and implementation plans.
scripts/      Repository-level development helpers.
tests/        Repository-level tests for development tooling.
external/     Local personal source exports, ignored by git.
data/         Local SQLite databases and persisted app data, ignored by git.
output/       Local logs, PID files, screenshots, and runtime output, ignored by git.
```

## Local setup

Create `.env.local` in the project root:

```env
VITE_MAPBOX_ACCESS_TOKEN=your-mapbox-access-token
VITE_MAPBOX_STYLE_URL=mapbox://styles/oies0/cmquspp54003i01qpazy084sq
VITE_MAPBOX_PROJECTION=globe
VITE_FOOTPRINT_TILE_URL=/api/map/tiles/footprints/{z}/{x}/{y}.mvt
VITE_FOOTPRINT_METRICS_URL=/api/footprints/metrics
VITE_ADMIN_REGION_TILE_URL=/api/map/tiles/admin-regions/{z}/{x}/{y}.mvt
VITE_ADMIN_REGION_API_URL=/api/admin-regions
FOOTPRINT_COORDINATE_SYSTEM=wgs84
```

Then run:

```bash
npm install
npm run install:api
npm run rebuild:footprints
npm run prepare:footprint-tiles
npm run prepare:admin-region-tiles
python start.py start
```

`python start.py start` starts both the Vite frontend application at
`http://127.0.0.1:5173` and the local footprints API at
`http://127.0.0.1:5178`. The frontend reads Mapbox vector tiles from
`/api/map/tiles/footprints/{z}/{x}/{y}.mvt` and lightweight metrics from
`/api/footprints/metrics`; administrative boundaries are read from
`/api/map/tiles/admin-regions/{z}/{x}/{y}.mvt`. Vite proxies those API routes to the local server.
Use `python start.py stop`,
`python start.py restart`, and `python start.py status` to manage both services
together; PID files and logs are written under `output/start-manager/`. You can
also use `npm run dev:full`, or run the services separately with `npm run api`
and `npm run dev`.

`npm install` installs the frontend application dependencies. `npm run
install:api` installs the Python backend service in editable mode with its test
dependencies from `apps/api/pyproject.toml`. `npm run rebuild:footprints`
recreates the ignored SQLite database from the WGS-84 source CSV, and
`npm run prepare:footprint-tiles` precomputes the footprint visual tile cells
for `all`, `day`, `month`, and `year` buckets up to zoom 16.

Mapbox map appearance is configured from `.env.local`. Use
`VITE_MAPBOX_PROJECTION=globe` for the default spherical map, or
`VITE_MAPBOX_PROJECTION=mercator` for the flat Web Mercator map. Change
`VITE_MAPBOX_STYLE_URL` to switch the base style. The default is
`mapbox://styles/oies0/cmquspp54003i01qpazy084sq`; other examples include
`mapbox://styles/mapbox/light-v11`, `mapbox://styles/mapbox/streets-v12`,
`mapbox://styles/mapbox/outdoors-v12`, `mapbox://styles/mapbox/dark-v11`, or
`mapbox://styles/mapbox/satellite-streets-v12`. Custom styles can be created in
Mapbox Studio (`https://console.mapbox.com/studio/`), and the style JSON
contract is documented at `https://docs.mapbox.com/style-spec/guides/` and
`https://docs.mapbox.com/style-spec/reference/`. The globe projection example
is at `https://docs.mapbox.com/mapbox-gl-js/example/globe/`.

Keep personal footprint exports in `external/`, which is ignored by git. The
Python API reads `FOOTPRINT_DATA_PATH=external/backUpData-all.csv` and stores
raw footprints in SQLite at `FOOTPRINT_DB_PATH=data/footprints.sqlite`.
Footprint coordinates are stored canonically as WGS-84. The source export at
`external/backUpData-all.csv` is treated as WGS-84 and can be used to rebuild
`data/footprints.sqlite` with `python scripts/rebuild_footprints_wgs84.py`.

The Mapbox footprint layer does not request raw point arrays for rendering. It
reads `/api/map/tiles/footprints/{z}/{x}/{y}.mvt`; the backend reads
precomputed `visual_tiles` cells and encodes MVT on demand. `visual_tiles` rows
exist only for `z/x/y/t_type/t` combinations that contain at least one footprint
cell. Missing rows mean empty, and empty rows are not stored.

Treat `visual_tiles` as a persistent precomputed visual-equivalent layer, not as
a disposable request cache. Runtime map tile requests, tile debug requests, and
frontend map style, language, or projection changes must only read this table;
they must not infer global corruption from a missing row, truncate completed
rows, or trigger a full rebuild. Rebuild it intentionally with `npm run
prepare:footprint-tiles`, or through explicit raw-footprint rebuild/import
compatibility and visual-algorithm migrations. For new or changed footprint
points, preserve existing completed rows by marking only affected existing
tile-time keys dirty and rebuilding those keys incrementally; missing keys stay
absent until a builder produces non-empty ready cells.

Optional administrative boundary data is read from
`ADMIN_REGION_DATA_PATH=external/admin-regions.geojson`. Boundary files stay
local unless their license permits committing them. The active scope is global
country-level coverage plus China detail through level 4: country, China
province/municipality/autonomous region/SAR, China city/prefecture, and China
district/county/county-level city/banner. Country-level geometry is canonical
WGS-84. AreaCity China detail geometry is preserved as GCJ-02 for local
matching and converted to WGS-84 only when building the Mapbox render tiles.

Global boundary sources should be normalized into the local GeoJSON contract
or Overture-style division features before import. Overture `country` features
map to EnRoute level 1; Overture `region` and `locality` features are skipped in
the active default scope. OSM imports keep country-level `admin_level` 2 only.
The legacy AreaCity converter remains available for China province/city/district
data via `npm run prepare:admin-regions`.

Run `npm run prepare:admin-region-tiles` after changing a single already-merged
boundary GeoJSON. For the current split-source setup, build with a world
country source plus the AreaCity China detail source, for example:

```powershell
python scripts/build_admin_region_tiles.py `
  --admin-region-data-path output/admin-regions-world-l1-simplified-z5.geojson `
  --china-admin-region-data-path external/admin-regions.geojson `
  --database data/footprints.sqlite `
  --max-zoom 4 `
  --depths 1,2,3,4
```

The script loads boundary rows into SQLite, clears stale `admin_region_tiles`,
and precomputes cached Mapbox vector tiles for world focus. Runtime map tile
requests only read cached rows. Missing `admin_region_tiles` rows mean empty and
return 204; they do not trigger request-time rebuilds.

When boundaries exist, the import assigns each WGS-84 footprint to the finest
matching `region_id`, updates cached unlock counts and stay/travel totals
across the available region chain, and serves the Mapbox overlay from
`GET /api/map/tiles/admin-regions/{z}/{x}/{y}.mvt?focusRegionId=world&depth=4`.
`GET /api/admin-regions?level=N&west=...` remains as a compatibility/debug JSON
endpoint for levels 1-4, but it is not the active map-rendering path.

Check the license of the selected boundary source before packaging data. If that
source has ODbL or similar share-alike database terms, keep attribution visible
in the product and treat redistributed derived databases, GeoJSON, or tile packs
as data artifacts that may carry those obligations. Closed-source application
code is not forced open merely because it displays those boundaries.

The compatibility `GET /api/footprints` and `POST /api/footprints/snapshot`
routes remain available for small/debug payloads, but the map no longer uses
them for footprint rendering. After a successful rebuild and tile precompute,
the local SQLite database can serve footprint map tiles even if the original CSV
export is removed.

Run verification from the repository root:

```bash
npm test
npm run lint
npm run build
```

The current location page uses a Mapbox GL map surface capped at zoom 16, a
vector-tile circle layer for footprint points, and cached vector tiles for
global administrative boundaries. Footprint and boundary rendering must stay on
the MVT path instead of loading raw GeoJSON or point arrays into browser memory.
Future track layers should use viewport or tile loading instead of React DOM
markers.
