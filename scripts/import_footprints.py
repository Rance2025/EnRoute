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
  admin_region_data_path = resolve_path(
    resolved_root_dir,
    args.admin_region_data_path or settings.admin_region_data_path,
  )

  store = FootprintStore(
    db_path=db_path,
    data_path=data_path,
    coordinate_system=coordinate_system,
    admin_region_data_path=admin_region_data_path,
  )
  try:
    result = store.import_footprints()
  finally:
    store.close()
  print(
    "Imported "
    f"{result['new_count']} new footprint rows from {data_path} into {db_path}; "
    f"total rows: {result['total_count']}; "
    f"matched regions: {result['matched_count']}; "
    f"loaded regions: {result['region_count']}; "
    f"unlocked regions: {result['unlocked_region_count']}",
  )
  return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Import footprint CSV data into the local SQLite database.")
  parser.add_argument("--source", type=Path, help="Footprint CSV path. Defaults to FOOTPRINT_DATA_PATH.")
  parser.add_argument("--database", type=Path, help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.")
  parser.add_argument(
    "--coordinate-system",
    choices=["wgs84", "gcj02"],
    help=(
      "Source coordinate system label. Footprint storage is canonical WGS-84; "
      "gcj02 is accepted only for legacy compatibility and is not shifted during import. "
      "Defaults to FOOTPRINT_COORDINATE_SYSTEM."
    ),
  )
  parser.add_argument(
    "--admin-region-data-path",
    type=Path,
    help="Local admin region GeoJSON path. Defaults to ADMIN_REGION_DATA_PATH.",
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
