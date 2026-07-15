from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .store import AccountingInputError, AccountingNotFoundError, AccountingStore


class TransactionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["income", "expense", "transfer"]
    amountInCents: int = Field(gt=0)
    occurredAt: str
    accountId: str | None = None
    fromAccountId: str | None = None
    toAccountId: str | None = None
    categoryId: str | None = None
    tagIds: list[str] = Field(default_factory=list)
    note: str | None = None


class AccountPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    nature: Literal["asset", "liability"] | None = None
    openingBalanceInCents: int | None = None
    openingBalanceAt: str | None = None
    sourceLabel: str | None = None
    brandSlug: str | None = None
    brandLabel: str | None = None
    brandColor: str | None = None
    hidden: bool | None = None
    archivedAt: str | None = None


def create_accounting_router(store: AccountingStore) -> APIRouter:
    router = APIRouter()

    @router.get("/dataset")
    def get_dataset() -> dict[str, object]:
        return store.get_dataset()

    @router.post("/transactions", status_code=201)
    def create_transaction(payload: TransactionWrite) -> dict[str, object]:
        return _translate_errors(lambda: store.create_transaction(payload.model_dump()))

    @router.put("/transactions/{transaction_id}")
    def update_transaction(transaction_id: str, payload: TransactionWrite) -> dict[str, object]:
        return _translate_errors(
            lambda: store.update_transaction(transaction_id, payload.model_dump()),
        )

    @router.patch("/accounts/{account_id}")
    def update_account(account_id: str, payload: AccountPatch) -> dict[str, object]:
        return _translate_errors(
            lambda: store.update_account(account_id, payload.model_dump(exclude_unset=True)),
        )

    return router


def _translate_errors(operation):
    try:
        return operation()
    except AccountingInputError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except AccountingNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

