from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.services import character_event_polling_service as polling_service
from app.services import character_event_service as event_service
from app.services import character_stream_access_service as access_service


class FakeSession:
    def __init__(self, name: str) -> None:
        self.name = name
        self.entered = False
        self.exited = False

    async def __aenter__(self):
        self.entered = True
        return self

    async def __aexit__(self, _exc_type, _exc, _tb) -> None:
        self.exited = True


class RecordingSessionFactory:
    def __init__(self) -> None:
        self.sessions: list[FakeSession] = []

    def __call__(self) -> FakeSession:
        session = FakeSession(f"session-{len(self.sessions) + 1}")
        self.sessions.append(session)
        return session


def make_access() -> access_service.CharacterStreamAccess:
    character = SimpleNamespace(id=uuid4(), server_revision=4)
    return access_service.CharacterStreamAccess(
        character=character,
        role="viewer",
        user_id=uuid4(),
        share_id=uuid4(),
    )


def page(*event_ids: int, has_more: bool = False) -> event_service.CharacterEventPage:
    return event_service.CharacterEventPage(
        events=[SimpleNamespace(id=event_id) for event_id in event_ids],
        has_more=has_more,
    )


async def collect_polls(
    iterator: AsyncIterator[polling_service.CharacterEventPoll],
    *,
    count: int,
) -> list[polling_service.CharacterEventPoll]:
    polls: list[polling_service.CharacterEventPoll] = []
    async for poll in iterator:
        polls.append(poll)
        if len(polls) == count:
            break
    await iterator.aclose()
    return polls


@pytest.mark.asyncio
async def test_polling_queries_immediately_advances_cursor_and_drains_backlog(
    monkeypatch,
) -> None:
    access = make_access()
    sessions = RecordingSessionFactory()
    queried_cursors: list[int] = []
    sleeps: list[float] = []

    async def list_events(_session, *, after_event_id: int, **_kwargs):
        queried_cursors.append(after_event_id)
        if len(queried_cursors) == 1:
            return page(10, has_more=True)
        return page(11, has_more=False)

    monkeypatch.setattr(
        polling_service.event_service,
        "list_character_events_after_position",
        list_events,
    )

    async def sleep(delay: float) -> None:
        sleeps.append(delay)

    iterator = polling_service.poll_character_events(
        access=access,
        after_event_id=9,
        limit=1,
        poll_interval_seconds=1,
        access_recheck_seconds=100,
        is_disconnected=AsyncMock(return_value=False),
        session_factory=sessions,
        sleep=sleep,
        clock=lambda: 0,
    )
    polls = await collect_polls(iterator, count=2)

    assert queried_cursors == [9, 10]
    assert [poll.cursor for poll in polls] == [10, 11]
    assert sleeps == []
    assert len(sessions.sessions) == 2
    assert all(session.entered and session.exited for session in sessions.sessions)


@pytest.mark.asyncio
async def test_polling_waits_only_after_catching_up(monkeypatch) -> None:
    access = make_access()
    sleeps: list[float] = []
    disconnect = AsyncMock(side_effect=[False, False, True])
    query = AsyncMock(
        side_effect=[
            page(has_more=False),
            page(20, has_more=False),
        ]
    )
    monkeypatch.setattr(
        polling_service.event_service,
        "list_character_events_after_position",
        query,
    )

    async def sleep(delay: float) -> None:
        sleeps.append(delay)

    iterator = polling_service.poll_character_events(
        access=access,
        after_event_id=19,
        limit=100,
        poll_interval_seconds=1.25,
        access_recheck_seconds=100,
        is_disconnected=disconnect,
        session_factory=RecordingSessionFactory(),
        sleep=sleep,
        clock=lambda: 0,
    )
    polls = [poll async for poll in iterator]

    assert [poll.cursor for poll in polls] == [19, 20]
    assert sleeps == [1.25, 1.25]
    assert query.await_count == 2


@pytest.mark.asyncio
async def test_polling_rechecks_exact_access_grant_and_stops(monkeypatch) -> None:
    access = make_access()
    sessions = RecordingSessionFactory()
    monkeypatch.setattr(
        polling_service.event_service,
        "list_character_events_after_position",
        AsyncMock(return_value=page(has_more=False)),
    )
    revalidate = AsyncMock(return_value=False)
    monkeypatch.setattr(
        polling_service.access_service,
        "is_character_stream_access_active",
        revalidate,
    )
    clock_values = iter([0.0, 5.0])

    iterator = polling_service.poll_character_events(
        access=access,
        after_event_id=0,
        limit=100,
        poll_interval_seconds=1,
        access_recheck_seconds=5,
        is_disconnected=AsyncMock(return_value=False),
        session_factory=sessions,
        sleep=AsyncMock(),
        clock=lambda: next(clock_values),
    )
    polls = [poll async for poll in iterator]

    assert len(polls) == 1
    assert polls[0].access_active is False
    assert len(sessions.sessions) == 2
    assert sessions.sessions[0] is not sessions.sessions[1]
    revalidate.assert_awaited_once_with(sessions.sessions[1], access=access)


@pytest.mark.asyncio
async def test_polling_stops_on_disconnect_before_opening_database_session(
    monkeypatch,
) -> None:
    query = AsyncMock()
    monkeypatch.setattr(
        polling_service.event_service,
        "list_character_events_after_position",
        query,
    )
    sessions = RecordingSessionFactory()

    polls = [
        poll
        async for poll in polling_service.poll_character_events(
            access=make_access(),
            after_event_id=0,
            limit=100,
            poll_interval_seconds=1,
            access_recheck_seconds=5,
            is_disconnected=AsyncMock(return_value=True),
            session_factory=sessions,
        )
    ]

    assert polls == []
    assert sessions.sessions == []
    query.assert_not_awaited()


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"after_event_id": -1}, "after_event_id cannot be negative"),
        ({"limit": 0}, "limit must be greater than zero"),
        ({"poll_interval_seconds": 0}, "poll_interval_seconds must be greater"),
        ({"access_recheck_seconds": 0}, "access_recheck_seconds must be greater"),
    ],
)
@pytest.mark.asyncio
async def test_polling_validates_configuration(kwargs, message: str) -> None:
    arguments = {
        "access": make_access(),
        "after_event_id": 0,
        "limit": 100,
        "poll_interval_seconds": 1,
        "access_recheck_seconds": 5,
        "is_disconnected": AsyncMock(return_value=True),
    }
    arguments.update(kwargs)

    with pytest.raises(ValueError, match=message):
        await anext(polling_service.poll_character_events(**arguments))
