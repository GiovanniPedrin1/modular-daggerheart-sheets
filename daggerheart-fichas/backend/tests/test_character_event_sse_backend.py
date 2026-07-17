from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import character_event_stream as routes
from app.api import dependencies
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import app
from app.models.character_event import CharacterEvent
from app.models.cloud_character import CloudCharacter
from app.schemas.character_events import (
    CharacterEventStreamPosition,
    CharacterFullResyncRequiredEvent,
    CharacterRealtimeSnapshot,
    CharacterUpdatedEvent,
)
from app.services import character_event_polling_service as polling_service
from app.services import character_event_service as event_service
from app.services import character_stream_access_service as access_service

FIXED_TIME = datetime(2026, 7, 11, 12, 0, tzinfo=UTC)


def make_viewer() -> SimpleNamespace:
    return SimpleNamespace(id=uuid4(), email="viewer@example.com")


def make_character(
    *,
    character_id: UUID | None = None,
    server_revision: int = 3,
) -> CloudCharacter:
    return CloudCharacter(
        id=character_id or uuid4(),
        owner_user_id=uuid4(),
        local_character_id="owner-local-character",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5"},
        server_revision=server_revision,
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


def make_persisted_updated_event(
    event_id: int,
    *,
    character_id: UUID,
    server_revision: int,
) -> CharacterEvent:
    event = CharacterEvent(
        character_id=character_id,
        server_revision=server_revision,
        event_type="updated",
        snapshot={
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "data": {"hp_current": str(8 - server_revision)},
            "schemaVersion": 1,
            "updatedAt": FIXED_TIME.isoformat().replace("+00:00", "Z"),
        },
        actor_user_id=uuid4(),
        audience_user_id=None,
        device_id="owner-device",
        created_at=FIXED_TIME,
    )
    event.id = event_id
    return event


def public_updated_event(
    *,
    character_id: UUID,
    event_id: str,
    server_revision: int,
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
            data={"hp_current": str(8 - server_revision)},
            schemaVersion=1,
            updatedAt=FIXED_TIME,
        ),
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


def test_heartbeat_is_an_sse_comment_without_cursor_or_event_name() -> None:
    frame = routes.encode_sse_heartbeat()

    assert frame == ": heartbeat\n\n"
    assert "id:" not in frame
    assert "event:" not in frame
    assert "data:" not in frame


def test_invalid_last_event_id_takes_precedence_and_returns_contract_error() -> None:
    character_id = uuid4()

    with pytest.raises(HTTPException) as exc_info:
        routes.parse_stream_position(
            character_id=character_id,
            since_revision=3,
            last_event_id="not-a-cursor",
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == {
        "code": "INVALID_EVENT_STREAM_POSITION",
        "message": "The event stream position is invalid.",
        "detail": {"characterId": str(character_id)},
    }


@pytest.mark.asyncio
async def test_prepare_cursor_replay_skips_revision_baseline(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character(server_revision=7)
    access = make_access(character=character, viewer_user_id=viewer_id)
    persisted = make_persisted_updated_event(
        12,
        character_id=character.id,
        server_revision=7,
    )
    latest_cursor = AsyncMock(return_value=999)
    cursor_replay = AsyncMock(
        return_value=event_service.CharacterEventPage(
            events=[persisted],
            has_more=False,
        )
    )
    monkeypatch.setattr(
        routes.event_service,
        "get_latest_viewer_visible_event_id",
        latest_cursor,
    )
    monkeypatch.setattr(
        routes.access_service,
        "get_shared_character_stream_access",
        AsyncMock(return_value=access),
    )
    monkeypatch.setattr(
        routes.event_service,
        "list_character_events_after_cursor",
        cursor_replay,
    )

    prepared = await routes.prepare_character_event_stream(
        SimpleNamespace(),
        character_id=character.id,
        viewer_user_id=viewer_id,
        position=CharacterEventStreamPosition(lastEventId="11"),
        batch_size=25,
    )

    assert isinstance(prepared, routes.PreparedCharacterEventStream)
    assert prepared.replay_kind == "cursor"
    assert prepared.replay_value == 11
    assert prepared.live_baseline_cursor == 11
    assert [event.event_id for event in prepared.initial_events] == ["12"]
    latest_cursor.assert_not_awaited()
    cursor_replay.assert_awaited_once_with(
        ANY,
        character_id=character.id,
        viewer_user_id=viewer_id,
        after_event_id=11,
        limit=25,
    )


@pytest.mark.asyncio
async def test_prepare_client_ahead_requests_full_resync(monkeypatch) -> None:
    viewer_id = uuid4()
    character = make_character(server_revision=5)
    monkeypatch.setattr(
        routes.event_service,
        "get_latest_viewer_visible_event_id",
        AsyncMock(return_value=20),
    )
    monkeypatch.setattr(
        routes.access_service,
        "get_shared_character_stream_access",
        AsyncMock(return_value=make_access(character=character, viewer_user_id=viewer_id)),
    )
    monkeypatch.setattr(
        routes.event_service,
        "list_character_content_events_since_revision",
        AsyncMock(
            side_effect=event_service.CharacterEventClientAheadError(
                character_id=character.id,
                since_revision=9,
                current_server_revision=5,
            )
        ),
    )

    prepared = await routes.prepare_character_event_stream(
        SimpleNamespace(),
        character_id=character.id,
        viewer_user_id=viewer_id,
        position=CharacterEventStreamPosition(sinceRevision=9),
        batch_size=100,
    )

    assert isinstance(prepared, CharacterFullResyncRequiredEvent)
    assert prepared.reason == "client_ahead"
    assert prepared.server_revision == 5
    assert "eventId" not in prepared.model_dump(by_alias=True, exclude_none=True)


def test_replay_error_mapping_reraises_unknown_service_errors() -> None:
    character = make_character()
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character),
        replay_kind="revision",
        replay_value=3,
        initial_events=[],
        initial_has_more=False,
        live_baseline_cursor=0,
    )
    error = event_service.CharacterEventServiceError("unexpected")

    with pytest.raises(event_service.CharacterEventServiceError) as exc_info:
        routes._replay_error_to_full_resync_event(error, prepared=prepared)

    assert exc_info.value is error


@pytest.mark.asyncio
async def test_paginated_revision_replay_advances_cursor_before_live_poll(
    monkeypatch,
) -> None:
    viewer_id = uuid4()
    character = make_character(server_revision=5)
    initial = public_updated_event(
        character_id=character.id,
        event_id="10",
        server_revision=4,
    )
    persisted_next = make_persisted_updated_event(
        11,
        character_id=character.id,
        server_revision=5,
    )
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character, viewer_user_id=viewer_id),
        replay_kind="revision",
        replay_value=3,
        initial_events=[initial],
        initial_has_more=True,
        live_baseline_cursor=9,
    )
    replay_page = AsyncMock(
        return_value=event_service.CharacterEventPage(
            events=[persisted_next],
            has_more=False,
        )
    )
    observed_live_cursor: list[int] = []

    async def live_poll(**kwargs) -> AsyncIterator[polling_service.CharacterEventPoll]:
        observed_live_cursor.append(kwargs["after_event_id"])
        yield polling_service.CharacterEventPoll(
            page=event_service.CharacterEventPage(events=[], has_more=False),
            cursor=kwargs["after_event_id"],
            access_active=False,
        )

    monkeypatch.setattr(routes, "_load_replay_page", replay_page)
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

    assert ["id: 10" in frame for frame in frames] == [True, False]
    assert ["id: 11" in frame for frame in frames] == [False, True]
    replay_page.assert_awaited_once_with(
        prepared,
        replay_value=4,
        batch_size=1,
        query_timeout_seconds=5.0,
    )
    assert observed_live_cursor == [11]


