from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 5178
    footprint_data_path: Path = Path("external/backUpData-all.csv")
    footprint_db_path: Path = Path("output/footprints.sqlite")
    footprint_coordinate_system: str = "wgs84"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            host=os.environ.get("ENROUTE_API_HOST", "127.0.0.1"),
            port=int(os.environ.get("ENROUTE_API_PORT", "5178")),
            footprint_data_path=Path(
                os.environ.get("FOOTPRINT_DATA_PATH", "external/backUpData-all.csv"),
            ),
            footprint_db_path=Path(os.environ.get("FOOTPRINT_DB_PATH", "output/footprints.sqlite")),
            footprint_coordinate_system=os.environ.get("FOOTPRINT_COORDINATE_SYSTEM", "wgs84"),
        )
