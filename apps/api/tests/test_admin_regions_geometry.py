from enroute_api.admin_regions.geometry import (
    calculate_geometry_bbox,
    geometry_contains_point,
)


DONUT = {
    "type": "Polygon",
    "coordinates": [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
    ],
}

MULTIPOLYGON = {
    "type": "MultiPolygon",
    "coordinates": [
        [
            [[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]],
        ],
        [
            [[30, 30], [32, 30], [32, 32], [30, 32], [30, 30]],
        ],
    ],
}


def test_polygon_contains_exterior_but_excludes_hole():
    assert geometry_contains_point(DONUT, longitude=2, latitude=2)
    assert not geometry_contains_point(DONUT, longitude=5, latitude=5)
    assert not geometry_contains_point(DONUT, longitude=12, latitude=5)


def test_multipolygon_contains_any_member_polygon():
    assert geometry_contains_point(MULTIPOLYGON, longitude=21, latitude=21)
    assert geometry_contains_point(MULTIPOLYGON, longitude=31, latitude=31)
    assert not geometry_contains_point(MULTIPOLYGON, longitude=25, latitude=25)


def test_bbox_includes_all_polygon_and_multipolygon_rings():
    assert calculate_geometry_bbox(DONUT) == {
        "min_lng": 0,
        "max_lng": 10,
        "min_lat": 0,
        "max_lat": 10,
    }
    assert calculate_geometry_bbox(MULTIPOLYGON) == {
        "min_lng": 20,
        "max_lng": 32,
        "min_lat": 20,
        "max_lat": 32,
    }