@pytest.mark.asyncio
async def test_empty_live_poll_emits_heartbeat_without_advancing_cursor(
    monkeypatch,
) -> None:
    character = make_character()
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character),
        replay_kind="revision",
        replay_value=3,
        initial_events=[],
        initial_has_more=False,
        live_baseline_cursor=21,
    )
    seen_cursor: list[int] = []

    async def live_poll(**kwargs) -> AsyncIterator[polling_service.CharacterEventPoll]:
        seen_cursor.append(kwargs["after_event_id"])
        yield polling_service.CharacterEventPoll(
            page=event_service.CharacterEventPage(events=[], has_more=False),
            cursor=21,
            access_active=True,
        )

    clock = iter([0.0, 5.0])
    monkeypatch.setattr(routes, "monotonic", lambda: next(clock))
    monkeypatch.setattr(routes.polling_service, "poll_character_events", live_poll)
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))

    frames = [
        frame
        async for frame in routes.character_event_stream_body(
            request,
            prepared=prepared,
            batch_size=100,
            poll_interval_seconds=1,
            heartbeat_seconds=5,
            access_recheck_seconds=5,
        )
    ]

    assert frames == [": heartbeat\n\n"]
    assert seen_cursor == [21]


@pytest.mark.asyncio
async def test_same_revision_returns_empty_replay_without_event_query(monkeypatch) -> None:
    session = SimpleNamespace(execute=AsyncMock())
    gap_check = AsyncMock(return_value=(False, None))
    monkeypatch.setattr(event_service, "has_character_event_history_gap", gap_check)

    page = await event_service.list_character_content_events_since_revision(
        session,
        character_id=uuid4(),
        since_revision=4,
        current_server_revision=4,
        limit=100,
    )

    assert page.events == []
    assert page.has_more is False
    gap_check.assert_awaited_once()
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("cursor", [0, event_service.MAX_CHARACTER_EVENT_ID + 1])
async def test_client_cursor_bounds_are_rejected_before_database_access(cursor: int) -> None:
    session = SimpleNamespace(execute=AsyncMock())

    with pytest.raises(ValueError, match="cursor"):
        await event_service.list_character_events_after_cursor(
            session,
            character_id=uuid4(),
            viewer_user_id=uuid4(),
            after_event_id=cursor,
        )

    session.execute.assert_not_awaited()


