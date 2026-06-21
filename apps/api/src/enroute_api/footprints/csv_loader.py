from __future__ import annotations

import csv
from itertools import chain
from pathlib import Path
from typing import Any, Iterable, Iterator

from .coordinates import parse_coordinate_system, transform_footprint_coordinate

REQUIRED_COLUMNS = [
    "dataTime",
    "locType",
    "longitude",
    "latitude",
    "heading",
    "accuracy",
    "speed",
    "distance",
    "isBackForeground",
    "stepType",
    "altitude",
]


def load_footprint_payload(
    *,
    data_path: str | Path,
    coordinate_system: str = "wgs84",
) -> dict[str, list[dict[str, Any]]]:
    return {
        "points": parse_footprint_csv(
            Path(data_path).read_text(encoding="utf-8-sig"),
            parse_coordinate_system(coordinate_system),
        ),
    }


def iter_footprint_points(
    *,
    data_path: str | Path,
    coordinate_system: str = "wgs84",
) -> Iterator[dict[str, Any]]:
    source_coordinate_system = parse_coordinate_system(coordinate_system)
    with Path(data_path).open("r", encoding="utf-8-sig", newline="") as csv_file:
        yield from iter_footprint_csv(csv_file, source_coordinate_system)


def parse_footprint_csv(csv_text: str, source_coordinate_system: str) -> list[dict[str, Any]]:
    return list(iter_footprint_csv(csv_text.splitlines(), source_coordinate_system))


def iter_footprint_csv(
    lines: Iterable[str],
    source_coordinate_system: str,
) -> Iterator[dict[str, Any]]:
    line_iterator = iter(lines)
    try:
        first_line = next(line_iterator)
    except StopIteration:
        return

    reader = csv.DictReader(chain([first_line], line_iterator))
    missing_columns = [column for column in REQUIRED_COLUMNS if column not in (reader.fieldnames or [])]
    if missing_columns:
        raise ValueError(f"Missing footprint CSV column: {missing_columns[0]}")

    for row_index, row in enumerate(reader):
        point = parse_footprint_row(row, row_index, source_coordinate_system)
        if point is not None:
            yield point


def parse_footprint_row(
    row: dict[str, str],
    row_index: int,
    source_coordinate_system: str,
) -> dict[str, Any] | None:
    try:
        longitude = float(row["longitude"])
        latitude = float(row["latitude"])
        timestamp_seconds = float(row["dataTime"])
        numeric_fields = {
            "accuracy": float(row["accuracy"]),
            "speed": float(row["speed"]),
            "distance": float(row["distance"]),
            "heading": float(row["heading"]),
            "altitude": float(row["altitude"]),
        }
    except (TypeError, ValueError):
        return None

    if longitude < -180 or longitude > 180:
        return None
    if latitude < -90 or latitude > 90:
        return None
    if timestamp_seconds <= 0:
        return None

    transformed_longitude, transformed_latitude = transform_footprint_coordinate(
        longitude=longitude,
        latitude=latitude,
        source_coordinate_system=source_coordinate_system,
    )
    truncated_timestamp = int(timestamp_seconds)

    return {
        "timestampSeconds": truncated_timestamp,
        "longitude": transformed_longitude,
        "latitude": transformed_latitude,
        **numeric_fields,
    }
