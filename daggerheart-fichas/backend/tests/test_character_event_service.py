from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.models.character_event import CharacterEvent
from app.models.cloud_character import CloudCharacter
from app.services import character_event_service as service


def now() -> datetime:
    return datetime.now(UTC)


def make_session() -> SimpleNamespace:
    return SimpleNamespace(
        add=Mock(),
        execute=AsyncMock(),
        flush=AsyncMock(),
    )


def make_character(
    *,
    server_revision: int = 4,
    deleted_at: datetime | None = None,
) -> CloudCharacter:
    timestamp = now()
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=uuid4(),
        local_character_id="local-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "4"},
        server_revision=server_revision,
        content_hash="a" * 64,
        schema_version=1,
        created_at=timestamp,
        updated_at=timestamp,
        deleted_at=deleted_at,
        updated_by_device_id="owner-device",
    )


def make_event(
    event_id: int,
    *,
    character_id: UUID | None = None,
    server_revision: int = 4,
    event_type: str = "updated",
    audience_user_id: UUID | None = None,
) -> CharacterEvent:
    timestamp = now()
    event = CharacterEvent(
        character_id=character_id or uuid4(),
        server_revision=server_revision,
        event_type=event_type,
        actor_user_id=uuid4(),
        audience_user_id=audience_user_id,
        device_id="owner-device",
        created_at=timestamp,
    )
    event.id = event_id
    if event_type == "updated":
        event.snapshot = {
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "data": {"hp_current": "4"},
            "schemaVersion": 1,
            "updatedAt": timestamp.isoformat().replace("+00:00", "Z"),
        }
    elif event_type == "deleted":
        event.deleted_at = timestamp
    elif event_type == "share_revoked":
        event.revoked_at = timestamp
    return event


def scalar_result(value):
    return SimpleNamespace(scalar_one_or_none=Mock(return_value=value))


def scalar_list_result(values):
    return SimpleNamespace(
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=values)))
    )


def row_result(value):
    return SimpleNamespace(one=Mock(return_value=value))


@pytest.mark.asyncio
async def test_append_updated_event_uses_complete_snapshot_and_device_fallback() -> None:
    character = make_character()
    session = make_session()

    event = await service.append_character_updated_event(
        session,
        character=character,
        actor_user_id=character.owner_user_id,
        changed_paths=["/data/hp_current"],
    )

    assert event.character_id == character.id
    assert event.server_revision == character.server_revision
    assert event.event_type == "updated"
    assert event.snapshot is not None
    assert event.snapshot["name"] == "Lyra"
    assert event.snapshot["updatedAt"].endswith("Z")
    assert event.actor_user_id == character.owner_user_id
    assert event.device_id == "owner-device"
    assert event.changed_paths == ["/data/hp_current"]
    session.add.assert_called_once_with(event)
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_append_deleted_event_requires_deleted_character() -> None:
    character = make_character()
    session = make_session()

    with pytest.raises(ValueError, match="deleted_at"):
        await service.append_character_deleted_event(
            session,
            character=character,
            actor_user_id=character.owner_user_id,
        )

    session.add.assert_not_called()
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_append_deleted_and_revoked_events_match_terminal_payloads() -> None:
    timestamp = now()
    character = make_character(server_revision=5, deleted_at=timestamp)
    viewer_user_id = uuid4()
    session = make_session()

    deleted = await service.append_character_deleted_event(
        session,
        character=character,
        actor_user_id=character.owner_user_id,
    )
    revoked = await service.append_share_revoked_event(
        session,
        character_id=character.id,
        server_revision=character.server_revision,
        audience_user_id=viewer_user_id,
        revoked_at=timestamp,
        actor_user_id=character.owner_user_id,
        device_id="owner-device-2",
    )

    assert deleted.event_type == "deleted"
    assert deleted.deleted_at == timestamp
    assert deleted.audience_user_id is None
    assert revoked.event_type == "share_revoked"
    assert revoked.audience_user_id == viewer_user_id
    assert revoked.revoked_at == timestamp
    assert revoked.device_id == "owner-device-2"
    assert session.add.call_count == 2
    assert session.flush.await_count == 2


