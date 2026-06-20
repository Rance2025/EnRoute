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
VITE_AMAP_KEY=your-amap-web-js-api-key
VITE_AMAP_SECURITY_CODE=your-amap-security-js-code
```

Then run:

```bash
npm install
npm run install:api
npm run prepare:footprints
python start.py start
```

`python start.py start` starts both the Vite frontend application at
`http://127.0.0.1:5173` and the local footprints API at
`http://127.0.0.1:5178`. The frontend calls `/api/footprints/snapshot`, and
Vite proxies that route to the API server. Use `python start.py stop`,
`python start.py restart`, and `python start.py status` to manage both services
together; PID files and logs are written under `output/start-manager/`. You can
also use `npm run dev:full`, or run the services separately with `npm run api`
and `npm run dev`.

`npm install` installs the frontend application dependencies. `npm run
install:api` installs the Python backend service in editable mode with its test
dependencies from `apps/api/pyproject.toml`. `npm run prepare:footprints`
imports the local CSV export into the ignored SQLite database before startup.

Keep personal footprint exports in `external/`, which is ignored by git. The
Python API reads `FOOTPRINT_DATA_PATH=external/backUpData-all.csv`, streams it
into SQLite at `FOOTPRINT_DB_PATH=data/footprints.sqlite`, and serves
viewport snapshots from `POST /api/footprints/snapshot`. The compatibility
`GET /api/footprints` route remains available for small/debug payloads, but the
map no longer loads all raw points into browser memory. Footprint CSV
coordinates default to WGS84 and are converted by the API to GCJ-02 for AMap; set
`FOOTPRINT_COORDINATE_SYSTEM=gcj02` when the source CSV is already GCJ-02. The
API also checks the CSV signature at query time and refreshes SQLite when the
source export changes. Loaded footprint samples render through AMap `MassMarks`, so
AMap owns point projection during drag and zoom instead of a React or custom
canvas overlay.

Run verification from the repository root:

```bash
npm test
npm run lint
npm run build
```

The first phase renders a 2D AMap base surface with the `远山黛` style, hidden
labels, a compact custom toolbar, no AMap compass, and limited drag bounds to
avoid exposing blank map edges. Future track and point layers should use
viewport loading, simplification, clustering, and canvas/WebGL layers instead of
React DOM markers.
