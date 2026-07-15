import sqlite3
from pathlib import Path

import pytest

from enroute_api.accounting.importer import (
    AccountingImportError,
    import_accounting_rows,
    import_accounting_workbook,
    normalize_rows,
)
from enroute_api.accounting.schema import initialize_accounting_schema


SAMPLE_ROWS = [
    ["支出", "午餐", 12.34, "2026-06-18 12:00", "微信 - 日常", "面馆"],
    ["收入", "工资", 5172.41, "2026-06-15 10:56", "微信 - 日常", "实习工资"],
    ["转账", "", 200, "2026-06-18 12:20", "微信 - 日常>花呗", "还款"],
]


def test_normalize_rows_preserves_types_accounts_cents_and_category_paths():
    normalized = normalize_rows(SAMPLE_ROWS, source_key="fixture")

    assert [row.amount_in_cents for row in normalized] == [1234, 517241, 20000]
    assert normalized[0].transaction_type == "expense"
    assert normalized[0].account_name == "微信 - 日常"
    assert normalized[0].category_path == ("餐饮", "午餐")
    assert normalized[1].transaction_type == "income"
    assert normalized[1].category_path == ("劳动所得", "工资")
    assert normalized[2].from_account_name == "微信 - 日常"
    assert normalized[2].to_account_name == "花呗"
    assert normalized[2].category_path == ("账户往来", "账户转账")


@pytest.mark.parametrize(
    ("row", "message"),
    [
        (["未知", "午餐", 12, "2026-06-18 12:00", "微信 - 日常", ""], "类别"),
        (["支出", "午餐", 0, "2026-06-18 12:00", "微信 - 日常", ""], "金额"),
        (["支出", "午餐", 12, "bad-time", "微信 - 日常", ""], "时间"),
        (["支出", "午餐", 12, "2026-06-18 12:00", "", ""], "账户"),
        (["转账", "", 12, "2026-06-18 12:00", "微信 - 日常", ""], ">"),
        (["转账", "", 12, "2026-06-18 12:00", "微信 - 日常>微信 - 日常", ""], "不同"),
    ],
)
def test_normalize_rows_rejects_invalid_source_rows(row, message):
    with pytest.raises(AccountingImportError, match=message):
        normalize_rows([row], source_key="fixture")


def test_import_rows_builds_accounts_categories_and_transactions(tmp_path: Path):
    db_path = tmp_path / "accounting.sqlite"

    result = import_accounting_rows(
        SAMPLE_ROWS,
        db_path,
        source_key="fixture",
        source_path="fixture.xls",
        source_sha256="abc123",
    )

    assert result.row_count == 3
    assert result.earliest_occurred_at == "2026-06-15T10:56:00"
    assert result.latest_occurred_at == "2026-06-18T12:20:00"
    with sqlite3.connect(db_path) as connection:
        accounts = connection.execute(
            "SELECT name, nature, opening_balance_in_cents, opening_balance_source "
            "FROM accounting_accounts ORDER BY name",
        ).fetchall()
        categories = connection.execute(
            "SELECT type, name, parent_id, source_name FROM accounting_categories",
        ).fetchall()
        transactions = connection.execute(
            "SELECT type, amount_in_cents FROM accounting_transactions ORDER BY occurred_at",
        ).fetchall()
    assert accounts == [
        ("微信 - 日常", "asset", 0, "import-zero-baseline"),
        ("花呗", "liability", 0, "import-zero-baseline"),
    ]
    assert any(row[1:] == ("午餐", "category-expense-canyin", "午餐") for row in categories)
    assert transactions == [("income", 517241), ("expense", 1234), ("transfer", 20000)]


def test_reimport_is_idempotent_and_preserves_manual_data(tmp_path: Path):
    db_path = tmp_path / "accounting.sqlite"
    import_accounting_rows(
        SAMPLE_ROWS,
        db_path,
        source_key="fixture",
        source_path="fixture.xls",
        source_sha256="abc123",
    )
    with sqlite3.connect(db_path) as connection:
        now = "2026-07-15T12:00:00"
        connection.execute(
            "UPDATE accounting_accounts SET opening_balance_in_cents = 88800, "
            "opening_balance_source = 'manual' WHERE name = '微信 - 日常'",
        )
        connection.execute(
            "INSERT INTO accounting_transactions "
            "(id, type, amount_in_cents, occurred_at, account_id, category_id, origin, created_at, updated_at) "
            "VALUES ('manual-1', 'expense', 500, ?, 'account-wechat-daily', "
            "'category-expense-lunch', 'manual', ?, ?)",
            (now, now, now),
        )

    import_accounting_rows(
        SAMPLE_ROWS,
        db_path,
        source_key="fixture",
        source_path="fixture.xls",
        source_sha256="abc123",
    )

    with sqlite3.connect(db_path) as connection:
        imported_count = connection.execute(
            "SELECT COUNT(*) FROM accounting_transactions WHERE origin = 'import'",
        ).fetchone()[0]
        manual_count = connection.execute(
            "SELECT COUNT(*) FROM accounting_transactions WHERE origin = 'manual'",
        ).fetchone()[0]
        opening = connection.execute(
            "SELECT opening_balance_in_cents, opening_balance_source "
            "FROM accounting_accounts WHERE name = '微信 - 日常'",
        ).fetchone()
    assert imported_count == 3
    assert manual_count == 1
    assert opening == (88800, "manual")


def test_invalid_row_rolls_back_entire_import(tmp_path: Path):
    db_path = tmp_path / "accounting.sqlite"

    with pytest.raises(AccountingImportError):
        import_accounting_rows(
            [SAMPLE_ROWS[0], ["支出", "午餐", -1, "2026-06-18 13:00", "微信 - 日常", ""]],
            db_path,
            source_key="fixture",
            source_path="fixture.xls",
            source_sha256="abc123",
        )

    initialize_accounting_schema(db_path)
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM accounting_transactions").fetchone() == (0,)


def test_workbook_import_rejects_non_ole2_input(tmp_path: Path):
    source_path = tmp_path / "fake.csv"
    source_path.write_text("类别,分类,金额,时间,账户,备注", encoding="utf-8")

    with pytest.raises(AccountingImportError, match="OLE2/BIFF"):
        import_accounting_workbook(source_path, tmp_path / "accounting.sqlite")
