from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
API_SRC_DIR = ROOT_DIR / "apps" / "api" / "src"

sys.path.insert(0, str(API_SRC_DIR))


def main() -> int:
  return pytest.main([str(ROOT_DIR / "apps" / "api" / "tests")])


if __name__ == "__main__":
  raise SystemExit(main())
