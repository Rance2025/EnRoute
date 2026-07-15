from __future__ import annotations

import hashlib
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable, Sequence

import xlrd

from .models import AccountingImportResult, NormalizedAccountingRow
from .schema import initialize_accounting_schema


OLE2_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")
EXPECTED_HEADERS = ("类别", "分类", "金额", "时间", "账户", "备注")
TRANSACTION_TYPES = {"收入": "income", "支出": "expense", "转账": "transfer"}

ACCOUNT_NATURES = {
    "微信 - 日常": "asset",
    "攒钱理财": "asset",
    "专款": "asset",
    "花呗": "liability",
    "美团月付": "liability",
    "京东白条": "liability",
    "抖音月付": "liability",
}

ACCOUNT_IDS = {
    "微信 - 日常": "account-wechat-daily",
    "攒钱理财": "account-savings",
    "专款": "account-earmarked",
    "花呗": "account-huabei",
    "美团月付": "account-meituan-credit",
    "京东白条": "account-jd-credit",
    "抖音月付": "account-douyin-credit",
}

EXPENSE_CATEGORY_GROUPS = {
    "餐饮": ("早餐", "午餐", "晚餐", "夜宵", "聚餐", "饮料"),
    "出行住宿": ("交通", "酒店"),
    "居住通信": ("住房", "水电", "通信"),
    "日常生活": ("日用品", "卫生", "服饰", "理发", "维修", "购物"),
    "文教成长": ("学习", "图书", "考试", "学费", "软件", "数码"),
    "娱乐体验": ("娱乐", "演出"),
    "健康公益": ("医疗", "捐赠"),
    "人情往来": ("红包",),
    "其他支出": ("其他",),
}

INCOME_CATEGORY_GROUPS = {
    "劳动所得": ("工资", "奖金", "补贴"),
    "家庭与专项": ("生活费", "专款"),
    "资金回流": ("退款", "红包", "收钱"),
    "投资与其他": ("投资收益", "意外所得", "其他收入"),
}

PARENT_SLUGS = {
    "餐饮": "canyin",
    "出行住宿": "travel",
    "居住通信": "living",
    "日常生活": "daily-life",
    "文教成长": "growth",
    "娱乐体验": "entertainment",
    "健康公益": "health",
    "人情往来": "social",
    "其他支出": "other",
    "劳动所得": "work",
    "家庭与专项": "family",
    "资金回流": "return",
    "投资与其他": "investment",
    "账户往来": "account-transfer",
}

LEAF_SLUGS = {
    "午餐": "lunch",
    "账户转账": "transfer",
}


class AccountingImportError(ValueError):
    pass


def normalize_rows(
    rows: Iterable[Sequence[object]],
    *,
    source_key: str,
    datemode: int = 0,
) -> list[NormalizedAccountingRow]:
    normalized: list[NormalizedAccountingRow] = []
    occurrences: Counter[tuple[str, ...]] = Counter()
    for row_number, raw_row in enumerate(rows, start=2):
        if len(raw_row) != len(EXPECTED_HEADERS):
            raise AccountingImportError(f"第 {row_number} 行必须恰好包含 6 列")
        kind, category, amount, occurred_at, account, note = raw_row
        kind_text = _clean_text(kind)
        transaction_type = TRANSACTION_TYPES.get(kind_text)
        if transaction_type is None:
            raise AccountingImportError(f"第 {row_number} 行类别无效: {kind_text or '空'}")
        amount_in_cents = _amount_to_cents(amount, row_number)
        occurred_at_text = _normalize_datetime(occurred_at, row_number, datemode)
        account_text = _clean_text(account)
        note_text = _clean_text(note) or None
        category_text = _clean_text(category)

        account_name: str | None = None
        from_account_name: str | None = None
        to_account_name: str | None = None
        if transaction_type == "transfer":
            if account_text.count(">") != 1:
                raise AccountingImportError(f"第 {row_number} 行转账账户必须包含一个 >")
            from_account_name, to_account_name = (part.strip() for part in account_text.split(">"))
            if not from_account_name or not to_account_name:
                raise AccountingImportError(f"第 {row_number} 行转账账户两端不能为空")
            if from_account_name == to_account_name:
                raise AccountingImportError(f"第 {row_number} 行转入转出账户必须不同")
            category_path = ("账户往来", "账户转账")
        else:
            if not account_text:
                raise AccountingImportError(f"第 {row_number} 行账户不能为空")
            account_name = account_text
            category_path = _category_path(transaction_type, category_text, row_number)

        identity_fields = (
            transaction_type,
            str(amount_in_cents),
            occurred_at_text,
            account_text,
            category_path[1],
            note_text or "",
        )
        occurrence = occurrences[identity_fields]
        occurrences[identity_fields] += 1
        digest = hashlib.sha256(
            "\u001f".join((*identity_fields, str(occurrence))).encode("utf-8"),
        ).hexdigest()
        normalized.append(
            NormalizedAccountingRow(
                transaction_type=transaction_type,
                amount_in_cents=amount_in_cents,
                occurred_at=occurred_at_text,
                account_name=account_name,
                from_account_name=from_account_name,
                to_account_name=to_account_name,
                category_path=category_path,
                note=note_text,
                source_key=source_key,
                source_record_id=digest,
            ),
        )
    if not normalized:
        raise AccountingImportError("账单至少需要一行数据")
    return normalized


