from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 5178
    footprint_data_path: Path = Path("external/backUpData-all.csv")
    footprint_db_path: Path = Path("data/footprints.sqlite")
    accounting_db_path: Path = Path("data/accounting.sqlite")
    footprint_coordinate_system: str = "wgs84"
    admin_region_data_path: Path = Path("external/admin-regions.geojson")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            host=os.environ.get("ENROUTE_API_HOST", "127.0.0.1"),
            port=int(os.environ.get("ENROUTE_API_PORT", "5178")),
            footprint_data_path=Path(
                os.environ.get("FOOTPRINT_DATA_PATH", "external/backUpData-all.csv"),
            ),
            footprint_db_path=Path(os.environ.get("FOOTPRINT_DB_PATH", "data/footprints.sqlite")),
            accounting_db_path=Path(
                os.environ.get("ACCOUNTING_DB_PATH", "data/accounting.sqlite"),
            ),
            footprint_coordinate_system=os.environ.get("FOOTPRINT_COORDINATE_SYSTEM", "wgs84"),
            admin_region_data_path=Path(
                os.environ.get("ADMIN_REGION_DATA_PATH", "external/admin-regions.geojson"),
            ),
        )
