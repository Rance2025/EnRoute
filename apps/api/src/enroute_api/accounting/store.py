from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .schema import initialize_accounting_schema


class AccountingInputError(ValueError):
    pass


class AccountingNotFoundError(LookupError):
    pass


class AccountingStore:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        initialize_accounting_schema(self.db_path)

    def get_dataset(self) -> dict[str, object]:
        with self._connect() as connection:
            accounts = [self._serialize_account(row) for row in connection.execute(
                "SELECT * FROM accounting_accounts ORDER BY archived_at IS NOT NULL, name, id",
            )]
            categories = [self._serialize_category(row) for row in connection.execute(
                "SELECT * FROM accounting_categories ORDER BY type, parent_id IS NOT NULL, sort_order, name",
            )]
            tags = [self._serialize_tag(row) for row in connection.execute(
                "SELECT * FROM accounting_tags ORDER BY parent_id IS NOT NULL, sort_order, name",
            )]
            tag_rows = connection.execute(
                "SELECT transaction_id, tag_id FROM accounting_transaction_tags ORDER BY transaction_id, tag_id",
            ).fetchall()
            tags_by_transaction: dict[str, list[str]] = {}
            for row in tag_rows:
                tags_by_transaction.setdefault(row["transaction_id"], []).append(row["tag_id"])
            transactions = [
                self._serialize_transaction(row, tags_by_transaction.get(row["id"], []))
                for row in connection.execute(
                    "SELECT * FROM accounting_transactions ORDER BY occurred_at DESC, id DESC",
                )
            ]
            imports = [self._serialize_import(row) for row in connection.execute(
                "SELECT * FROM accounting_imports ORDER BY imported_at DESC, source_key",
            )]
        return {
            "accounts": accounts,
            "transactions": transactions,
            "categories": categories,
            "tags": tags,
            "imports": imports,
            "legacyCategories": [],
            "legacyFunds": [],
        }

    def create_transaction(self, draft: dict[str, Any]) -> dict[str, object]:
        transaction_id = f"transaction-manual-{uuid.uuid4()}"
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            self._validate_transaction(connection, draft)
            self._insert_transaction(connection, transaction_id, draft, "manual", None, None, now, now)
            self._replace_tags(connection, transaction_id, draft.get("tagIds", []))
            row = self._get_transaction_row(connection, transaction_id)
            return self._serialize_transaction(row, list(draft.get("tagIds", [])))

    def update_transaction(self, transaction_id: str, draft: dict[str, Any]) -> dict[str, object]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            existing = self._get_transaction_row(connection, transaction_id)
            self._validate_transaction(connection, draft)
            connection.execute(
                """
                UPDATE accounting_transactions SET
                    type = ?, amount_in_cents = ?, occurred_at = ?, account_id = ?,
                    from_account_id = ?, to_account_id = ?, category_id = ?, note = ?, updated_at = ?
                WHERE id = ?
                """,
                self._transaction_values(draft) + (now, transaction_id),
            )
            self._replace_tags(connection, transaction_id, draft.get("tagIds", []))
            row = self._get_transaction_row(connection, transaction_id)
            result = self._serialize_transaction(row, list(draft.get("tagIds", [])))
            result["origin"] = existing["origin"]
            return result

    def update_account(self, account_id: str, patch: dict[str, Any]) -> dict[str, object]:
        allowed_columns = {
            "name": "name",
            "nature": "nature",
            "openingBalanceInCents": "opening_balance_in_cents",
            "openingBalanceAt": "opening_balance_at",
            "sourceLabel": "source_label",
            "brandSlug": "brand_slug",
            "brandLabel": "brand_label",
            "brandColor": "brand_color",
            "hidden": "hidden",
            "archivedAt": "archived_at",
        }
        assignments: list[str] = []
        values: list[object] = []
        for field, value in patch.items():
            column = allowed_columns.get(field)
            if column is None:
                continue
            assignments.append(f"{column} = ?")
            values.append(int(value) if field == "hidden" else value)
        if "openingBalanceInCents" in patch or "openingBalanceAt" in patch:
            assignments.append("opening_balance_source = 'manual'")
        assignments.append("updated_at = ?")
        values.append(datetime.now(timezone.utc).isoformat())
        values.append(account_id)
        with self._connect() as connection:
            cursor = connection.execute(
                f"UPDATE accounting_accounts SET {', '.join(assignments)} WHERE id = ?",
                values,
            )
            if cursor.rowcount == 0:
                raise AccountingNotFoundError("账户不存在")
            row = connection.execute(
                "SELECT * FROM accounting_accounts WHERE id = ?",
                (account_id,),
            ).fetchone()
            return self._serialize_account(row)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _validate_transaction(self, connection: sqlite3.Connection, draft: dict[str, Any]) -> None:
        transaction_type = draft["type"]
        if transaction_type not in {"income", "expense", "transfer"}:
            raise AccountingInputError("流水类别无效")
        if int(draft["amountInCents"]) <= 0:
            raise AccountingInputError("金额必须大于 0")
        account_ids: list[str] = []
        if transaction_type == "transfer":
            from_account_id = draft.get("fromAccountId")
            to_account_id = draft.get("toAccountId")
            if not from_account_id or not to_account_id:
                raise AccountingInputError("转账必须选择转出和转入账户")
            if from_account_id == to_account_id:
                raise AccountingInputError("转入和转出账户必须不同")
            account_ids.extend((from_account_id, to_account_id))
        else:
            account_id = draft.get("accountId")
            if not account_id:
                raise AccountingInputError("收入或支出必须选择账户")
            account_ids.append(account_id)
        for account_id in account_ids:
            if connection.execute(
                "SELECT 1 FROM accounting_accounts WHERE id = ?",
                (account_id,),
            ).fetchone() is None:
                raise AccountingInputError("账户不存在")
        category_id = draft.get("categoryId")
        if category_id:
            category = connection.execute(
                "SELECT type FROM accounting_categories WHERE id = ?",
                (category_id,),
            ).fetchone()
            if category is None or category["type"] != transaction_type:
                raise AccountingInputError("分类与流水类别不匹配")
        for tag_id in draft.get("tagIds", []):
            if connection.execute(
                "SELECT 1 FROM accounting_tags WHERE id = ?",
                (tag_id,),
            ).fetchone() is None:
                raise AccountingInputError("标签不存在")

    def _insert_transaction(
        self,
        connection: sqlite3.Connection,
        transaction_id: str,
        draft: dict[str, Any],
        origin: str,
        source_key: str | None,
        source_record_id: str | None,
        created_at: str,
        updated_at: str,
    ) -> None:
        connection.execute(
            """
            INSERT INTO accounting_transactions (
                id, type, amount_in_cents, occurred_at, account_id, from_account_id,
                to_account_id, category_id, note, origin, source_key, source_record_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (transaction_id,) + self._transaction_values(draft) + (
                origin, source_key, source_record_id, created_at, updated_at,
            ),
        )

    @staticmethod
    def _transaction_values(draft: dict[str, Any]) -> tuple[object, ...]:
        transaction_type = draft["type"]
        return (
            transaction_type,
            int(draft["amountInCents"]),
            draft["occurredAt"],
            draft.get("accountId") if transaction_type != "transfer" else None,
            draft.get("fromAccountId") if transaction_type == "transfer" else None,
            draft.get("toAccountId") if transaction_type == "transfer" else None,
            draft.get("categoryId"),
            draft.get("note") or None,
        )

    @staticmethod
    def _replace_tags(connection: sqlite3.Connection, transaction_id: str, tag_ids: list[str]) -> None:
        connection.execute(
            "DELETE FROM accounting_transaction_tags WHERE transaction_id = ?",
            (transaction_id,),
        )
        connection.executemany(
            "INSERT INTO accounting_transaction_tags(transaction_id, tag_id) VALUES (?, ?)",
            ((transaction_id, tag_id) for tag_id in tag_ids),
        )

    @staticmethod
    def _get_transaction_row(connection: sqlite3.Connection, transaction_id: str) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM accounting_transactions WHERE id = ?",
            (transaction_id,),
        ).fetchone()
        if row is None:
            raise AccountingNotFoundError("流水不存在")
        return row

    @staticmethod
    def _serialize_account(row: sqlite3.Row) -> dict[str, object]:
        result: dict[str, object] = {
            "id": row["id"],
            "name": row["name"],
            "nature": row["nature"],
            "currency": row["currency"],
            "openingBalanceInCents": row["opening_balance_in_cents"],
            "openingBalanceAt": row["opening_balance_at"],
            "openingBalanceSource": row["opening_balance_source"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "hidden": bool(row["hidden"]),
        }
        if row["source_label"]:
            result["sourceLabel"] = row["source_label"]
        if row["archived_at"]:
            result["archivedAt"] = row["archived_at"]
        if row["brand_slug"] or row["brand_label"] or row["brand_color"]:
            result["brand"] = {
                "slug": row["brand_slug"] or "custom",
                "label": row["brand_label"] or row["name"],
                "color": row["brand_color"] or "#315f58",
            }
        return result

    @staticmethod
    def _serialize_category(row: sqlite3.Row) -> dict[str, object]:
        result: dict[str, object] = {
            "id": row["id"],
            "type": row["type"],
            "name": row["name"],
            "sortOrder": row["sort_order"],
        }
        if row["parent_id"]:
            result["parentId"] = row["parent_id"]
        if row["archived_at"]:
            result["archivedAt"] = row["archived_at"]
        return result

    @staticmethod
    def _serialize_tag(row: sqlite3.Row) -> dict[str, object]:
        result: dict[str, object] = {
            "id": row["id"],
            "name": row["name"],
            "sortOrder": row["sort_order"],
        }
        if row["parent_id"]:
            result["parentId"] = row["parent_id"]
        if row["archived_at"]:
            result["archivedAt"] = row["archived_at"]
        return result

    @staticmethod
    def _serialize_transaction(row: sqlite3.Row, tag_ids: list[str]) -> dict[str, object]:
        result: dict[str, object] = {
            "id": row["id"],
            "type": row["type"],
            "amountInCents": row["amount_in_cents"],
            "occurredAt": row["occurred_at"],
            "tagIds": tag_ids,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "origin": row["origin"],
        }
        for source, target in (
            ("account_id", "accountId"),
            ("from_account_id", "fromAccountId"),
            ("to_account_id", "toAccountId"),
            ("category_id", "categoryId"),
            ("note", "note"),
        ):
            if row[source] is not None:
                result[target] = row[source]
        return result

    @staticmethod
    def _serialize_import(row: sqlite3.Row) -> dict[str, object]:
        return {
            "sourceKey": row["source_key"],
            "sourcePath": row["source_path"],
            "sourceSha256": row["source_sha256"],
            "importedAt": row["imported_at"],
            "rowCount": row["row_count"],
            "earliestOccurredAt": row["earliest_occurred_at"],
            "latestOccurredAt": row["latest_occurred_at"],
        }