@pytest.mark.asyncio
async def test_history_state_returns_revision_bounds_and_count() -> None:
    session = make_session()
    session.execute.return_value = row_result((3, 5, 3))
    character_id = uuid4()

    state = await service.get_character_event_history_state(
        session,
        character_id=character_id,
        after_revision=2,
        through_revision=5,
    )

    assert state.oldest_available_revision == 3
    assert state.newest_available_revision == 5
    assert state.available_revision_count == 3
    sql = str(session.execute.await_args.args[0])
    assert "character_events.snapshot IS NOT NULL" in sql
    assert "character_events.server_revision >" in sql
    assert "character_events.server_revision <=" in sql


@pytest.mark.asyncio
async def test_history_gap_rejects_client_ahead_without_query() -> None:
    session = make_session()
    character_id = uuid4()

    with pytest.raises(service.CharacterEventClientAheadError) as exc_info:
        await service.has_character_event_history_gap(
            session,
            character_id=character_id,
            since_revision=6,
            current_server_revision=5,
        )

    assert exc_info.value.character_id == character_id
    assert exc_info.value.since_revision == 6
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_history_gap_accepts_contiguous_revisions() -> None:
    session = make_session()
    session.execute.return_value = row_result((3, 5, 3))

    has_gap, oldest = await service.has_character_event_history_gap(
        session,
        character_id=uuid4(),
        since_revision=2,
        current_server_revision=5,
    )

    assert has_gap is False
    assert oldest == 3


@pytest.mark.asyncio
async def test_history_gap_detects_missing_or_pruned_revision() -> None:
    session = make_session()
    session.execute.return_value = row_result((4, 5, 2))

    has_gap, oldest = await service.has_character_event_history_gap(
        session,
        character_id=uuid4(),
        since_revision=2,
        current_server_revision=5,
    )

    assert has_gap is True
    assert oldest == 4


@pytest.mark.asyncio
async def test_list_content_events_since_revision_is_ordered_and_paginated(monkeypatch) -> None:
    character_id = uuid4()
    events = [
        make_event(10, character_id=character_id, server_revision=3),
        make_event(11, character_id=character_id, server_revision=4),
        make_event(12, character_id=character_id, server_revision=5),
    ]
    session = make_session()
    session.execute.return_value = scalar_list_result(events)
    monkeypatch.setattr(
        service,
        "has_character_event_history_gap",
        AsyncMock(return_value=(False, 3)),
    )

    page = await service.list_character_content_events_since_revision(
        session,
        character_id=character_id,
        since_revision=2,
        current_server_revision=5,
        limit=2,
    )

    assert page.events == events[:2]
    assert page.has_more is True
    assert page.last_event_id == 11
    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "character_events.snapshot IS NOT NULL" in sql
    assert "share_revoked" not in sql
    assert statement._limit_clause is not None


@pytest.mark.asyncio
async def test_list_content_events_raises_history_gap(monkeypatch) -> None:
    session = make_session()
    character_id = uuid4()
    monkeypatch.setattr(
        service,
        "has_character_event_history_gap",
        AsyncMock(return_value=(True, 30)),
    )

    with pytest.raises(service.CharacterEventHistoryGapError) as exc_info:
        await service.list_character_content_events_since_revision(
            session,
            character_id=character_id,
            since_revision=10,
            current_server_revision=50,
        )

    assert exc_info.value.oldest_available_revision == 30
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_cursor_availability_is_scoped_to_character_and_viewer() -> None:
    session = make_session()
    session.execute.return_value = scalar_result(1042)
    character_id = uuid4()
    viewer_user_id = uuid4()

    available = await service.is_character_event_cursor_available(
        session,
        character_id=character_id,
        viewer_user_id=viewer_user_id,
        event_id=1042,
    )

    assert available is True
    sql = str(session.execute.await_args.args[0])
    assert "character_events.id =" in sql
    assert "character_events.character_id =" in sql
    assert "character_events.audience_user_id =" in sql
    assert "character_events.snapshot IS NOT NULL" in sql


