from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import character_event_stream as routes
from app.api import dependencies
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import app
from app.models.cloud_character import CloudCharacter
from app.schemas.character_events import (
    CharacterDeletedEvent,
    CharacterEventStreamPosition,
    CharacterFullResyncRequiredEvent,
    CharacterRealtimeSnapshot,
    CharacterShareRevokedEvent,
    CharacterUpdatedEvent,
)
from app.services import character_event_service as event_service
from app.services import character_stream_access_service as access_service

FIXED_TIME = datetime(2026, 7, 11, 12, 0, tzinfo=UTC)


def make_viewer() -> SimpleNamespace:
    return SimpleNamespace(id=uuid4(), email="viewer@example.com")


def make_character(*, character_id: UUID | None = None) -> CloudCharacter:
    return CloudCharacter(
        id=character_id or uuid4(),
        owner_user_id=uuid4(),
        local_character_id="owner-local-character",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5"},
        server_revision=3,
        content_hash="a" * 64,
        schema_version=1,
        created_at=FIXED_TIME,
        updated_at=FIXED_TIME,
        deleted_at=None,
        updated_by_device_id="owner-device",
    )


def make_access(
    *,
    character: CloudCharacter | None = None,
    viewer_user_id: UUID | None = None,
) -> access_service.CharacterStreamAccess:
    return access_service.CharacterStreamAccess(
        character=character or make_character(),
        role="viewer",
        user_id=viewer_user_id or uuid4(),
        share_id=uuid4(),
    )


def updated_event(
    *,
    character_id: UUID,
    event_id: str = "10",
    server_revision: int = 4,
) -> CharacterUpdatedEvent:
    return CharacterUpdatedEvent(
        eventId=event_id,
        characterId=character_id,
        serverRevision=server_revision,
        eventType="updated",
        snapshot=CharacterRealtimeSnapshot(
            name="Lyra",
            system="daggerheart",
            classKey="wizard",
            language="pt-BR",
            data={"hp_current": "4"},
            schemaVersion=1,
            updatedAt=FIXED_TIME,
        ),
        createdAt=FIXED_TIME,
    )


def deleted_event(
    *,
    character_id: UUID,
    event_id: str = "11",
    server_revision: int = 5,
) -> CharacterDeletedEvent:
    return CharacterDeletedEvent(
        eventId=event_id,
        characterId=character_id,
        serverRevision=server_revision,
        eventType="deleted",
        deletedAt=FIXED_TIME,
        createdAt=FIXED_TIME,
    )


