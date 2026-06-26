from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from .config import Settings
from .footprints.store import FootprintStore


def create_app(*, settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    app = FastAPI(title="EnRoute API")
    store = FootprintStore(
        db_path=resolved_settings.footprint_db_path,
        data_path=resolved_settings.footprint_data_path,
        coordinate_system=resolved_settings.footprint_coordinate_system,
        admin_region_data_path=resolved_settings.admin_region_data_path,
    )

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
        west: float,
        south: float,
        east: float,
        north: float,
        range: str | None = None,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, object]:
        return store.get_footprint_tile_debug_metrics(
            z=z,
            west=west,
            south=south,
            east=east,
            north=north,
            range_value=range,
            start_date=start,
            end_date=end,
        )

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

    @app.get("/api/admin-regions")
    def get_admin_regions(
        level: int,
        west: float | None = None,
        south: float | None = None,
        east: float | None = None,
        north: float | None = None,
        zoom: float | None = None,
    ) -> dict[str, object]:
        if level not in {2, 3, 4, 5}:
            raise HTTPException(status_code=400, detail="level must be one of 2, 3, 4, or 5")
        return store.get_admin_regions(
            level=level,
            west=west,
            south=south,
            east=east,
            north=north,
            zoom=zoom,
        )

    @app.exception_handler(Exception)
    async def json_exception_handler(_request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={"error": str(error) or "Internal server error"},
        )

    return app
