from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

EARTH_MEAN_RADIUS_METERS = 6_371_008.8
SHANGHAI_TIME_ZONE = ZoneInfo("Asia/Shanghai")


@dataclass(frozen=True)
class FootprintDistancePoint:
    timestamp_seconds: int
    longitude: float
    latitude: float
    distance: float


def normalize_daily_first_distance(
    *,
    previous: FootprintDistancePoint | None,
    current: FootprintDistancePoint,
) -> float:
    validate_point(current)
    if previous is None:
        return current.distance

    validate_point(previous)
    if previous.timestamp_seconds >= current.timestamp_seconds:
        raise ValueError("previous footprint timestamp must be earlier than current timestamp")
    if current.distance != 0:
        return current.distance
    if shanghai_date(previous.timestamp_seconds) == shanghai_date(current.timestamp_seconds):
        return current.distance
    return haversine_distance_meters(previous, current)


def shanghai_date(timestamp_seconds: int) -> date:
    return (
        datetime.fromtimestamp(timestamp_seconds, tz=timezone.utc)
        .astimezone(SHANGHAI_TIME_ZONE)
        .date()
    )


def haversine_distance_meters(
    previous: FootprintDistancePoint,
    current: FootprintDistancePoint,
) -> float:
    previous_latitude = math.radians(previous.latitude)
    current_latitude = math.radians(current.latitude)
    latitude_delta = current_latitude - previous_latitude
    longitude_delta = math.radians(current.longitude - previous.longitude)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(previous_latitude)
        * math.cos(current_latitude)
        * math.sin(longitude_delta / 2) ** 2
    )
    return EARTH_MEAN_RADIUS_METERS * 2 * math.asin(math.sqrt(haversine))


def validate_point(point: FootprintDistancePoint) -> None:
    values = (point.longitude, point.latitude, point.distance)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("footprint coordinates and distance must be finite")
    if not -180 <= point.longitude <= 180 or not -90 <= point.latitude <= 90:
        raise ValueError("footprint coordinates are outside valid bounds")
    if point.distance < 0:
        raise ValueError("footprint distance must be non-negative")
