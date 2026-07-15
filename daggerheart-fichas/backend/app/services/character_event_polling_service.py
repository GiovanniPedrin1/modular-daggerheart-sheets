from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from time import monotonic

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.services import character_event_service as event_service
from app.services import character_stream_access_service as access_service

type SessionFactory = Callable[[], AsyncSession]
type DisconnectCheck = Callable[[], Awaitable[bool]]
type Sleep = Callable[[float], Awaitable[None]]
type Clock = Callable[[], float]


@dataclass(frozen=True, slots=True)
class CharacterEventPoll:
    """One incremental database poll for an open character event stream."""

    page: event_service.CharacterEventPage
    cursor: int
    access_active: bool


def _require_positive_interval(value: float, *, name: str) -> float:
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


async def poll_character_events(
    *,
    access: access_service.CharacterStreamAccess,
    after_event_id: int,
    limit: int,
    poll_interval_seconds: float,
    access_recheck_seconds: float,
    is_disconnected: DisconnectCheck,
    session_factory: SessionFactory = AsyncSessionLocal,
    sleep: Sleep = asyncio.sleep,
    clock: Clock = monotonic,
) -> AsyncIterator[CharacterEventPoll]:
    """Poll events visible to an open owner/viewer stream.

    Owner streams receive content events only. Viewer streams also receive their
    own terminal ``share_revoked`` events. The first query happens immediately.
    Empty polls wait for the configured interval, while pages with more rows are
    drained without sleeping. Authorization is checked after querying events so a
    persisted terminal event can be delivered before the connection is closed.
    No transaction or session is kept alive between polls.
    """

    interval = _require_positive_interval(
        poll_interval_seconds,
        name="poll_interval_seconds",
    )
    recheck_interval = _require_positive_interval(
        access_recheck_seconds,
        name="access_recheck_seconds",
    )
    if after_event_id < 0:
        raise ValueError("after_event_id cannot be negative")
    if limit < 1:
        raise ValueError("limit must be greater than zero")

    cursor = after_event_id
    delay_before_next_poll = 0.0
    next_access_recheck = clock() + recheck_interval

    while True:
        if delay_before_next_poll > 0:
            await sleep(delay_before_next_poll)

        if await is_disconnected():
            return

        async with session_factory() as session:
            if access.role == "owner":
                page = await event_service.list_character_content_events_after_position(
                    session,
                    character_id=access.character_id,
                    after_event_id=cursor,
                    limit=limit,
                )
            else:
                page = await event_service.list_character_events_after_position(
                    session,
                    character_id=access.character_id,
                    viewer_user_id=access.user_id,
                    after_event_id=cursor,
                    limit=limit,
                )

        if page.last_event_id is not None:
            cursor = page.last_event_id

        now = clock()
        access_active = True
        if not page.has_more and now >= next_access_recheck:
            async with session_factory() as session:
                access_active = await access_service.is_character_stream_access_active(
                    session,
                    access=access,
                )
            next_access_recheck = now + recheck_interval

        yield CharacterEventPoll(
            page=page,
            cursor=cursor,
            access_active=access_active,
        )

        if not access_active:
            return

        # Drain a backlog immediately. Once caught up, wait before querying again.
        delay_before_next_poll = 0.0 if page.has_more else interval
