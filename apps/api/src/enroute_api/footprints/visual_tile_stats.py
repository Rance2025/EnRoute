from __future__ import annotations

import html
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


@dataclass(frozen=True)
class VisualTileZoomStats:
    z: int
    tile_count: int
    raw_sum: int
    raw_average: float
    raw_min: int
    raw_max: int
    representative_sum: int
    representative_average: float
    representative_min: int
    representative_max: int


@dataclass(frozen=True)
class VisualTileChartFiles:
    average_chart_path: Path
    max_chart_path: Path


def summarize_visual_tiles_by_zoom(connection: sqlite3.Connection) -> list[VisualTileZoomStats]:
    rows = connection.execute(
        """
        SELECT
          z,
          COUNT(*) AS tile_count,
          SUM(raw_count) AS raw_sum,
          AVG(raw_count) AS raw_average,
          MIN(raw_count) AS raw_min,
          MAX(raw_count) AS raw_max,
          SUM(representative_count) AS representative_sum,
          AVG(representative_count) AS representative_average,
          MIN(representative_count) AS representative_min,
          MAX(representative_count) AS representative_max
        FROM visual_tiles
        WHERE cells IS NOT NULL
        GROUP BY z
        ORDER BY z
        """,
    ).fetchall()
    return [
        VisualTileZoomStats(
            z=int(get_row_value(row, "z", 0)),
            tile_count=int(get_row_value(row, "tile_count", 1)),
            raw_sum=int(get_row_value(row, "raw_sum", 2) or 0),
            raw_average=float(get_row_value(row, "raw_average", 3) or 0),
            raw_min=int(get_row_value(row, "raw_min", 4) or 0),
            raw_max=int(get_row_value(row, "raw_max", 5) or 0),
            representative_sum=int(get_row_value(row, "representative_sum", 6) or 0),
            representative_average=float(get_row_value(row, "representative_average", 7) or 0),
            representative_min=int(get_row_value(row, "representative_min", 8) or 0),
            representative_max=int(get_row_value(row, "representative_max", 9) or 0),
        )
        for row in rows
    ]


def render_visual_tile_average_chart_svg(stats: Sequence[VisualTileZoomStats]) -> str:
    return render_line_chart_svg(
        title="Visual Tile Count Averages by Zoom",
        stats=stats,
        series=[
            ("Representative average", [row.representative_average for row in stats], "#dc2626"),
            ("Actual average", [row.raw_average for row in stats], "#2563eb"),
        ],
    )


def render_visual_tile_max_chart_svg(stats: Sequence[VisualTileZoomStats]) -> str:
    return render_line_chart_svg(
        title="Visual Tile Count Maximums by Zoom",
        stats=stats,
        series=[
            ("Representative maximum", [row.representative_max for row in stats], "#dc2626"),
            ("Actual maximum", [row.raw_max for row in stats], "#2563eb"),
        ],
    )


def write_visual_tile_count_charts(
    stats: Sequence[VisualTileZoomStats],
    output_dir: Path,
) -> VisualTileChartFiles:
    output_dir.mkdir(parents=True, exist_ok=True)
    average_chart_path = output_dir / "visual-tile-count-averages.svg"
    max_chart_path = output_dir / "visual-tile-count-maxima.svg"
    average_chart_path.write_text(render_visual_tile_average_chart_svg(stats), encoding="utf-8")
    max_chart_path.write_text(render_visual_tile_max_chart_svg(stats), encoding="utf-8")
    return VisualTileChartFiles(
        average_chart_path=average_chart_path,
        max_chart_path=max_chart_path,
    )


def format_visual_tile_zoom_stats_table(stats: Sequence[VisualTileZoomStats]) -> str:
    lines = [
        "z tile_count raw_avg representative_avg raw_max representative_max raw_min representative_min raw_sum representative_sum",
    ]
    for row in stats:
        lines.append(
            " ".join(
                [
                    str(row.z),
                    str(row.tile_count),
                    format_count(row.raw_average),
                    format_count(row.representative_average),
                    str(row.raw_max),
                    str(row.representative_max),
                    str(row.raw_min),
                    str(row.representative_min),
                    str(row.raw_sum),
                    str(row.representative_sum),
                ],
            ),
        )
    return "\n".join(lines)


