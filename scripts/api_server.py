from __future__ import annotations

import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
API_SRC_DIR = ROOT_DIR / "apps" / "api" / "src"

sys.path.insert(0, str(API_SRC_DIR))

from enroute_api.__main__ import main


if __name__ == "__main__":
  main()
