from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Sequence


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
  repository_root_dir = Path(__file__).resolve().parents[1]
  resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
  add_api_src_to_path(repository_root_dir)

  from enroute_api.config import Settings
  from enroute_api.footprints.store import initialize_schema
  from enroute_api.footprints.visual_tiles import build_visual_tiles

  args = parse_args(argv)
  settings = Settings.from_env()
  db_path = resolve_path(resolved_root_dir, args.database or settings.footprint_db_path)
  min_zoom = args.zoom if args.zoom is not None else args.min_zoom
  max_zoom = args.zoom if args.zoom is not None else args.max_zoom

  db_path.parent.mkdir(parents=True, exist_ok=True)
  connection = sqlite3.connect(db_path)
  connection.row_factory = sqlite3.Row
  try:
    initialize_schema(connection)
    result = build_visual_tiles(
      connection,
      min_zoom=min_zoom,
      max_zoom=max_zoom,
      bucket=args.bucket,
      commit_interval=args.commit_interval,
    )
  finally:
    connection.close()

  print(
    f"Built {result.built_count} footprint visual tile rows "
    f"from {result.candidate_count} candidate keys "
    f"for bucket {result.bucket} zoom {result.min_zoom}-{result.max_zoom} "
    f"into {db_path}",
  )
  return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Build precomputed footprint visual tile rows from the local SQLite database.",
  )
  parser.add_argument("--database", type=Path, help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.")
  parser.add_argument("--min-zoom", type=int, default=0, help="Minimum zoom to build. Defaults to 0.")
  parser.add_argument("--max-zoom", type=int, default=18, help="Maximum zoom to build. Defaults to 18.")
  parser.add_argument("--zoom", type=int, help="Build one zoom level, overriding --min-zoom and --max-zoom.")
  parser.add_argument(
    "--bucket",
    choices=["all", "day", "month", "year"],
    default="all",
    help="Time bucket granularity to build. Defaults to all.",
  )
  parser.add_argument(
    "--commit-interval",
    type=int,
    default=1000,
    help="Commit after this many candidate keys. Use 0 to commit only at the end.",
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
