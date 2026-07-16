from datetime import datetime, timezone

import pytest

from enroute_api.footprints.distance import (
    FootprintDistancePoint,
    normalize_daily_first_distance,
)


def timestamp(value: str) -> int:
    return int(datetime.fromisoformat(value).astimezone(timezone.utc).timestamp())


def point(
    *,
    value: str,
    longitude: float,
    latitude: float,
    distance: float,
) -> FootprintDistancePoint:
    return FootprintDistancePoint(
        timestamp_seconds=timestamp(value),
        longitude=longitude,
        latitude=latitude,
        distance=distance,
    )


def test_normalizes_zero_distance_across_shanghai_days() -> None:
    previous = point(
        value="2026-06-11T23:56:24+08:00",
        longitude=119.414,
        latitude=32.198,
        distance=12,
    )
    current = point(
        value="2026-06-12T00:49:07+08:00",
        longitude=118.7969,
        latitude=32.0603,
        distance=0,
    )

    result = normalize_daily_first_distance(previous=previous, current=current)

    assert result == pytest.approx(60_000, rel=0.05)


@pytest.mark.parametrize(
    ("previous", "current", "expected"),
    [
        (
            None,
            point(
                value="2026-06-12T00:00:00+08:00",
                longitude=1,
                latitude=1,
                distance=0,
            ),
            0,
        ),
        (
            point(
                value="2026-06-12T00:00:00+08:00",
                longitude=1,
                latitude=1,
                distance=5,
            ),
            point(
                value="2026-06-12T01:00:00+08:00",
                longitude=2,
                latitude=2,
                distance=0,
            ),
            0,
        ),
        (
            point(
                value="2026-06-11T23:59:00+08:00",
                longitude=1,
                latitude=1,
                distance=5,
            ),
            point(
                value="2026-06-12T00:01:00+08:00",
                longitude=2,
                latitude=2,
                distance=123,
            ),
            123,
        ),
        (
            point(
                value="2026-06-11T23:59:00+08:00",
                longitude=1,
                latitude=1,
                distance=5,
            ),
            point(
                value="2026-06-12T00:01:00+08:00",
                longitude=1,
                latitude=1,
                distance=0,
            ),
            0,
        ),
    ],
)
def test_preserves_non_candidates(
    previous: FootprintDistancePoint | None,
    current: FootprintDistancePoint,
    expected: float,
) -> None:
    assert normalize_daily_first_distance(previous=previous, current=current) == expected


@pytest.mark.parametrize(
    "current",
    [
        point(
            value="2026-06-12T00:01:00+08:00",
            longitude=float("nan"),
            latitude=1,
            distance=0,
        ),
        point(
            value="2026-06-12T00:01:00+08:00",
            longitude=1,
            latitude=1,
            distance=-1,
        ),
    ],
)
def test_rejects_invalid_current_values(current: FootprintDistancePoint) -> None:
    with pytest.raises(ValueError):
        normalize_daily_first_distance(previous=None, current=current)


def test_rejects_previous_point_that_is_not_earlier() -> None:
    previous = point(
        value="2026-06-12T00:01:00+08:00",
        longitude=1,
        latitude=1,
        distance=5,
    )
    current = point(
        value="2026-06-12T00:01:00+08:00",
        longitude=2,
        latitude=2,
        distance=0,
    )

    with pytest.raises(ValueError, match="earlier"):
        normalize_daily_first_distance(previous=previous, current=current)
