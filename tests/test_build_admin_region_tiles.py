import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import Point, box, shape

from scripts.build_admin_region_tiles import create_country_line_mask_geometry, main

API_SRC_DIR = Path(__file__).resolve().parents[1] / "apps" / "api" / "src"
if str(API_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(API_SRC_DIR))

from enroute_api.footprints.coordinates import transform_wgs84_to_gcj02_coordinate


class BuildAdminRegionTilesTests(unittest.TestCase):
    def test_country_line_mask_uses_any_assigned_visual_gap(self):
        country_geometry = box(10.03, 0, 20, 10)
        assigned_gap_geometry = box(10, 0, 10.02, 10)

        line_mask_geometry = create_country_line_mask_geometry(
            country_geometry,
            mask_source_geometries=[assigned_gap_geometry],
        )

        self.assertIsNotNone(line_mask_geometry)
        self.assertTrue(line_mask_geometry.contains(Point(10.03, 5)))
        self.assertFalse(line_mask_geometry.contains(Point(20, 5)))

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

    def test_builds_world_tiles_for_depth_one_through_four_by_default(self):
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
                                    "id": "country-id",
                                    "name": "Test Country",
                                    "level": 1,
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "region-id",
                                    "name": "Test Region",
                                    "level": 2,
                                    "parentId": "country-id",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]],
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
                ],
                root_dir=root_dir,
            )

            connection = sqlite3.connect(database_path)
            try:
                rows = connection.execute(
                    """
                    SELECT depth, COUNT(*) AS count
                    FROM admin_region_tiles
                    GROUP BY depth
                    ORDER BY depth
                    """,
                ).fetchall()
            finally:
                connection.close()

            self.assertEqual(exit_code, 0)
            self.assertEqual(rows, [(1, 1)])

    def test_merges_world_country_source_with_china_detail_source(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            world_source_path = root_dir / "world-countries.geojson"
            china_source_path = root_dir / "china-admin-regions.geojson"
            database_path = root_dir / "footprints.sqlite"
            world_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "overture:division:country:cn",
                                    "subtype": "country",
                                    "names": {"primary": "China"},
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[70, 15], [135, 15], [135, 55], [70, 55], [70, 15]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "overture:division:country:us",
                                    "subtype": "country",
                                    "names": {"primary": "United States"},
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[-125, 24], [-66, 24], [-66, 50], [-125, 50], [-125, 24]],
                                    ],
                                },
                            },
                        ],
                    },
                ),
                encoding="utf-8",
            )
            china_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "310000",
                                    "adcode": "310000",
                                    "name": "Shanghai",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[120, 30], [123, 30], [123, 33], [120, 33], [120, 30]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "310100",
                                    "adcode": "310100",
                                    "parent": "310000",
                                    "name": "Shanghai City",
                                    "level": "city",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[121, 31], [122, 31], [122, 32], [121, 32], [121, 31]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "310115",
                                    "adcode": "310115",
                                    "parent": "310100",
                                    "name": "Pudong",
                                    "level": "district",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[121.4, 31.1], [121.8, 31.1], [121.8, 31.4], [121.4, 31.4], [121.4, 31.1]],
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
                    str(world_source_path),
                    "--china-admin-region-data-path",
                    str(china_source_path),
                    "--database",
                    str(database_path),
                    "--max-zoom",
                    "0",
                    "--depths",
                    "1,2,3,4",
                ],
                root_dir=root_dir,
            )

            connection = sqlite3.connect(database_path)
            try:
                regions = connection.execute(
                    """
                    SELECT r.id, r.level, t.parent_id
                    FROM admin_regions r
                    LEFT JOIN admin_region_tree t ON t.child_id = r.id
                    ORDER BY r.id
                    """,
                ).fetchall()
                tile_depths = connection.execute(
                    """
                    SELECT depth, COUNT(*) AS count
                    FROM admin_region_tiles
                    GROUP BY depth
                    ORDER BY depth
                    """,
                ).fetchall()
            finally:
                connection.close()

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                regions,
                [
                    ("310000", 2, "overture:division:country:cn"),
                    ("310100", 3, "310000"),
                    ("310115", 4, "310100"),
                    ("overture:division:country:cn", 1, None),
                    ("overture:division:country:us", 1, None),
                ],
            )
            self.assertEqual(tile_depths, [(1, 1), (2, 1), (3, 1), (4, 1)])

    def test_china_detail_source_overrides_country_level_worldview(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            world_source_path = root_dir / "world-countries.geojson"
            china_source_path = root_dir / "china-admin-regions.geojson"
            database_path = root_dir / "footprints.sqlite"
            world_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {"id": "cn", "name": "China", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[100, 30], [110, 30], [110, 40], [100, 40], [100, 30]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {"id": "tw", "name": "Taiwan", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[120, 24], [122, 24], [122, 26], [120, 26], [120, 24]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {"id": "in", "name": "India", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[92, 27], [95, 27], [95, 29], [92, 29], [92, 27]],
                                    ],
                                },
                            },
                        ],
                    },
                ),
                encoding="utf-8",
            )
            china_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "110000",
                                    "adcode": "110000",
                                    "name": "Beijing",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [self._gcj_rectangle(100, 30, 110, 40)],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "710000",
                                    "adcode": "710000",
                                    "name": "Taiwan",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [self._gcj_rectangle(120, 24, 122, 26)],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "810000:province",
                                    "adcode": "810000",
                                    "name": "Hong Kong",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [self._gcj_rectangle(113.8, 22.1, 114.4, 22.6)],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "820000:province",
                                    "adcode": "820000",
                                    "name": "Macau",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [self._gcj_rectangle(113.4, 22.0, 113.7, 22.3)],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "540000",
                                    "adcode": "540000",
                                    "name": "Tibet",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [self._gcj_rectangle(92, 27, 95, 29)],
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
                    str(world_source_path),
                    "--china-admin-region-data-path",
                    str(china_source_path),
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
            connection.row_factory = sqlite3.Row
            try:
                country_ids = [
                    row["id"]
                    for row in connection.execute(
                        "SELECT id FROM admin_regions WHERE level = 1 ORDER BY id",
                    )
                ]
                point_hits = {
                    "beijing": self._country_hits(connection, longitude=105, latitude=35),
                    "taiwan": self._country_hits(connection, longitude=121, latitude=25),
                    "hong_kong": self._country_hits(connection, longitude=114.1, latitude=22.3),
                    "macau": self._country_hits(connection, longitude=113.55, latitude=22.15),
                    "zangnan": self._country_hits(connection, longitude=93.5, latitude=28),
                }
            finally:
                connection.close()

            self.assertEqual(exit_code, 0)
            self.assertEqual(country_ids, ["cn"])
            self.assertEqual(
                point_hits,
                {
                    "beijing": ["cn"],
                    "taiwan": ["cn"],
                    "hong_kong": ["cn"],
                    "macau": ["cn"],
                    "zangnan": ["cn"],
                },
            )

    def test_country_level_preserves_china_world_gap_as_china_country(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            world_source_path = root_dir / "world-countries.geojson"
            china_source_path = root_dir / "china-admin-regions.geojson"
            database_path = root_dir / "footprints.sqlite"
            world_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {"id": "cn", "name": "China", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {"id": "neighbor", "name": "Neighbor", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[10.03, 0], [20, 0], [20, 10], [10.03, 10], [10.03, 0]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {"id": "far", "name": "Far", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[30, 0], [40, 0], [40, 10], [30, 10], [30, 0]],
                                    ],
                                },
                            },
                        ],
                    },
                ),
                encoding="utf-8",
            )
            china_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "110000",
                                    "adcode": "110000",
                                    "name": "Detailed China",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[0, 0], [8, 0], [8, 10], [0, 10], [0, 0]],
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
                    str(world_source_path),
                    "--china-admin-region-data-path",
                    str(china_source_path),
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
            connection.row_factory = sqlite3.Row
            try:
                country_ids = [
                    row["id"]
                    for row in connection.execute(
                        "SELECT id FROM admin_regions WHERE level = 1 ORDER BY id",
                    )
                ]
                detailed_china_hits = self._country_hits(connection, longitude=7, latitude=5)
                gap_hits = self._country_hits(connection, longitude=9, latitude=5)
                neighbor_hits = self._country_hits(connection, longitude=12, latitude=5)
                china_geometry = self._country_geometry(connection, region_id="cn")
                neighbor_geometry = self._country_geometry(connection, region_id="neighbor")
                neighbor_line_mask_geometry = self._country_line_mask_geometry(connection, region_id="neighbor")
                far_line_mask_geometry = self._country_line_mask_geometry(connection, region_id="far")
            finally:
                connection.close()

            self.assertEqual(exit_code, 0)
            self.assertEqual(country_ids, ["cn", "far", "neighbor"])
            self.assertEqual(detailed_china_hits, ["cn"])
            self.assertEqual(gap_hits, ["cn"])
            self.assertEqual(neighbor_hits, ["neighbor"])
            self.assertTrue(china_geometry.contains(Point(9, 5)))
            self.assertFalse(neighbor_geometry.contains(Point(9, 5)))
            self.assertTrue(neighbor_line_mask_geometry.contains(Point(10, 5)))
            self.assertTrue(neighbor_line_mask_geometry.contains(Point(10.03, 5)))
            self.assertIsNone(far_line_mask_geometry)

    def test_country_level_assigns_china_worldview_island_gap_to_china_country(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            world_source_path = root_dir / "world-countries.geojson"
            china_source_path = root_dir / "china-admin-regions.geojson"
            database_path = root_dir / "footprints.sqlite"
            world_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {"id": "cn", "name": "China", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[100, 30], [110, 30], [110, 40], [100, 40], [100, 30]],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {"id": "tw", "name": "Taiwan", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[119, 23], [120, 23], [120, 24], [119, 24], [119, 23]],
                                    ],
                                },
                            },
                        ],
                    },
                ),
                encoding="utf-8",
            )
            china_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "110000",
                                    "adcode": "110000",
                                    "name": "Beijing",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [self._gcj_rectangle(100, 30, 110, 40)],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "710000",
                                    "adcode": "710000",
                                    "name": "Taiwan",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [self._gcj_rectangle(119.2, 23.2, 119.8, 23.8)],
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
                    str(world_source_path),
                    "--china-admin-region-data-path",
                    str(china_source_path),
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
            connection.row_factory = sqlite3.Row
            try:
                country_ids = [
                    row["id"]
                    for row in connection.execute(
                        "SELECT id FROM admin_regions WHERE level = 1 ORDER BY id",
                    )
                ]
                island_gap_hits = self._country_hits(connection, longitude=119.05, latitude=23.5)
                taiwan_detail_hits = self._country_hits(connection, longitude=119.5, latitude=23.5)
            finally:
                connection.close()

            self.assertEqual(exit_code, 0)
            self.assertEqual(country_ids, ["cn"])
            self.assertEqual(island_gap_hits, ["cn"])
            self.assertEqual(taiwan_detail_hits, ["cn"])

    def test_country_level_cuts_neighbor_against_china_wgs_render_geometry(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            world_source_path = root_dir / "world-countries.geojson"
            china_source_path = root_dir / "china-admin-regions.geojson"
            database_path = root_dir / "footprints.sqlite"
            china_west = 116.0
            china_east = 117.0
            china_south = 39.0
            china_north = 40.0
            gcj_west, gcj_south = transform_wgs84_to_gcj02_coordinate(
                longitude=china_west,
                latitude=china_south,
            )
            gcj_east, gcj_north = transform_wgs84_to_gcj02_coordinate(
                longitude=china_east,
                latitude=china_north,
            )
            world_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {"id": "cn", "name": "China", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [
                                            [china_west, china_south],
                                            [china_east, china_south],
                                            [china_east, china_north],
                                            [china_west, china_north],
                                            [china_west, china_south],
                                        ],
                                    ],
                                },
                            },
                            {
                                "type": "Feature",
                                "properties": {"id": "neighbor", "name": "Neighbor", "level": 1},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [
                                            [china_east, china_south],
                                            [118.0, china_south],
                                            [118.0, china_north],
                                            [china_east, china_north],
                                            [china_east, china_south],
                                        ],
                                    ],
                                },
                            },
                        ],
                    },
                ),
                encoding="utf-8",
            )
            china_source_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "id": "110000",
                                    "adcode": "110000",
                                    "name": "Detailed China",
                                    "level": "province",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [
                                            [gcj_west, gcj_south],
                                            [gcj_east, gcj_south],
                                            [gcj_east, gcj_north],
                                            [gcj_west, gcj_north],
                                            [gcj_west, gcj_south],
                                        ],
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
                    str(world_source_path),
                    "--china-admin-region-data-path",
                    str(china_source_path),
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
            connection.row_factory = sqlite3.Row
            try:
                neighbor_geometry = self._country_geometry(connection, region_id="neighbor")
            finally:
                connection.close()

            self.assertEqual(exit_code, 0)
            self.assertTrue(neighbor_geometry.contains(Point(china_east + 0.002, 39.5)))

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

    def _country_hits(
        self,
        connection: sqlite3.Connection,
        *,
        longitude: float,
        latitude: float,
    ) -> list[str]:
        point = Point(longitude, latitude)
        hits = []
        rows = connection.execute(
            """
            SELECT id, geometry
            FROM admin_regions
            WHERE level = 1
              AND min_lng <= ?
              AND max_lng >= ?
              AND min_lat <= ?
              AND max_lat >= ?
            ORDER BY id
            """,
            (longitude, longitude, latitude, latitude),
        ).fetchall()
        for row in rows:
            geometry = shape(json.loads(row["geometry"]))
            if geometry.contains(point) or geometry.touches(point):
                hits.append(row["id"])
        return hits

    def _country_line_mask_geometry(self, connection: sqlite3.Connection, *, region_id: str):
        row = connection.execute(
            "SELECT line_mask_geometry FROM admin_regions WHERE id = ?",
            (region_id,),
        ).fetchone()
        self.assertIsNotNone(row)
        if row["line_mask_geometry"] is None:
            return None
        return shape(json.loads(str(row["line_mask_geometry"])))

    def _country_geometry(self, connection: sqlite3.Connection, *, region_id: str):
        row = connection.execute(
            "SELECT geometry FROM admin_regions WHERE id = ?",
            (region_id,),
        ).fetchone()
        self.assertIsNotNone(row)
        return shape(json.loads(str(row["geometry"])))

    def _gcj_rectangle(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
    ) -> list[list[float]]:
        return [
            list(transform_wgs84_to_gcj02_coordinate(longitude=west, latitude=south)),
            list(transform_wgs84_to_gcj02_coordinate(longitude=east, latitude=south)),
            list(transform_wgs84_to_gcj02_coordinate(longitude=east, latitude=north)),
            list(transform_wgs84_to_gcj02_coordinate(longitude=west, latitude=north)),
            list(transform_wgs84_to_gcj02_coordinate(longitude=west, latitude=south)),
        ]


if __name__ == "__main__":
    unittest.main()