def test_http_stream_rejects_invalid_last_event_id_before_preparation(monkeypatch) -> None:
    viewer = make_viewer()
    character_id = uuid4()
    prepare = AsyncMock()
    monkeypatch.setattr(routes, "prepare_character_event_stream", prepare)

    with authenticated_client(viewer=viewer) as client:
        response = client.get(
            f"/shared/characters/{character_id}/events?sinceRevision=3",
            headers={"Last-Event-ID": "invalid"},
        )

    assert response.status_code == 422
    assert response.json() == {
        "code": "INVALID_EVENT_STREAM_POSITION",
        "message": "The event stream position is invalid.",
        "detail": {"characterId": str(character_id)},
    }
    prepare.assert_not_awaited()


def test_http_stream_rolls_back_when_authorization_fails(monkeypatch) -> None:
    viewer = make_viewer()
    character_id = uuid4()
    session = make_session()
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

    with authenticated_client(viewer=viewer, session=session) as client:
        response = client.get(
            f"/shared/characters/{character_id}/events?sinceRevision=3"
        )

    assert response.status_code == 404
    session.rollback.assert_awaited_once()


def test_http_live_stream_uses_sse_headers_and_last_event_id(monkeypatch) -> None:
    viewer = make_viewer()
    character = make_character()
    session = make_session()
    prepared = routes.PreparedCharacterEventStream(
        access=make_access(character=character, viewer_user_id=viewer.id),
        replay_kind="cursor",
        replay_value=25,
        initial_events=[],
        initial_has_more=False,
        live_baseline_cursor=25,
    )
    prepare = AsyncMock(return_value=prepared)
    body_calls: list[tuple[routes.PreparedCharacterEventStream, int]] = []

    async def finite_body(
        _request,
        *,
        prepared,
        batch_size,
        **_kwargs,
    ) -> AsyncIterator[str]:
        body_calls.append((prepared, batch_size))
        yield routes.encode_sse_heartbeat()

    monkeypatch.setattr(routes, "prepare_character_event_stream", prepare)
    monkeypatch.setattr(routes, "character_event_stream_body", finite_body)

    with authenticated_client(viewer=viewer, session=session) as client:
        response = client.get(
            f"/shared/characters/{character.id}/events?sinceRevision=1",
            headers={"Last-Event-ID": "25"},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache, no-store, private, no-transform"
    assert "connection" not in response.headers
    assert response.headers["x-accel-buffering"] == "no"
    assert response.text == ": heartbeat\n\n"
    position = prepare.await_args.kwargs["position"]
    assert position.kind == "cursor"
    assert position.value == "25"
    assert body_calls == [(prepared, 100)]
    session.rollback.assert_awaited_once()


def test_event_stream_requires_authentication() -> None:
    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides = {}
    try:
        with TestClient(app) as client:
            response = client.get(
                f"/shared/characters/{uuid4()}/events?sinceRevision=1"
            )
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_EXPIRED"
