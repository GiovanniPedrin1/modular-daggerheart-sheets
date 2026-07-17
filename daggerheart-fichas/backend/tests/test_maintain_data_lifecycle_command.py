from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.commands import maintain_data_lifecycle as command
from app.core.config import Settings
from app.services.data_lifecycle_service import DataLifecycleRetentionResult


class _SessionContext:
    def __init__(self, session: SimpleNamespace) -> None:
        self.session = session

    async def __aenter__(self) -> SimpleNamespace:
        return self.session

    async def __aexit__(self, *_args) -> None:
        return None


def _result(*, dry_run: bool = False) -> DataLifecycleRetentionResult:
    now = datetime(2026, 7, 16, tzinfo=UTC)
    return DataLifecycleRetentionResult(
        now=now,
        dry_run=dry_run,
        batch_size=500,
        cloud_character_cutoff=now - timedelta(days=30),
        pending_share_cutoff=now - timedelta(days=30),
        revoked_share_cutoff=now - timedelta(days=30),
        refresh_session_cutoff=now - timedelta(days=7),
        audit_cutoff=now - timedelta(days=90),
        cloud_characters_deleted=1,
        pending_shares_deleted=2,
        revoked_shares_deleted=3,
        refresh_sessions_deleted=4,
        audit_events_deleted=5,
        batch_limit_reached=("audit_events",),
    )


@pytest.mark.asyncio
async def test_command_commits_delete_run(monkeypatch) -> None:
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    maintenance = AsyncMock(return_value=_result())
    monkeypatch.setattr(command, "maintain_data_lifecycle", maintenance)

    result = await command.run_maintenance(
        settings=Settings(app_env="test"),
        session_factory=lambda: _SessionContext(session),
    )

    assert result.total_deleted == 15
    session.commit.assert_awaited_once()
    session.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_command_rolls_back_dry_run(monkeypatch) -> None:
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    monkeypatch.setattr(
        command,
        "maintain_data_lifecycle",
        AsyncMock(return_value=_result(dry_run=True)),
    )

    await command.run_maintenance(
        dry_run=True,
        settings=Settings(app_env="test"),
        session_factory=lambda: _SessionContext(session),
    )

    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


def test_command_payload_is_machine_readable() -> None:
    payload = command.lifecycle_result_payload(_result())

    assert payload["totalMatched"] == 15
    assert payload["totalDeleted"] == 15
    assert payload["counts"]["audit_events"] == 5
    assert payload["batchLimitReached"] == ["audit_events"]
    assert payload["cutoffs"]["refreshSession"].endswith("+00:00")


def test_command_rejects_naive_now() -> None:
    with pytest.raises(SystemExit):
        command.build_parser().parse_args(["--now", "2026-07-16T12:00:00"])
