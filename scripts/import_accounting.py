from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
    repository_root = Path(__file__).resolve().parents[1]
    resolved_root = Path(root_dir or Path.cwd()).resolve()
    sys.path.insert(0, str(repository_root / "apps" / "api" / "src"))

    from enroute_api.accounting.importer import import_accounting_workbook

    args = parse_args(argv)
    source_path = _resolve(resolved_root, args.source)
    database_path = _resolve(resolved_root, args.database)
    result = import_accounting_workbook(source_path, database_path)
    print(
        f"Imported {result.row_count} accounting rows from {source_path} into {database_path}; "
        f"range: {result.earliest_occurred_at} to {result.latest_occurred_at}",
    )
    return 0


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import the external accounting BIFF workbook.")
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("external/账单@日常-全部-1349.csv"),
        help="Source OLE2/BIFF workbook path.",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path("data/accounting.sqlite"),
        help="Target accounting SQLite path.",
    )
    return parser.parse_args(argv)


def _resolve(root: Path, value: Path) -> Path:
    return value if value.is_absolute() else root / value


if __name__ == "__main__":
    raise SystemExit(main())

