import sqlite3
import tempfile
import unittest
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

            self.assertEqual(exit_code, 0)
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


if __name__ == "__main__":
    unittest.main()