def render_line_chart_svg(
    *,
    title: str,
    stats: Sequence[VisualTileZoomStats],
    series: Sequence[tuple[str, Sequence[float], str]],
) -> str:
    width = 960
    height = 560
    left = 84
    right = 32
    top = 56
    bottom = 72
    plot_width = width - left - right
    plot_height = height - top - bottom
    z_values = [row.z for row in stats]
    y_values = [value for _, values, _ in series for value in values]
    y_max = max(y_values, default=0)
    y_axis_max = nice_axis_max(y_max)

    def x_position(z: int) -> float:
        if len(z_values) <= 1:
            return left + plot_width / 2
        return left + ((z - min(z_values)) / (max(z_values) - min(z_values))) * plot_width

    def y_position(value: float) -> float:
        if y_axis_max <= 0:
            return top + plot_height
        return top + plot_height - (value / y_axis_max) * plot_height

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">',
        "<style>",
        ".label{font:14px Arial,sans-serif;fill:#1f2937}",
        ".tick{font:12px Arial,sans-serif;fill:#4b5563}",
        ".grid{stroke:#e5e7eb;stroke-width:1}",
        ".axis{stroke:#111827;stroke-width:1.2}",
        ".line{fill:none;stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round}",
        ".point{stroke:#ffffff;stroke-width:1.5}",
        "</style>",
        f'<text class="label" x="{left}" y="32">{html.escape(title)}</text>',
        f'<line class="axis" x1="{left}" y1="{top + plot_height}" x2="{left + plot_width}" y2="{top + plot_height}"/>',
        f'<line class="axis" x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_height}"/>',
    ]

    for index in range(6):
        value = y_axis_max * index / 5
        y = y_position(value)
        parts.append(f'<line class="grid" x1="{left}" y1="{y:.2f}" x2="{left + plot_width}" y2="{y:.2f}"/>')
        parts.append(
            f'<text class="tick" x="{left - 10}" y="{y + 4:.2f}" text-anchor="end">{html.escape(format_count(value))}</text>',
        )

    for z in z_values:
        x = x_position(z)
        parts.append(f'<line class="grid" x1="{x:.2f}" y1="{top}" x2="{x:.2f}" y2="{top + plot_height}"/>')
        parts.append(
            f'<text class="tick" x="{x:.2f}" y="{top + plot_height + 24}" text-anchor="middle">z={z}</text>',
        )

    parts.append(
        f'<text class="label" x="{left + plot_width / 2:.2f}" y="{height - 20}" text-anchor="middle">z level</text>',
    )
    parts.append(
        f'<text class="label" x="22" y="{top + plot_height / 2:.2f}" transform="rotate(-90 22 {top + plot_height / 2:.2f})" text-anchor="middle">point count</text>',
    )

    legend_x = left + 12
    legend_y = top + 18
    for index, (name, _, color) in enumerate(series):
        y = legend_y + index * 24
        parts.append(f'<line x1="{legend_x}" y1="{y}" x2="{legend_x + 28}" y2="{y}" stroke="{color}" stroke-width="2.8"/>')
        parts.append(f'<text class="tick" x="{legend_x + 36}" y="{y + 4}">{html.escape(name)}</text>')

    for name, values, color in series:
        points = [
            f"{x_position(row.z):.2f},{y_position(float(value)):.2f}"
            for row, value in zip(stats, values, strict=True)
        ]
        if points:
            parts.append(
                f'<polyline class="line" aria-label="{html.escape(name)}" points="{" ".join(points)}" stroke="{color}"/>',
            )
        for row, value in zip(stats, values, strict=True):
            x = x_position(row.z)
            y = y_position(float(value))
            parts.append(f'<circle class="point" cx="{x:.2f}" cy="{y:.2f}" r="3.5" fill="{color}"/>')
            parts.append(
                f'<title>{html.escape(name)} z={row.z}: {html.escape(format_count(float(value)))}</title>',
            )

    parts.append("</svg>")
    return "\n".join(parts)


def nice_axis_max(value: float) -> float:
    if value <= 0:
        return 1
    magnitude = 10 ** max(0, len(str(int(value))) - 1)
    normalized = value / magnitude
    if normalized <= 1:
        rounded = 1
    elif normalized <= 2:
        rounded = 2
    elif normalized <= 5:
        rounded = 5
    else:
        rounded = 10
    return rounded * magnitude


def format_count(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def get_row_value(row: sqlite3.Row | tuple[object, ...], key: str, index: int) -> object:
    if isinstance(row, sqlite3.Row):
        return row[key]
    return row[index]
