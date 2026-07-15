from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class NormalizedAccountingRow:
    transaction_type: str
    amount_in_cents: int
    occurred_at: str
    account_name: str | None
    from_account_name: str | None
    to_account_name: str | None
    category_path: tuple[str, str]
    note: str | None
    source_key: str
    source_record_id: str


@dataclass(frozen=True)
class AccountingImportResult:
    row_count: int
    earliest_occurred_at: str
    latest_occurred_at: str
    source_key: str

