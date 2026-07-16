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

    from enroute_api.admin_regions.precompute import build_admin_region_summary_precompute
    from enroute_api.config import Settings
    from enroute_api.footprints.store import initialize_schema

    args = parse_args(argv)
    settings = Settings.from_env()
    db_path = resolve_path(resolved_root_dir, args.database or settings.footprint_db_path)
    if not db_path.exists():
        raise FileNotFoundError(db_path)

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        result = build_admin_region_summary_precompute(connection)
    finally:
        connection.close()

    print(
        f"Built {result.thumbnail_base_count} thumbnail bases, "
        f"{result.thumbnail_region_path_count} region paths, and "
        f"{result.daily_stat_count} daily stats with "
        f"{result.unresolved_footprint_count} unresolved footprints into {db_path}",
    )
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build precomputed admin-region thumbnail and daily summary rows.",
    )
    parser.add_argument(
        "--database",
        type=Path,
        help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.",
    )
    return parser.parse_args(argv)


def add_api_src_to_path(root_dir: Path) -> None:
    api_src_dir = root_dir / "apps" / "api" / "src"
    if str(api_src_dir) not in sys.path:
        sys.path.insert(0, str(api_src_dir))


def resolve_path(root_dir: Path, path: Path | str) -> Path:
    resolved_path = Path(path)
    if resolved_path.is_absolute():
        return resolved_path
    return root_dir / resolved_path


if __name__ == "__main__":
    raise SystemExit(main())
