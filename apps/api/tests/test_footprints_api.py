import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from enroute_api.config import Settings
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


def test_loads_footprint_points_from_configured_csv_path(tmp_path: Path):
    data_path = write_csv(tmp_path, CSV)

    payload = load_footprint_payload(data_path=data_path, coordinate_system="gcj02")

    assert payload == {
        "points": [
            {
                "id": "1768144456-0",
                "timestampSeconds": 1768144456,
                "longitude": 121.511383,
                "latitude": 31.296564,
                "accuracy": 5.729415,
                "speed": -1,
                "distance": 0,
                "heading": 0,
                "altitude": 10.146956,
                "locType": 1,
                "isBackForeground": 1,
                "stepType": 0,
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
            "id": "1768144457-1",
            "timestampSeconds": 1768144457,
            "longitude": 121.511384,
            "latitude": 31.296565,
            "accuracy": 5.729415,
            "speed": -1,
            "distance": 0,
            "heading": 0,
            "altitude": 10.146956,
            "locType": 1,
            "isBackForeground": 1,
            "stepType": 0,
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
            "id": "1768144456-0",
            "timestampSeconds": 1768144456,
            "longitude": 121.511383,
            "latitude": 31.296564,
            "accuracy": 5.729415,
            "speed": -1,
            "distance": 0,
            "heading": 0,
            "altitude": 10.146956,
            "locType": 1,
            "isBackForeground": 1,
            "stepType": 0,
        },
    ]


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


def create_test_client(*, data_path: Path, db_path: Path) -> TestClient:
    settings = Settings(
        footprint_data_path=data_path,
        footprint_db_path=db_path,
        footprint_coordinate_system="gcj02",
    )
    return TestClient(create_app(settings=settings))