def revoked_event(
    *,
    character_id: UUID,
    event_id: str = "12",
    server_revision: int = 5,
) -> CharacterShareRevokedEvent:
    return CharacterShareRevokedEvent(
        eventId=event_id,
        characterId=character_id,
        serverRevision=server_revision,
        eventType="share_revoked",
        revokedAt=FIXED_TIME,
        createdAt=FIXED_TIME,
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(rollback=AsyncMock())


@contextmanager
def authenticated_client(
    *,
    viewer: SimpleNamespace,
    session: SimpleNamespace | None = None,
) -> Iterator[TestClient]:
    test_session = session or make_session()

    async def override_db_session():
        yield test_session

    async def override_current_user():
        return viewer

    def override_settings() -> Settings:
        return Settings(
            app_env="test",
            character_event_poll_interval_seconds=0.001,
            character_event_heartbeat_seconds=0.01,
            character_event_access_recheck_seconds=0.01,
        )

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[dependencies.require_current_user] = override_current_user
    app.dependency_overrides[get_settings] = override_settings
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides = previous_overrides


def test_event_stream_route_is_registered() -> None:
    with TestClient(app) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "get" in response.json()["paths"][
        "/shared/characters/{character_id}/events"
    ]


def test_encode_sse_event_uses_cursor_name_and_camel_case_json() -> None:
    character_id = uuid4()

    frame = routes.encode_sse_event(updated_event(character_id=character_id))

    assert frame.startswith("id: 10\nevent: character.updated\ndata: {")
    assert '"characterId":"' + str(character_id) + '"' in frame
    assert '"serverRevision":4' in frame
    assert '"eventType":"updated"' in frame
    assert frame.endswith("\n\n")


def test_full_resync_frame_has_no_cursor() -> None:
    frame = routes.encode_sse_event(
        CharacterFullResyncRequiredEvent.create(
            character_id=uuid4(),
            server_revision=5,
            reason="unknown_cursor",
        )
    )

    assert frame.startswith("event: character.full_resync_required\n")
    assert "\nid: " not in frame
    assert '"reason":"unknown_cursor"' in frame


def test_parse_stream_position_requires_position_and_prefers_header() -> None:
    character_id = uuid4()
    with pytest.raises(HTTPException) as exc_info:
        routes.parse_stream_position(
            character_id=character_id,
            since_revision=None,
            last_event_id=None,
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "EVENT_STREAM_POSITION_REQUIRED"

    position = routes.parse_stream_position(
        character_id=character_id,
        since_revision=3,
        last_event_id=" 0010 ",
    )
    assert position.kind == "cursor"
    assert position.value == "10"


@pytest.mark.asyncio
async def test_prepare_revision_records_baseline_before_authorizing(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character()
    access = make_access(character=character, viewer_user_id=viewer_id)
    calls: list[str] = []

    async def latest(*_args, **_kwargs):
        calls.append("baseline")
        return 9

    async def authorize(*_args, **_kwargs):
        calls.append("authorize")
        return access

    monkeypatch.setattr(
        routes.event_service,
        "get_latest_viewer_visible_event_id",
        latest,
    )
    monkeypatch.setattr(
        routes.access_service,
        "get_shared_character_stream_access",
        authorize,
    )
    monkeypatch.setattr(
        routes.event_service,
        "list_character_content_events_since_revision",
        AsyncMock(return_value=event_service.CharacterEventPage(events=[], has_more=False)),
    )

    prepared = await routes.prepare_character_event_stream(
        SimpleNamespace(),
        character_id=character.id,
        viewer_user_id=viewer_id,
        position=CharacterEventStreamPosition(sinceRevision=3),
        batch_size=100,
    )

    assert isinstance(prepared, routes.PreparedCharacterEventStream)
    assert calls == ["baseline", "authorize"]
    assert prepared.live_baseline_cursor == 9
    assert prepared.replay_kind == "revision"


@pytest.mark.asyncio
async def test_prepare_converts_gap_and_unknown_cursor_to_resync(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character()
    access = make_access(character=character, viewer_user_id=viewer_id)
    monkeypatch.setattr(
        routes.access_service,
        "get_shared_character_stream_access",
        AsyncMock(return_value=access),
    )
    monkeypatch.setattr(
        routes.event_service,
        "get_latest_viewer_visible_event_id",
        AsyncMock(return_value=10),
    )
    monkeypatch.setattr(
        routes.event_service,
        "list_character_content_events_since_revision",
        AsyncMock(
            side_effect=event_service.CharacterEventHistoryGapError(
                character_id=character.id,
                since_revision=1,
                current_server_revision=3,
                oldest_available_revision=2,
            )
        ),
    )

    gap = await routes.prepare_character_event_stream(
        SimpleNamespace(),
        character_id=character.id,
        viewer_user_id=viewer_id,
        position=CharacterEventStreamPosition(sinceRevision=1),
        batch_size=100,
    )
    assert isinstance(gap, CharacterFullResyncRequiredEvent)
    assert gap.reason == "history_gap"
    assert gap.oldest_available_revision == 2

    monkeypatch.setattr(
        routes.event_service,
        "list_character_events_after_cursor",
        AsyncMock(
            side_effect=event_service.UnknownCharacterEventCursorError(
                character_id=character.id,
                event_id=999,
            )
        ),
    )
    unknown = await routes.prepare_character_event_stream(
        SimpleNamespace(),
        character_id=character.id,
        viewer_user_id=viewer_id,
        position=CharacterEventStreamPosition(lastEventId="999"),
        batch_size=100,
    )
    assert isinstance(unknown, CharacterFullResyncRequiredEvent)
    assert unknown.reason == "unknown_cursor"


@pytest.mark.asyncio
async def test_terminal_replay_closes_before_live_poll(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character()
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character, viewer_user_id=viewer_id),
        replay_kind="revision",
        replay_value=3,
        initial_events=[deleted_event(character_id=character.id)],
        initial_has_more=False,
        live_baseline_cursor=10,
    )
    live_poll_started = False

    async def live_polls(**_kwargs):
        nonlocal live_poll_started
        live_poll_started = True
        if False:
            yield None

    monkeypatch.setattr(
        routes.polling_service,
        "poll_character_events",
        live_polls,
    )
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))

    frames = [
        frame
        async for frame in routes.character_event_stream_body(
            request,
            prepared=prepared,
            batch_size=100,
            poll_interval_seconds=0.001,
            heartbeat_seconds=10,
            access_recheck_seconds=10,
        )
    ]

    assert len(frames) == 1
    assert "character.deleted" in frames[0]
    assert live_poll_started is False


@pytest.mark.asyncio
async def test_live_poll_delivers_update_then_targeted_revocation(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character()
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character, viewer_user_id=viewer_id),
        replay_kind="revision",
        replay_value=3,
        initial_events=[],
        initial_has_more=False,
        live_baseline_cursor=9,
    )
    async def live_polls(**_kwargs):
        yield routes.polling_service.CharacterEventPoll(
            page=event_service.CharacterEventPage(events=[], has_more=False),
            cursor=10,
            access_active=True,
        )
        yield routes.polling_service.CharacterEventPoll(
            page=event_service.CharacterEventPage(events=[], has_more=False),
            cursor=11,
            access_active=True,
        )

    monkeypatch.setattr(
        routes.polling_service,
        "poll_character_events",
        live_polls,
    )
    public_pages = iter(
        [
            [updated_event(character_id=character.id, event_id="10")],
            [revoked_event(character_id=character.id, event_id="11")],
        ]
    )
    monkeypatch.setattr(
        routes,
        "_to_public_events",
        lambda *_args, **_kwargs: next(public_pages),
    )
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))

    frames = [
        frame
        async for frame in routes.character_event_stream_body(
            request,
            prepared=prepared,
            batch_size=100,
            poll_interval_seconds=0.001,
            heartbeat_seconds=100,
            access_recheck_seconds=100,
        )
    ]

    assert ["character.updated" in frames[0], "character.share_revoked" in frames[1]] == [
        True,
        True,
    ]


