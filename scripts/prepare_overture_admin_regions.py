from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


DEFAULT_OVERTURE_RELEASE = "2026-06-17.0"
DEFAULT_OVERTURE_S3_PREFIX = "s3://overturemaps-us-west-2/release"
DEFAULT_SUBTYPES = ("country", "region", "locality")
OVERTURE_SUBTYPE_TO_ENROUTE_LEVEL = {
    "country": 1,
    "region": 2,
    "locality": 3,
}


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
    args = parse_args(argv)
    resolved_root_dir = Path(root_dir or Path.cwd()).resolve()
    output_path = resolve_path(resolved_root_dir, args.output)
    subtypes = tuple(parse_csv_values(args.subtypes))
    countries = tuple(parse_csv_values(args.countries))
    area_path = str(resolve_path(resolved_root_dir, args.area_parquet)) if args.area_parquet else (
        f"{args.s3_prefix}/{args.release}/theme=divisions/type=division_area/*"
    )
    division_path = str(resolve_path(resolved_root_dir, args.division_parquet)) if args.division_parquet else (
        f"{args.s3_prefix}/{args.release}/theme=divisions/type=division/*"
    )

    features = load_overture_features(
        area_path=area_path,
        division_path=division_path,
        subtype_filter=subtypes,
        country_filter=countries,
        row_limit=args.limit,
        http_timeout_seconds=args.http_timeout,
        http_retries=args.http_retries,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": features,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(features)} Overture admin region features to {output_path}")
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Overture Maps division_area boundaries into EnRoute admin-region GeoJSON.",
    )
    parser.add_argument("--release", default=DEFAULT_OVERTURE_RELEASE, help="Overture release id.")
    parser.add_argument("--s3-prefix", default=DEFAULT_OVERTURE_S3_PREFIX, help="Overture release S3 prefix.")
    parser.add_argument("--area-parquet", type=Path, help="Local division_area parquet path for tests/offline builds.")
    parser.add_argument("--division-parquet", type=Path, help="Local division parquet path for tests/offline builds.")
    parser.add_argument(
        "--subtypes",
        default=",".join(DEFAULT_SUBTYPES),
        help="Comma-separated Overture division subtypes to export.",
    )
    parser.add_argument(
        "--countries",
        default="",
        help="Optional comma-separated ISO country codes.",
    )
    parser.add_argument("--limit", type=int, help="Optional row limit for smoke checks.")
    parser.add_argument(
        "--http-timeout",
        type=int,
        default=300,
        help="DuckDB HTTP timeout in seconds for remote Overture reads. Defaults to 300.",
    )
    parser.add_argument(
        "--http-retries",
        type=int,
        default=10,
        help="DuckDB HTTP retry count for remote Overture reads. Defaults to 10.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("external/admin-regions.geojson"),
        help="Output GeoJSON path consumed by ADMIN_REGION_DATA_PATH.",
    )
    return parser.parse_args(argv)


def load_overture_features(
    *,
    area_path: str,
    division_path: str,
    subtype_filter: tuple[str, ...],
    country_filter: tuple[str, ...] = (),
    row_limit: int | None = None,
    http_timeout_seconds: int = 300,
    http_retries: int = 10,
) -> list[dict[str, Any]]:
    try:
        import duckdb
    except ImportError as error:  # pragma: no cover - exercised by environment, not unit tests.
        raise RuntimeError("duckdb is required to export Overture admin regions") from error

    connection = duckdb.connect()
    try:
        if area_path.startswith("s3://") or division_path.startswith("s3://"):
            connection.execute("INSTALL httpfs; LOAD httpfs;")
            connection.execute("SET http_timeout = ?", [http_timeout_seconds])
            connection.execute("SET http_retries = ?", [http_retries])
        connection.execute("INSTALL spatial; LOAD spatial;")
        query = build_overture_division_area_query(
            area_path=area_path,
            division_path=division_path,
            subtype_filter=subtype_filter,
            country_filter=country_filter,
            row_limit=row_limit,
        )
        rows = connection.execute(query).fetchall()
        columns = [column[0] for column in connection.description]
    finally:
        connection.close()

    features = [
        normalize_overture_feature_row(dict(zip(columns, row, strict=True)))
        for row in rows
    ]
    return sorted(features, key=lambda feature: (
        int(feature["properties"]["level"]),
        str(feature["properties"]["id"]),
    ))


def build_overture_division_area_query(
    *,
    area_path: str,
    division_path: str,
    subtype_filter: tuple[str, ...],
    country_filter: tuple[str, ...] = (),
    row_limit: int | None = None,
) -> str:
    subtype_sql = ",".join(sql_string(value) for value in subtype_filter)
    country_clause = ""
    if country_filter:
        country_sql = ",".join(sql_string(value) for value in country_filter)
        country_clause = f"AND d.country IN ({country_sql})"
    limit_clause = "" if row_limit is None else f"\nLIMIT {int(row_limit)}"

    return f"""
WITH divisions AS (
  SELECT
    id,
    parent_division_id,
    subtype,
    names.primary AS name,
    country
  FROM read_parquet('{escape_sql_path(division_path)}', filename=true, hive_partitioning=1)
  WHERE subtype IN ({subtype_sql})
),
areas AS (
  SELECT
    id,
    division_id,
    geometry
  FROM read_parquet('{escape_sql_path(area_path)}', filename=true, hive_partitioning=1)
  WHERE subtype IN ({subtype_sql})
    AND class = 'land'
    AND is_land = true
)
SELECT
  MIN(a.id) AS id,
  a.division_id,
  d.subtype,
  d.name,
  d.parent_division_id,
  ST_AsGeoJSON(ST_Union_Agg(a.geometry)) AS geometry
FROM areas a
JOIN divisions d ON d.id = a.division_id
WHERE d.name IS NOT NULL
  {country_clause}
GROUP BY a.division_id, d.subtype, d.name, d.parent_division_id
ORDER BY d.subtype, a.division_id{limit_clause}
""".strip()


def normalize_overture_feature_row(row: Mapping[str, Any]) -> dict[str, Any]:
    subtype = str(row["subtype"])
    level = OVERTURE_SUBTYPE_TO_ENROUTE_LEVEL[subtype]
    geometry_value = row["geometry"]
    geometry = json.loads(geometry_value if isinstance(geometry_value, str) else str(geometry_value))
    properties: dict[str, Any] = {
        "id": str(row["division_id"]),
        "name": str(row["name"]),
        "level": level,
        "source": "overture:division_area",
        "sourceAreaId": str(row["id"]),
        "sourceCoordinateSystem": "wgs84",
    }
    parent_id = row.get("parent_division_id")
    if parent_id not in {None, ""}:
        properties["parentId"] = str(parent_id)
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": geometry,
    }


def parse_csv_values(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def escape_sql_path(path: str) -> str:
    return path.replace("\\", "/").replace("'", "''")


def resolve_path(root_dir: Path, path: Path | str) -> Path:
    resolved_path = Path(path)
    if resolved_path.is_absolute():
        return resolved_path
    return root_dir / resolved_path


if __name__ == "__main__":
    raise SystemExit(main())
