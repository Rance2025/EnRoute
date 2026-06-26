# Footprint Visual Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace viewport snapshot rendering with WGS-84 raw footprint storage, precomputed visual cell tiles, and real-time MVT output for Mapbox.

**Architecture:** Keep raw footprints as the only source of truth in SQLite with WGS-84 coordinates and RTree spatial lookup. Add one `visual_tiles` SQLite table keyed by `z/x/y/t_type/t` that combines task status and binary visual cell records. Store only keys that contain footprint data; missing `z/x/y/t_type/t` rows mean empty. Serve Mapbox vector tiles by reading ready/dirty cells, OR-ing by `cell_id`, and encoding MVT on demand.

**Tech Stack:** Python 3.12, FastAPI, SQLite/RTree, pytest, TypeScript/React/Mapbox GL JS, Vitest.

---

## Non-Negotiable Constraints

- Rebuild raw footprint storage from `external/backUpData-all.csv`; treat that file as WGS-84.
- Store raw footprint coordinates as WGS-84 in `data/footprints.sqlite`; do not convert footprint storage to GCJ-02.
- Keep map camera and tile pyramid capped at zoom 18.
- Store visual tile rows only for `z/x/y/t_type/t` combinations that contain at least one visual cell.
- Treat a missing `visual_tiles` row as empty; never insert empty BLOB rows, `empty` status rows, or count=0 rows.
- Use `dirty` only on an existing row with old `cells`; mark it with `UPDATE`, not with a second row or an insert placeholder.
- If a key has no row yet, the background builder may compute it, but `visual_tiles` receives an inserted row only after cells exist and the row can be `ready`.
- Keep `algo_version` out of the primary key for this phase.
- Do not persist MVT in this phase; encode MVT from `cells` on request.
- Do not send count to the frontend for footprint visual cells; existence is a 0/1 value.

## Files

- Modify: `apps/api/src/enroute_api/footprints/coordinates.py`
  - Preserve WGS-84 as canonical footprint storage for Mapbox.
- Modify: `apps/api/src/enroute_api/footprints/store.py`
  - Add visual tile schema hooks and keep raw footprint import WGS-84.
- Create: `apps/api/src/enroute_api/footprints/visual_tile_codec.py`
  - Encode/decode the fixed-width `cells` BLOB format.
- Create: `apps/api/src/enroute_api/footprints/visual_tiles.py`
  - Build visual cells for one `z/x/y/t_type/t`; split custom ranges into buckets; query ready/dirty cells; mark existing rows dirty without creating empty dirty placeholders.
- Create: `apps/api/src/enroute_api/map_tiles/mvt.py`
  - Encode footprint point features into MVT.
- Modify: `apps/api/pyproject.toml`
  - Add `mapbox-vector-tile>=2.1,<3` for server-side vector tile encoding.
- Modify: `apps/api/src/enroute_api/main.py`
  - Add `/api/map/tiles/footprints/{z}/{x}/{y}.mvt`.
- Create: `apps/web/src/layers/footprintVectorTileSource.ts`
  - Build the Mapbox vector tile source URL capped at zoom 18.
- Modify: `scripts/import_footprints.py`
  - Support explicit rebuild from WGS-84 source and report canonical coordinate mode.
- Create: `scripts/rebuild_footprints_wgs84.py`
  - Delete/recreate `data/footprints.sqlite` from `external/backUpData-all.csv` as WGS-84.
- Modify: `README.md`
  - Replace current GCJ-02 storage statement with WGS-84 canonical storage and visual tile preparation notes.
- Modify: `.env.example`
  - Keep `FOOTPRINT_COORDINATE_SYSTEM=wgs84` and update the footprint API URL once the Mapbox MVT endpoint exists.
- Test: `apps/api/tests/test_footprints_api.py`
- Test: `apps/api/tests/test_visual_tile_codec.py`
- Test: `apps/api/tests/test_visual_tiles.py`
- Test: `apps/web/src/layers/footprintVectorTileSource.test.ts`
- Test: `tests/test_import_footprints.py`

