from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]


def main() -> int:
  return subprocess.run(
    [sys.executable, "-m", "pip", "install", "-e", "apps/api[dev]"],
    cwd=ROOT_DIR,
    check=False,
  ).returncode


if __name__ == "__main__":
  raise SystemExit(main())
