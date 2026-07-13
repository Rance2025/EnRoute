import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from enroute_api.config import Settings
from enroute_api.footprints.store import ensure_imported, initialize_schema
from enroute_api.footprints.visual_tiles import (
    STATUS_DIRTY,
    STATUS_READY,
    VISUAL_TILE_ALGORITHM_SIGNATURE,
    VISUAL_TILE_ALGORITHM_SIGNATURE_KEY,
)
from enroute_api.main import create_app
from enroute_api.footprints.csv_loader import load_footprint_payload


CSV = "\n".join(
    [
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
        "1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956",
    ],
)

SNAPSHOT_CSV = "\n".join(
    [
        "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
        "1781798400,1,121.511383,31.296564,0.000000,5.729415,-1.000000,100.000000,1,0,10.146956",
        "1781840000,1,121.511384,31.296565,0.000000,4.729415,-1.000000,250.000000,1,0,10.146956",
        "1781840100,1,118.000000,30.000000,0.000000,6.729415,-1.000000,50.000000,1,0,10.146956",
        "1781884800,1,121.511385,31.296566,0.000000,5.729415,-1.000000,999.000000,1,0,10.146956",
    ],
)


def expected_quarter_hour_buckets(
    date_key: str,
    distance_by_bucket: dict[int, float],
) -> list[dict[str, object]]:
    buckets: list[dict[str, object]] = []
    for bucket_index in range(96):
        hour, quarter = divmod(bucket_index, 4)
        label = f"{hour:02d}:{quarter * 15:02d}"
        buckets.append(
            {
                "key": f"{date_key}T{label}",
                "label": label,
                "distanceMeters": distance_by_bucket.get(bucket_index, 0),
            },
        )
    return buckets


def test_defaults_to_data_directory_for_footprint_database():
    settings = Settings()

    assert settings.footprint_db_path == Path("data/footprints.sqlite")


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


def test_loads_footprint_points_from_configured_csv_path(tmp_path: Path):
    data_path = write_csv(tmp_path, CSV)

    payload = load_footprint_payload(data_path=data_path, coordinate_system="gcj02")

    assert payload == {
        "points": [
            {
                "timestampSeconds": 1768144456,
                "longitude": 121.511383,
                "latitude": 31.296564,
                "accuracy": 5.729415,
                "speed": -1,
                "distance": 0,
                "heading": 0,
                "altitude": 10.146956,
            },
        ],
    }


def test_skips_rows_with_invalid_numeric_fields(tmp_path: Path):
    data_path = write_csv(
        tmp_path,
        "\n".join(
            [
                "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
                "1768144456,1,121.511383,31.296564,0.000000,,not-a-number,0.000000,1,0,10.146956",
                "1768144457,1,121.511384,31.296565,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956",
            ],
        ),
    )

    payload = load_footprint_payload(data_path=data_path, coordinate_system="gcj02")

    assert payload["points"] == [
        {
            "timestampSeconds": 1768144457,
            "longitude": 121.511384,
            "latitude": 31.296565,
            "accuracy": 5.729415,
            "speed": -1,
            "distance": 0,
            "heading": 0,
            "altitude": 10.146956,
        },
    ]


def test_serves_get_footprints_as_json(tmp_path: Path):
    data_path = write_csv(tmp_path, CSV)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.get("/api/footprints")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["points"] == [
        {
            "timestampSeconds": 1768144456,
            "longitude": 121.511383,
            "latitude": 31.296564,
            "accuracy": 5.729415,
            "speed": -1,
            "distance": 0,
            "heading": 0,
            "altitude": 10.146956,
            "regionId": None,
        },
    ]


def test_get_footprints_imports_and_serves_from_sqlite(tmp_path: Path):
    data_path = write_csv(tmp_path, CSV)
    db_path = tmp_path / "footprints.sqlite"
    client = create_test_client(data_path=data_path, db_path=db_path)

    response = client.get("/api/footprints")

    assert response.status_code == 200
    connection = sqlite3.connect(db_path)
    try:
        stored_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()
        spatial_count = connection.execute("SELECT COUNT(*) FROM footprint_spatial").fetchone()
    finally:
        connection.close()

    assert stored_count == (1,)
    assert spatial_count == (1,)