@pytest.mark.asyncio
async def test_cursor_replay_rejects_unknown_or_pruned_cursor(monkeypatch) -> None:
    session = make_session()
    character_id = uuid4()
    monkeypatch.setattr(
        service,
        "is_character_event_cursor_available",
        AsyncMock(return_value=False),
    )

    with pytest.raises(service.UnknownCharacterEventCursorError) as exc_info:
        await service.list_character_events_after_cursor(
            session,
            character_id=character_id,
            viewer_user_id=uuid4(),
            after_event_id=1042,
        )

    assert exc_info.value.event_id == 1042
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_cursor_replay_includes_general_and_targeted_events(monkeypatch) -> None:
    character_id = uuid4()
    viewer_user_id = uuid4()
    events = [
        make_event(1043, character_id=character_id, event_type="updated"),
        make_event(
            1044,
            character_id=character_id,
            event_type="share_revoked",
            audience_user_id=viewer_user_id,
        ),
    ]
    session = make_session()
    session.execute.return_value = scalar_list_result(events)
    monkeypatch.setattr(
        service,
        "is_character_event_cursor_available",
        AsyncMock(return_value=True),
    )

    page = await service.list_character_events_after_cursor(
        session,
        character_id=character_id,
        viewer_user_id=viewer_user_id,
        after_event_id=1042,
        limit=10,
    )

    assert page.events == events
    assert page.has_more is False
    sql = str(session.execute.await_args.args[0])
    assert "character_events.id >" in sql
    assert "character_events.audience_user_id =" in sql
    assert "ORDER BY character_events.id ASC" in sql


@pytest.mark.asyncio
async def test_compaction_replaces_expired_snapshot_with_path_only_marker() -> None:
    session = make_session()
    session.execute.return_value = SimpleNamespace(rowcount=6)
    settings = Settings(
        app_env="test",
        character_event_retention_days=30,
        character_event_retention_revisions=500,
    )
    character_id = uuid4()

    compacted = await service.compact_expired_character_events(
        session,
        settings=settings,
        now=datetime(2026, 7, 11, 12, 0, tzinfo=UTC),
        character_id=character_id,
    )

    assert compacted == 6
    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "UPDATE character_events SET snapshot=" in sql
    assert "row_number() OVER" in sql
    assert "character_events.snapshot IS NOT NULL" in sql
    assert "character_events.changed_paths IS NOT NULL" in sql
    assert "character_events.character_id =" in sql
    assert (
        statement._values[CharacterEvent.__table__.c.patch].value
        == service.COMPACTED_EVENT_PATCH
    )
    assert (
        statement._values[CharacterEvent.__table__.c.compacted_at].value
        == datetime(2026, 7, 11, 12, 0, tzinfo=UTC)
    )


@pytest.mark.asyncio
async def test_retention_deletes_expired_replay_and_compacted_events() -> None:
    session = make_session()
    session.execute.return_value = SimpleNamespace(rowcount=7)
    settings = Settings(
        app_env="test",
        character_event_retention_days=30,
        character_event_retention_revisions=500,
        character_event_compaction_retention_days=90,
        character_event_compaction_retention_revisions=2_000,
    )
    character_id = uuid4()

    deleted = await service.delete_expired_character_events(
        session,
        settings=settings,
        now=datetime(2026, 7, 11, 12, 0, tzinfo=UTC),
        character_id=character_id,
    )

    assert deleted == 7
    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "DELETE FROM character_events" in sql
    assert sql.count("row_number() OVER") == 2
    assert "character_events.created_at <" in sql
    assert "character_events.patch IS NOT NULL" in sql
    assert "character_events.character_id =" in sql


@pytest.mark.asyncio
async def test_retention_rejects_naive_clock() -> None:
    with pytest.raises(ValueError, match="timezone"):
        await service.delete_expired_character_events(
            make_session(),
            settings=Settings(app_env="test"),
            now=datetime(2026, 7, 11, 12, 0),
        )


@pytest.mark.parametrize(
    "field",
    [
        "character_event_retention_days",
        "character_event_retention_revisions",
        "character_event_compaction_retention_days",
        "character_event_compaction_retention_revisions",
        "character_event_replay_batch_size",
    ],
)
def test_character_event_settings_must_be_positive(field: str) -> None:
    with pytest.raises(ValidationError, match="greater than zero"):
        Settings(app_env="test", **{field: 0})

