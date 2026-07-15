import sqlite3
from pathlib import Path

from enroute_api.accounting.schema import initialize_accounting_schema
from enroute_api.config import Settings


EXPECTED_TABLES = {
    "accounting_schema",
    "accounting_imports",
    "accounting_accounts",
    "accounting_categories",
    "accounting_tags",
    "accounting_transactions",
    "accounting_transaction_tags",
}


def test_initialize_accounting_schema_only_writes_requested_database(tmp_path: Path):
    accounting_db = tmp_path / "accounting.sqlite"
    footprint_db = tmp_path / "footprints.sqlite"
    footprint_db.write_bytes(b"untouched-footprint-sentinel")

    initialize_accounting_schema(accounting_db)

    assert footprint_db.read_bytes() == b"untouched-footprint-sentinel"
    with sqlite3.connect(accounting_db) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'",
            )
        }
        version = connection.execute(
            "SELECT version FROM accounting_schema",
        ).fetchone()
    assert EXPECTED_TABLES <= tables
    assert version == (1,)


def test_accounting_schema_enforces_transaction_amount_and_source_identity(tmp_path: Path):
    db_path = tmp_path / "accounting.sqlite"
    initialize_accounting_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(accounting_transactions)")
        }
        indexes = {
            row[1]
            for row in connection.execute("PRAGMA index_list(accounting_transactions)")
        }

    assert "amount_in_cents" in columns
    assert "source_record_id" in columns
    assert "accounting_transactions_source_identity" in indexes


def test_settings_defaults_to_independent_accounting_database(monkeypatch):
    monkeypatch.delenv("ACCOUNTING_DB_PATH", raising=False)

    settings = Settings.from_env()

    assert settings.accounting_db_path == Path("data/accounting.sqlite")
    assert settings.accounting_db_path != settings.footprint_db_path


def test_settings_reads_accounting_database_from_environment(monkeypatch, tmp_path: Path):
    configured_path = tmp_path / "custom-accounting.sqlite"
    monkeypatch.setenv("ACCOUNTING_DB_PATH", str(configured_path))

    settings = Settings.from_env()

    assert settings.accounting_db_path == configured_path
