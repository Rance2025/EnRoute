from __future__ import annotations

import unittest
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))


def main() -> int:
  suite = unittest.defaultTestLoader.discover(str(ROOT_DIR / "tests"))
  result = unittest.TextTestRunner(verbosity=2).run(suite)
  return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
  raise SystemExit(main())
