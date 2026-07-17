from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.services.data_lifecycle_service import maintain_data_lifecycle


class _ScalarResult:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def scalars(self) -> SimpleNamespace:
        return SimpleNamespace(all=lambda: list(self._values))


class _DeleteResult:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


def _session_for_counts(counts: list[int]) -> SimpleNamespace:
    results: list[object] = []
    for count in counts:
        ids = [uuid4() for _ in range(count)]
        results.append(_ScalarResult(ids))
        if ids:
            results.append(_DeleteResult(len(ids)))
    return SimpleNamespace(execute=AsyncMock(side_effect=results))


@pytest.mark.asyncio
async def test_maintenance_deletes_each_expired_resource_in_a_bounded_batch() -> None:
    session = _session_for_counts([2, 1, 1, 2, 3])
    now = datetime(2026, 7, 16, 12, tzinfo=UTC)
    settings = Settings(
        app_env="test",
        data_lifecycle_batch_size=10,
        cloud_character_tombstone_retention_days=30,
        pending_share_retention_days=14,
        revoked_share_retention_days=21,
        refresh_session_retention_days=7,
        audit_retention_days=90,
    )

    result = await maintain_data_lifecycle(
        session,
        settings=settings,
        now=now,
    )

    assert result.counts() == {
        "cloud_character_tombstones": 2,
        "pending_character_shares": 1,
        "revoked_character_shares": 1,
        "refresh_sessions": 2,
        "audit_events": 3,
    }
    assert result.total_deleted == 9
    assert result.cloud_character_cutoff == now - timedelta(days=30)
    assert result.pending_share_cutoff == now - timedelta(days=14)
    assert result.revoked_share_cutoff == now - timedelta(days=21)
    assert result.refresh_session_cutoff == now - timedelta(days=7)
    assert result.audit_cutoff == now - timedelta(days=90)
    assert result.batch_limit_reached == ()
    assert session.execute.await_count == 10


@pytest.mark.asyncio
async def test_dry_run_only_selects_and_reports_without_deleting() -> None:
    results = [
        _ScalarResult([uuid4()]),
        _ScalarResult([]),
        _ScalarResult([]),
        _ScalarResult([]),
        _ScalarResult([]),
    ]
    session = SimpleNamespace(execute=AsyncMock(side_effect=results))

    result = await maintain_data_lifecycle(
        session,
        settings=Settings(app_env="test", data_lifecycle_batch_size=5),
        now=datetime(2026, 7, 16, tzinfo=UTC),
        dry_run=True,
    )

    assert result.dry_run is True
    assert result.cloud_characters_deleted == 1
    assert result.total_matched == 1
    assert result.total_deleted == 0
    assert session.execute.await_count == 5


@pytest.mark.asyncio
async def test_batch_limit_is_reported_for_scheduler_follow_up() -> None:
    session = _session_for_counts([2, 0, 0, 0, 0])

    result = await maintain_data_lifecycle(
        session,
        settings=Settings(app_env="test", data_lifecycle_batch_size=2),
        now=datetime(2026, 7, 16, tzinfo=UTC),
    )

    assert result.batch_limit_reached == ("cloud_character_tombstones",)


@pytest.mark.asyncio
async def test_maintenance_rejects_naive_time_and_oversized_runtime_batch() -> None:
    session = SimpleNamespace(execute=AsyncMock())
    settings = Settings(app_env="test", data_lifecycle_batch_size=10)

    with pytest.raises(ValueError, match="timezone"):
        await maintain_data_lifecycle(
            session,
            settings=settings,
            now=datetime(2026, 7, 16),
        )

    with pytest.raises(ValueError, match="configured maximum"):
        await maintain_data_lifecycle(
            session,
            settings=settings,
            now=datetime(2026, 7, 16, tzinfo=UTC),
            batch_size=11,
        )
