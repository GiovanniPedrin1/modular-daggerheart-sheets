from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from time import monotonic
from typing import Literal, NoReturn
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.api.dependencies import CurrentUser, DbSession, SettingsDep
from app.api.errors import api_error
from app.db.session import AsyncSessionLocal
from app.schemas.character_events import (
    CharacterDeletedEvent,
    CharacterEventStreamPosition,
    CharacterFullResyncRequiredEvent,
    CharacterShareRevokedEvent,
    CharacterUpdatedEvent,
    EventStreamPositionRequiredDetail,
    character_event_public_from_model,
)
from app.services import character_event_polling_service as polling_service
from app.services import character_event_service as event_service
from app.services import character_stream_access_service as access_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["character-events"])

SSE_MEDIA_TYPE = "text/event-stream"
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}
SSE_EVENT_NAMES = {
    "updated": "character.updated",
    "deleted": "character.deleted",
    "share_revoked": "character.share_revoked",
    "full_resync_required": "character.full_resync_required",
}

type PublicPersistedEvent = (
    CharacterUpdatedEvent | CharacterDeletedEvent | CharacterShareRevokedEvent
)
type ReplayKind = Literal["revision", "cursor"]


@dataclass(frozen=True, slots=True)
class PreparedCharacterEventStream:
    access: access_service.CharacterStreamAccess
    replay_kind: ReplayKind
    replay_value: int
    initial_events: list[PublicPersistedEvent]
    initial_has_more: bool
    live_baseline_cursor: int


def encode_sse_event(
    event: PublicPersistedEvent | CharacterFullResyncRequiredEvent,
) -> str:
    """Serialize a validated public event as one SSE frame."""

    lines: list[str] = []
    event_id = getattr(event, "event_id", None)
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {SSE_EVENT_NAMES[event.event_type]}")

    payload = event.model_dump_json(by_alias=True, exclude_none=True)
    lines.extend(f"data: {line}" for line in payload.splitlines() or [""])
    return "\n".join(lines) + "\n\n"


def encode_sse_heartbeat() -> str:
    return ": heartbeat\n\n"


def _to_public_events(
    events,
    *,
    viewer_user_id: UUID,
) -> list[PublicPersistedEvent]:
    return [
        character_event_public_from_model(event, viewer_user_id=viewer_user_id)
        for event in events
    ]


def _is_terminal_event(event: PublicPersistedEvent) -> bool:
    return event.event_type in {"deleted", "share_revoked"}


def raise_stream_access_api_error(
    error: access_service.CharacterStreamAccessError,
) -> NoReturn:
    if isinstance(error, access_service.CharacterStreamAccessNotFoundError):
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "SHARED_CHARACTER_NOT_FOUND",
            "Shared character was not found.",
            {"characterId": str(error.character_id)},
        ) from error
    raise error


def parse_stream_position(
    *,
    character_id: UUID,
    since_revision: int | None,
    last_event_id: str | None,
) -> CharacterEventStreamPosition:
    if since_revision is None and last_event_id is None:
        detail = EventStreamPositionRequiredDetail(characterId=character_id)
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "EVENT_STREAM_POSITION_REQUIRED",
            "Last-Event-ID or sinceRevision is required.",
            detail.model_dump(by_alias=True, mode="json"),
        )

    try:
        return CharacterEventStreamPosition(
            sinceRevision=since_revision,
            lastEventId=last_event_id,
        )
    except ValidationError as error:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_EVENT_STREAM_POSITION",
            "The event stream position is invalid.",
            {"characterId": str(character_id)},
        ) from error


def full_resync_response(
    event: CharacterFullResyncRequiredEvent,
) -> StreamingResponse:
    async def event_body() -> AsyncIterator[str]:
        yield encode_sse_event(event)

    return StreamingResponse(
        event_body(),
        media_type=SSE_MEDIA_TYPE,
        headers=SSE_HEADERS,
    )


