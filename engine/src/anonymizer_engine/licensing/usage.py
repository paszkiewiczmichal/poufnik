"""SQLite-backed usage counter storing metadata only."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, Field

from anonymizer_engine.licensing.plans import Plan


class UsageSnapshot(BaseModel):
    period: str
    requests: int = Field(ge=0)
    documents: int = Field(ge=0)


@dataclass(frozen=True)
class LimitCheck:
    allowed: bool
    reason: str | None = None


class UsageCounter:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def increment(self, endpoint: str, document_count: int = 0) -> None:
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO usage_events(timestamp, endpoint, document_count)
                VALUES (?, ?, ?)
                """,
                (now, endpoint, document_count),
            )

    def current_period_snapshot(self) -> UsageSnapshot:
        period = current_period()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*), COALESCE(SUM(document_count), 0)
                FROM usage_events
                WHERE timestamp >= ?
                """,
                (period,),
            ).fetchone()
        return UsageSnapshot(period=period, requests=int(row[0]), documents=int(row[1]))

    def check_limits(
        self,
        plan: Plan,
        *,
        request_count: int = 1,
        document_count: int = 0,
    ) -> LimitCheck:
        if plan.monthly_request_limit is None and plan.monthly_document_limit is None:
            return LimitCheck(allowed=True)

        snapshot = self.current_period_snapshot()
        if (
            plan.monthly_request_limit is not None
            and snapshot.requests + request_count > plan.monthly_request_limit
        ):
            return LimitCheck(
                allowed=False,
                reason=(
                    "Monthly request limit exceeded "
                    f"({plan.monthly_request_limit} requests)."
                ),
            )
        if (
            plan.monthly_document_limit is not None
            and snapshot.documents + document_count > plan.monthly_document_limit
        ):
            return LimitCheck(
                allowed=False,
                reason=(
                    "Monthly document limit exceeded "
                    f"({plan.monthly_document_limit} documents)."
                ),
            )
        return LimitCheck(allowed=True)

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS usage_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    endpoint TEXT NOT NULL,
                    document_count INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)


def current_period(now: datetime | None = None) -> str:
    value = now or datetime.now(UTC)
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
