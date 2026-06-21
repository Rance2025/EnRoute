from __future__ import annotations

from typing import Any, Iterable, TypedDict


class BoundingBox(TypedDict):
    min_lng: float
    max_lng: float
    min_lat: float
    max_lat: float


LngLat = list[float]
LinearRing = list[LngLat]
PolygonCoordinates = list[LinearRing]
MultiPolygonCoordinates = list[PolygonCoordinates]


def geometry_contains_point(geometry: dict[str, Any], *, longitude: float, latitude: float) -> bool:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Polygon" and isinstance(coordinates, list):
        return polygon_contains_point(coordinates, longitude=longitude, latitude=latitude)
    if geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        return any(
            polygon_contains_point(polygon, longitude=longitude, latitude=latitude)
            for polygon in coordinates
        )
    return False


def polygon_contains_point(
    polygon: PolygonCoordinates,
    *,
    longitude: float,
    latitude: float,
) -> bool:
    if not polygon:
        return False

    exterior, *holes = polygon
    if not ring_contains_point(exterior, longitude=longitude, latitude=latitude):
        return False

    return not any(
        ring_contains_point(hole, longitude=longitude, latitude=latitude)
        for hole in holes
    )


def ring_contains_point(ring: LinearRing, *, longitude: float, latitude: float) -> bool:
    inside = False
    if len(ring) < 4:
        return False

    previous_lng, previous_lat = ring[-1]
    for current_lng, current_lat in ring:
        intersects = (current_lat > latitude) != (previous_lat > latitude)
        if intersects:
            x_at_latitude = (
                (previous_lng - current_lng)
                * (latitude - current_lat)
                / (previous_lat - current_lat)
                + current_lng
            )
            if longitude < x_at_latitude:
                inside = not inside
        previous_lng, previous_lat = current_lng, current_lat

    return inside


def calculate_geometry_bbox(geometry: dict[str, Any]) -> BoundingBox:
    coordinates = list(iter_geometry_positions(geometry))
    if not coordinates:
        raise ValueError("Geometry contains no coordinates")

    longitudes = [point[0] for point in coordinates]
    latitudes = [point[1] for point in coordinates]

    return {
        "min_lng": min(longitudes),
        "max_lng": max(longitudes),
        "min_lat": min(latitudes),
        "max_lat": max(latitudes),
    }


def iter_geometry_positions(geometry: dict[str, Any]) -> Iterable[LngLat]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Polygon" and isinstance(coordinates, list):
        yield from iter_polygon_positions(coordinates)
    elif geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        for polygon in coordinates:
            yield from iter_polygon_positions(polygon)


def iter_polygon_positions(polygon: PolygonCoordinates) -> Iterable[LngLat]:
    for ring in polygon:
        for position in ring:
            if len(position) >= 2:
                yield [float(position[0]), float(position[1])]
