from __future__ import annotations

import pytest

from enroute_api.footprints.visual_tile_codec import (
    VisualCellRecord,
    decode_visual_cells,
    encode_visual_cells,
)


def test_round_trips_visual_cell_records():
    records = [
        VisualCellRecord(cell_id=1, footprint_id=1000, geom_x=20, geom_y=30),
        VisualCellRecord(cell_id=2, footprint_id=1005, geom_x=21, geom_y=31),
    ]

    encoded = encode_visual_cells(records)

    assert decode_visual_cells(encoded) == records


def test_rejects_invalid_magic():
    with pytest.raises(ValueError, match="Invalid visual cell blob"):
        decode_visual_cells(b"BAD!")
