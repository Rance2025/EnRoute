from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .admin_regions.store import format_admin_region, query_admin_regions_by_level
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

    @app.get("/api/admin-regions")
    def get_admin_regions(level: int) -> dict[str, object]:
        if level < 1 or level > 5:
            raise HTTPException(status_code=400, detail="level must be between 1 and 5")
        store.ensure_ready()
        return {
            "regions": [
                format_admin_region(row)
                for row in query_admin_regions_by_level(store.connection, level)
            ],
        }

    @app.exception_handler(Exception)
    async def json_exception_handler(_request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={"error": str(error) or "Internal server error"},
        )

    return app
