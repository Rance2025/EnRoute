from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Sequence


DEFAULT_ADMIN_REGION_FOCUS_ID = "world"
DEFAULT_ADMIN_REGION_DEPTHS = (1, 2)


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
    repository_root_dir = Path(__file__).resolve().parents[1]
    resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
    add_api_src_to_path(repository_root_dir)

    from enroute_api.admin_regions.store import load_admin_regions
    from enroute_api.admin_regions.tiles import (
        DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM,
        build_admin_region_tiles,
        clear_admin_region_tiles,
    )
    from enroute_api.config import Settings
    from enroute_api.footprints.store import (
        ADMIN_REGION_LOADER_VERSION,
        ADMIN_REGION_STATS_SIGNATURE_KEY,
        create_source_signature,
        delete_meta_value,
        initialize_schema,
        set_meta_value,
    )

    args = parse_args(argv, max_zoom_default=DEFAULT_ADMIN_REGION_TILE_MAX_ZOOM)
    settings = Settings.from_env()
    admin_region_data_path = resolve_path(
        resolved_root_dir,
        args.admin_region_data_path or settings.admin_region_data_path,
    )
    db_path = resolve_path(resolved_root_dir, args.database or settings.footprint_db_path)
    min_zoom = args.zoom if args.zoom is not None else args.min_zoom
    max_zoom = args.zoom if args.zoom is not None else args.max_zoom

    if not admin_region_data_path.exists():
        raise FileNotFoundError(admin_region_data_path)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        feature_collection = json.loads(admin_region_data_path.read_text(encoding="utf-8-sig"))
        load_admin_regions(connection, feature_collection)
        set_meta_value(
            connection,
            "adminRegionSourceSignature",
            create_source_signature(admin_region_data_path, ADMIN_REGION_LOADER_VERSION),
        )
        delete_meta_value(connection, ADMIN_REGION_STATS_SIGNATURE_KEY)
        clear_admin_region_tiles(connection)
        depths = resolve_depths(depth=args.depth, depths=args.depths)
        results = [
            build_admin_region_tiles(
                connection,
                focus_region_id=args.focus_region_id,
                depth=depth,
                min_zoom=min_zoom,
                max_zoom=max_zoom,
                commit_interval=args.commit_interval,
            )
            for depth in depths
        ]
    finally:
        connection.close()

    for result in results:
        print(
            f"Built {result.built_count} admin region tile rows "
            f"from {result.candidate_count} candidate keys "
            f"for focus {result.focus_region_id} depth {result.depth} "
            f"zoom {result.min_zoom}-{result.max_zoom} into {db_path}",
        )
    return 0


def parse_args(argv: Sequence[str] | None, *, max_zoom_default: int) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build precomputed admin-region vector tile rows from local GeoJSON.",
    )
    parser.add_argument(
        "--admin-region-data-path",
        type=Path,
        help="Admin region GeoJSON path. Defaults to ADMIN_REGION_DATA_PATH.",
    )
    parser.add_argument("--database", type=Path, help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.")
    parser.add_argument(
        "--focus-region-id",
        default=DEFAULT_ADMIN_REGION_FOCUS_ID,
        help=f"Focused region id to build. Defaults to {DEFAULT_ADMIN_REGION_FOCUS_ID}.",
    )
    parser.add_argument("--depth", type=int, help="Descendant depth to render when --depths is not set.")
    parser.add_argument(
        "--depths",
        help="Comma-separated depths to build. Defaults to 1,2 for the UI switch.",
    )
    parser.add_argument("--min-zoom", type=int, default=0, help="Minimum zoom to build. Defaults to 0.")
    parser.add_argument(
        "--max-zoom",
        type=int,
        default=max_zoom_default,
        help=f"Maximum zoom to build. Defaults to {max_zoom_default}.",
    )
    parser.add_argument("--zoom", type=int, help="Build one zoom level, overriding --min-zoom and --max-zoom.")
    parser.add_argument(
        "--commit-interval",
        type=int,
        default=1000,
        help="Commit after this many populated tiles. Use 0 to commit only at the end.",
    )
    return parser.parse_args(argv)


def resolve_depths(*, depth: int | None, depths: str | None) -> tuple[int, ...]:
    if depths:
        return tuple(parse_depths(depths))
    if depth is not None:
        return (depth,)
    return DEFAULT_ADMIN_REGION_DEPTHS


def parse_depths(value: str) -> list[int]:
    depths: list[int] = []
    for part in value.split(","):
        text = part.strip()
        if not text:
            continue
        depth = int(text)
        if depth not in depths:
            depths.append(depth)
    if not depths:
        raise ValueError("depths must include at least one depth")
    return depths


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