## Task 1: Lock WGS-84 Canonical Import

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/coordinates.py`
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Test: `apps/api/tests/test_footprints_api.py`

- [ ] **Step 1: Write a failing WGS-84 storage test**

Add imports if this test file does not already have them:

```python
import pytest
```

Add a test that imports a China coordinate and asserts SQLite stores the original WGS-84 value, not a GCJ-02 shifted value:

```python
def test_import_stores_wgs84_coordinates_without_gcj02_shift(tmp_path: Path):
    data_path = tmp_path / "footprints.csv"
    data_path.write_text(
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,0,121.473700,31.230400,0,5,0,0,0,0,3",
            ],
        ),
        encoding="utf-8",
    )
    db_path = tmp_path / "footprints.sqlite"
    client = create_test_client(
        data_path=data_path,
        db_path=db_path,
    )

    response = client.get("/api/footprints")

    assert response.status_code == 200
    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT longitude, latitude FROM footprints WHERE timestamp_seconds IS NOT NULL",
        ).fetchone()
    assert row == pytest.approx((121.473700, 31.230400))
```

- [ ] **Step 1b: Make the test helper accept coordinate system**

Update the existing helper in `apps/api/tests/test_footprints_api.py` before running the new test:

```python
def create_test_client(
    *,
    data_path: Path,
    db_path: Path,
    coordinate_system: str = "wgs84",
) -> TestClient:
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system=coordinate_system,
        admin_region_data_path=db_path.parent / "missing-admin-regions.geojson",
    )
    return TestClient(create_app(settings=settings))
```

For existing tests that intentionally exercise legacy GCJ-02 input, pass `coordinate_system="gcj02"` to `create_test_client`. Tests that assert default behavior should use the new default `wgs84`.

- [ ] **Step 2: Run the failing test**

Run:

```powershell
python -m pytest apps/api/tests/test_footprints_api.py::test_import_stores_wgs84_coordinates_without_gcj02_shift -q
```

Expected: FAIL because current `transform_footprint_coordinate()` shifts WGS-84 China coordinates to GCJ-02.

- [ ] **Step 3: Change coordinate canonical behavior**

Update `transform_footprint_coordinate()` so footprint imports store WGS-84 unchanged. Region matching must read the stored WGS-84 footprint and perform any coordinate-system adaptation in the region matcher, not in the raw footprint import path.

```python
def transform_footprint_coordinate(
    *,
    longitude: float,
    latitude: float,
    source_coordinate_system: str = "wgs84",
) -> tuple[float, float]:
    return longitude, latitude
```

Remove tests that assert raw footprint rows are stored as GCJ-02. Replace them with tests that assert region matching still works from WGS-84 raw rows.

- [ ] **Step 4: Run focused API tests**

Run:

```powershell
python -m pytest apps/api/tests/test_footprints_api.py apps/api/tests/test_admin_regions_import.py -q
```

Expected: PASS with raw footprint storage remaining WGS-84 and admin-region matching covered separately.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/footprints/coordinates.py apps/api/src/enroute_api/footprints/store.py apps/api/tests/test_footprints_api.py apps/api/tests/test_admin_regions_import.py
git commit -m "feat: 统一足迹原始库为WGS84坐标"
```

## Task 2: Add Full WGS-84 Rebuild Script

**Files:**
- Create: `scripts/rebuild_footprints_wgs84.py`
- Modify: `tests/test_import_footprints.py`

- [ ] **Step 1: Write a failing repo test for rebuild behavior**

Add a unittest that creates an old database, runs the rebuild script against a temp CSV, and verifies the database was recreated from WGS-84 source.

```python
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
                    "2026-06-23 12:00:00,0,121.473700,31.230400,0,5,0,0,0,0,3",
                ],
            ),
            encoding="utf-8",
        )
        database = root_dir / "data" / "footprints.sqlite"
        sqlite3.connect(database).execute("CREATE TABLE stale(value TEXT)").connection.close()

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
        with sqlite3.connect(database) as connection:
            row = connection.execute("SELECT longitude, latitude FROM footprints").fetchone()
        self.assertEqual(row, (121.4737, 31.2304))
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
python -m unittest tests.test_import_footprints -v
```

