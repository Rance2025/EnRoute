from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


SCHEMA_VERSION = 1

ACCOUNTING_SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounting_schema (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_imports (
    source_key TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    earliest_occurred_at TEXT NOT NULL,
    latest_occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    nature TEXT NOT NULL CHECK (nature IN ('asset', 'liability')),
    currency TEXT NOT NULL DEFAULT 'CNY',
    opening_balance_in_cents INTEGER NOT NULL,
    opening_balance_at TEXT NOT NULL,
    opening_balance_source TEXT NOT NULL CHECK (
        opening_balance_source IN ('import-zero-baseline', 'manual')
    ),
    source_label TEXT,
    brand_slug TEXT,
    brand_label TEXT,
    brand_color TEXT,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_categories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES accounting_categories(id),
    sort_order INTEGER NOT NULL,
    source_name TEXT,
    archived_at TEXT,
    UNIQUE(type, parent_id, name)
);

CREATE TABLE IF NOT EXISTS accounting_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES accounting_tags(id),
    sort_order INTEGER NOT NULL,
    archived_at TEXT,
    UNIQUE(parent_id, name)
);

CREATE TABLE IF NOT EXISTS accounting_transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount_in_cents INTEGER NOT NULL CHECK (amount_in_cents > 0),
    occurred_at TEXT NOT NULL,
    account_id TEXT REFERENCES accounting_accounts(id),
    from_account_id TEXT REFERENCES accounting_accounts(id),
    to_account_id TEXT REFERENCES accounting_accounts(id),
    category_id TEXT REFERENCES accounting_categories(id),
    note TEXT,
    origin TEXT NOT NULL CHECK (origin IN ('import', 'manual')),
    source_key TEXT,
    source_record_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
        (type IN ('income', 'expense') AND account_id IS NOT NULL
            AND from_account_id IS NULL AND to_account_id IS NULL)
        OR
        (type = 'transfer' AND account_id IS NULL
            AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL
            AND from_account_id <> to_account_id)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_transactions_source_identity
ON accounting_transactions(source_key, source_record_id)
WHERE source_key IS NOT NULL AND source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS accounting_transactions_occurred_at
ON accounting_transactions(occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS accounting_transaction_tags (
    transaction_id TEXT NOT NULL REFERENCES accounting_transactions(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES accounting_tags(id),
    PRIMARY KEY (transaction_id, tag_id)
);
"""


def initialize_accounting_schema(db_path: Path) -> None:
    """Create or migrate the accounting database at exactly ``db_path``."""

    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(ACCOUNTING_SCHEMA_SQL)
        connection.execute(
            "INSERT OR IGNORE INTO accounting_schema(version, applied_at) VALUES (?, ?)",
            (SCHEMA_VERSION, datetime.now(timezone.utc).isoformat()),
        )

