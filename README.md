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
npm run dev
```

Optional local footprint samples can be served from `public/local/` by setting
`VITE_FOOTPRINT_DATA_URL=/local/backUpData-all.csv`. Keep personal exports in
`external/` and run `npm run prepare:footprints` to copy the ignored sample into
the ignored local public folder.

The first phase renders a 2D AMap base surface with the `远山黛` style, hidden
labels, a compact custom toolbar, no AMap compass, and limited drag bounds to
avoid exposing blank map edges. Future track and point layers should use
viewport loading, simplification, clustering, and AMap Loca/WebGL instead of
React DOM markers.
