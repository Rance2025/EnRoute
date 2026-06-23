from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

from import_footprints import main as import_main


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.database.exists():
        args.database.unlink()

    return import_main(
        [
            "--source",
            str(args.source),
            "--database",
            str(args.database),
            "--coordinate-system",
            "wgs84",
        ],
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild the local footprints SQLite database from WGS-84 source CSV.",
    )
    parser.add_argument("--source", type=Path, default=Path("external/backUpData-all.csv"))
    parser.add_argument("--database", type=Path, default=Path("data/footprints.sqlite"))
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
