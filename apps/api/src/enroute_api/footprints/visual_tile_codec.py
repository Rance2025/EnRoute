from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterable

MAGIC = b"EVTC"
VERSION = 1
HEADER_STRUCT = struct.Struct("<4sBI")
RECORD_STRUCT = struct.Struct("<IqHH")


@dataclass(frozen=True)
class VisualCellRecord:
    cell_id: int
    footprint_id: int
    geom_x: int
    geom_y: int


def encode_visual_cells(records: Iterable[VisualCellRecord]) -> bytes:
    ordered_records = list(records)
    payload = bytearray(HEADER_STRUCT.pack(MAGIC, VERSION, len(ordered_records)))
    for record in ordered_records:
        payload.extend(
            RECORD_STRUCT.pack(
                record.cell_id,
                record.footprint_id,
                record.geom_x,
                record.geom_y,
            ),
        )
    return bytes(payload)


def decode_visual_cells(blob: bytes) -> list[VisualCellRecord]:
    if len(blob) < HEADER_STRUCT.size:
        raise ValueError("Invalid visual cell blob")
    magic, version, count = HEADER_STRUCT.unpack_from(blob, 0)
    if magic != MAGIC or version != VERSION:
        raise ValueError("Invalid visual cell blob")

    expected_size = HEADER_STRUCT.size + count * RECORD_STRUCT.size
    if len(blob) != expected_size:
        raise ValueError("Invalid visual cell blob")

    offset = HEADER_STRUCT.size
    records: list[VisualCellRecord] = []
    for _ in range(count):
        cell_id, footprint_id, geom_x, geom_y = RECORD_STRUCT.unpack_from(blob, offset)
        records.append(
            VisualCellRecord(
                cell_id=cell_id,
                footprint_id=footprint_id,
                geom_x=geom_x,
                geom_y=geom_y,
            ),
        )
        offset += RECORD_STRUCT.size
    return records
