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

The first phase only renders the domestic AMap base surface and UI shell. Future
track and point layers should use viewport loading, simplification, clustering,
and AMap Loca/WebGL instead of React DOM markers.