def test_http_stream_requires_position() -> None:
    viewer = make_viewer()
    character_id = uuid4()

    with authenticated_client(viewer=viewer) as client:
        response = client.get(f"/shared/characters/{character_id}/events")

    assert response.status_code == 400
    assert response.json()["code"] == "EVENT_STREAM_POSITION_REQUIRED"


def test_http_stream_returns_terminal_resync_and_ends_read_transaction(
    monkeypatch,
) -> None:
    viewer = make_viewer()
    character_id = uuid4()
    session = make_session()
    monkeypatch.setattr(
        routes,
        "prepare_character_event_stream",
        AsyncMock(
            return_value=CharacterFullResyncRequiredEvent.create(
                character_id=character_id,
                server_revision=5,
                reason="unknown_cursor",
            )
        ),
    )

    with authenticated_client(viewer=viewer, session=session) as client:
        response = client.get(
            f"/shared/characters/{character_id}/events",
            headers={"Last-Event-ID": "10"},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache, no-store, private, no-transform"
    assert response.headers["x-accel-buffering"] == "no"
    assert "event: character.full_resync_required" in response.text
    assert '"reason":"unknown_cursor"' in response.text
    session.rollback.assert_awaited_once()


def test_stream_access_error_is_masked_as_shared_character_not_found(monkeypatch) -> None:
    viewer = make_viewer()
    character_id = uuid4()
    monkeypatch.setattr(
        routes.event_service,
        "get_latest_viewer_visible_event_id",
        AsyncMock(return_value=0),
    )
    monkeypatch.setattr(
        routes.access_service,
        "get_shared_character_stream_access",
        AsyncMock(
            side_effect=access_service.CharacterStreamAccessNotFoundError(character_id)
        ),
    )

    with authenticated_client(viewer=viewer) as client:
        response = client.get(
            f"/shared/characters/{character_id}/events?sinceRevision=3"
        )

    assert response.status_code == 404
    assert response.json() == {
        "code": "SHARED_CHARACTER_NOT_FOUND",
        "message": "Shared character was not found.",
        "detail": {"characterId": str(character_id)},
    }


@pytest.mark.asyncio
async def test_retention_gap_during_paginated_replay_emits_full_resync(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character()
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character, viewer_user_id=viewer_id),
        replay_kind="revision",
        replay_value=3,
        initial_events=[
            updated_event(
                character_id=character.id,
                event_id="10",
                server_revision=4,
            )
        ],
        initial_has_more=True,
        live_baseline_cursor=10,
    )
    monkeypatch.setattr(
        routes,
        "_load_replay_page",
        AsyncMock(
            side_effect=event_service.CharacterEventHistoryGapError(
                character_id=character.id,
                since_revision=4,
                current_server_revision=6,
                oldest_available_revision=6,
            )
        ),
    )
    live_poll = AsyncMock()
    monkeypatch.setattr(routes.polling_service, "poll_character_events", live_poll)
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))

    frames = [
        frame
        async for frame in routes.character_event_stream_body(
            request,
            prepared=prepared,
            batch_size=1,
            poll_interval_seconds=0.001,
            heartbeat_seconds=10,
            access_recheck_seconds=10,
        )
    ]

    assert len(frames) == 2
    assert "event: character.updated" in frames[0]
    assert "event: character.full_resync_required" in frames[1]
    assert '"reason":"history_gap"' in frames[1]
    assert '"oldestAvailableRevision":6' in frames[1]
    assert "\nid: " not in frames[1]
    live_poll.assert_not_awaited()


@pytest.mark.asyncio
async def test_pruned_cursor_during_paginated_replay_emits_full_resync(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character()
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character, viewer_user_id=viewer_id),
        replay_kind="cursor",
        replay_value=9,
        initial_events=[
            updated_event(
                character_id=character.id,
                event_id="10",
                server_revision=4,
            )
        ],
        initial_has_more=True,
        live_baseline_cursor=9,
    )
    monkeypatch.setattr(
        routes,
        "_load_replay_page",
        AsyncMock(
            side_effect=event_service.UnknownCharacterEventCursorError(
                character_id=character.id,
                event_id=10,
            )
        ),
    )
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))

    frames = [
        frame
        async for frame in routes.character_event_stream_body(
            request,
            prepared=prepared,
            batch_size=1,
            poll_interval_seconds=0.001,
            heartbeat_seconds=10,
            access_recheck_seconds=10,
        )
    ]

    assert len(frames) == 2
    assert "event: character.updated" in frames[0]
    assert "event: character.full_resync_required" in frames[1]
    assert '"reason":"unknown_cursor"' in frames[1]
    assert "\nid: " not in frames[1]