@pytest.mark.asyncio
async def test_latest_viewer_visible_cursor_returns_zero_without_events() -> None:
    session = make_session()
    session.execute.return_value = scalar_result(None)
    character_id = uuid4()
    viewer_user_id = uuid4()

    cursor = await service.get_latest_viewer_visible_event_id(
        session,
        character_id=character_id,
        viewer_user_id=viewer_user_id,
    )

    assert cursor == 0
    sql = str(session.execute.await_args.args[0])
    assert "max(character_events.id)" in sql.lower()
    assert "character_events.event_type" in sql
    assert "audience_user_id" in sql


@pytest.mark.asyncio
async def test_server_established_position_accepts_zero_and_filters_viewer_events() -> None:
    character_id = uuid4()
    viewer_user_id = uuid4()
    events = [make_event(1, character_id=character_id)]
    session = make_session()
    session.execute.return_value = scalar_list_result(events)

    page = await service.list_character_events_after_position(
        session,
        character_id=character_id,
        viewer_user_id=viewer_user_id,
        after_event_id=0,
        limit=10,
    )

    assert page.events == events
    assert page.has_more is False
    sql = str(session.execute.await_args.args[0])
    assert "character_events.id >" in sql
    assert "character_events.audience_user_id" in sql

    with pytest.raises(ValueError, match="negative"):
        await service.list_character_events_after_position(
            session,
            character_id=character_id,
            viewer_user_id=viewer_user_id,
            after_event_id=-1,
        )


@pytest.mark.asyncio
async def test_prune_character_events_returns_operational_summary(monkeypatch) -> None:
    session = make_session()
    settings = Settings(
        app_env="test",
        character_event_retention_days=14,
        character_event_retention_revisions=250,
        character_event_compaction_retention_days=60,
        character_event_compaction_retention_revisions=1_000,
    )
    current_time = datetime(2026, 7, 11, 12, 0, tzinfo=UTC)
    character_id = uuid4()
    compact_events = AsyncMock(return_value=12)
    delete_events = AsyncMock(return_value=9)
    monkeypatch.setattr(service, "compact_expired_character_events", compact_events)
    monkeypatch.setattr(service, "delete_expired_character_events", delete_events)

    result = await service.prune_character_events(
        session,
        settings=settings,
        now=current_time,
        character_id=character_id,
    )

    assert result.compacted_count == 12
    assert result.deleted_count == 9
    assert result.cutoff == datetime(2026, 6, 27, 12, 0, tzinfo=UTC)
    assert result.retention_days == 14
    assert result.retained_content_revisions == 250
    assert result.compaction_cutoff == datetime(2026, 5, 12, 12, 0, tzinfo=UTC)
    assert result.compaction_retention_days == 60
    assert result.retained_compacted_revisions == 1_000
    assert result.character_id == character_id
    compact_events.assert_awaited_once_with(
        session,
        settings=settings,
        now=current_time,
        character_id=character_id,
    )
    delete_events.assert_awaited_once_with(
        session,
        settings=settings,
        now=current_time,
        character_id=character_id,
    )


def test_compacted_event_marker_is_detected_without_exposing_snapshot() -> None:
    event = make_event(42)
    event.snapshot = None
    event.patch = dict(service.COMPACTED_EVENT_PATCH)
    event.compacted_at = now()
    event.changed_paths = ["/data/hp_current"]

    assert service.is_compacted_character_event(event) is True


def test_compaction_window_cannot_be_shorter_than_replay_window() -> None:
    with pytest.raises(ValidationError, match="COMPACTION_RETENTION_DAYS"):
        Settings(
            app_env="test",
            character_event_retention_days=30,
            character_event_compaction_retention_days=29,
        )

    with pytest.raises(ValidationError, match="COMPACTION_RETENTION_REVISIONS"):
        Settings(
            app_env="test",
            character_event_retention_revisions=500,
            character_event_compaction_retention_revisions=499,
        )