Expected: FAIL because `scripts/rebuild_footprints_wgs84.py` does not exist.

- [ ] **Step 3: Implement the rebuild script**

Create `scripts/rebuild_footprints_wgs84.py`:

```python
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

from import_footprints import main as import_main


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    database = args.database
    if database.exists():
        database.unlink()
    return import_main(
        [
            "--source",
            str(args.source),
            "--database",
            str(database),
            "--coordinate-system",
            "wgs84",
        ],
    )


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild the local footprints SQLite database from WGS-84 source CSV.",
    )
    parser.add_argument("--source", type=Path, default=Path("external/backUpData-all.csv"))
    parser.add_argument("--database", type=Path, default=Path("data/footprints.sqlite"))
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the test**

Run:

```powershell
python -m unittest tests.test_import_footprints -v
```

Expected: PASS.

- [ ] **Step 5: Run the local full rebuild against real source**

Run from repo root:

```powershell
python scripts/rebuild_footprints_wgs84.py --source external\backUpData-all.csv --database data\footprints.sqlite
```

Expected: command reports all rows imported. Do not commit `data\footprints.sqlite`.

- [ ] **Step 6: Verify row count and WGS-84 sample**

Run:

```powershell
@'
import csv
import sqlite3
from pathlib import Path

source = Path("external/backUpData-all.csv")
database = Path("data/footprints.sqlite")
with source.open("r", encoding="utf-8-sig", newline="") as source_file:
    first = next(csv.DictReader(source_file))
with sqlite3.connect(database) as connection:
    count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0]
    spatial = connection.execute("SELECT COUNT(*) FROM footprint_spatial").fetchone()[0]
    row = connection.execute(
        "SELECT longitude, latitude FROM footprints ORDER BY timestamp_seconds LIMIT 1",
    ).fetchone()
print({"footprints": count, "spatial": spatial, "first_csv": (first["longitude"], first["latitude"]), "first_db": row})
'@ | python -
```

Expected: `footprints == spatial`; first DB coordinate equals the corresponding CSV coordinate after numeric parsing.

- [ ] **Step 7: Commit**

```powershell
git add scripts/rebuild_footprints_wgs84.py tests/test_import_footprints.py
git commit -m "chore: 增加WGS84足迹库重建脚本"
```

## Task 3: Add visual_tiles Schema

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/store.py`
- Test: `apps/api/tests/test_visual_tiles.py`

- [ ] **Step 1: Write failing schema test**

Create `apps/api/tests/test_visual_tiles.py`:

```python
from __future__ import annotations

import sqlite3

from enroute_api.footprints.store import initialize_schema


def column_names(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info({table_name})")]


def test_initializes_visual_tiles_table(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)
        assert column_names(connection, "visual_tiles") == [
            "z",
            "x",
            "y",
            "t_type",
            "t",
            "status",
            "cells",
            "updated_at",
        ]
        indexes = list(connection.execute("PRAGMA index_list(visual_tiles)"))
        assert indexes
    finally:
        connection.close()
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py::test_initializes_visual_tiles_table -q
```

Expected: FAIL because `visual_tiles` does not exist.

- [ ] **Step 3: Add schema**

In `initialize_schema()` add:

```sql
CREATE TABLE IF NOT EXISTS visual_tiles (
  z INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  t_type INTEGER NOT NULL,
  t INTEGER NOT NULL,
  status INTEGER NOT NULL,
  cells BLOB,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (z, x, y, t_type, t)
) WITHOUT ROWID;
```

- [ ] **Step 4: Run focused schema test**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/footprints/store.py apps/api/tests/test_visual_tiles.py
git commit -m "feat: 增加足迹视觉瓦片表"
```

## Task 4: Implement Binary Visual Cell Codec

**Files:**
- Create: `apps/api/src/enroute_api/footprints/visual_tile_codec.py`
- Test: `apps/api/tests/test_visual_tile_codec.py`

- [ ] **Step 1: Write codec tests**

Create `apps/api/tests/test_visual_tile_codec.py`:

```python
from __future__ import annotations

import pytest

