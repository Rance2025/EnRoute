from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from .accounting.router import create_accounting_router
from .accounting.store import AccountingStore
from .admin_regions.preview import get_shanghai_preview_regions
from .admin_regions.precompute import AdminRegionPrecomputeUnavailable
from .config import Settings
from .footprints.store import AdminRegionSummaryInputError, FootprintStore


def create_app(*, settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    app = FastAPI(title="EnRoute API")
    store = FootprintStore(
        db_path=resolved_settings.footprint_db_path,
        data_path=resolved_settings.footprint_data_path,
        coordinate_system=resolved_settings.footprint_coordinate_system,
        admin_region_data_path=resolved_settings.admin_region_data_path,
    )
    accounting_store = AccountingStore(resolved_settings.accounting_db_path)
    app.include_router(create_accounting_router(accounting_store), prefix="/api/accounting")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/footprints")
    def get_footprints() -> dict[str, object]:
        return store.get_all_points()

    @app.post("/api/footprints/snapshot")
    async def post_snapshot(request: Request) -> dict[str, object]:
        try:
            payload = await request.json()
        except Exception as error:  # pragma: no cover - FastAPI normally catches JSON errors first.
            raise HTTPException(status_code=400, detail="Invalid JSON body") from error

        return store.get_snapshot(payload)

    @app.get("/api/footprints/metrics")
    def get_footprint_metrics(
        range: str | None = None,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, object]:
        return store.get_footprint_metrics(
            range_value=range,
            start_date=start,
            end_date=end,
        )

    @app.get("/api/map/tiles/footprints/debug")
    def get_footprint_tile_debug_metrics(
        z: int,
        west: float | None = None,
        south: float | None = None,
        east: float | None = None,
        north: float | None = None,
        tiles: str | None = None,
        range: str | None = None,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, object]:
        try:
            return store.get_footprint_tile_debug_metrics(
                z=z,
                west=west,
                south=south,
                east=east,
                north=north,
                tile_keys=parse_tile_keys(tiles),
                range_value=range,
                start_date=start,
                end_date=end,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/api/map/tiles/footprints/{z}/{x}/{y}.mvt")
    def get_footprint_tile(
        z: int,
        x: int,
        y: int,
        range: str | None = None,
        start: str | None = None,
        end: str | None = None,
    ) -> Response:
        content = store.get_footprint_mvt(
            z=z,
            x=x,
            y=y,
            range_value=range,
            start_date=start,
            end_date=end,
        )
        if not content:
            return Response(status_code=204)
        return Response(content=content, media_type="application/vnd.mapbox-vector-tile")

    @app.get("/api/map/tiles/admin-regions/{z}/{x}/{y}.mvt")
    def get_admin_region_tile(
        z: int,
        x: int,
        y: int,
        focusRegionId: str = "world",
        depth: int = 4,
    ) -> Response:
        try:
            content = store.get_admin_region_mvt(
                z=z,
                x=x,
                y=y,
                focus_region_id=focusRegionId,
                depth=depth,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not content:
            return Response(status_code=204)
        return Response(content=content, media_type="application/vnd.mapbox-vector-tile")

    @app.get("/api/admin-regions")
    def get_admin_regions(
        level: int,
        west: float | None = None,
        south: float | None = None,
        east: float | None = None,
        north: float | None = None,
        zoom: float | None = None,
    ) -> dict[str, object]:
        if level not in {1, 2, 3, 4}:
            raise HTTPException(status_code=400, detail="level must be one of 1, 2, 3, or 4")
        return store.get_admin_regions(
            level=level,
            west=west,
            south=south,
            east=east,
            north=north,
            zoom=zoom,
        )

    @app.get("/api/admin-regions/active")
    def get_active_admin_regions(
        depth: int,
        range: str | None = None,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, object]:
        if depth not in {1, 2, 3, 4}:
            raise HTTPException(status_code=400, detail="depth must be one of 1, 2, 3, or 4")
        try:
            return store.get_active_admin_region_ids(
                depth=depth,
                range_value=range,
                start_date=start,
                end_date=end,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/api/admin-regions/summary")
    def get_admin_region_summary(
        depth: int,
        range: str | None = None,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, object]:
        if depth not in {1, 2, 3, 4}:
            raise HTTPException(status_code=400, detail="depth must be one of 1, 2, 3, or 4")
        try:
            return store.get_admin_region_summary(
                depth=depth,
                range_value=range,
                start_date=start,
                end_date=end,
            )
        except AdminRegionSummaryInputError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except AdminRegionPrecomputeUnavailable as error:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "admin_region_summary_precompute_unavailable",
                    "message": str(error),
                },
            ) from error

    @app.get("/api/admin-regions/thumbnail-bases")
    def get_admin_region_thumbnail_bases() -> dict[str, object]:
        try:
            return store.get_admin_region_thumbnail_bases()
        except AdminRegionPrecomputeUnavailable as error:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "admin_region_thumbnail_precompute_unavailable",
                    "message": str(error),
                },
            ) from error

    @app.get("/api/admin-regions/preview/shanghai")
    def get_shanghai_admin_region_preview(source: str, level: int) -> dict[str, object]:
        if source not in {"amap", "local", "osm"}:
            raise HTTPException(status_code=400, detail="source must be one of amap, local, or osm")
        if level not in {2, 3, 4, 5}:
            raise HTTPException(status_code=400, detail="level must be one of 2, 3, 4, or 5")

        return get_shanghai_preview_regions(
            source=source,
            level=level,
            admin_region_data_path=resolved_settings.admin_region_data_path,
            db_path=resolved_settings.footprint_db_path,
        )

    @app.exception_handler(Exception)
    async def json_exception_handler(_request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={"error": str(error) or "Internal server error"},
        )

    return app


def parse_tile_keys(value: str | None) -> list[tuple[int, int]] | None:
    if value is None:
        return None

    tile_keys: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for raw_tile in value.split(","):
        tile = raw_tile.strip()
        if not tile:
            continue
        parts = tile.split("/")
        if len(parts) != 2:
            raise ValueError("tiles must use x/y entries")
        try:
            x, y = int(parts[0]), int(parts[1])
        except ValueError as error:
            raise ValueError("tiles must use integer x/y entries") from error
        if x < 0 or y < 0:
            raise ValueError("tiles must be non-negative")
        key = (x, y)
        if key in seen:
            continue
        seen.add(key)
        tile_keys.append(key)

    if not tile_keys:
        raise ValueError("tiles must include at least one tile")

    return tile_keys
