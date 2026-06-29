from __future__ import annotations

import json
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, TypedDict

from .store import OSM_ADMIN_LEVEL_TO_ENROUTE_LEVEL, parse_osm_admin_level

ShanghaiPreviewSource = Literal["amap", "local", "osm"]
PreviewCoordinateSystem = Literal["gcj02", "wgs84"]

SHANGHAI_PROVINCE_ID = "310000"
SHANGHAI_CITY_ID = "310100"
LOCAL_LEVELS = {
    "province": 2,
    "city": 3,
    "district": 4,
}

class PreviewRegion(TypedDict):
    id: str
    name: str
    level: int
    geometry: dict[str, Any]


class ShanghaiPreviewResponse(TypedDict):
    source: ShanghaiPreviewSource
    level: int
    available: bool
    coordinateSystem: PreviewCoordinateSystem | None
    reason: str | None
    regions: list[PreviewRegion]


def get_shanghai_preview_regions(
    *,
    source: ShanghaiPreviewSource,
    level: int,
    admin_region_data_path: Path | None,
    db_path: Path | None = None,
) -> ShanghaiPreviewResponse:
    if source == "amap":
        return unavailable_preview(
            source=source,
            level=level,
            reason="高德源由浏览器内 DistrictSearch 实时查询。",
        )
    if source == "local":
        return get_local_shanghai_preview(
            level=level,
            admin_region_data_path=admin_region_data_path,
            db_path=db_path,
        )
    if source == "osm":
        return get_osm_shanghai_preview(level=level, admin_region_data_path=admin_region_data_path)

    raise ValueError("source must be one of amap, local, or osm")


def get_local_shanghai_preview(
    *,
    level: int,
    admin_region_data_path: Path | None,
    db_path: Path | None = None,
) -> ShanghaiPreviewResponse:
    if level == 5:
        return unavailable_preview(
            source="local",
            level=level,
            reason="本地 AreaCity 源只提供上海 level 2-4，level 5 请切换到 OSM 源。",
        )

    if level not in {2, 3, 4}:
        return unavailable_preview(
            source="local",
            level=level,
            reason="本地 AreaCity 源只提供上海 level 2-4。",
        )

    rows = load_cached_local_shanghai_regions(db_path, level=level)
    if rows:
        return available_preview(
            source="local",
            level=level,
            coordinate_system="gcj02",
            regions=rows,
        )

    if admin_region_data_path is not None and admin_region_data_path.exists():
        rows = [
            row
            for row in load_local_shanghai_regions(admin_region_data_path)
            if row["level"] == level
        ]
    else:
        rows = []

    if not rows:
        reason = "未找到本地行政区划 GeoJSON。"
        if admin_region_data_path is not None and admin_region_data_path.exists():
            reason = f"本地行政区划 GeoJSON 中没有上海 level {level} 数据。"
        return unavailable_preview(
            source="local",
            level=level,
            reason=reason,
        )

    return available_preview(
        source="local",
        level=level,
        coordinate_system="gcj02",
        regions=rows,
    )


def get_osm_shanghai_preview(
    *,
    level: int,
    admin_region_data_path: Path | None,
) -> ShanghaiPreviewResponse:
    if level in {2, 3}:
        return unavailable_preview(
            source="osm",
            level=level,
            reason="当前本地 OSM 上海源缺少 level 2-3 外包边界。",
        )
    if level == 4:
        shape_path = resolve_osm_shapefile_path(admin_region_data_path)
        if shape_path is None:
            return unavailable_preview(
                source="osm",
                level=level,
                reason="未找到 OSM 上海 shapefile，无法读取 level 4。",
            )
        regions = load_osm_shanghai_shapefile_regions(shape_path, level=4)
    elif level == 5:
        geojson_path = resolve_osm_level8_geojson_path(admin_region_data_path)
        if geojson_path is None:
            return unavailable_preview(
                source="osm",
                level=level,
                reason="未找到 OSM 上海 level 5 GeoJSON。",
            )
        regions = load_osm_shanghai_level8_regions(geojson_path)
    else:
        return unavailable_preview(
            source="osm",
            level=level,
            reason="OSM 上海预览只支持 level 4-5。",
        )

    if not regions:
        return unavailable_preview(
            source="osm",
            level=level,
            reason=f"当前本地 OSM 上海源没有 level {level} 数据。",
        )

    return available_preview(
        source="osm",
        level=level,
        coordinate_system="wgs84",
        regions=regions,
    )


def resolve_osm_level8_geojson_path(admin_region_data_path: Path | None) -> Path | None:
    if admin_region_data_path is None:
        return None

    candidate = admin_region_data_path.parent / "osm" / "shanghai-admin-level8.geojson"
    return candidate if candidate.exists() else None


def resolve_osm_shapefile_path(admin_region_data_path: Path | None) -> Path | None:
    if admin_region_data_path is None:
        return None

    candidate = (
        admin_region_data_path.parent
        / "osm"
        / "shanghai-shp"
        / "gis_osm_adminareas_a_free_1.shp"
    )
    return candidate if candidate.exists() else None


def available_preview(
    *,
    source: ShanghaiPreviewSource,
    level: int,
    coordinate_system: PreviewCoordinateSystem,
    regions: list[PreviewRegion],
) -> ShanghaiPreviewResponse:
    return {
        "source": source,
        "level": level,
        "available": True,
        "coordinateSystem": coordinate_system,
        "reason": None,
        "regions": regions,
    }


def unavailable_preview(
    *,
    source: ShanghaiPreviewSource,
    level: int,
    reason: str,
) -> ShanghaiPreviewResponse:
    return {
        "source": source,
        "level": level,
        "available": False,
        "coordinateSystem": None,
        "reason": reason,
        "regions": [],
    }