def test_missing_csv_does_not_accept_legacy_database_without_import_signature(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (1768144456, 121.511383, 31.296564, 5, 0, 0, 0, 0)
            """,
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (1768144456, 121.511383, 121.511383, 31.296564, 31.296564)
            """,
        )
        connection.commit()

        with pytest.raises(FileNotFoundError):
            ensure_imported(
                connection,
                data_path=tmp_path / "missing.csv",
                coordinate_system="wgs84",
                admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
            )
        assert connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0] == 1


def test_initialize_schema_rejects_legacy_footprints_shape_without_dropping_rows(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE footprints (
              timestamp_seconds INTEGER PRIMARY KEY,
              longitude REAL NOT NULL,
              latitude REAL NOT NULL
            )
            """,
        )
        connection.execute(
            """
            INSERT INTO footprints (timestamp_seconds, longitude, latitude)
            VALUES (1, 122, 32)
            """,
        )
        connection.commit()

        with pytest.raises(RuntimeError, match="legacy footprints schema"):
            initialize_schema(connection)

        row_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()

    assert row_count == (1,)


def test_import_preserves_existing_rows_and_visual_tiles_when_signature_is_missing(tmp_path: Path):
    db_path = tmp_path / "footprints.sqlite"
    data_path = write_csv(tmp_path, CSV)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        initialize_schema(connection)
        connection.execute(
            """
            INSERT INTO footprints (
              timestamp_seconds, longitude, latitude, accuracy, speed, distance, heading, altitude
            ) VALUES (1, 122, 32, 5, 0, 0, 0, 0)
            """,
        )
        connection.execute(
            """
            INSERT INTO footprint_spatial (
              footprint_rowid, min_lng, max_lng, min_lat, max_lat
            ) VALUES (1, 122, 122, 32, 32)
            """,
        )
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 0, 0, 0, 1, X'455654430100000000', 1000)
            """,
        )
        connection.commit()

        result = ensure_imported(
            connection,
            data_path=data_path,
            coordinate_system="wgs84",
            admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
        )
        rows = [
            tuple(row)
            for row in connection.execute(
                "SELECT timestamp_seconds, longitude, latitude FROM footprints ORDER BY timestamp_seconds",
            ).fetchall()
        ]
        visual_tile_count = tuple(connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone())
        compatibility_signature = connection.execute(
            "SELECT value FROM footprint_meta WHERE key = 'importCompatibilitySignature'",
        ).fetchone()

    assert result["new_count"] == 1
    assert rows == [
        (1, 122.0, 32.0),
        (1768144456, 121.511383, 31.296564),
    ]
    assert visual_tile_count == (1,)
    assert compatibility_signature is not None


def test_import_preserves_visual_tiles_when_algorithm_signature_is_stale(tmp_path: Path):
    data_path = write_csv(tmp_path, CSV)
    db_path = tmp_path / "footprints.sqlite"
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        initialize_schema(connection)

        ensure_imported(
            connection,
            data_path=data_path,
            coordinate_system="wgs84",
            admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
        )
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 0, 0, 0, 1, X'455654430100000000', 1000)
            """,
        )
        connection.execute(
            "UPDATE footprint_meta SET value = ? WHERE key = ?",
            ("old-grid", VISUAL_TILE_ALGORITHM_SIGNATURE_KEY),
        )
        connection.commit()

        result = ensure_imported(
            connection,
            data_path=data_path,
            coordinate_system="wgs84",
            admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
        )
        visual_tile_count = tuple(connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone())
        visual_tile_signature = tuple(
            connection.execute(
                "SELECT value FROM footprint_meta WHERE key = ?",
                (VISUAL_TILE_ALGORITHM_SIGNATURE_KEY,),
            ).fetchone(),
        )

    assert result["new_count"] == 0
    assert visual_tile_count == (1,)
    assert visual_tile_signature == (VISUAL_TILE_ALGORITHM_SIGNATURE,)


def test_coordinate_system_change_does_not_clear_visual_tiles_on_request_path(tmp_path: Path):
    data_path = write_csv(tmp_path, CSV)
    db_path = tmp_path / "footprints.sqlite"
    client = create_test_client(data_path=data_path, db_path=db_path)

    response = client.get("/api/footprints")
    assert response.status_code == 200

    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (1, 1, 0, 0, 0, 1, X'455654430100000000', 1000)
            """,
        )
        connection.commit()
    finally:
        connection.close()

    client = create_test_client(
        data_path=data_path,
        db_path=db_path,
        coordinate_system="gcj02",
    )

    response = client.get("/api/footprints")

    assert response.status_code == 200
    connection = sqlite3.connect(db_path)
    try:
        footprint_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()
        visual_tile_count = connection.execute("SELECT COUNT(*) FROM visual_tiles").fetchone()
    finally:
        connection.close()
    assert footprint_count == (1,)
    assert visual_tile_count == (1,)


