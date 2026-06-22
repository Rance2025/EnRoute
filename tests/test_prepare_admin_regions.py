import json
import tempfile
import unittest
from pathlib import Path

from scripts.prepare_admin_regions import main


class PrepareAdminRegionsTests(unittest.TestCase):
    def test_converts_areacity_ok_geo_csv_to_project_geojson(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            source_path = root_dir / "ok_geo.csv"
            output_path = root_dir / "admin-regions.geojson"
            source_path.write_text(
                "\n".join(
                    [
                        "id,pid,deep,name,ext_path,geo,polygon",
                        '31,0,0,"上海市","上海市","121.47 31.23","120 30,123 30,123 33,120 33"',
                        '3101,31,1,"上海市","上海市 上海市","121.47 31.23","121 31,122 31,122 32,121 32"',
                        '310115,3101,2,"浦东新区","上海市 上海市 浦东新区","121.54 31.22","121.4 31.1,121.8 31.1,121.8 31.4,121.4 31.4;121.9 31.2,122 31.2,122 31.3,121.9 31.3"',
                        '310115001,310115,3,"潍坊新村街道","上海市 上海市 浦东新区 潍坊新村街道","121.52 31.22","121 31,122 31,122 32,121 32"',
                    ],
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    "--source-csv",
                    str(source_path),
                    "--output",
                    str(output_path),
                ],
                root_dir=root_dir,
            )

            payload = json.loads(output_path.read_text(encoding="utf-8"))
            features = payload["features"]

            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["type"], "FeatureCollection")
            self.assertEqual(
                [(feature["properties"]["id"], feature["properties"]["level"]) for feature in features],
                [
                    ("310000", "province"),
                    ("310100", "city"),
                    ("310115", "district"),
                ],
            )
            self.assertEqual(features[1]["properties"]["parent"], "310000")
            self.assertEqual(features[2]["properties"]["parent"], "310100")
            self.assertEqual(features[0]["geometry"]["type"], "Polygon")
            self.assertEqual(features[0]["geometry"]["coordinates"][0][0], [120.0, 30.0])
            self.assertEqual(features[0]["geometry"]["coordinates"][0][-1], [120.0, 30.0])
            self.assertEqual(features[2]["geometry"]["type"], "MultiPolygon")
            self.assertEqual(len(features[2]["geometry"]["coordinates"]), 2)
            self.assertEqual(features[2]["geometry"]["coordinates"][0][0][0], [121.4, 31.1])
            self.assertEqual(features[2]["geometry"]["coordinates"][0][0][-1], [121.4, 31.1])

    def test_preserves_direct_administered_city_codes_without_colliding(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            source_path = root_dir / "ok_geo.csv"
            output_path = root_dir / "admin-regions.geojson"
            source_path.write_text(
                "\n".join(
                    [
                        "id,pid,deep,name,ext_path,geo,polygon",
                        '42,0,0,"湖北省","湖北省","114.3 30.6","110 29,116 29,116 32,110 32"',
                        '429004,42,1,"仙桃市","湖北省 仙桃市","113.4 30.4","113 30,114 30,114 31,113 31"',
                        '429005,42,1,"潜江市","湖北省 潜江市","112.9 30.4","112 30,113 30,113 31,112 31"',
                        '429004000,429004,2,"仙桃市","湖北省 仙桃市 仙桃市","113.4 30.4","113 30,114 30,114 31,113 31"',
                    ],
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    "--source-csv",
                    str(source_path),
                    "--output",
                    str(output_path),
                ],
                root_dir=root_dir,
            )

            payload = json.loads(output_path.read_text(encoding="utf-8"))

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                [feature["properties"]["id"] for feature in payload["features"]],
                ["420000", "429004", "429005", "429004000"],
            )
            self.assertEqual(payload["features"][3]["properties"]["parent"], "429004")

    def test_disambiguates_same_adcode_across_city_and_district_levels(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            source_path = root_dir / "ok_geo.csv"
            output_path = root_dir / "admin-regions.geojson"
            source_path.write_text(
                "\n".join(
                    [
                        "id,pid,deep,name,ext_path,geo,polygon",
                        '44,0,0,"广东省","广东省","113.2 23.1","112 22,114 22,114 24,112 24"',
                        '4419,44,1,"东莞市","广东省 东莞市","113.7 23.0","113 22,114 22,114 24,113 24"',
                        '441900,4419,2,"东莞市","广东省 东莞市 东莞市","113.7 23.0","113 22,114 22,114 24,113 24"',
                    ],
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    "--source-csv",
                    str(source_path),
                    "--output",
                    str(output_path),
                ],
                root_dir=root_dir,
            )

            payload = json.loads(output_path.read_text(encoding="utf-8"))

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                [(feature["properties"]["id"], feature["properties"].get("parent")) for feature in payload["features"]],
                [
                    ("440000", None),
                    ("441900:city", "440000"),
                    ("441900:district", "441900:city"),
                ],
            )
            self.assertEqual(payload["features"][1]["properties"]["adcode"], "441900")
            self.assertEqual(payload["features"][2]["properties"]["adcode"], "441900")

    def test_appends_shanghai_osm_level8_boundaries_as_level5(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            source_path = root_dir / "ok_geo.csv"
            osm_path = root_dir / "shanghai-admin-level8.geojson"
            output_path = root_dir / "admin-regions.geojson"
            source_path.write_text(
                "\n".join(
                    [
                        "id,pid,deep,name,ext_path,geo,polygon",
                        '31,0,0,"上海市","上海市","121.47 31.23","120 30,123 30,123 33,120 33"',
                        '3101,31,1,"上海市","上海市 上海市","121.47 31.23","121 31,122 31,122 32,121 32"',
                        '310115,3101,2,"浦东新区","上海市 上海市 浦东新区","121.54 31.22","121.4 31.1,121.8 31.1,121.8 31.4,121.4 31.4"',
                    ],
                ),
                encoding="utf-8",
            )
            osm_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "osm_id": "12867438",
                                    "code": 1208,
                                    "fclass": "admin_level8",
                                    "name": "测试街道",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [
                                            [121.52, 31.18],
                                            [121.58, 31.18],
                                            [121.58, 31.24],
                                            [121.52, 31.24],
                                            [121.52, 31.18],
                                        ],
                                    ],
                                },
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    "--source-csv",
                    str(source_path),
                    "--shanghai-level5-geojson",
                    str(osm_path),
                    "--output",
                    str(output_path),
                ],
                root_dir=root_dir,
            )

            payload = json.loads(output_path.read_text(encoding="utf-8"))
            features = payload["features"]

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                [(feature["properties"]["id"], feature["properties"]["level"]) for feature in features],
                [
                    ("310000", "province"),
                    ("310100", "city"),
                    ("310115", "district"),
                    ("osm:12867438", 5),
                ],
            )
            self.assertEqual(features[3]["properties"]["parentId"], "310115")
            self.assertEqual(features[3]["properties"]["sourceCoordinateSystem"], "wgs84")

    def test_reads_areacity_polygon_fields_larger_than_python_csv_default_limit(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            source_path = root_dir / "ok_geo.csv"
            output_path = root_dir / "admin-regions.geojson"
            long_ring = ",".join(
                f"{120 + index * 0.000001:.6f} {30 + index * 0.000001:.6f}"
                for index in range(7000)
            )
            source_path.write_text(
                "\n".join(
                    [
                        "id,pid,deep,name,ext_path,geo,polygon",
                        f'31,0,0,"上海市","上海市","121.47 31.23","{long_ring}"',
                    ],
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    "--source-csv",
                    str(source_path),
                    "--output",
                    str(output_path),
                ],
                root_dir=root_dir,
            )

            payload = json.loads(output_path.read_text(encoding="utf-8"))

            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["features"][0]["properties"]["id"], "310000")


if __name__ == "__main__":
    unittest.main()
