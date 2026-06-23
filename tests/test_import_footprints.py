import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from scripts.import_footprints import main


CSV = "\n".join(
    [
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
        "1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956",
        "1768144457,1,121.511384,31.296565,0.000000,4.729415,-1.000000,12.500000,1,0,10.146956",
    ],
)


class ImportFootprintsTests(unittest.TestCase):
    def test_import_command_rebuilds_sqlite_database_from_csv(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            data_path = root_dir / "external" / "backUpData-all.csv"
            db_path = root_dir / "data" / "footprints.sqlite"
            data_path.parent.mkdir(parents=True)
            data_path.write_text(CSV, encoding="utf-8")

            stdout = StringIO()

            with redirect_stdout(stdout):
                exit_code = main(
                    [
                        "--source",
                        str(data_path),
                        "--database",
                        str(db_path),
                        "--coordinate-system",
                        "gcj02",
                    ],
                    root_dir=root_dir,
                )

            completed_output = stdout.getvalue()

            self.assertEqual(exit_code, 0)
            self.assertIn("Imported 2 new footprint rows", completed_output)
            self.assertIn("total rows: 2", completed_output)
            connection = sqlite3.connect(db_path)
            try:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM footprints").fetchone(), (2,))
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM footprint_spatial").fetchone(), (2,))
                self.assertEqual(
                    connection.execute(
                        "SELECT value FROM footprint_meta WHERE key = 'rowCount'",
                    ).fetchone(),
                    ("2",),
                )
            finally:
                connection.close()

    def test_rebuild_footprints_wgs84_recreates_database(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            (root_dir / "external").mkdir()
            (root_dir / "data").mkdir()
            source = root_dir / "external" / "backUpData-all.csv"
            source.write_text(
                "\n".join(
                    [
                        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                        "1768144456,0,121.473700,31.230400,0,5,0,0,0,0,3",
                    ],
                ),
                encoding="utf-8",
            )
            database = root_dir / "data" / "footprints.sqlite"
            connection = sqlite3.connect(database)
            try:
                connection.execute("CREATE TABLE stale(value TEXT)")
                connection.commit()
            finally:
                connection.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve().parents[1] / "scripts" / "rebuild_footprints_wgs84.py"),
                    "--source",
                    str(source),
                    "--database",
                    str(database),
                ],
                cwd=root_dir,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            connection = sqlite3.connect(database)
            try:
                row = connection.execute("SELECT longitude, latitude FROM footprints").fetchone()
                stale_table = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stale'",
                ).fetchone()
            finally:
                connection.close()
            self.assertEqual(row, (121.4737, 31.2304))
            self.assertIsNone(stale_table)

    def test_rebuild_footprints_wgs84_preserves_existing_database_when_source_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            (root_dir / "data").mkdir()
            source = root_dir / "external" / "missing.csv"
            database = root_dir / "data" / "footprints.sqlite"
            connection = sqlite3.connect(database)
            try:
                connection.execute("CREATE TABLE preserved(value TEXT)")
                connection.execute("INSERT INTO preserved(value) VALUES ('still-here')")
                connection.commit()
            finally:
                connection.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve().parents[1] / "scripts" / "rebuild_footprints_wgs84.py"),
                    "--source",
                    str(source),
                    "--database",
                    str(database),
                ],
                cwd=root_dir,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertNotEqual(completed.returncode, 0)
            connection = sqlite3.connect(database)
            try:
                row = connection.execute("SELECT value FROM preserved").fetchone()
            finally:
                connection.close()
            self.assertEqual(row, ("still-here",))

    def test_build_footprint_visual_tiles_cli_imports_raw_footprints_before_building(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            source = root_dir / "external" / "backUpData-all.csv"
            database = root_dir / "data" / "footprints.sqlite"
            source.parent.mkdir(parents=True)
            source.write_text(CSV, encoding="utf-8")

            completed = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve().parents[1] / "scripts" / "build_footprint_visual_tiles.py"),
                    "--database",
                    str(database),
                    "--min-zoom",
                    "18",
                    "--max-zoom",
                    "18",
                ],
                cwd=root_dir,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            connection = sqlite3.connect(database)
            try:
                footprint_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()
                visual_tile_count = connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()
            finally:
                connection.close()
            self.assertEqual(footprint_count, (2,))
            self.assertGreater(visual_tile_count[0], 0)

    def test_build_footprint_visual_tiles_cli_builds_all_time_buckets_by_default(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            database = root_dir / "data" / "footprints.sqlite"
            database.parent.mkdir(parents=True)
            connection = sqlite3.connect(database)
            try:
                sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api" / "src"))
                from enroute_api.footprints.store import initialize_schema

                initialize_schema(connection)
                for timestamp, longitude, latitude in [
                    (1768144456, -100.0, 10.0),
                    (1768144457, 100.0, -10.0),
                ]:
                    connection.execute(
                        """
                        INSERT INTO footprints (
                          timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
                        ) VALUES (?, ?, ?, 5, 0, 0, 0, 0)
                        """,
                        (timestamp, longitude, latitude),
                    )
                    connection.execute(
                        """
                        INSERT INTO footprint_spatial (
                          footprint_rowid, min_lng, max_lng, min_lat, max_lat
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (timestamp, longitude, longitude, latitude, latitude),
                    )
                connection.commit()
            finally:
                connection.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve().parents[1] / "scripts" / "build_footprint_visual_tiles.py"),
                    "--database",
                    str(database),
                    "--min-zoom",
                    "1",
                    "--max-zoom",
                    "1",
                ],
                cwd=root_dir,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("bucket all,day,month,year", completed.stdout)
            connection = sqlite3.connect(database)
            try:
                rows = connection.execute(
                    """
                    SELECT t_type, t, COUNT(*)
                    FROM visual_tiles
                    GROUP BY t_type, t
                    ORDER BY t_type, t
                    """,
                ).fetchall()
            finally:
                connection.close()
            self.assertEqual(
                rows,
                [
                    (0, 0, 2),
                    (1, 2026, 2),
                    (2, 202601, 2),
                    (3, 20260111, 2),
                ],
            )


if __name__ == "__main__":
    unittest.main()