def test_footprint_runtime_reads_existing_rows_when_csv_changes(tmp_path: Path):
    first_csv = CSV
    appended_csv = "\n".join(
        [
            CSV,
            "1768144457,1,121.511384,31.296565,0.000000,4.729415,-1.000000,12.500000,1,0,10.146956",
        ],
    )
    data_path = write_csv(tmp_path, first_csv)
    db_path = tmp_path / "footprints.sqlite"
    client = create_test_client(data_path=data_path, db_path=db_path)
    assert client.get("/api/footprints").status_code == 200

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (16, 54888, 26764, 0, 0, ?, X'455654430100000000', 1000)
            """,
            (STATUS_READY,),
        )
        connection.execute(
            """
            INSERT INTO visual_tiles (z, x, y, t_type, t, status, cells, updated_at)
            VALUES (16, 54888, 26764, 3, 20260111, ?, X'455654430100000000', 1000)
            """,
            (STATUS_READY,),
        )
        connection.commit()

    data_path.write_text(appended_csv, encoding="utf-8")
    client = create_test_client(data_path=data_path, db_path=db_path)

    response = client.get("/api/footprints")

    assert response.status_code == 200
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT t_type, t, status
            FROM visual_tiles
            WHERE z = 16 AND x = 54888 AND y = 26764
            ORDER BY t_type, t
            """,
        ).fetchall()
        footprint_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()[0]
    assert rows == [(0, 0, STATUS_READY), (3, 20260111, STATUS_READY)]
    assert footprint_count == 1


def test_serves_footprint_metrics_without_raw_points_for_date_range(tmp_path: Path):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.get("/api/footprints/metrics?start=2026-06-19&end=2026-06-19")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "selectedCount": 3,
        "totalDistanceMeters": 400,
        "averageDistanceMetersPerDay": 400,
        "distanceSeries": {
            "granularity": "quarter-hour",
            "unit": "quarter-hour",
            "buckets": expected_quarter_hour_buckets(
                "2026-06-19",
                {0: 100, 46: 300},
            ),
        },
        "selectedBounds": {
            "southWest": [118.0, 30.0],
            "northEast": [121.511384, 31.296565],
        },
    }
    assert "points" not in payload
    assert "debug" not in payload


def test_assigns_exact_quarter_hour_boundary_to_the_next_bucket(tmp_path: Path):
    boundary_csv = "\n".join(
        [
            "dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude",
            "1781799299,1,121.5,31.2,0,5,0,10,1,0,0",
            "1781799300,1,121.5,31.2,0,5,0,20,1,0,0",
        ],
    )
    data_path = write_csv(tmp_path, boundary_csv)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.get("/api/footprints/metrics?start=2026-06-19&end=2026-06-19")

    assert response.status_code == 200
    series = response.json()["distanceSeries"]
    assert len(series["buckets"]) == 96
    assert series["buckets"][:2] == [
        {"key": "2026-06-19T00:00", "label": "00:00", "distanceMeters": 10},
        {"key": "2026-06-19T00:15", "label": "00:15", "distanceMeters": 20},
    ]
    assert series["buckets"][-1] == {
        "key": "2026-06-19T23:45",
        "label": "23:45",
        "distanceMeters": 0,
    }


