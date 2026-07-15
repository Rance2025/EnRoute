from pathlib import Path

from fastapi.testclient import TestClient

from enroute_api.accounting.importer import import_accounting_rows
from enroute_api.config import Settings
from enroute_api.main import create_app


SEED_ROWS = [
    ["支出", "午餐", 12.34, "2026-06-18 12:00", "微信 - 日常", "面馆"],
    ["收入", "工资", 5172.41, "2026-06-15 10:56", "微信 - 日常", "实习工资"],
    ["转账", "", 200, "2026-06-18 12:20", "微信 - 日常>花呗", "还款"],
]


def test_accounting_dataset_returns_empty_shape_for_new_database(tmp_path: Path):
    client = create_test_client(tmp_path)

    response = client.get("/api/accounting/dataset")

    assert response.status_code == 200
    assert response.json() == {
        "accounts": [],
        "transactions": [],
        "categories": [],
        "tags": [],
        "imports": [],
        "legacyCategories": [],
        "legacyFunds": [],
    }


def test_dataset_serializes_imported_accounts_categories_and_transactions(tmp_path: Path):
    db_path = seed_database(tmp_path)
    client = create_test_client(tmp_path, accounting_db_path=db_path)

    response = client.get("/api/accounting/dataset")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["accounts"]) == 2
    assert len(payload["transactions"]) == 3
    assert payload["transactions"][0]["type"] == "transfer"
    assert payload["transactions"][0]["fromAccountId"] == "account-wechat-daily"
    assert payload["transactions"][0]["toAccountId"] == "account-huabei"
    assert payload["accounts"][0]["openingBalanceSource"] == "import-zero-baseline"
    assert payload["imports"][0]["rowCount"] == 3


def test_create_then_edit_expense_persists(tmp_path: Path):
    db_path = seed_database(tmp_path)
    client = create_test_client(tmp_path, accounting_db_path=db_path)
    create_payload = {
        "type": "expense",
        "amountInCents": 1880,
        "occurredAt": "2026-06-18T12:30:00",
        "accountId": "account-wechat-daily",
        "categoryId": "category-expense-lunch",
        "tagIds": [],
        "note": "午餐",
    }

    created = client.post("/api/accounting/transactions", json=create_payload)

    assert created.status_code == 201
    transaction_id = created.json()["id"]
    updated = client.put(
        f"/api/accounting/transactions/{transaction_id}",
        json={**create_payload, "amountInCents": 2080},
    )
    assert updated.status_code == 200
    assert updated.json()["amountInCents"] == 2080
    dataset = client.get("/api/accounting/dataset").json()
    persisted = next(item for item in dataset["transactions"] if item["id"] == transaction_id)
    assert persisted["amountInCents"] == 2080
    assert persisted["origin"] == "manual"


def test_editing_imported_transaction_keeps_import_origin(tmp_path: Path):
    db_path = seed_database(tmp_path)
    client = create_test_client(tmp_path, accounting_db_path=db_path)
    imported = next(
        item
        for item in client.get("/api/accounting/dataset").json()["transactions"]
        if item["type"] == "expense"
    )

    updated = client.put(
        f"/api/accounting/transactions/{imported['id']}",
        json={
            "type": "expense",
            "amountInCents": 1500,
            "occurredAt": imported["occurredAt"],
            "accountId": imported["accountId"],
            "categoryId": imported["categoryId"],
            "tagIds": [],
            "note": "已校正",
        },
    )

    assert updated.status_code == 200
    assert updated.json()["origin"] == "import"
    assert updated.json()["note"] == "已校正"


def test_transaction_validation_rejects_wrong_category_and_transfer_direction(tmp_path: Path):
    db_path = seed_database(tmp_path)
    client = create_test_client(tmp_path, accounting_db_path=db_path)

    wrong_category = client.post(
        "/api/accounting/transactions",
        json={
            "type": "expense",
            "amountInCents": 100,
            "occurredAt": "2026-06-18T13:00:00",
            "accountId": "account-wechat-daily",
            "categoryId": "category-income-work",
            "tagIds": [],
        },
    )
    same_account_transfer = client.post(
        "/api/accounting/transactions",
        json={
            "type": "transfer",
            "amountInCents": 100,
            "occurredAt": "2026-06-18T13:00:00",
            "fromAccountId": "account-wechat-daily",
            "toAccountId": "account-wechat-daily",
            "categoryId": "category-transfer-transfer",
            "tagIds": [],
        },
    )

    assert wrong_category.status_code == 400
    assert "分类" in wrong_category.json()["detail"]
    assert same_account_transfer.status_code == 400
    assert "不同" in same_account_transfer.json()["detail"]


def test_account_patch_sets_manual_opening_balance(tmp_path: Path):
    db_path = seed_database(tmp_path)
    client = create_test_client(tmp_path, accounting_db_path=db_path)

    response = client.patch(
        "/api/accounting/accounts/account-wechat-daily",
        json={
            "openingBalanceInCents": 88800,
            "openingBalanceAt": "2025-09-01T00:00:00",
        },
    )

    assert response.status_code == 200
    assert response.json()["openingBalanceInCents"] == 88800
    assert response.json()["openingBalanceSource"] == "manual"


def seed_database(tmp_path: Path) -> Path:
    db_path = tmp_path / "accounting.sqlite"
    import_accounting_rows(
        SEED_ROWS,
        db_path,
        source_key="fixture",
        source_path="fixture.xls",
        source_sha256="abc123",
    )
    return db_path


def create_test_client(
    tmp_path: Path,
    *,
    accounting_db_path: Path | None = None,
) -> TestClient:
    settings = Settings(
        footprint_data_path=tmp_path / "missing-footprints.csv",
        footprint_db_path=tmp_path / "footprints.sqlite",
        accounting_db_path=accounting_db_path or tmp_path / "accounting.sqlite",
        admin_region_data_path=tmp_path / "missing-admin-regions.geojson",
    )
    return TestClient(create_app(settings=settings))
