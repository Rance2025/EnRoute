from __future__ import annotations

import tomllib
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]


def test_api_declares_tzdata_as_a_runtime_dependency() -> None:
    project = tomllib.loads(
        (ROOT_DIR / "apps" / "api" / "pyproject.toml").read_text(encoding="utf-8"),
    )

    assert "tzdata>=2025.2" in project["project"]["dependencies"]
