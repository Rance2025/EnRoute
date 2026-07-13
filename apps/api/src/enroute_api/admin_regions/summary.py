from __future__ import annotations

import sqlite3
from typing import Any


def query_admin_region_statistics(
    connection: sqlite3.Connection,
    *,
    depth: int,
    start_timestamp_seconds: int,
    end_timestamp_seconds: int,
) -> dict[str, Any]:
    if depth not in {1, 2, 3, 4}:
        raise ValueError("depth must be one of 1, 2, 3, or 4")

    rows = connection.execute(
        """
        WITH RECURSIVE
        ancestry(footprint_timestamp_seconds, region_id) AS (
          SELECT timestamp_seconds, region_id
          FROM footprints
          WHERE timestamp_seconds BETWEEN :start_timestamp_seconds AND :end_timestamp_seconds
            AND region_id IS NOT NULL
            AND TRIM(region_id) != ''

          UNION ALL

          SELECT ancestry.footprint_timestamp_seconds, tree.parent_id
          FROM ancestry
          JOIN admin_region_tree AS tree ON tree.child_id = ancestry.region_id
        ),
        eligible_regions AS (
          SELECT *
          FROM admin_regions
          WHERE level = :depth
            AND (
              :depth != 1
              OR (
                LOWER(TRIM(name)) NOT IN ('antarctica', '南极洲')
                AND LOWER(TRIM(id)) NOT IN (
                  'aq', 'ata', '010', 'country:aq', 'country:ata', 'country:010'
                )
                AND LOWER(TRIM(id)) NOT LIKE '%:aq'
                AND LOWER(TRIM(id)) NOT LIKE '%:ata'
              )
            )
        ),
        grouped_regions AS (
          SELECT
            regions.id AS region_id,
            regions.name,
            COUNT(*) AS footprint_count,
            regions.min_lng,
            regions.min_lat,
            regions.max_lng,
            regions.max_lat
          FROM ancestry
          JOIN eligible_regions AS regions ON regions.id = ancestry.region_id
          GROUP BY
            regions.id,
            regions.name,
            regions.min_lng,
            regions.min_lat,
            regions.max_lng,
            regions.max_lat
        ),
        ranked_regions AS (
          SELECT
            ROW_NUMBER() OVER (
              ORDER BY footprint_count DESC, name ASC, region_id ASC
            ) AS rank,
            *
          FROM grouped_regions
        ),
        total_regions AS (
          SELECT COUNT(*) AS total_count
          FROM eligible_regions
        )
        SELECT
          total_regions.total_count,
          ranked_regions.rank,
          ranked_regions.region_id,
          ranked_regions.name,
          ranked_regions.footprint_count,
          ranked_regions.min_lng,
          ranked_regions.min_lat,
          ranked_regions.max_lng,
          ranked_regions.max_lat
        FROM total_regions
        LEFT JOIN ranked_regions ON TRUE
        ORDER BY ranked_regions.rank
        """,
        {
            "depth": depth,
            "start_timestamp_seconds": start_timestamp_seconds,
            "end_timestamp_seconds": end_timestamp_seconds,
        },
    ).fetchall()

    ranking_rows = [row for row in rows if row["region_id"] is not None]
    return {
        "depth": depth,
        "totalCount": int(rows[0]["total_count"]),
        "visitedCount": len(ranking_rows),
        "visitedRegionIds": sorted(str(row["region_id"]) for row in ranking_rows),
        "rankings": [
            {
                "rank": int(row["rank"]),
                "regionId": str(row["region_id"]),
                "name": str(row["name"]),
                "footprintCount": int(row["footprint_count"]),
                "bounds": {
                    "west": float(row["min_lng"]),
                    "south": float(row["min_lat"]),
                    "east": float(row["max_lng"]),
                    "north": float(row["max_lat"]),
                },
            }
            for row in ranking_rows
        ],
    }