from enroute_api.footprints.visual_tile_codec import (
    VisualCellRecord,
    decode_visual_cells,
    encode_visual_cells,
)


def test_round_trips_visual_cell_records():
    records = [
        VisualCellRecord(cell_id=1, footprint_id=1000, geom_x=20, geom_y=30),
        VisualCellRecord(cell_id=2, footprint_id=1005, geom_x=21, geom_y=31),
    ]

    encoded = encode_visual_cells(records)

    assert decode_visual_cells(encoded) == records


def test_rejects_invalid_magic():
    with pytest.raises(ValueError, match="Invalid visual cell blob"):
        decode_visual_cells(b"BAD!")
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tile_codec.py -q
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement codec**

Create `visual_tile_codec.py`:

```python
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterable

MAGIC = b"EVTC"
VERSION = 1
HEADER_STRUCT = struct.Struct("<4sBI")
RECORD_STRUCT = struct.Struct("<IqHH")


@dataclass(frozen=True)
class VisualCellRecord:
    cell_id: int
    footprint_id: int
    geom_x: int
    geom_y: int


def encode_visual_cells(records: Iterable[VisualCellRecord]) -> bytes:
    ordered_records = list(records)
    payload = bytearray(HEADER_STRUCT.pack(MAGIC, VERSION, len(ordered_records)))
    for record in ordered_records:
        payload.extend(
            RECORD_STRUCT.pack(
                record.cell_id,
                record.footprint_id,
                record.geom_x,
                record.geom_y,
            ),
        )
    return bytes(payload)


def decode_visual_cells(blob: bytes) -> list[VisualCellRecord]:
    if len(blob) < HEADER_STRUCT.size:
        raise ValueError("Invalid visual cell blob")
    magic, version, count = HEADER_STRUCT.unpack_from(blob, 0)
    if magic != MAGIC or version != VERSION:
        raise ValueError("Invalid visual cell blob")
    expected_size = HEADER_STRUCT.size + count * RECORD_STRUCT.size
    if len(blob) != expected_size:
        raise ValueError("Invalid visual cell blob")
    offset = HEADER_STRUCT.size
    records: list[VisualCellRecord] = []
    for _ in range(count):
        cell_id, footprint_id, geom_x, geom_y = RECORD_STRUCT.unpack_from(blob, offset)
        records.append(
            VisualCellRecord(
                cell_id=cell_id,
                footprint_id=footprint_id,
                geom_x=geom_x,
                geom_y=geom_y,
            ),
        )
        offset += RECORD_STRUCT.size
    return records
```

- [ ] **Step 4: Run codec tests**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tile_codec.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/footprints/visual_tile_codec.py apps/api/tests/test_visual_tile_codec.py
git commit -m "feat: 增加视觉瓦片二进制编码"
```

## Task 5: Build Visual Cells for One Tile Bucket

**Files:**
- Create: `apps/api/src/enroute_api/footprints/visual_tiles.py`
- Test: `apps/api/tests/test_visual_tiles.py`

- [ ] **Step 1: Add failing builder test**

Extend `test_visual_tiles.py`:

```python
from enroute_api.footprints.visual_tile_codec import decode_visual_cells
from enroute_api.footprints.visual_tiles import (
    TIME_BUCKET_DAY,
    build_visual_tile,
)