def load_local_shanghai_regions(path: Path) -> list[PreviewRegion]:
    stat = path.stat()
    return _load_local_shanghai_regions(str(path.resolve()), stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=4)
def _load_local_shanghai_regions(
    path: str,
    mtime_ns: int,
    size: int,
) -> list[PreviewRegion]:
    del mtime_ns, size
    feature_collection = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    regions: list[PreviewRegion] = []
    for feature in feature_collection.get("features", []):
        region = parse_local_shanghai_region(feature)
        if region is not None:
            regions.append(region)
    return regions


def load_cached_local_shanghai_regions(
    db_path: Path | None,
    *,
    level: int,
) -> list[PreviewRegion]:
    if db_path is None or not db_path.exists():
        return []

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT id, name, level, geometry
            FROM admin_regions
            WHERE level = ?
            ORDER BY id
            """,
            (level,),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        connection.close()

    regions: list[PreviewRegion] = []
    for row in rows:
        region_id = str(row["id"])
        parent_id = cached_parent_id_for_region_id(region_id, level=level)
        if not is_shanghai_local_region(level=level, region_id=region_id, parent_id=parent_id):
            continue
        regions.append({
            "id": region_id,
            "name": str(row["name"]),
            "level": int(row["level"]),
            "geometry": json.loads(str(row["geometry"])),
        })
    return regions


def cached_parent_id_for_region_id(region_id: str, *, level: int) -> str | None:
    if level == 3 and region_id == SHANGHAI_CITY_ID:
        return SHANGHAI_PROVINCE_ID
    if level == 4 and region_id.startswith("31"):
        return SHANGHAI_CITY_ID
    return None


def parse_local_shanghai_region(feature: object) -> PreviewRegion | None:
    if not isinstance(feature, dict):
        return None

    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return None

    level_value = properties.get("level")
    level = LOCAL_LEVELS.get(level_value) if isinstance(level_value, str) else None
    if level is None:
        return None

    region_id = string_or_none(properties.get("id") or properties.get("adcode"))
    parent_id = string_or_none(
        properties.get("parent")
        or properties.get("parentId")
        or properties.get("parent_id")
        or properties.get("pid")
        or properties.get("parent_adcode"),
    )
    if not is_shanghai_local_region(level=level, region_id=region_id, parent_id=parent_id):
        return None

    name = string_or_none(properties.get("name"))
    if region_id is None or name is None:
        return None

    return {
        "id": region_id,
        "name": name,
        "level": level,
        "geometry": geometry,
    }


def is_shanghai_local_region(
    *,
    level: int,
    region_id: str | None,
    parent_id: str | None,
) -> bool:
    if level == 2:
        return region_id == SHANGHAI_PROVINCE_ID
    if level == 3:
        return region_id == SHANGHAI_CITY_ID or parent_id == SHANGHAI_PROVINCE_ID
    if level == 4:
        return parent_id == SHANGHAI_CITY_ID
    return False


def load_osm_shanghai_level8_regions(path: Path) -> list[PreviewRegion]:
    stat = path.stat()
    return _load_osm_shanghai_level8_regions(str(path.resolve()), stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=4)
def _load_osm_shanghai_level8_regions(
    path: str,
    mtime_ns: int,
    size: int,
) -> list[PreviewRegion]:
    del mtime_ns, size
    feature_collection = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    regions: list[PreviewRegion] = []
    for feature in feature_collection.get("features", []):
        region = parse_osm_geojson_region(feature, expected_level=5)
        if region is not None:
            regions.append(region)
    return regions


def parse_osm_geojson_region(feature: object, *, expected_level: int) -> PreviewRegion | None:
    if not isinstance(feature, dict):
        return None

    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return None

    if get_osm_enroute_level(properties) != expected_level:
        return None

    osm_id = string_or_none(properties.get("osm_id") or properties.get("osmId"))
    name = string_or_none(properties.get("name"))
    if osm_id is None or name is None:
        return None

    return {
        "id": f"osm:{osm_id}",
        "name": name,
        "level": expected_level,
        "geometry": geometry,
    }


def load_osm_shanghai_shapefile_regions(path: Path, *, level: int) -> list[PreviewRegion]:
    stat = path.stat()
    return _load_osm_shanghai_shapefile_regions(str(path.resolve()), stat.st_mtime_ns, stat.st_size, level)


@lru_cache(maxsize=4)
def _load_osm_shanghai_shapefile_regions(
    path: str,
    mtime_ns: int,
    size: int,
    level: int,
) -> list[PreviewRegion]:
    del mtime_ns, size
    try:
        import shapefile
    except ImportError as error:  # pragma: no cover - dependency is installed via pyproject.
        raise RuntimeError("pyshp is required to read OSM shapefiles") from error

    regions: list[PreviewRegion] = []
    reader = shapefile.Reader(path, encoding="utf-8")
    try:
        for shape_record in reader.iterShapeRecords():
            record = shape_record.record.as_dict()
            if get_osm_enroute_level(record) != level:
                continue
            osm_id = string_or_none(record.get("osm_id"))
            name = string_or_none(record.get("name"))
            if osm_id is None or name is None:
                continue
            geometry = normalize_geojson_geometry(shape_record.shape.__geo_interface__)
            regions.append({
                "id": f"osm:{osm_id}",
                "name": name,
                "level": level,
                "geometry": geometry,
            })
    finally:
            reader.close()
    return regions


def get_osm_enroute_level(properties: dict[str, Any]) -> int | None:
    osm_admin_level = parse_osm_admin_level(properties)
    if osm_admin_level is None:
        return None
    return OSM_ADMIN_LEVEL_TO_ENROUTE_LEVEL.get(osm_admin_level)


def normalize_geojson_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(geometry))


def string_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None
