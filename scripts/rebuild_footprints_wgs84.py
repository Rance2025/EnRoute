from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Sequence

from import_footprints import main as import_main


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    temporary_database = args.database.with_name(
        f".{args.database.name}.rebuild-{os.getpid()}.tmp",
    )
    if temporary_database.exists():
        temporary_database.unlink()

    try:
        exit_code = import_main(
            [
                "--source",
                str(args.source),
                "--database",
                str(temporary_database),
                "--coordinate-system",
                "wgs84",
            ],
        )
        if exit_code != 0:
            return exit_code

        args.database.parent.mkdir(parents=True, exist_ok=True)
        temporary_database.replace(args.database)
        return 0
    finally:
        if temporary_database.exists():
            temporary_database.unlink()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild the local footprints SQLite database from WGS-84 source CSV.",
    )
    parser.add_argument("--source", type=Path, default=Path("external/backUpData-all.csv"))
    parser.add_argument("--database", type=Path, default=Path("data/footprints.sqlite"))
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
