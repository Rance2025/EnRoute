from __future__ import annotations

import importlib
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT_DIR = Path(__file__).resolve().parents[1]
API_SRC_DIR = ROOT_DIR / "apps" / "api" / "src"
if str(API_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(API_SRC_DIR))


class PrepareAdminRegionSummaryTests(unittest.TestCase):
    def test_cli_builds_summary_precompute_for_explicit_database(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            database = root_dir / "data" / "footprints.sqlite"
            database.parent.mkdir(parents=True)
            sqlite3.connect(database).close()
            stdout = StringIO()

            with patch(
                "enroute_api.admin_regions.precompute.build_admin_region_summary_precompute",
                return_value=SimpleNamespace(
                    thumbnail_base_count=2,
                    thumbnail_region_path_count=3851,
                    daily_stat_count=1047,
                    unresolved_footprint_count=23,
                ),
            ) as build, redirect_stdout(stdout):
                exit_code = module.main(
                    ["--database", str(database)],
                    root_dir=root_dir,
                )

            self.assertEqual(exit_code, 0)
            build.assert_called_once()
            self.assertIn("2 thumbnail bases", stdout.getvalue())
            self.assertIn("3851 region paths", stdout.getvalue())
            self.assertIn("1047 daily stats", stdout.getvalue())
            self.assertIn("23 unresolved footprints", stdout.getvalue())
            connection = sqlite3.connect(database)
            try:
                tables = {
                    str(row[0])
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'",
                    )
                }
            finally:
                connection.close()
            self.assertIn("admin_region_thumbnail_bases", tables)

    def test_cli_rejects_missing_database_without_creating_it(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            database = root_dir / "data" / "missing.sqlite"

            with self.assertRaises(FileNotFoundError):
                module.main(["--database", str(database)], root_dir=root_dir)

            self.assertFalse(database.exists())

    def test_package_exposes_explicit_admin_region_summary_command(self):
        package = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))

        self.assertIn("prepare:admin-region-summary", package["scripts"])
        self.assertEqual(
            package["scripts"]["prepare:admin-region-summary"],
            "python scripts/prepare_admin_region_summary.py",
        )

    def load_module(self):
        try:
            return importlib.import_module("scripts.prepare_admin_region_summary")
        except ModuleNotFoundError:
            self.fail("scripts.prepare_admin_region_summary is missing")


if __name__ == "__main__":
    unittest.main()