def import_accounting_workbook(source_path: Path, db_path: Path) -> AccountingImportResult:
    source_path = Path(source_path)
    data = source_path.read_bytes()
    if not data.startswith(OLE2_SIGNATURE):
        raise AccountingImportError("源文件不是 OLE2/BIFF Excel 工作簿")
    workbook = xlrd.open_workbook(file_contents=data)
    if workbook.nsheets < 1:
        raise AccountingImportError("工作簿没有工作表")
    sheet = workbook.sheet_by_index(0)
    if sheet.nrows < 2:
        raise AccountingImportError("工作表至少需要表头和一行数据")
    headers = tuple(_clean_text(value) for value in sheet.row_values(0))
    if headers != EXPECTED_HEADERS:
        raise AccountingImportError(
            f"账单表头必须为 {' | '.join(EXPECTED_HEADERS)}，实际为 {' | '.join(headers)}",
        )
    source_hash = hashlib.sha256(data).hexdigest()
    source_key = f"biff:{source_path.name}"
    return import_accounting_rows(
        (sheet.row_values(index) for index in range(1, sheet.nrows)),
        db_path,
        source_key=source_key,
        source_path=str(source_path),
        source_sha256=source_hash,
        datemode=workbook.datemode,
    )


def import_accounting_rows(
    rows: Iterable[Sequence[object]],
    db_path: Path,
    *,
    source_key: str,
    source_path: str,
    source_sha256: str,
    datemode: int = 0,
) -> AccountingImportResult:
    normalized = normalize_rows(rows, source_key=source_key, datemode=datemode)
    earliest = min(row.occurred_at for row in normalized)
    latest = max(row.occurred_at for row in normalized)
    initialize_accounting_schema(Path(db_path))
    imported_at = datetime.now(timezone.utc).isoformat()

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "DELETE FROM accounting_transactions WHERE source_key = ? AND origin = 'import'",
            (source_key,),
        )
        for account_name in sorted(_account_names(normalized)):
            _upsert_account(connection, account_name, earliest, imported_at)
        category_ids: dict[tuple[str, str], str] = {}
        for row in normalized:
            category_ids[(row.transaction_type, row.category_path[1])] = _upsert_category_path(
                connection,
                row.transaction_type,
                row.category_path,
            )
        for row in normalized:
            _insert_transaction(
                connection,
                row,
                category_ids[(row.transaction_type, row.category_path[1])],
                imported_at,
            )
        connection.execute(
            """
            INSERT INTO accounting_imports (
                source_key, source_path, source_sha256, imported_at, row_count,
                earliest_occurred_at, latest_occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_key) DO UPDATE SET
                source_path = excluded.source_path,
                source_sha256 = excluded.source_sha256,
                imported_at = excluded.imported_at,
                row_count = excluded.row_count,
                earliest_occurred_at = excluded.earliest_occurred_at,
                latest_occurred_at = excluded.latest_occurred_at
            """,
            (source_key, source_path, source_sha256, imported_at, len(normalized), earliest, latest),
        )

    return AccountingImportResult(len(normalized), earliest, latest, source_key)


def _amount_to_cents(value: object, row_number: int) -> int:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as error:
        raise AccountingImportError(f"第 {row_number} 行金额无效") from error
    cents = int(amount * 100)
    if cents <= 0:
        raise AccountingImportError(f"第 {row_number} 行金额必须大于 0")
    return cents


def _normalize_datetime(value: object, row_number: int, datemode: int) -> str:
    parsed: datetime
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            parsed = xlrd.xldate.xldate_as_datetime(float(value), datemode)
        except (ValueError, xlrd.XLDateError) as error:
            raise AccountingImportError(f"第 {row_number} 行时间无效") from error
    else:
        text = _clean_text(value)
        parsed = _parse_datetime_text(text, row_number)
    return parsed.replace(microsecond=0, tzinfo=None).isoformat(timespec="seconds")


def _parse_datetime_text(value: str, row_number: int) -> datetime:
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(value, pattern)
        except ValueError:
            continue
    raise AccountingImportError(f"第 {row_number} 行时间无效: {value or '空'}")


