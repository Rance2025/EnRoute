from __future__ import annotations

import argparse
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Sequence

REQUIRED_TABLES = (
    "footprints",
    "footprint_spatial",
    "visual_tiles",
    "admin_region_daily_stats",
)


def main(
    argv: Sequence[str] | None = None,
    *,
    root_dir: Path | str | None = None,
) -> int:
    repository_root_dir = Path(__file__).resolve().parents[1]
    resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
    add_api_src_to_path(repository_root_dir)

    from enroute_api.footprints.distance_repair import repair_daily_first_distances

    args = parse_args(argv)
    database = resolve_path(resolved_root_dir, args.database)
    if not database.exists():
        raise FileNotFoundError(database)
    backup = resolve_path(
        resolved_root_dir,
        args.backup or default_backup_path(database),
    )
    create_verified_backup(database, backup)

    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            result = repair_daily_first_distances(connection)
            require_integrity(connection, label="repaired database")
    finally:
        connection.close()

    print(f"Verified backup: {backup}")
    print(
        f"Repair complete; scanned: {result.scanned_count}; "
        f"candidates: {result.candidate_count}; updated: {result.updated_count}; "
        f"added distance meters: {result.added_distance_meters:.3f}",
    )
    return 0


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Back up and repair zero-distance first footprints across Shanghai days.",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path("data/footprints.sqlite"),
    )
    parser.add_argument("--backup", type=Path)
    return parser.parse_args(argv)


def create_verified_backup(database: Path, backup: Path) -> None:
    if backup.exists():
        raise FileExistsError(backup)
    backup.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)
    destination = sqlite3.connect(backup)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()

    with closing(open_readonly(database)) as source_connection, closing(
        open_readonly(backup),
    ) as backup_connection:
        require_integrity(source_connection, label="source database")
        require_integrity(backup_connection, label="backup database")
        source_counts = read_required_table_counts(source_connection)
        backup_counts = read_required_table_counts(backup_connection)
        if source_counts != backup_counts:
            raise RuntimeError(
                f"backup table counts differ: source={source_counts}, backup={backup_counts}",
            )


def open_readonly(database: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)


def require_integrity(connection: sqlite3.Connection, *, label: str) -> None:
    result = connection.execute("PRAGMA integrity_check").fetchone()
    if result is None or str(result[0]).lower() != "ok":
        raise RuntimeError(f"{label} integrity check failed")


def read_required_table_counts(connection: sqlite3.Connection) -> dict[str, int]:
    table_names = {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
        )
    }
    missing = [table for table in REQUIRED_TABLES if table not in table_names]
    if missing:
        raise RuntimeError(f"required database table is missing: {missing[0]}")
    return {
        table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        for table in REQUIRED_TABLES
    }


def default_backup_path(database: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return database.with_name(
        f"{database.name}.backup-before-daily-first-distance-{timestamp}",
    )


def add_api_src_to_path(root_dir: Path) -> None:
    api_src_dir = root_dir / "apps" / "api" / "src"
    if str(api_src_dir) not in sys.path:
        sys.path.insert(0, str(api_src_dir))


def resolve_path(root_dir: Path, path: Path) -> Path:
    if path.is_absolute():
        return path
    return root_dir / path


if __name__ == "__main__":
    raise SystemExit(main())
