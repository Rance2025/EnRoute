from __future__ import annotations

import importlib
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing, redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import patch


ROOT_DIR = Path(__file__).resolve().parents[1]
API_SRC_DIR = ROOT_DIR / "apps" / "api" / "src"
if str(API_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(API_SRC_DIR))

from enroute_api.admin_regions.precompute_meta import DAILY_STATS_SIGNATURE_KEY
from enroute_api.footprints.distance_repair import (
    repair_daily_first_distances,
    snapshot_protected_tables,
)
from enroute_api.footprints.store import initialize_schema


class RepairDailyFirstDistancesTests(unittest.TestCase):
    def test_repairs_only_daily_first_zero_distances_and_rebuilds_summaries(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            database = Path(temporary_directory) / "footprints.sqlite"
            connection = create_repair_database(database)
            try:
                before = snapshot_protected_tables(connection)

                with connection:
                    result = repair_daily_first_distances(connection)

                after = snapshot_protected_tables(connection)
                distances = connection.execute(
                    "SELECT distance FROM footprints ORDER BY timestamp_seconds",
                ).fetchall()
                region_distance = float(
                    connection.execute(
                        "SELECT travel_distance_meters FROM admin_regions WHERE id = 'district-a'",
                    ).fetchone()[0],
                )
                daily_distance = float(
                    connection.execute(
                        """
                        SELECT SUM(travel_distance_meters)
                        FROM admin_region_daily_stats
                        WHERE depth = 4 AND region_id = 'district-a'
                        """,
                    ).fetchone()[0],
                )
                daily_signature = connection.execute(
                    "SELECT value FROM footprint_meta WHERE key = ?",
                    (DAILY_STATS_SIGNATURE_KEY,),
                ).fetchone()
            finally:
                connection.close()

        self.assertEqual(result.scanned_count, 5)
        self.assertEqual(result.candidate_count, 2)
        self.assertEqual(result.updated_count, 1)
        self.assertAlmostEqual(result.added_distance_meters, 111_195.08, delta=1)
        self.assertEqual([float(row[0]) for row in distances][2:], [0.0, 5.0, 0.0])
        self.assertAlmostEqual(float(distances[1][0]), 111_195.08, delta=1)
        self.assertEqual(before, after)
        self.assertGreater(region_distance, 111_195)
        self.assertGreater(daily_distance, 111_195)
        self.assertIsNotNone(daily_signature)

    def test_cli_backs_up_before_repairing_database(self):
        module = importlib.import_module("scripts.repair_daily_first_distances")
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            database = root_dir / "data" / "footprints.sqlite"
            backup = root_dir / "data" / "footprints.sqlite.backup"
            database.parent.mkdir(parents=True)
            connection = create_repair_database(database)
            current_timestamp = local_timestamp("2026-06-12T00:05:00+08:00")
            connection.close()
            stdout = StringIO()

            with redirect_stdout(stdout):
                exit_code = module.main(
                    ["--database", str(database), "--backup", str(backup)],
                    root_dir=root_dir,
                )

            with closing(sqlite3.connect(backup)) as backup_connection:
                backup_integrity = backup_connection.execute(
                    "PRAGMA integrity_check",
                ).fetchone()[0]
                backup_distance = float(
                    backup_connection.execute(
                        "SELECT distance FROM footprints WHERE timestamp_seconds = ?",
                        (current_timestamp,),
                    ).fetchone()[0],
                )
            with closing(sqlite3.connect(database)) as repaired_connection:
                repaired_integrity = repaired_connection.execute(
                    "PRAGMA integrity_check",
                ).fetchone()[0]
                repaired_distance = float(
                    repaired_connection.execute(
                        "SELECT distance FROM footprints WHERE timestamp_seconds = ?",
                        (current_timestamp,),
                    ).fetchone()[0],
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(backup_integrity, "ok")
        self.assertEqual(repaired_integrity, "ok")
        self.assertEqual(backup_distance, 0)
        self.assertGreater(repaired_distance, 111_000)
        output = stdout.getvalue()
        self.assertIn(str(backup), output)
        self.assertIn("scanned: 5", output)
        self.assertIn("candidates: 2", output)
        self.assertIn("updated: 1", output)

    def test_cli_does_not_write_when_backup_path_exists(self):
        module = importlib.import_module("scripts.repair_daily_first_distances")
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            database = root_dir / "data" / "footprints.sqlite"
            backup = root_dir / "data" / "existing.backup"
            database.parent.mkdir(parents=True)
            connection = create_repair_database(database)
            before = tuple(connection.iterdump())
            connection.close()
            backup.write_bytes(b"preserve-me")

            with self.assertRaises(FileExistsError):
                module.main(
                    ["--database", str(database), "--backup", str(backup)],
                    root_dir=root_dir,
                )

            with closing(sqlite3.connect(database)) as check_connection:
                after = tuple(check_connection.iterdump())
            backup_content = backup.read_bytes()

        self.assertEqual(before, after)
        self.assertEqual(backup_content, b"preserve-me")

    def test_cli_does_not_write_when_backup_verification_fails(self):
        module = importlib.import_module("scripts.repair_daily_first_distances")
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            database = root_dir / "data" / "footprints.sqlite"
            backup = root_dir / "data" / "footprints.sqlite.backup"
            database.parent.mkdir(parents=True)
            connection = create_repair_database(database)
            before = tuple(connection.iterdump())
            connection.close()

            with patch.object(
                module,
                "require_integrity",
                side_effect=RuntimeError("backup integrity failed"),
            ), self.assertRaisesRegex(RuntimeError, "backup integrity failed"):
                module.main(
                    ["--database", str(database), "--backup", str(backup)],
                    root_dir=root_dir,
                )

            with closing(sqlite3.connect(database)) as check_connection:
                after = tuple(check_connection.iterdump())

        self.assertEqual(before, after)

    def test_package_exposes_daily_first_distance_repair_command(self):
        package = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))

        self.assertEqual(
            package["scripts"]["repair:daily-first-distances"],
            "python scripts/repair_daily_first_distances.py",
        )

    def test_visual_tile_snapshot_distinguishes_null_from_empty_blob(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            connection = create_repair_database(
                Path(temporary_directory) / "footprints.sqlite",
            )
            try:
                connection.execute("UPDATE visual_tiles SET cells = NULL")
                null_snapshot = snapshot_protected_tables(connection)
                connection.execute("UPDATE visual_tiles SET cells = X''")
                empty_snapshot = snapshot_protected_tables(connection)
            finally:
                connection.close()

        self.assertNotEqual(
            null_snapshot.visual_tile_sha256,
            empty_snapshot.visual_tile_sha256,
        )

    def test_repair_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            connection = create_repair_database(
                Path(temporary_directory) / "footprints.sqlite",
            )
            try:
                with connection:
                    first_result = repair_daily_first_distances(connection)
                first_dump = tuple(connection.iterdump())

                with connection:
                    second_result = repair_daily_first_distances(connection)
                second_dump = tuple(connection.iterdump())
            finally:
                connection.close()

        self.assertEqual(first_result.updated_count, 1)
        self.assertEqual(second_result.updated_count, 0)
        self.assertEqual(second_result.added_distance_meters, 0)
        self.assertEqual(first_dump, second_dump)

    def test_summary_failure_rolls_back_fact_update(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            connection = create_repair_database(
                Path(temporary_directory) / "footprints.sqlite",
            )
            try:
                before = tuple(connection.iterdump())

                with patch(
                    "enroute_api.footprints.distance_repair.replace_admin_region_daily_stats",
                    side_effect=RuntimeError("summary failed"),
                ), self.assertRaisesRegex(RuntimeError, "summary failed"):
                    with connection:
                        repair_daily_first_distances(connection)

                after = tuple(connection.iterdump())
            finally:
                connection.close()

        self.assertEqual(before, after)


def local_timestamp(value: str) -> int:
    return int(datetime.fromisoformat(value).astimezone(timezone.utc).timestamp())


def create_repair_database(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    for region_id, level, parent_id in (
        ("country-a", 1, None),
        ("province-a", 2, "country-a"),
        ("city-a", 3, "province-a"),
        ("district-a", 4, "city-a"),
    ):
        connection.execute(
            """
            INSERT INTO admin_regions (
              id, name, level, geometry, source_geometry, source_coordinate_system,
              min_lng, max_lng, min_lat, max_lat,
              first_seen_timestamp, footprint_count, stay_duration_seconds,
              travel_distance_meters
            ) VALUES (?, ?, ?, ?, ?, 'wgs84', 0, 2, 0, 2, NULL, 0, 0, 0)
            """,
            (
                region_id,
                region_id,
                level,
                '{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}',
                '{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}',
            ),
        )
        if parent_id is not None:
            connection.execute(
                "INSERT INTO admin_region_tree (parent_id, child_id) VALUES (?, ?)",
                (parent_id, region_id),
            )

    rows = [
        ("2026-06-11T23:50:00+08:00", 0.0, 0.0, 10.0),
        ("2026-06-12T00:05:00+08:00", 1.0, 0.0, 0.0),
        ("2026-06-12T01:00:00+08:00", 2.0, 0.0, 0.0),
        ("2026-06-12T23:50:00+08:00", 1.0, 1.0, 5.0),
        ("2026-06-13T00:05:00+08:00", 1.0, 1.0, 0.0),
    ]
    for value, longitude, latitude, distance in rows:
        timestamp_seconds = local_timestamp(value)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed,
              distance, heading, altitude, region_id
            ) VALUES (?, ?, ?, 5, -1, ?, 0, 0, 'district-a')
            """,
            (timestamp_seconds, longitude, latitude, distance),
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (timestamp_seconds, longitude, longitude, latitude, latitude),
        )
    connection.execute(
        """
        INSERT INTO visual_tiles (
          z, x, y, t_type, t, status, cells, raw_count,
          representative_count, updated_at
        ) VALUES (1, 1, 0, 0, 0, 1, X'010203', 5, 3, 123)
        """,
    )
    connection.executemany(
        "INSERT INTO footprint_meta (key, value) VALUES (?, ?)",
        (
            ("sourceSignature", "footprints-v1"),
            ("adminRegionSourceSignature", "regions-v1"),
            ("rowCount", "5"),
        ),
    )
    connection.commit()
    return connection


if __name__ == "__main__":
    unittest.main()