def test_serves_daily_distance_series_for_multi_day_metrics(tmp_path: Path):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.get("/api/footprints/metrics?start=2026-06-18&end=2026-06-19")

    assert response.status_code == 200
    assert response.json()["distanceSeries"] == {
        "granularity": "day",
        "unit": "day",
        "buckets": [
            {
                "key": "2026-06-18",
                "label": "6月18日",
                "distanceMeters": 0,
            },
            {
                "key": "2026-06-19",
                "label": "6月19日",
                "distanceMeters": 400,
            },
        ],
    }


def test_averages_current_date_range_metrics_only_through_today(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")
    monkeypatch.setattr(
        "enroute_api.footprints.store.time.time",
        lambda: 1781886000,
    )

    response = client.get("/api/footprints/metrics?start=2026-06-01&end=2026-06-30")

    assert response.status_code == 200
    payload = response.json()
    assert payload["totalDistanceMeters"] == 1399
    assert payload["averageDistanceMetersPerDay"] == pytest.approx(69.95)


def test_serves_footprint_metrics_for_all_range_without_raw_points(tmp_path: Path):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.get("/api/footprints/metrics?range=all")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "selectedCount": 4,
        "totalDistanceMeters": 1399,
        "averageDistanceMetersPerDay": 699.5,
        "distanceSeries": {
            "granularity": "day",
            "unit": "day",
            "buckets": [
                {
                    "key": "2026-06-19",
                    "label": "6月19日",
                    "distanceMeters": 400,
                },
                {
                    "key": "2026-06-20",
                    "label": "6月20日",
                    "distanceMeters": 999,
                },
            ],
        },
        "selectedBounds": {
            "southWest": [118.0, 30.0],
            "northEast": [121.511385, 31.296566],
        },
    }
    assert "points" not in payload
    assert "debug" not in payload