async def prepare_character_event_stream(
    session: DbSession,
    *,
    character_id: UUID,
    user_id: UUID | None = None,
    owner_only: bool = False,
    viewer_user_id: UUID | None = None,
    position: CharacterEventStreamPosition,
    batch_size: int,
) -> PreparedCharacterEventStream | CharacterFullResyncRequiredEvent:
    """Authorize and prepare the finite replay preceding the live poll loop."""

    resolved_user_id = user_id if user_id is not None else viewer_user_id
    if resolved_user_id is None:
        raise ValueError("user_id is required to prepare a character event stream")

    # Establish the live cursor before authorizing the exact active share. If the
    # share is revoked between these operations, authorization fails. If it is
    # revoked afterwards, the new revocation event has a greater cursor and is
    # delivered by the live loop.
    live_baseline_cursor = 0
    if position.kind == "revision":
        if owner_only:
            live_baseline_cursor = await event_service.get_latest_content_event_id(
                session,
                character_id=character_id,
            )
        else:
            live_baseline_cursor = await event_service.get_latest_viewer_visible_event_id(
                session,
                character_id=character_id,
                viewer_user_id=resolved_user_id,
            )

    try:
        if owner_only:
            access = await access_service.get_character_stream_access(
                session,
                user_id=resolved_user_id,
                character_id=character_id,
            )
            if access.role != "owner":
                raise access_service.CharacterStreamAccessNotFoundError(character_id)
        else:
            access = await access_service.get_shared_character_stream_access(
                session,
                viewer_user_id=resolved_user_id,
                character_id=character_id,
            )
    except access_service.CharacterStreamAccessError as error:
        raise_stream_access_api_error(error)

    if position.kind == "cursor":
        cursor = int(position.value)
        try:
            if owner_only:
                page = await event_service.list_character_content_events_after_cursor(
                    session,
                    character_id=character_id,
                    after_event_id=cursor,
                    limit=batch_size,
                )
            else:
                page = await event_service.list_character_events_after_cursor(
                    session,
                    character_id=character_id,
                    viewer_user_id=resolved_user_id,
                    after_event_id=cursor,
                    limit=batch_size,
                )
        except event_service.UnknownCharacterEventCursorError:
            return CharacterFullResyncRequiredEvent.create(
                character_id=character_id,
                server_revision=access.server_revision,
                reason="unknown_cursor",
            )

        return PreparedCharacterEventStream(
            access=access,
            replay_kind="cursor",
            replay_value=cursor,
            initial_events=_to_public_events(
                page.events,
                viewer_user_id=resolved_user_id,
            ),
            initial_has_more=page.has_more,
            live_baseline_cursor=cursor,
        )

    since_revision = int(position.value)
    try:
        page = await event_service.list_character_content_events_since_revision(
            session,
            character_id=character_id,
            since_revision=since_revision,
            current_server_revision=access.server_revision,
            limit=batch_size,
        )
    except event_service.CharacterEventHistoryGapError as error:
        return CharacterFullResyncRequiredEvent.create(
            character_id=character_id,
            server_revision=error.current_server_revision,
            reason="history_gap",
            oldest_available_revision=error.oldest_available_revision,
        )
    except event_service.CharacterEventClientAheadError as error:
        return CharacterFullResyncRequiredEvent.create(
            character_id=character_id,
            server_revision=error.current_server_revision,
            reason="client_ahead",
        )

    return PreparedCharacterEventStream(
        access=access,
        replay_kind="revision",
        replay_value=since_revision,
        initial_events=_to_public_events(
            page.events,
            viewer_user_id=resolved_user_id,
        ),
        initial_has_more=page.has_more,
        live_baseline_cursor=live_baseline_cursor,
    )


async def _load_replay_page(
    prepared: PreparedCharacterEventStream,
    *,
    replay_value: int,
    batch_size: int,
):
    async with AsyncSessionLocal() as session:
        if prepared.replay_kind == "revision":
            return await event_service.list_character_content_events_since_revision(
                session,
                character_id=prepared.access.character_id,
                since_revision=replay_value,
                current_server_revision=prepared.access.server_revision,
                limit=batch_size,
            )
        if prepared.access.role == "owner":
            return await event_service.list_character_content_events_after_cursor(
                session,
                character_id=prepared.access.character_id,
                after_event_id=replay_value,
                limit=batch_size,
            )
        return await event_service.list_character_events_after_cursor(
            session,
            character_id=prepared.access.character_id,
            viewer_user_id=prepared.access.user_id,
            after_event_id=replay_value,
            limit=batch_size,
        )


def _replay_error_to_full_resync_event(
    error: event_service.CharacterEventServiceError,
    *,
    prepared: PreparedCharacterEventStream,
) -> CharacterFullResyncRequiredEvent:
    if isinstance(error, event_service.CharacterEventHistoryGapError):
        return CharacterFullResyncRequiredEvent.create(
            character_id=prepared.access.character_id,
            server_revision=error.current_server_revision,
            reason="history_gap",
            oldest_available_revision=error.oldest_available_revision,
        )
    if isinstance(error, event_service.CharacterEventClientAheadError):
        return CharacterFullResyncRequiredEvent.create(
            character_id=prepared.access.character_id,
            server_revision=error.current_server_revision,
            reason="client_ahead",
        )
    if isinstance(error, event_service.UnknownCharacterEventCursorError):
        return CharacterFullResyncRequiredEvent.create(
            character_id=prepared.access.character_id,
            server_revision=prepared.access.server_revision,
            reason="unknown_cursor",
        )
    raise error


