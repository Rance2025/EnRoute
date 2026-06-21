from __future__ import annotations

from typing import TypedDict


CHINA_COUNTRY_ID = "CHN"


class CountryLookupDecision(TypedDict):
    possibly_china: bool
    remote_lookup_allowed: bool


def classify_country_lookup(*, longitude: float, latitude: float) -> CountryLookupDecision:
    possibly_china = 73 <= longitude <= 136 and 3 <= latitude <= 54
    return {
        "possibly_china": possibly_china,
        "remote_lookup_allowed": not possibly_china,
    }


def country_id_for_region_match(region_id: str | None) -> str | None:
    return CHINA_COUNTRY_ID if region_id else None