def test_serves_snapshot_from_database_backed_viewport_query(tmp_path: Path):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.post(
        "/api/footprints/snapshot",
        json={
            "timeRange": {
                "startTimestampSeconds": 1781798400,
                "endTimestampSeconds": 1781884799,
                "dayCount": 1,
            },
            "zoom": 16,
            "cellSizePx": 8,
            "viewportBounds": {"west": 121, "south": 31, "east": 122, "north": 32},
            "viewportNorthWestWorldPixel": {"x": 0, "y": 0},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["points"] == [
        {
            "id": payload["points"][0]["id"],
            "longitude": payload["points"][0]["longitude"],
            "latitude": payload["points"][0]["latitude"],
            "count": 2,
            "minAccuracy": 4.729415,
            "startTimestampSeconds": 1781798400,
            "endTimestampSeconds": 1781840000,
        },
    ]
    assert payload["points"][0]["id"]
    assert payload["points"][0]["longitude"] == 121.51138350000002
    assert payload["points"][0]["latitude"] == 31.296564500000002
    assert payload | {"points": []} == {
        "points": [],
        "metrics": {
            "selectedCount": 3,
            "totalDistanceMeters": 400,
            "averageDistanceMetersPerDay": 400,
            "distanceSeries": {
                "granularity": "quarter-hour",
                "unit": "quarter-hour",
                "buckets": expected_quarter_hour_buckets(
                    "2026-06-19",
                    {0: 100, 46: 300},
                ),
            },
        },
        "selectedBounds": {
            "southWest": [118, 30],
            "northEast": [121.511384, 31.296565],
        },
        "debug": {
            "rawCount": 2,
            "renderedCount": 1,
            "renderRatio": 0.5,
        },
    }


def test_imports_footprints_into_sqlite_rtree_viewport_index(tmp_path: Path):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    db_path = tmp_path / "footprints.sqlite"
    client = create_test_client(data_path=data_path, db_path=db_path)

    response = client.post(
        "/api/footprints/snapshot",
        json={
            "timeRange": {
                "startTimestampSeconds": 1781798400,
                "endTimestampSeconds": 1781884799,
                "dayCount": 1,
            },
            "zoom": 16,
            "cellSizePx": 0.5,
            "viewportBounds": {"west": 121, "south": 31, "east": 122, "north": 32},
            "viewportNorthWestWorldPixel": {"x": 0, "y": 0},
        },
    )

    assert response.status_code == 200
    connection = sqlite3.connect(db_path)
    try:
        table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'footprint_spatial'",
        ).fetchone()
        spatial_count = connection.execute("SELECT COUNT(*) FROM footprint_spatial").fetchone()
    finally:
        connection.close()

    assert table == ("footprint_spatial",)
    assert spatial_count == (4,)


def test_serves_snapshot_from_existing_database_when_source_csv_was_removed(tmp_path: Path):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    db_path = tmp_path / "footprints.sqlite"
    client = create_test_client(data_path=data_path, db_path=db_path)

    first_response = client.post(
        "/api/footprints/snapshot",
        json={
            "timeRange": {
                "startTimestampSeconds": 1781798400,
                "endTimestampSeconds": 1781884799,
                "dayCount": 1,
            },
            "zoom": 16,
            "cellSizePx": 0.5,
            "viewportBounds": {"west": 121, "south": 31, "east": 122, "north": 32},
            "viewportNorthWestWorldPixel": {"x": 0, "y": 0},
        },
    )
    assert first_response.status_code == 200

    data_path.unlink()

    second_response = client.post(
        "/api/footprints/snapshot",
        json={
            "timeRange": {
                "startTimestampSeconds": 1781798400,
                "endTimestampSeconds": 1781884799,
                "dayCount": 1,
            },
            "zoom": 16,
            "cellSizePx": 0.5,
            "viewportBounds": {"west": 121, "south": 31, "east": 122, "north": 32},
            "viewportNorthWestWorldPixel": {"x": 0, "y": 0},
        },
    )

    assert second_response.status_code == 200
    assert second_response.json()["metrics"]["selectedCount"] == 3
    connection = sqlite3.connect(db_path)
    try:
        stored_count = connection.execute("SELECT COUNT(*) FROM footprints").fetchone()
        spatial_count = connection.execute("SELECT COUNT(*) FROM footprint_spatial").fetchone()
    finally:
        connection.close()

    assert stored_count == (4,)
    assert spatial_count == (4,)


def test_snapshot_import_streams_csv_without_reading_entire_file(tmp_path: Path, monkeypatch):
    data_path = write_csv(tmp_path, SNAPSHOT_CSV)
    original_read_text = Path.read_text

    def fail_if_snapshot_import_reads_entire_file(self: Path, *args, **kwargs):
        if self == data_path:
            raise AssertionError("snapshot import must stream the CSV into SQLite")
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", fail_if_snapshot_import_reads_entire_file)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.post(
        "/api/footprints/snapshot",
        json={
            "timeRange": {
                "startTimestampSeconds": 1781798400,
                "endTimestampSeconds": 1781884799,
                "dayCount": 1,
            },
            "zoom": 16,
            "cellSizePx": 0.5,
            "viewportBounds": {"west": 121, "south": 31, "east": 122, "north": 32},
            "viewportNorthWestWorldPixel": {"x": 0, "y": 0},
        },
    )

    assert response.status_code == 200
    assert response.json()["metrics"]["selectedCount"] == 3


def test_unknown_routes_return_404(tmp_path: Path):
    data_path = write_csv(tmp_path, CSV)
    client = create_test_client(data_path=data_path, db_path=tmp_path / "footprints.sqlite")

    response = client.get("/api/unknown")

    assert response.status_code == 404


def write_csv(tmp_path: Path, content: str) -> Path:
    data_path = tmp_path / "backUpData-all.csv"
    data_path.write_text(content, encoding="utf-8")
    return data_path


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