async def character_event_stream_body(
    request: Request,
    *,
    prepared: PreparedCharacterEventStream,
    batch_size: int,
    poll_interval_seconds: float,
    heartbeat_seconds: float,
    access_recheck_seconds: float,
) -> AsyncIterator[str]:
    """Replay persisted events, then poll with short independent DB sessions."""

    replay_value = prepared.replay_value
    live_cursor = prepared.live_baseline_cursor
    events = prepared.initial_events
    has_more = prepared.initial_has_more

    while True:
        for event in events:
            yield encode_sse_event(event)
            replay_value = (
                event.server_revision
                if prepared.replay_kind == "revision"
                else int(event.event_id)
            )
            live_cursor = max(live_cursor, int(event.event_id))
            if _is_terminal_event(event):
                return

        if not has_more:
            break
        try:
            page = await _load_replay_page(
                prepared,
                replay_value=replay_value,
                batch_size=batch_size,
            )
        except (
            event_service.CharacterEventHistoryGapError,
            event_service.CharacterEventClientAheadError,
            event_service.UnknownCharacterEventCursorError,
        ) as error:
            yield encode_sse_event(
                _replay_error_to_full_resync_event(error, prepared=prepared)
            )
            return
        events = _to_public_events(
            page.events,
            viewer_user_id=prepared.access.user_id,
        )
        has_more = page.has_more

    last_heartbeat = monotonic()
    async for poll in polling_service.poll_character_events(
        access=prepared.access,
        after_event_id=live_cursor,
        limit=batch_size,
        poll_interval_seconds=poll_interval_seconds,
        access_recheck_seconds=access_recheck_seconds,
        is_disconnected=request.is_disconnected,
    ):
        public_events = _to_public_events(
            poll.page.events,
            viewer_user_id=prepared.access.user_id,
        )
        for event in public_events:
            yield encode_sse_event(event)
            last_heartbeat = monotonic()
            if _is_terminal_event(event):
                return

        if not poll.access_active:
            return

        now = monotonic()
        if now - last_heartbeat >= heartbeat_seconds:
            yield encode_sse_heartbeat()
            last_heartbeat = now


@router.get(
    "/shared/characters/{character_id}/events",
    responses={
        status.HTTP_200_OK: {
            "description": "Server-sent event stream for an active viewer.",
            "content": {SSE_MEDIA_TYPE: {}},
        },
        status.HTTP_400_BAD_REQUEST: {
            "description": "A starting revision or Last-Event-ID is required."
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is not actively shared with this viewer."
        },
    },
)
async def stream_shared_character_events(
    character_id: UUID,
    request: Request,
    session: DbSession,
    current_user: CurrentUser,
    settings: SettingsDep,
    since_revision: int | None = Query(default=None, ge=1, alias="sinceRevision"),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    position = parse_stream_position(
        character_id=character_id,
        since_revision=since_revision,
        last_event_id=last_event_id,
    )
    try:
        prepared = await prepare_character_event_stream(
            session,
            character_id=character_id,
            user_id=current_user.id,
            owner_only=False,
            position=position,
            batch_size=settings.character_event_replay_batch_size,
        )
    finally:
        # FastAPI may keep yielded dependencies alive until a StreamingResponse
        # finishes. Explicitly end the read transaction before opening the long-lived
        # stream; the live loop uses short, independent sessions.
        await session.rollback()
    if isinstance(prepared, CharacterFullResyncRequiredEvent):
        return full_resync_response(prepared)

    return StreamingResponse(
        character_event_stream_body(
            request,
            prepared=prepared,
            batch_size=settings.character_event_replay_batch_size,
            poll_interval_seconds=settings.character_event_poll_interval_seconds,
            heartbeat_seconds=settings.character_event_heartbeat_seconds,
            access_recheck_seconds=settings.character_event_access_recheck_seconds,
        ),
        media_type=SSE_MEDIA_TYPE,
        headers=SSE_HEADERS,
    )


@router.get(
    "/characters/cloud/{character_id}/events",
    responses={
        status.HTTP_200_OK: {
            "description": "Server-sent event stream for the cloud character owner.",
            "content": {SSE_MEDIA_TYPE: {}},
        },
        status.HTTP_400_BAD_REQUEST: {
            "description": "A starting revision or Last-Event-ID is required."
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "The cloud character was not found for this owner."
        },
    },
)
async def stream_owner_character_events(
    character_id: UUID,
    request: Request,
    session: DbSession,
    current_user: CurrentUser,
    settings: SettingsDep,
    since_revision: int | None = Query(default=None, ge=1, alias="sinceRevision"),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    position = parse_stream_position(
        character_id=character_id,
        since_revision=since_revision,
        last_event_id=last_event_id,
    )
    try:
        prepared = await prepare_character_event_stream(
            session,
            character_id=character_id,
            user_id=current_user.id,
            owner_only=True,
            position=position,
            batch_size=settings.character_event_replay_batch_size,
        )
    finally:
        await session.rollback()
    if isinstance(prepared, CharacterFullResyncRequiredEvent):
        return full_resync_response(prepared)

    return StreamingResponse(
        character_event_stream_body(
            request,
            prepared=prepared,
            batch_size=settings.character_event_replay_batch_size,
            poll_interval_seconds=settings.character_event_poll_interval_seconds,
            heartbeat_seconds=settings.character_event_heartbeat_seconds,
            access_recheck_seconds=settings.character_event_access_recheck_seconds,
        ),
        media_type=SSE_MEDIA_TYPE,
        headers=SSE_HEADERS,
    )
