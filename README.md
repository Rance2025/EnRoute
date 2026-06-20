# 在途 EnRoute

Full-screen AMap base map for a future lifetime-footprint product.

## Local setup

Create `.env.local` in the project root:

```env
VITE_AMAP_KEY=your-amap-web-js-api-key
VITE_AMAP_SECURITY_CODE=your-amap-security-js-code
```

Then run:

```bash
npm install
npm run dev:full
```

`npm run dev:full` starts both the Vite frontend at `http://127.0.0.1:5173`
and the local footprints API at `http://127.0.0.1:5178`. The frontend calls
`/api/footprints`, and Vite proxies that route to the API server. You can also
run them separately with `npm run api` and `npm run dev`.

Keep personal footprint exports in `external/`, which is ignored by git. The
API reads `FOOTPRINT_DATA_PATH=external/backUpData-all.csv` and returns parsed
JSON points from `GET /api/footprints`. Footprint CSV coordinates default to
WGS84 and are converted by the API to GCJ-02 for AMap; set
`FOOTPRINT_COORDINATE_SYSTEM=gcj02` when the source CSV is already GCJ-02. Run
`npm run prepare:footprints` to check that the local export exists before
starting the API. Loaded footprint samples render through AMap `MassMarks`, so
AMap owns point projection during drag and zoom instead of a React or custom
canvas overlay.

The first phase renders a 2D AMap base surface with the `远山黛` style, hidden
labels, a compact custom toolbar, no AMap compass, and limited drag bounds to
avoid exposing blank map edges. Future track and point layers should use
viewport loading, simplification, clustering, and canvas/WebGL layers instead of
React DOM markers.
