from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.commands import prune_character_events as command
from app.core.config import Settings
from app.services.character_event_service import CharacterEventRetentionResult


class SessionContext:
    def __init__(self, session: SimpleNamespace) -> None:
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        return None


class SessionFactory:
    def __init__(self, session: SimpleNamespace) -> None:
        self.session = session

    def __call__(self) -> SessionContext:
        return SessionContext(self.session)


@pytest.mark.asyncio
async def test_run_retention_commits_and_returns_summary(monkeypatch) -> None:
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    current_time = datetime(2026, 7, 11, 12, 0, tzinfo=UTC)
    character_id = uuid4()
    expected = CharacterEventRetentionResult(
        deleted_count=7,
        cutoff=datetime(2026, 6, 11, 12, 0, tzinfo=UTC),
        retention_days=30,
        retained_content_revisions=500,
        character_id=character_id,
    )
    prune = AsyncMock(return_value=expected)
    monkeypatch.setattr(command, "prune_character_events", prune)
    settings = Settings(app_env="test")

    result = await command.run_retention(
        character_id=character_id,
        now=current_time,
        settings=settings,
        session_factory=SessionFactory(session),
    )

    assert result == expected
    prune.assert_awaited_once_with(
        session,
        settings=settings,
        now=current_time,
        character_id=character_id,
    )
    session.commit.assert_awaited_once_with()
    session.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_retention_rolls_back_on_failure(monkeypatch) -> None:
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    monkeypatch.setattr(
        command,
        "prune_character_events",
        AsyncMock(side_effect=RuntimeError("database unavailable")),
    )

    with pytest.raises(RuntimeError, match="database unavailable"):
        await command.run_retention(
            settings=Settings(app_env="test"),
            session_factory=SessionFactory(session),
        )

    session.commit.assert_not_awaited()
    session.rollback.assert_awaited_once_with()


def test_retention_command_payload_is_machine_readable() -> None:
    character_id = uuid4()
    result = CharacterEventRetentionResult(
        deleted_count=3,
        cutoff=datetime(2026, 6, 11, 12, 0, tzinfo=UTC),
        retention_days=30,
        retained_content_revisions=500,
        character_id=character_id,
    )

    assert command.retention_result_payload(result) == {
        "deletedCount": 3,
        "cutoff": "2026-06-11T12:00:00+00:00",
        "retentionDays": 30,
        "retainedContentRevisions": 500,
        "characterId": str(character_id),
    }


def test_retention_command_rejects_now_without_timezone() -> None:
    parser = command.build_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["--now", "2026-07-11T12:00:00"])
