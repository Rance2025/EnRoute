from __future__ import annotations

import math

EARTH_SEMI_MAJOR_AXIS = 6378245.0
EARTH_ECCENTRICITY_SQUARED = 0.006693421622965943


def parse_coordinate_system(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"gcj02", "none"}:
        return normalized
    return "wgs84"


def transform_footprint_coordinate(
    *,
    longitude: float,
    latitude: float,
    source_coordinate_system: str = "wgs84",
) -> tuple[float, float]:
    del source_coordinate_system
    return longitude, latitude


def transform_wgs84_to_gcj02_coordinate(
    *,
    longitude: float,
    latitude: float,
) -> tuple[float, float]:
    if is_outside_china(longitude, latitude):
        return longitude, latitude

    delta_longitude, delta_latitude = calculate_wgs84_to_gcj02_offset(longitude, latitude)
    return longitude + delta_longitude, latitude + delta_latitude


def transform_gcj02_to_wgs84_coordinate(
    *,
    longitude: float,
    latitude: float,
) -> tuple[float, float]:
    if is_outside_china(longitude, latitude):
        return longitude, latitude

    wgs_longitude = longitude
    wgs_latitude = latitude
    for _ in range(3):
        projected_longitude, projected_latitude = transform_wgs84_to_gcj02_coordinate(
            longitude=wgs_longitude,
            latitude=wgs_latitude,
        )
        wgs_longitude -= projected_longitude - longitude
        wgs_latitude -= projected_latitude - latitude
    return wgs_longitude, wgs_latitude


def is_outside_china(longitude: float, latitude: float) -> bool:
    return longitude < 72.004 or longitude > 137.8347 or latitude < 0.8293 or latitude > 55.8271


def calculate_wgs84_to_gcj02_offset(longitude: float, latitude: float) -> tuple[float, float]:
    adjusted_longitude = longitude - 105.0
    adjusted_latitude = latitude - 35.0
    delta_latitude = transform_latitude(adjusted_longitude, adjusted_latitude)
    delta_longitude = transform_longitude(adjusted_longitude, adjusted_latitude)
    radian_latitude = latitude / 180.0 * math.pi
    magic = math.sin(radian_latitude)
    magic = 1 - EARTH_ECCENTRICITY_SQUARED * magic * magic
    sqrt_magic = math.sqrt(magic)
    delta_latitude = (
        delta_latitude
        * 180.0
        / (
            (
                EARTH_SEMI_MAJOR_AXIS
                * (1 - EARTH_ECCENTRICITY_SQUARED)
                / (magic * sqrt_magic)
            )
            * math.pi
        )
    )
    delta_longitude = (
        delta_longitude
        * 180.0
        / ((EARTH_SEMI_MAJOR_AXIS / sqrt_magic) * math.cos(radian_latitude) * math.pi)
    )
    return delta_longitude, delta_latitude


def transform_latitude(x: float, y: float) -> float:
    result = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    result += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    result += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    result += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return result


def transform_longitude(x: float, y: float) -> float:
    result = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    result += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    result += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    result += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return result
