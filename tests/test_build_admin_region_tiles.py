import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.build_admin_region_tiles import main


class BuildAdminRegionTilesTests(unittest.TestCase):
    def test_builds_world_admin_region_tiles_from_geojson_source(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            source_path = root_dir / "admin-regions.geojson"
            database_path = root_dir / "footprints.sqlite"
            source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "overture:division:country:test",
                                    "subtype": "country",
                                    "names": {"primary": "Test Country"},
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],
                                    ],
                                },
                            },
                        ],
                    },
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    "--admin-region-data-path",
                    str(source_path),
                    "--database",
                    str(database_path),
                    "--max-zoom",
                    "0",
                    "--depth",
                    "1",
                ],
                root_dir=root_dir,
            )

            connection = sqlite3.connect(database_path)
            try:
                tile_count = connection.execute("SELECT COUNT(*) FROM admin_region_tiles").fetchone()[0]
                region_count = connection.execute("SELECT COUNT(*) FROM admin_regions").fetchone()[0]
            finally:
                connection.close()

            self.assertEqual(exit_code, 0)
            self.assertEqual(region_count, 1)
            self.assertEqual(tile_count, 1)

    def test_preserves_built_admin_tiles_when_store_imports_footprints(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            source_path = root_dir / "admin-regions.geojson"
            database_path = root_dir / "footprints.sqlite"
            footprint_path = root_dir / "points.csv"
            source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "overture:division:country:test",
                                    "subtype": "country",
                                    "names": {"primary": "Test Country"},
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],
                                    ],
                                },
                            },
                        ],
                    },
                ),
                encoding="utf-8",
            )
            footprint_path.write_text(
                "\n".join(
                    [
                        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                        "2024-01-01 00:00:00,0,0,0,0,10,0,0,0,0,0",
                    ],
                ),
                encoding="utf-8",
            )

            main(
                [
                    "--admin-region-data-path",
                    str(source_path),
                    "--database",
                    str(database_path),
                    "--max-zoom",
                    "0",
                    "--depth",
                    "1",
                ],
                root_dir=root_dir,
            )
            from enroute_api.footprints.store import FootprintStore

            store = FootprintStore(
                db_path=database_path,
                data_path=footprint_path,
                coordinate_system="wgs84",
                admin_region_data_path=source_path,
            )
            try:
                store.import_footprints()
                tile_count = store.connection.execute(
                    "SELECT COUNT(*) FROM admin_region_tiles",
                ).fetchone()[0]
            finally:
                store.close()

            self.assertEqual(tile_count, 1)


if __name__ == "__main__":
    unittest.main()