def test_builds_first_timestamp_representative_per_cell(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        rows = [
            (100, 0.0, 0.0),
            (101, 0.000001, 0.000001),
            (102, 1.0, 1.0),
        ]
        for timestamp, longitude, latitude in rows:
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

        build_visual_tile(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=TIME_BUCKET_DAY,
            t=19700101,
            start_timestamp_seconds=0,
            end_timestamp_seconds=200,
            updated_at=1234,
        )

        row = connection.execute(
            "SELECT status, cells, updated_at FROM visual_tiles WHERE z = 1 AND x = 1 AND y = 0",
        ).fetchone()
        assert row["status"] == 1
        assert row["updated_at"] == 1234
        records = decode_visual_cells(row["cells"])
        assert records
        assert records[0].footprint_id == 100
    finally:
        connection.close()


def test_empty_visual_tile_deletes_existing_row_instead_of_storing_empty_blob(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 0, 3, 19700101, 1, X'455654430100000000', 1000)
            """,
        )

        build_visual_tile(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=TIME_BUCKET_DAY,
            t=19700101,
            start_timestamp_seconds=0,
            end_timestamp_seconds=200,
            updated_at=1234,
        )

        row = connection.execute(
            """
            SELECT 1 FROM visual_tiles
            WHERE z = 1 AND x = 1 AND y = 0 AND t_type = 3 AND t = 19700101
            """,
        ).fetchone()
        assert row is None
    finally:
        connection.close()
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py::test_builds_first_timestamp_representative_per_cell apps/api/tests/test_visual_tiles.py::test_empty_visual_tile_deletes_existing_row_instead_of_storing_empty_blob -q
```

Expected: FAIL because `visual_tiles.py` does not exist.

- [ ] **Step 3: Implement tile bbox/projection and builder**

Create `visual_tiles.py` with constants, WebMercator projection, tile bbox, and `build_visual_tile`. The query must use RTree, filter time, and order by timestamp:

```python
cursor = connection.execute(
    """
    SELECT f.timestamp_seconds, f.longitude, f.latitude
    FROM footprint_spatial s
    JOIN footprints f ON f.timestamp_seconds = s.footprint_rowid
    WHERE s.min_lng <= :east
      AND s.max_lng >= :west
      AND s.min_lat <= :north
      AND s.max_lat >= :south
      AND f.timestamp_seconds >= :start
      AND f.timestamp_seconds < :end
    ORDER BY f.timestamp_seconds ASC
    """,
    {
        "west": west,
        "south": south,
        "east": east,
        "north": north,
        "start": start_timestamp_seconds,
        "end": end_timestamp_seconds,
    },
)
```

For each row, project to tile extent, calculate `cell_id`, and only keep the first record for each `cell_id`. If no records remain, delete any stale row for the key instead of storing an empty tile. Do not insert rows with empty `cells`.

- [ ] **Step 4: Run visual tile tests**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py apps/api/tests/test_visual_tile_codec.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/footprints/visual_tiles.py apps/api/tests/test_visual_tiles.py
git commit -m "feat: 构建足迹视觉瓦片"
```

## Task 5b: Mark Existing Visual Tiles Dirty Without Placeholder Rows

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/visual_tiles.py`
- Test: `apps/api/tests/test_visual_tiles.py`

- [ ] **Step 1: Add dirty-state tests**

Extend `test_visual_tiles.py`:

```python
from enroute_api.footprints.visual_tiles import (
    STATUS_DIRTY,
    STATUS_READY,
    mark_visual_tile_dirty,
)


def test_marks_existing_visual_tile_dirty_on_same_row(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 0, 3, 19700101, ?, X'455654430100000000', 1000)
            """,
            (STATUS_READY,),
        )

        mark_visual_tile_dirty(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=3,
            t=19700101,
            updated_at=2000,
        )

        rows = list(
            connection.execute(
                """
                SELECT status, cells, updated_at FROM visual_tiles
                WHERE z = 1 AND x = 1 AND y = 0 AND t_type = 3 AND t = 19700101
                """,
            ),
        )
        assert len(rows) == 1
        assert rows[0]["status"] == STATUS_DIRTY
        assert rows[0]["cells"] == bytes.fromhex("455654430100000000")
        assert rows[0]["updated_at"] == 2000
    finally:
        connection.close()


def test_mark_dirty_does_not_create_missing_visual_tile_row(tmp_path):
    connection = sqlite3.connect(tmp_path / "footprints.sqlite")
    try:
        initialize_schema(connection)

        mark_visual_tile_dirty(
            connection,
            z=1,
            x=1,
            y=0,
            t_type=3,
            t=19700101,
            updated_at=2000,
        )

        count = connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
        assert count == 0
    finally:
        connection.close()
```

- [ ] **Step 2: Run failing dirty-state tests**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py::test_marks_existing_visual_tile_dirty_on_same_row apps/api/tests/test_visual_tiles.py::test_mark_dirty_does_not_create_missing_visual_tile_row -q
```

