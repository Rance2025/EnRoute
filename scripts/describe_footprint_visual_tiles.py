from __future__ import annotations

import argparse
import sqlite3
import sys
import webbrowser
from pathlib import Path
from typing import Callable, Sequence


def main(
  argv: Sequence[str] | None = None,
  *,
  root_dir: Path | str | None = None,
  opener: Callable[[Path], object] | None = None,
  shower: Callable[[Sequence[object]], object] | None = None,
) -> int:
  repository_root_dir = Path(__file__).resolve().parents[1]
  resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
  add_api_src_to_path(repository_root_dir)

  from enroute_api.config import Settings
  from enroute_api.footprints.visual_tile_stats import (
    format_visual_tile_zoom_stats_table,
    summarize_visual_tiles_by_zoom,
    write_visual_tile_count_charts,
  )

  args = parse_args(argv)
  settings = Settings.from_env()
  db_path = resolve_path(resolved_root_dir, args.database or settings.footprint_db_path)
  charts_dir = resolve_path(resolved_root_dir, args.charts_dir)

  connection = sqlite3.connect(db_path)
  connection.row_factory = sqlite3.Row
  try:
    stats = summarize_visual_tiles_by_zoom(connection)
  finally:
    connection.close()

  print(format_visual_tile_zoom_stats_table(stats))
  if not args.no_write_charts:
    chart_files = write_visual_tile_count_charts(stats, charts_dir)
    print(f"Wrote average chart: {chart_files.average_chart_path}")
    print(f"Wrote maximum chart: {chart_files.max_chart_path}")
    if args.open:
      open_chart = opener or open_path_in_browser
      open_chart(chart_files.average_chart_path)
      open_chart(chart_files.max_chart_path)
  if args.show:
    show_charts = shower or show_matplotlib_charts
    show_charts(stats)
  return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Describe precomputed footprint visual tile counts and write count charts.",
  )
  parser.add_argument("--database", type=Path, help="SQLite database path. Defaults to FOOTPRINT_DB_PATH.")
  parser.add_argument(
    "--charts-dir",
    type=Path,
    default=Path("output") / "footprint-visual-tiles",
    help="Directory for generated SVG charts. Defaults to output/footprint-visual-tiles.",
  )
  parser.add_argument(
    "--open",
    action="store_true",
    help="Open the generated SVG charts after writing them.",
  )
  parser.add_argument(
    "--show",
    action="store_true",
    help="Draw and open interactive matplotlib charts for this database snapshot.",
  )
  parser.add_argument(
    "--no-write-charts",
    action="store_true",
    help="Skip writing SVG charts. Useful with --show for a display-only run.",
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


def open_path_in_browser(path: Path) -> bool:
  return webbrowser.open(path.resolve().as_uri())


def show_matplotlib_charts(stats: Sequence[object]) -> None:
  try:
    import matplotlib.pyplot as plt
  except ImportError as exc:
    raise SystemExit(
      "matplotlib is required for --show. Install the API dev environment or run without --show.",
    ) from exc

  z_values = [row.z for row in stats]
  figure, axes = plt.subplots(1, 2, figsize=(14, 5), constrained_layout=True)
  average_axis, max_axis = axes

  average_axis.plot(z_values, [row.representative_average for row in stats], marker="o", label="Representative average")
  average_axis.plot(z_values, [row.raw_average for row in stats], marker="o", label="Actual average")
  configure_axis(average_axis, title="Visual tile count averages by zoom")

  max_axis.plot(z_values, [row.representative_max for row in stats], marker="o", label="Representative maximum")
  max_axis.plot(z_values, [row.raw_max for row in stats], marker="o", label="Actual maximum")
  configure_axis(max_axis, title="Visual tile count maximums by zoom")

  figure.canvas.manager.set_window_title("Footprint visual tile count diagnostics")
  plt.show()


def configure_axis(axis: object, *, title: str) -> None:
  axis.set_title(title)
  axis.set_xlabel("z level")
  axis.set_ylabel("point count")
  axis.grid(True, alpha=0.3)
  axis.legend()


if __name__ == "__main__":
  raise SystemExit(main())
