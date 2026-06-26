from __future__ import annotations

from mapbox_vector_tile import encode

from enroute_api.footprints.visual_tile_codec import VisualCellRecord
from enroute_api.footprints.visual_tiles import MVT_EXTENT

FOOTPRINT_LAYER_NAME = "footprints"


def encode_footprint_mvt(records: list[VisualCellRecord]) -> bytes:
    if not records:
        return b""

    features = [
        {
            "geometry": {
                "type": "Point",
                "coordinates": [record.geom_x, record.geom_y],
            },
            "properties": {
                "footprint_id": record.footprint_id,
                "cell_id": record.cell_id,
            },
        }
        for record in records
    ]
    return encode(
        [
            {
                "name": FOOTPRINT_LAYER_NAME,
                "features": features,
            },
        ],
        default_options={
            "extents": MVT_EXTENT,
            "y_coord_down": True,
        },
    )