Expected: FAIL because `mark_visual_tile_dirty()` and status constants do not exist.

- [ ] **Step 3: Implement dirty update semantics**

Add constants and implement `mark_visual_tile_dirty` as an update-only operation:

```python
STATUS_READY = 1
STATUS_DIRTY = 2


def mark_visual_tile_dirty(
    connection: sqlite3.Connection,
    *,
    z: int,
    x: int,
    y: int,
    t_type: int,
    t: int,
    updated_at: int,
) -> None:
    connection.execute(
        """
        UPDATE visual_tiles
        SET status = ?, updated_at = ?
        WHERE z = ? AND x = ? AND y = ? AND t_type = ? AND t = ?
        """,
        (STATUS_DIRTY, updated_at, z, x, y, t_type, t),
    )
```

Do not use `INSERT` or `INSERT OR REPLACE` in `mark_visual_tile_dirty`.

- [ ] **Step 4: Run dirty-state tests**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py::test_marks_existing_visual_tile_dirty_on_same_row apps/api/tests/test_visual_tiles.py::test_mark_dirty_does_not_create_missing_visual_tile_row -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/footprints/visual_tiles.py apps/api/tests/test_visual_tiles.py
git commit -m "feat: 标记足迹视觉瓦片脏状态"
```

## Task 6: Split Time Ranges into all/year/month/day Buckets

**Files:**
- Modify: `apps/api/src/enroute_api/footprints/visual_tiles.py`
- Test: `apps/api/tests/test_visual_tiles.py`

- [ ] **Step 1: Add bucket split tests**

Add:

```python
from enroute_api.footprints.visual_tiles import split_time_range_into_buckets


def test_splits_custom_range_into_year_month_day_buckets():
    buckets = split_time_range_into_buckets("2024-02-10", "2026-03-09")

    assert ("year", 2025) in buckets
    assert ("month", 202403) in buckets
    assert ("month", 202602) in buckets
    assert ("day", 20240210) in buckets
    assert ("day", 20260309) in buckets
```

- [ ] **Step 2: Run failing bucket test**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py::test_splits_custom_range_into_year_month_day_buckets -q
```

Expected: FAIL because splitter is missing.

- [ ] **Step 3: Implement splitter**

Implement `split_time_range_into_buckets(start_date: str, end_date: str)` using `datetime.date`. It should greedily emit whole years, then whole months, then day buckets for leftovers. Keep output deterministic sorted by date.

- [ ] **Step 4: Run tests**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/footprints/visual_tiles.py apps/api/tests/test_visual_tiles.py
git commit -m "feat: 拆分足迹瓦片时间桶"
```

## Task 7: Add Footprint MVT Endpoint

**Files:**
- Create: `apps/api/src/enroute_api/map_tiles/mvt.py`
- Modify: `apps/api/src/enroute_api/main.py`
- Modify: `apps/api/pyproject.toml`
- Test: `apps/api/tests/test_visual_tiles.py`

- [ ] **Step 1: Add failing endpoint test**

Add a test that inserts a ready visual tile row and fetches the MVT endpoint:

```python
from fastapi.testclient import TestClient

from enroute_api.config import Settings
from enroute_api.footprints.store import FootprintStore
from enroute_api.footprints.visual_tile_codec import (
    VisualCellRecord,
    encode_visual_cells,
)
from enroute_api.main import create_app


