from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Sequence


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
  repository_root_dir = Path(__file__).resolve().parents[1]
  resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
  add_api_src_to_path(repository_root_dir)

  from enroute_api.config import Settings
  from enroute_api.footprints.store import FootprintStore

  args = parse_args(argv)
  settings = Settings.from_env()
  data_path = resolve_path(resolved_root_dir, args.source or settings.footprint_data_path)
  db_path = resolve_path(resolved_root_dir, args.database or settings.footprint_db_path)
  coordinate_system = args.coordinate_system or settings.footprint_coordinate_system

  store = FootprintStore(
    db_path=db_path,
    data_path=data_path,
    coordinate_system=coordinate_system,
  )
  try:
    snapshot = store.get_snapshot(
      {
        "timeRange": {
          "startTimestampSeconds": 0,
          "endTimestampSeconds": 8_640_000_000_000,
          "dayCount": 1,
        },
        "zoom": 0,
        "cellSizePx": 1,
        "viewportBounds": {"west": -180, "south": -85, "east": 180, "north": 85},
        "viewportNorthWestWorldPixel": {"x": 0, "y": 0},
      },
    )
  finally:
    store.close()
  print(
    "Imported "
    f"{snapshot['metrics']['selectedCount']} footprint rows from {data_path} into {db_path}",
  )
  return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Import footprint CSV data into the local SQLite database.")
  parser.add_argument("--source", type=Path, help="Footprint CSV path. Defaults to FOOTPRINT_DATA_PATH.")
  parser.add_argument("--database", type=Path, help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.")
  parser.add_argument(
    "--coordinate-system",
    choices=["wgs84", "gcj02"],
    help="Source coordinate system. Defaults to FOOTPRINT_COORDINATE_SYSTEM.",
  )
  return parser.parse_args(argv)


def add_api_src_to_path(root_dir: Path) -> None:
  api_src_dir = root_dir / "apps" / "api" / "src"
  sys.path.insert(0, str(api_src_dir))


def resolve_path(root_dir: Path, path: Path | str) -> Path:
  resolved_path = Path(path)
  if resolved_path.is_absolute():
    return resolved_path
  return root_dir / resolved_path


if __name__ == "__main__":
  raise SystemExit(main())
