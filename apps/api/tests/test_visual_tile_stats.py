from __future__ import annotations

import sqlite3

from enroute_api.footprints.store import initialize_schema
from enroute_api.footprints.visual_tiles import STATUS_READY, TIME_BUCKET_ALL
from enroute_api.footprints.visual_tile_stats import (
    render_visual_tile_average_chart_svg,
    render_visual_tile_max_chart_svg,
    summarize_visual_tiles_by_zoom,
)


def test_summarizes_visual_tile_counts_by_zoom(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        insert_visual_tile_counts(
            connection,
            [
                (1, 0, 0, 10, 4),
                (1, 0, 1, 30, 6),
                (2, 2, 1, 7, 3),
            ],
        )

        stats = summarize_visual_tiles_by_zoom(connection)

        assert [(row.z, row.tile_count) for row in stats] == [(1, 2), (2, 1)]
        assert stats[0].raw_average == 20
        assert stats[0].representative_average == 5
        assert stats[0].raw_min == 10
        assert stats[0].raw_max == 30
        assert stats[0].representative_min == 4
        assert stats[0].representative_max == 6
        assert stats[1].raw_average == 7
        assert stats[1].representative_average == 3
    finally:
        connection.close()


def test_renders_average_and_max_visual_tile_count_charts(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        insert_visual_tile_counts(
            connection,
            [
                (1, 0, 0, 10, 4),
                (1, 0, 1, 30, 6),
                (2, 2, 1, 7, 3),
            ],
        )
        stats = summarize_visual_tiles_by_zoom(connection)

        average_svg = render_visual_tile_average_chart_svg(stats)
        max_svg = render_visual_tile_max_chart_svg(stats)

        assert average_svg.startswith("<svg ")
        assert "Representative average" in average_svg
        assert "Actual average" in average_svg
        assert "z=1" in average_svg
        assert max_svg.startswith("<svg ")
        assert "Representative maximum" in max_svg
        assert "Actual maximum" in max_svg
        assert "z=2" in max_svg
    finally:
        connection.close()


def insert_visual_tile_counts(
    connection: sqlite3.Connection,
    rows: list[tuple[int, int, int, int, int]],
) -> None:
    for z, x, y, raw_count, representative_count in rows:
        connection.execute(
            """
            INSERT INTO visual_tiles (
              z, x, y, t_type, t, status, cells, raw_count, representative_count, updated_at
            )
            VALUES (?, ?, ?, ?, 0, ?, X'455654430100000000', ?, ?, 1000)
            """,
            (z, x, y, TIME_BUCKET_ALL, STATUS_READY, raw_count, representative_count),
        )