def _category_path(transaction_type: str, source_name: str, row_number: int) -> tuple[str, str]:
    groups = EXPENSE_CATEGORY_GROUPS if transaction_type == "expense" else INCOME_CATEGORY_GROUPS
    for parent_name, children in groups.items():
        if source_name in children:
            return parent_name, source_name
    raise AccountingImportError(f"第 {row_number} 行分类无效: {source_name or '空'}")


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _account_names(rows: Iterable[NormalizedAccountingRow]) -> set[str]:
    result: set[str] = set()
    for row in rows:
        result.update(
            name
            for name in (row.account_name, row.from_account_name, row.to_account_name)
            if name
        )
    return result


def _stable_slug(prefix: str, value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if cleaned:
        return f"{prefix}-{cleaned}"
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def _account_id(name: str) -> str:
    return ACCOUNT_IDS.get(name, _stable_slug("account", name))


def _upsert_account(connection: sqlite3.Connection, name: str, opening_at: str, now: str) -> None:
    nature = ACCOUNT_NATURES.get(name, "asset")
    connection.execute(
        """
        INSERT INTO accounting_accounts (
            id, name, nature, currency, opening_balance_in_cents, opening_balance_at,
            opening_balance_source, source_label, created_at, updated_at
        ) VALUES (?, ?, ?, 'CNY', 0, ?, 'import-zero-baseline', '记账助手导入', ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            nature = excluded.nature,
            source_label = excluded.source_label,
            updated_at = excluded.updated_at,
            opening_balance_in_cents = CASE
                WHEN accounting_accounts.opening_balance_source = 'manual'
                    THEN accounting_accounts.opening_balance_in_cents
                ELSE 0 END,
            opening_balance_at = CASE
                WHEN accounting_accounts.opening_balance_source = 'manual'
                    THEN accounting_accounts.opening_balance_at
                ELSE excluded.opening_balance_at END
        """,
        (_account_id(name), name, nature, opening_at, now, now),
    )


def _category_id(transaction_type: str, name: str, *, parent: bool) -> str:
    slug = PARENT_SLUGS.get(name) if parent else LEAF_SLUGS.get(name)
    if slug is None:
        slug = hashlib.sha1(name.encode("utf-8")).hexdigest()[:10]
    return f"category-{transaction_type}-{slug}"


def _upsert_category_path(
    connection: sqlite3.Connection,
    transaction_type: str,
    path: tuple[str, str],
) -> str:
    parent_name, leaf_name = path
    parent_id = _category_id(transaction_type, parent_name, parent=True)
    leaf_id = _category_id(transaction_type, leaf_name, parent=False)
    connection.execute(
        "INSERT OR IGNORE INTO accounting_categories "
        "(id, type, name, parent_id, sort_order, source_name) VALUES (?, ?, ?, NULL, ?, NULL)",
        (parent_id, transaction_type, parent_name, _parent_sort_order(transaction_type, parent_name)),
    )
    connection.execute(
        "INSERT OR IGNORE INTO accounting_categories "
        "(id, type, name, parent_id, sort_order, source_name) VALUES (?, ?, ?, ?, ?, ?)",
        (leaf_id, transaction_type, leaf_name, parent_id, _leaf_sort_order(transaction_type, leaf_name), leaf_name),
    )
    return leaf_id


def _parent_sort_order(transaction_type: str, name: str) -> int:
    groups = _groups_for_type(transaction_type)
    return list(groups).index(name) if name in groups else len(groups)


def _leaf_sort_order(transaction_type: str, name: str) -> int:
    groups = _groups_for_type(transaction_type)
    flattened = [child for children in groups.values() for child in children]
    return flattened.index(name) if name in flattened else len(flattened)


def _groups_for_type(transaction_type: str) -> dict[str, tuple[str, ...]]:
    if transaction_type == "expense":
        return EXPENSE_CATEGORY_GROUPS
    if transaction_type == "income":
        return INCOME_CATEGORY_GROUPS
    return {"账户往来": ("账户转账",)}


def _insert_transaction(
    connection: sqlite3.Connection,
    row: NormalizedAccountingRow,
    category_id: str,
    now: str,
) -> None:
    connection.execute(
        """
        INSERT INTO accounting_transactions (
            id, type, amount_in_cents, occurred_at, account_id, from_account_id,
            to_account_id, category_id, note, origin, source_key, source_record_id,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?)
        """,
        (
            f"transaction-import-{row.source_record_id}",
            row.transaction_type,
            row.amount_in_cents,
            row.occurred_at,
            _account_id(row.account_name) if row.account_name else None,
            _account_id(row.from_account_name) if row.from_account_name else None,
            _account_id(row.to_account_name) if row.to_account_name else None,
            category_id,
            row.note,
            row.source_key,
            row.source_record_id,
            now,
            now,
        ),
    )