def test_serves_footprint_mvt_from_ready_visual_tile(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    store = FootprintStore(
        db_path=db_path,
        data_path=tmp_path / "missing.csv",
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        blob = encode_visual_cells([
            VisualCellRecord(cell_id=1, footprint_id=100, geom_x=2048, geom_y=2048),
        ])
        store.connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 1, 0, 0, 1, ?, 1234)
            """,
            (blob,),
        )
        store.connection.commit()
        client = TestClient(
            create_app(
                settings=Settings(
                    footprint_db_path=db_path,
                    footprint_data_path=tmp_path / "missing.csv",
                    footprint_coordinate_system="wgs84",
                    admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
                ),
            ),
        )

        response = client.get("/api/map/tiles/footprints/1/1/1.mvt?range=all")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.mapbox-vector-tile"
        assert response.content
    finally:
        store.close()


def test_missing_visual_tile_row_means_empty_without_creating_row(tmp_path):
    db_path = tmp_path / "footprints.sqlite"
    store = FootprintStore(
        db_path=db_path,
        data_path=tmp_path / "missing.csv",
        coordinate_system="wgs84",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    try:
        client = TestClient(
            create_app(
                settings=Settings(
                    footprint_db_path=db_path,
                    footprint_data_path=tmp_path / "missing.csv",
                    footprint_coordinate_system="wgs84",
                    admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
                ),
            ),
        )

        response = client.get("/api/map/tiles/footprints/1/1/1.mvt?range=all")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.mapbox-vector-tile"
        assert response.content == b""
        count = store.connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()[0]
        assert count == 0
    finally:
        store.close()
```

- [ ] **Step 2: Run failing endpoint test**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py::test_serves_footprint_mvt_from_ready_visual_tile apps/api/tests/test_visual_tiles.py::test_missing_visual_tile_row_means_empty_without_creating_row -q
```

Expected: FAIL because endpoint is missing.

- [ ] **Step 3: Implement MVT encoder and route**

Add this dependency to `apps/api/pyproject.toml`:

```toml
dependencies = [
  "fastapi>=0.115,<1",
  "mapbox-vector-tile>=2.1,<3",
  "pydantic>=2.10,<3",
  "uvicorn[standard]>=0.34,<1",
]
```

Implement `apps/api/src/enroute_api/map_tiles/mvt.py` with `mapbox_vector_tile.encode`. The route must:

```text
1. Read visual_tiles rows for z/x/y and requested buckets.
2. Treat missing rows as empty.
3. If status dirty, use existing cells and enqueue a rebuild before returning the response.
4. OR records by cell_id.
5. Encode one point feature per retained record.
```

Set response header:

```text
Content-Type: application/vnd.mapbox-vector-tile
```

- [ ] **Step 4: Run endpoint tests**

Run:

```powershell
python -m pytest apps/api/tests/test_visual_tiles.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/enroute_api/map_tiles apps/api/src/enroute_api/main.py apps/api/tests/test_visual_tiles.py apps/api/pyproject.toml
git commit -m "feat: 提供足迹MVT瓦片接口"
```

## Task 8: Frontend Mapbox Tile Source Switch

**Files:**
- Modify: `apps/web/src/layers/footprintDataSource.ts`
- Create: `apps/web/src/layers/footprintVectorTileSource.ts`
- Test: `apps/web/src/layers/footprintVectorTileSource.test.ts`
- Modify: `apps/web/src/components/AmapCanvas.tsx`

- [ ] **Step 1: Write frontend tests for tile URL construction**

Create `apps/web/src/layers/footprintVectorTileSource.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createFootprintVectorTileSource } from './footprintVectorTileSource'

describe('createFootprintVectorTileSource', () => {
  it('builds a Mapbox vector source capped at zoom 18', () => {
    const source = createFootprintVectorTileSource({
      start: '2024-02-10',
      end: '2026-03-09',
    })

    expect(source.type).toBe('vector')
    expect(source.maxzoom).toBe(18)
    expect(source.tiles).toEqual([
      '/api/map/tiles/footprints/{z}/{x}/{y}.mvt?start=2024-02-10&end=2026-03-09',
    ])
  })
})
```

- [ ] **Step 2: Run frontend test and verify fail**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/footprintVectorTileSource.test.ts
```

Expected: FAIL because `footprintVectorTileSource.ts` does not exist.

- [ ] **Step 3: Implement tile source configuration**

Create `apps/web/src/layers/footprintVectorTileSource.ts`:

```ts
export interface FootprintVectorTileRange {
  start: string
  end: string
}

export function createFootprintVectorTileSource(range: FootprintVectorTileRange) {
  const params = new URLSearchParams({
    start: range.start,
    end: range.end,
  })

  return {
    type: 'vector' as const,
    tiles: [`/api/map/tiles/footprints/{z}/{x}/{y}.mvt?${params.toString()}`],
    minzoom: 0,
    maxzoom: 18,
  }
}
```

In `apps/web/src/components/AmapCanvas.tsx`, or the renamed Mapbox canvas component if the Mapbox migration has already renamed this file before Task 8 starts, register this vector source and render ordinary point symbols/circles from the footprint MVT layer. The final Mapbox path must not call `/api/footprints/snapshot` and must not send raw point arrays to the browser for footprint rendering.

- [ ] **Step 4: Run focused web tests**

Run:

```powershell
npm --workspace apps/web run test -- --run src/layers/footprintVectorTileSource.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/layers apps/web/src/components
git commit -m "feat: 接入足迹MVT瓦片源"
```

## Task 9: Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-06-23-footprint-visual-tile-architecture-design.md`

- [ ] **Step 1: Update README storage truth**

Replace the current statement that footprint coordinates are stored as GCJ-02 with:

```text
Footprint coordinates are stored canonically as WGS-84. The source export at external/backUpData-all.csv is treated as WGS-84 and can be used to rebuild data/footprints.sqlite with python scripts/rebuild_footprints_wgs84.py.
```

- [ ] **Step 2: Document visual tile flow**

Add concise notes:

```text
The Mapbox footprint layer reads /api/map/tiles/footprints/{z}/{x}/{y}.mvt. Visual tile cells are precomputed per z/x/y/time bucket into the ignored SQLite database and MVT is encoded on request.
```

- [ ] **Step 3: Update `.env.example` footprint endpoint**

Replace:

```env
VITE_FOOTPRINT_API_URL=/api/footprints/snapshot
```

with:

```env
VITE_FOOTPRINT_TILE_URL=/api/map/tiles/footprints/{z}/{x}/{y}.mvt
```

- [ ] **Step 4: Run docs grep sanity**

Run:

```powershell
rg -n "GCJ-02|gcj02|WGS-84|wgs84|visual_tiles|footprint visual|VITE_FOOTPRINT" README.md docs .env.example
```

Expected: WGS-84 statements are consistent; any remaining GCJ-02 mentions are only for admin region or legacy explanation.

- [ ] **Step 5: Commit**

```powershell
git add README.md .env.example docs/superpowers/specs/2026-06-23-footprint-visual-tile-architecture-design.md
git commit -m "docs: 记录足迹视觉瓦片终态架构"
```

## Task 10: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run API tests**

Run:

```powershell
python scripts/run_api_tests.py
```

Expected: exit 0.

- [ ] **Step 2: Run repo tests**

Run:

```powershell
python scripts/run_repo_tests.py
```

Expected: exit 0.

- [ ] **Step 3: Run web tests**

Run:

```powershell
node scripts/run-web-tests.mjs
```

Expected: exit 0.

- [ ] **Step 4: Run lint and build**

Run:

```powershell
npm run lint
npm run build
```

Expected: both exit 0.

- [ ] **Step 5: Run visual tile smoke check against real WGS-84 database**

Run:

```powershell
python scripts/rebuild_footprints_wgs84.py --source external\backUpData-all.csv --database data\footprints.sqlite
python -m pytest apps/api/tests/test_visual_tiles.py -q
```

Expected: rebuild succeeds and visual tile tests pass.

- [ ] **Step 6: Browser verification**

Start local app:

```powershell
python start.py start
```

Open the map and verify:

```text
1. Browser network requests include /api/map/tiles/footprints/{z}/{x}/{y}.mvt.
2. The frontend does not request /api/footprints/snapshot for the Mapbox footprint layer.
3. Footprint points render as ordinary points, not heatmap or cluster bubbles.
4. Changing time range reloads tile URLs and does not fetch all raw points.
5. Panning loads new tile requests and unloads out-of-view tiles through Mapbox.
```

- [ ] **Step 7: Stop services**

Run:

```powershell
python start.py stop
```

Expected: services stop cleanly.

- [ ] **Step 8: Commit verification-only docs if changed**

Only commit if verification required doc adjustments:

```powershell
git status --short
git add <changed-docs>
git commit -m "docs: 补充足迹瓦片验证说明"
```
