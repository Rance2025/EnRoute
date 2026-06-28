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
VITE_ADMIN_REGION_API_URL=/api/admin-regions
FOOTPRINT_COORDINATE_SYSTEM=wgs84
```

Then run:

```bash
npm install
npm run install:api
npm run rebuild:footprints
npm run prepare:footprint-tiles
python start.py start
```

`python start.py start` starts both the Vite frontend application at
`http://127.0.0.1:5173` and the local footprints API at
`http://127.0.0.1:5178`. The frontend reads Mapbox vector tiles from
`/api/map/tiles/footprints/{z}/{x}/{y}.mvt` and lightweight metrics from
`/api/footprints/metrics`; Vite proxies those API routes to the local server.
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

Optional administrative boundary data is read from
`ADMIN_REGION_DATA_PATH=external/admin-regions.geojson`. Boundary files stay
local unless their license permits committing them. The preferred China source
is `ok_geo.csv` from `xiangyuecn/AreaCity-JsSpider-StatsGov`, converted by
`npm run prepare:admin-regions` into the project GeoJSON contract for China
province/city/district levels. The same command can append
`external/osm/shanghai-admin-level8.geojson` as the current Shanghai-only level
5 source. AreaCity boundary coordinates are treated as GCJ-02 and are not
converted again; appended OSM boundaries are marked as WGS84 and converted into
the same local administrative-boundary coordinate convention during import.
When boundaries exist, the import assigns each WGS-84 footprint to the finest matching
`region_id`, writes `country_id=CHN` for local China matches, updates cached
unlock counts and stay/travel totals across the available region chain, and
serves the map overlay from `GET /api/admin-regions?level=N&west=...&south=...&east=...&north=...&zoom=...`.
The frontend only requests `/api/admin-regions` after enabling the
administrative-region unlock layer, and currently exposes China levels 2-5:
province, city, district/county, and the Shanghai-only street/township layer.

Future non-China imports should first run the conservative local China bbox
check. Points that may be in China should try the local AreaCity region match
before any remote lookup; points outside that bbox are eligible for a later AMap
reverse-geocode fallback for country assignment.

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

The current location page uses a Mapbox GL map surface capped at zoom 16 and a
vector-tile circle layer for footprint points. Footprint rendering must stay on
the MVT path instead of loading raw point arrays into browser memory.
Future track and region layers should use viewport or tile loading instead of
React DOM markers.
