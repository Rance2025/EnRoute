import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.prepare_overture_admin_regions import (
    build_overture_division_area_query,
    main,
    normalize_overture_feature_row,
)


class PrepareOvertureAdminRegionsTests(unittest.TestCase):
    def test_normalizes_division_area_rows_to_project_levels(self):
        feature = normalize_overture_feature_row(
            {
                "id": "region-area-id",
                "division_id": "region-id",
                "subtype": "region",
                "name": "California",
                "parent_division_id": "country-id",
                "geometry": '{"type":"Polygon","coordinates":[[[-125,32],[-114,32],[-114,42],[-125,42],[-125,32]]]}',
            },
        )

        self.assertEqual(feature["properties"], {
            "id": "region-id",
            "name": "California",
            "level": 2,
            "parentId": "country-id",
            "source": "overture:division_area",
            "sourceAreaId": "region-area-id",
            "sourceCoordinateSystem": "wgs84",
        })
        self.assertEqual(feature["geometry"]["type"], "Polygon")

    def test_builds_query_from_local_parquet_paths(self):
        query = build_overture_division_area_query(
            area_path="areas.parquet",
            division_path="divisions.parquet",
            subtype_filter=("country", "region"),
            country_filter=("US", "CN"),
            row_limit=10,
        )

        self.assertIn("read_parquet('areas.parquet'", query)
        self.assertIn("read_parquet('divisions.parquet'", query)
        self.assertIn("class = 'land'", query)
        self.assertIn("is_land = true", query)
        self.assertIn("subtype IN ('country','region')", query)
        self.assertIn("d.country IN ('US','CN')", query)
        self.assertIn("LIMIT 10", query)

    def test_passes_http_timeout_and_retries_to_loader(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            with patch("scripts.prepare_overture_admin_regions.load_overture_features", return_value=[]) as loader:
                exit_code = main(
                    [
                        "--output",
                        str(root_dir / "admin-regions.geojson"),
                        "--http-timeout",
                        "600",
                        "--http-retries",
                        "12",
                    ],
                    root_dir=root_dir,
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(loader.call_args.kwargs["http_timeout_seconds"], 600)
        self.assertEqual(loader.call_args.kwargs["http_retries"], 12)

    def test_exports_local_parquet_fixture_to_geojson(self):
        duckdb = __import__("duckdb")

        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            database = root_dir / "fixture.duckdb"
            area_path = root_dir / "areas.parquet"
            division_path = root_dir / "divisions.parquet"
            output_path = root_dir / "admin-regions.geojson"
            connection = duckdb.connect(str(database))
            try:
                connection.execute("INSTALL spatial; LOAD spatial;")
                connection.execute(
                    """
                    CREATE TABLE areas AS
                    SELECT
                      'country-area-id' AS id,
                      'country-id' AS division_id,
                      'country' AS subtype,
                      'land' AS class,
                      true AS is_land,
                      'CN' AS country,
                      ST_GeomFromText('POLYGON ((70 15, 140 15, 140 55, 70 55, 70 15))') AS geometry
                    UNION ALL
                    SELECT
                      'region-area-id',
                      'region-id',
                      'region',
                      'land',
                      true,
                      'CN',
                      ST_GeomFromText('POLYGON ((120 30, 123 30, 123 33, 120 33, 120 30))')
                    """,
                )
                connection.execute(
                    """
                    CREATE TABLE divisions AS
                    SELECT
                      'country-id' AS id,
                      NULL AS parent_division_id,
                      'country' AS subtype,
                      struct_pack("primary" := 'China') AS names,
                      'CN' AS country
                    UNION ALL
                    SELECT
                      'region-id',
                      'country-id',
                      'region',
                      struct_pack("primary" := 'Shanghai'),
                      'CN'
                    """,
                )
                connection.execute(f"COPY areas TO '{area_path.as_posix()}' (FORMAT PARQUET)")
                connection.execute(f"COPY divisions TO '{division_path.as_posix()}' (FORMAT PARQUET)")
            finally:
                connection.close()

            exit_code = main(
                [
                    "--area-parquet",
                    str(area_path),
                    "--division-parquet",
                    str(division_path),
                    "--output",
                    str(output_path),
                ],
                root_dir=root_dir,
            )

            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["type"], "FeatureCollection")
        self.assertEqual(
            [(feature["properties"]["id"], feature["properties"]["level"]) for feature in payload["features"]],
            [("country-id", 1), ("region-id", 2)],
        )
        self.assertEqual(payload["features"][1]["properties"]["parentId"], "country-id")

    def test_unions_multiple_area_rows_for_one_division(self):
        duckdb = __import__("duckdb")

        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            database = root_dir / "fixture.duckdb"
            area_path = root_dir / "areas.parquet"
            division_path = root_dir / "divisions.parquet"
            output_path = root_dir / "admin-regions.geojson"
            connection = duckdb.connect(str(database))
            try:
                connection.execute("INSTALL spatial; LOAD spatial;")
                connection.execute(
                    """
                    CREATE TABLE areas AS
                    SELECT
                      'area-a' AS id,
                      'country-id' AS division_id,
                      'country' AS subtype,
                      'land' AS class,
                      true AS is_land,
                      ST_GeomFromText('POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))') AS geometry
                    UNION ALL
                    SELECT
                      'area-b',
                      'country-id',
                      'country',
                      'land',
                      true,
                      ST_GeomFromText('POLYGON ((2 0, 3 0, 3 1, 2 1, 2 0))')
                    """,
                )
                connection.execute(
                    """
                    CREATE TABLE divisions AS
                    SELECT
                      'country-id' AS id,
                      NULL AS parent_division_id,
                      'country' AS subtype,
                      struct_pack("primary" := 'Test Country') AS names,
                      'TC' AS country
                    """,
                )
                connection.execute(f"COPY areas TO '{area_path.as_posix()}' (FORMAT PARQUET)")
                connection.execute(f"COPY divisions TO '{division_path.as_posix()}' (FORMAT PARQUET)")
            finally:
                connection.close()

            exit_code = main(
                [
                    "--area-parquet",
                    str(area_path),
                    "--division-parquet",
                    str(division_path),
                    "--output",
                    str(output_path),
                ],
                root_dir=root_dir,
            )

            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(payload["features"]), 1)
        self.assertEqual(payload["features"][0]["properties"]["id"], "country-id")


if __name__ == "__main__":
    unittest.main()
