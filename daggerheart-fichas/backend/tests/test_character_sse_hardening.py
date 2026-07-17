from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import character_event_stream as routes
from app.api.sse_response import HardenedSseStreamingResponse
from app.core.config import Settings
from app.services import character_event_polling_service as polling_service
from app.services import character_event_service as event_service
from app.services import rate_limit_service
from app.services.character_sse_lifecycle_service import (
    CharacterStreamConnectionControl,
    CharacterStreamDrainingError,
    CharacterStreamManager,
)
from app.services.character_stream_access_service import CharacterStreamAccess


def make_prepared_stream() -> routes.PreparedCharacterEventStream:
    character = SimpleNamespace(id=uuid4(), server_revision=4)
    access = CharacterStreamAccess(
        character=character,
        role="owner",
        user_id=uuid4(),
    )
    return routes.PreparedCharacterEventStream(
        access=access,
        replay_kind="revision",
        replay_value=4,
        initial_events=[],
        initial_has_more=False,
        live_baseline_cursor=0,
    )


def test_retry_and_reconnect_frames_are_cursor_neutral() -> None:
    assert routes.encode_sse_retry(3_000) == "retry: 3000\n\n"
    assert routes.encode_sse_reconnect("rotation") == ": reconnect rotation\n\n"
    assert "id:" not in routes.encode_sse_retry(3_000)
    assert "id:" not in routes.encode_sse_reconnect("rotation")


@pytest.mark.asyncio
async def test_stream_rotates_after_bounded_lifetime_without_polling(monkeypatch) -> None:
    poll = AsyncMock()
    monkeypatch.setattr(routes.polling_service, "poll_character_events", poll)
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
    clock_values = iter([0.0, 11.0])

    frames = [
        frame
        async for frame in routes.character_event_stream_body(
            request,
            prepared=make_prepared_stream(),
            batch_size=100,
            poll_interval_seconds=1,
            heartbeat_seconds=5,
            access_recheck_seconds=5,
            retry_milliseconds=2_500,
            max_duration_seconds=10,
            rotation_jitter_seconds=0,
            clock=lambda: next(clock_values),
        )
    ]

    assert frames == ["retry: 2500\n\n", ": reconnect rotation\n\n"]
    poll.assert_not_awaited()


@pytest.mark.asyncio
async def test_manager_rejects_new_streams_and_waits_for_active_stream() -> None:
    manager = CharacterStreamManager()
    control = CharacterStreamConnectionControl()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def hold_connection() -> None:
        async with manager.track(control):
            entered.set()
            await release.wait()

    task = asyncio.create_task(hold_connection())
    await entered.wait()

    assert await manager.begin_shutdown() == 1
    assert manager.shutdown_event.is_set()
    assert await manager.wait_for_drain(0.001) is False

    with pytest.raises(CharacterStreamDrainingError):
        async with manager.track(CharacterStreamConnectionControl()):
            pass

    release.set()
    await task
    assert await manager.wait_for_drain(0.1) is True
    assert manager.active_count == 0


@pytest.mark.asyncio
async def test_hardened_response_closes_slow_downstream() -> None:
    finalized = asyncio.Event()

    async def body() -> AsyncIterator[str]:
        try:
            yield "data: test\n\n"
        finally:
            finalized.set()

    async def slow_send(message) -> None:
        if message["type"] == "http.response.body" and message.get("body"):
            await asyncio.sleep(0.05)

    control = CharacterStreamConnectionControl()
    response = HardenedSseStreamingResponse(
        body(),
        send_timeout_seconds=0.001,
        control=control,
        media_type=routes.SSE_MEDIA_TYPE,
    )

    with pytest.raises(OSError, match="timed out"):
        await response.stream_response(slow_send)

    assert control.close_reason == "slow_client"
    assert finalized.is_set()


