from __future__ import annotations

from typing import Any


ANTARCTICA_REGION_IDS = {
    "aq",
    "ata",
    "010",
    "country:aq",
    "country:ata",
    "overture:division:country:aq",
    "overture:division:country:ata",
}
ANTARCTICA_REGION_NAMES = {"antarctica"}
ANTARCTICA_REGION_CODES = {"AQ", "ATA", "010"}


def is_antarctica_admin_region_properties(properties: dict[str, Any]) -> bool:
    region_id = str(properties.get("id") or properties.get("region_id") or "").strip().lower()
    if region_id in ANTARCTICA_REGION_IDS or region_id.endswith((":aq", ":ata")):
        return True

    names = {
        str(properties.get("name", "")).strip().casefold(),
        str(properties.get("ADMIN", "")).strip().casefold(),
        str(properties.get("NAME", "")).strip().casefold(),
    }
    if any(name in ANTARCTICA_REGION_NAMES for name in names):
        return True

    codes = {
        str(properties.get("ISO3166-1-Alpha-2", "")).strip().upper(),
        str(properties.get("ISO3166-1-Alpha-3", "")).strip().upper(),
        str(properties.get("ISO_A2", "")).strip().upper(),
        str(properties.get("ISO_A3", "")).strip().upper(),
        str(properties.get("iso_a2", "")).strip().upper(),
        str(properties.get("iso_a3", "")).strip().upper(),
        str(properties.get("country", "")).strip().upper(),
    }
    return any(code in ANTARCTICA_REGION_CODES for code in codes)