@pytest.mark.asyncio
async def test_polling_times_out_stuck_database_query(monkeypatch) -> None:
    async def stuck_query(*_args, **_kwargs):
        await asyncio.sleep(1)
        return event_service.CharacterEventPage(events=[], has_more=False)

    monkeypatch.setattr(
        polling_service.event_service,
        "list_character_content_events_after_position",
        stuck_query,
    )
    prepared = make_prepared_stream()

    iterator = polling_service.poll_character_events(
        access=prepared.access,
        after_event_id=0,
        limit=100,
        poll_interval_seconds=1,
        access_recheck_seconds=5,
        query_timeout_seconds=0.001,
        is_disconnected=AsyncMock(return_value=False),
    )

    with pytest.raises(polling_service.CharacterEventPollDatabaseTimeoutError):
        await anext(iterator)


@pytest.mark.asyncio
async def test_prepare_timeout_returns_retryable_service_error(monkeypatch) -> None:
    async def stuck_prepare(*_args, **_kwargs):
        await asyncio.sleep(1)

    monkeypatch.setattr(routes, "prepare_character_event_stream", stuck_prepare)

    with pytest.raises(HTTPException) as exc_info:
        await routes.prepare_character_event_stream_with_timeout(
            SimpleNamespace(),
            character_id=uuid4(),
            user_id=uuid4(),
            owner_only=True,
            position=SimpleNamespace(),
            batch_size=100,
            timeout_seconds=0.001,
            retry_after_seconds=3,
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "EVENT_STREAM_UNAVAILABLE"
    assert exc_info.value.headers == {"Retry-After": "3"}


@pytest.mark.asyncio
async def test_rate_limit_lease_refreshes_while_stream_is_idle() -> None:
    class Lease:
        limit = 1
        remaining = 0
        refresh_interval_seconds = 0.005

        def __init__(self) -> None:
            self.refresh_count = 0
            self.release_count = 0

        async def refresh(self) -> None:
            self.refresh_count += 1

        async def release(self) -> None:
            self.release_count += 1

    async def idle_stream() -> AsyncIterator[str]:
        await asyncio.sleep(0.018)
        yield "frame"

    lease = Lease()
    frames = [
        frame
        async for frame in rate_limit_service.stream_with_rate_limit_lease(
            idle_stream(),
            lease=lease,
        )
    ]

    assert frames == ["frame"]
    assert lease.refresh_count >= 2
    assert lease.release_count == 1

@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        (
            {
                "character_event_poll_interval_seconds": 16,
                "character_event_heartbeat_seconds": 15,
            },
            "POLL_INTERVAL_SECONDS",
        ),
        (
            {
                "character_event_heartbeat_seconds": 15,
                "character_event_stream_max_duration_seconds": 29,
            },
            "MAX_DURATION_SECONDS",
        ),
        (
            {
                "character_event_stream_max_duration_seconds": 60,
                "character_event_stream_rotation_jitter_seconds": 61,
            },
            "ROTATION_JITTER_SECONDS",
        ),
        (
            {"character_event_send_timeout_seconds": 301},
            "SEND_TIMEOUT_SECONDS",
        ),
    ],
)
def test_sse_startup_contract_rejects_unsafe_values(overrides, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        Settings(app_env="test", **overrides)



@pytest.mark.asyncio
async def test_hardened_response_releases_resources_when_headers_cannot_be_sent() -> None:
    cleanup_calls = 0

    async def body() -> AsyncIterator[str]:
        yield "never-started"

    async def blocked_send(_message) -> None:
        await asyncio.sleep(1)

    async def cleanup() -> None:
        nonlocal cleanup_calls
        cleanup_calls += 1

    control = CharacterStreamConnectionControl()
    response = HardenedSseStreamingResponse(
        body(),
        send_timeout_seconds=0.001,
        control=control,
        media_type=routes.SSE_MEDIA_TYPE,
        cleanup=cleanup,
    )

    with pytest.raises(OSError, match="timed out"):
        await response.stream_response(blocked_send)

    assert cleanup_calls == 1
    assert control.close_reason == "slow_client"
