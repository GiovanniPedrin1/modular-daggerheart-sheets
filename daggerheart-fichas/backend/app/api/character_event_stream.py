from __future__ import annotations

import asyncio
import logging
import math
import random
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
from app.api.rollout import require_character_sse
from app.api.sse_response import HardenedSseStreamingResponse
from app.core.observability import Stopwatch, get_current_metrics, log_event
from app.core.security_contracts import MAX_CHARACTER_SERVER_REVISION
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
from app.services.character_sse_lifecycle_service import (
    CharacterStreamConnectionControl,
    CharacterStreamDrainingError,
    CharacterStreamManager,
    ensure_character_stream_accepting,
    get_character_stream_manager,
)
from app.services.rate_limit_service import (
    acquire_sse_connection_lease,
    stream_with_rate_limit_lease,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["character-events"])

SSE_MEDIA_TYPE = "text/event-stream"
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-store, private, no-transform",
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
    "Content-Encoding": "identity",
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
type StreamRole = Literal["owner", "viewer"]


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


def encode_sse_retry(retry_milliseconds: int) -> str:
    if retry_milliseconds < 100:
        raise ValueError("retry_milliseconds must be at least 100")
    return f"retry: {retry_milliseconds}\n\n"


def encode_sse_reconnect(reason: str) -> str:
    normalized = reason.strip().replace("\n", " ")[:64] or "rotation"
    return f": reconnect {normalized}\n\n"


def _to_public_events(
    events,
    *,
    viewer_user_id: UUID,
) -> list[PublicPersistedEvent]:
    return [
        character_event_public_from_model(event, viewer_user_id=viewer_user_id) for event in events
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


def record_full_resync_instruction(
    *,
    role: StreamRole,
    event: CharacterFullResyncRequiredEvent,
) -> None:
    get_current_metrics().record_full_resync(role=role, reason=event.reason)
    log_event(
        logger,
        logging.WARNING,
        "character.stream.full_resync",
        role=role,
        reason=event.reason,
        serverRevision=event.server_revision,
        oldestAvailableRevision=event.oldest_available_revision,
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
    query_timeout_seconds: float,
):
    async with AsyncSessionLocal() as session:
        async with asyncio.timeout(query_timeout_seconds):
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


async def _character_event_stream_frames(
    request: Request,
    *,
    role: StreamRole,
    prepared: PreparedCharacterEventStream,
    batch_size: int,
    poll_interval_seconds: float,
    heartbeat_seconds: float,
    access_recheck_seconds: float,
    query_timeout_seconds: float,
    retry_milliseconds: int | None,
    rotation_deadline: float | None,
    control: CharacterStreamConnectionControl,
    stream_manager: CharacterStreamManager | None,
    clock,
) -> AsyncIterator[str]:
    metrics = get_current_metrics()
    stopwatch = Stopwatch.start()
    close_reason = "client_disconnected"
    metrics.record_sse_open(role=role)
    log_event(
        logger,
        logging.INFO,
        "character.stream.opened",
        role=role,
        replayKind=prepared.replay_kind,
        initialEventCount=len(prepared.initial_events),
        rotationEnabled=rotation_deadline is not None,
    )

    replay_value = prepared.replay_value
    live_cursor = prepared.live_baseline_cursor
    events = prepared.initial_events
    has_more = prepared.initial_has_more

    def synchronous_stop_reason() -> str | None:
        if control.close_reason is not None:
            return control.close_reason
        if stream_manager is not None and stream_manager.shutdown_event.is_set():
            control.request_close("server_shutdown")
            return control.close_reason
        if rotation_deadline is not None and clock() >= rotation_deadline:
            control.request_close("rotation")
            return control.close_reason
        return None

    async def forced_close_reason(*, check_disconnect: bool) -> str | None:
        reason = synchronous_stop_reason()
        if reason is not None:
            return reason
        if check_disconnect and await request.is_disconnected():
            control.request_close("client_disconnected")
            return control.close_reason
        return None

    async def close_for_reason(reason: str) -> AsyncIterator[str]:
        nonlocal close_reason
        close_reason = reason
        if reason in {"rotation", "server_shutdown"}:
            metrics.record_sse_transport_failure(reason=reason)
            yield encode_sse_reconnect(reason)

    try:
        if retry_milliseconds is not None:
            yield encode_sse_retry(retry_milliseconds)

        while True:
            reason = await forced_close_reason(check_disconnect=True)
            if reason is not None:
                async for frame in close_for_reason(reason):
                    yield frame
                return

            for event in events:
                reason = await forced_close_reason(check_disconnect=False)
                if reason is not None:
                    async for frame in close_for_reason(reason):
                        yield frame
                    return
                metrics.record_sse_event(role=role, event_type=event.event_type)
                yield encode_sse_event(event)
                replay_value = (
                    event.server_revision
                    if prepared.replay_kind == "revision"
                    else int(event.event_id)
                )
                live_cursor = max(live_cursor, int(event.event_id))
                if _is_terminal_event(event):
                    close_reason = event.event_type
                    control.request_close(close_reason)
                    return

            if not has_more:
                break
            try:
                page = await _load_replay_page(
                    prepared,
                    replay_value=replay_value,
                    batch_size=batch_size,
                    query_timeout_seconds=query_timeout_seconds,
                )
            except TimeoutError:
                close_reason = "database_timeout"
                control.request_close(close_reason)
                metrics.record_sse_transport_failure(reason=close_reason)
                log_event(
                    logger,
                    logging.WARNING,
                    "character.stream.database_timeout",
                    role=role,
                    phase="replay",
                    timeoutSeconds=query_timeout_seconds,
                )
                return
            except (
                event_service.CharacterEventHistoryGapError,
                event_service.CharacterEventClientAheadError,
                event_service.UnknownCharacterEventCursorError,
            ) as error:
                full_resync = _replay_error_to_full_resync_event(error, prepared=prepared)
                record_full_resync_instruction(role=role, event=full_resync)
                metrics.record_sse_event(role=role, event_type=full_resync.event_type)
                close_reason = "full_resync_required"
                control.request_close(close_reason)
                yield encode_sse_event(full_resync)
                return
            events = _to_public_events(
                page.events,
                viewer_user_id=prepared.access.user_id,
            )
            has_more = page.has_more

        last_heartbeat = clock()
        try:
            async for poll in polling_service.poll_character_events(
                access=prepared.access,
                after_event_id=live_cursor,
                limit=batch_size,
                poll_interval_seconds=poll_interval_seconds,
                access_recheck_seconds=access_recheck_seconds,
                query_timeout_seconds=query_timeout_seconds,
                is_disconnected=request.is_disconnected,
                should_stop=lambda: synchronous_stop_reason() is not None,
            ):
                reason = synchronous_stop_reason()
                if reason is not None:
                    async for frame in close_for_reason(reason):
                        yield frame
                    return

                public_events = _to_public_events(
                    poll.page.events,
                    viewer_user_id=prepared.access.user_id,
                )
                for event in public_events:
                    metrics.record_sse_event(role=role, event_type=event.event_type)
                    yield encode_sse_event(event)
                    last_heartbeat = clock()
                    if _is_terminal_event(event):
                        close_reason = event.event_type
                        control.request_close(close_reason)
                        return

                if not poll.access_active:
                    close_reason = "access_inactive"
                    control.request_close(close_reason)
                    return

                now = clock()
                if now - last_heartbeat >= heartbeat_seconds:
                    metrics.record_sse_heartbeat(role=role)
                    yield encode_sse_heartbeat()
                    last_heartbeat = now

            reason = synchronous_stop_reason()
            if reason is not None:
                async for frame in close_for_reason(reason):
                    yield frame
                return
        except polling_service.CharacterEventPollDatabaseTimeoutError:
            close_reason = "database_timeout"
            control.request_close(close_reason)
            metrics.record_sse_transport_failure(reason=close_reason)
            log_event(
                logger,
                logging.WARNING,
                "character.stream.database_timeout",
                role=role,
                phase="live",
                timeoutSeconds=query_timeout_seconds,
            )
            return
    except asyncio.CancelledError:
        close_reason = control.close_reason or "cancelled"
        raise
    except Exception:
        close_reason = control.close_reason or "error"
        log_event(
            logger,
            logging.ERROR,
            "character.stream.failed",
            exc_info=True,
            role=role,
        )
        raise
    finally:
        close_reason = control.close_reason or close_reason
        duration = stopwatch.elapsed()
        metrics.record_sse_close(
            role=role,
            reason=close_reason,
            duration_seconds=duration,
        )
        log_event(
            logger,
            logging.INFO if close_reason != "error" else logging.ERROR,
            "character.stream.closed",
            role=role,
            reason=close_reason,
            durationMs=round(duration * 1000, 3),
        )


async def character_event_stream_body(
    request: Request,
    *,
    role: StreamRole | None = None,
    prepared: PreparedCharacterEventStream,
    batch_size: int,
    poll_interval_seconds: float,
    heartbeat_seconds: float,
    access_recheck_seconds: float,
    query_timeout_seconds: float = 5.0,
    retry_milliseconds: int | None = None,
    max_duration_seconds: float | None = None,
    rotation_jitter_seconds: float = 0.0,
    control: CharacterStreamConnectionControl | None = None,
    stream_manager: CharacterStreamManager | None = None,
    clock=None,
    random_value=None,
) -> AsyncIterator[str]:
    """Replay persisted events, then poll with bounded production lifecycle rules."""

    resolved_role: StreamRole = role or prepared.access.role
    resolved_clock = clock or monotonic
    resolved_random_value = random_value or random.random
    resolved_control = control or CharacterStreamConnectionControl()
    resolved_manager = stream_manager
    if resolved_manager is None and isinstance(request, Request):
        resolved_manager = get_character_stream_manager(request)

    rotation_deadline: float | None = None
    if max_duration_seconds is not None:
        if max_duration_seconds <= 0:
            raise ValueError("max_duration_seconds must be greater than zero")
        if rotation_jitter_seconds < 0:
            raise ValueError("rotation_jitter_seconds cannot be negative")
        rotation_deadline = (
            resolved_clock()
            + max_duration_seconds
            + max(0.0, min(1.0, float(resolved_random_value())))
            * rotation_jitter_seconds
        )

    async def frames() -> AsyncIterator[str]:
        async for frame in _character_event_stream_frames(
            request,
            role=resolved_role,
            prepared=prepared,
            batch_size=batch_size,
            poll_interval_seconds=poll_interval_seconds,
            heartbeat_seconds=heartbeat_seconds,
            access_recheck_seconds=access_recheck_seconds,
            query_timeout_seconds=query_timeout_seconds,
            retry_milliseconds=retry_milliseconds,
            rotation_deadline=rotation_deadline,
            control=resolved_control,
            stream_manager=resolved_manager,
            clock=resolved_clock,
        ):
            yield frame

    if resolved_manager is None:
        async for frame in frames():
            yield frame
        return

    try:
        async with resolved_manager.track(resolved_control):
            async for frame in frames():
                yield frame
    except CharacterStreamDrainingError:
        return


async def prepare_character_event_stream_with_timeout(
    session: DbSession,
    *,
    character_id: UUID,
    user_id: UUID,
    owner_only: bool,
    position: CharacterEventStreamPosition,
    batch_size: int,
    timeout_seconds: float,
    retry_after_seconds: int,
) -> PreparedCharacterEventStream | CharacterFullResyncRequiredEvent:
    try:
        async with asyncio.timeout(timeout_seconds):
            return await prepare_character_event_stream(
                session,
                character_id=character_id,
                user_id=user_id,
                owner_only=owner_only,
                position=position,
                batch_size=batch_size,
            )
    except TimeoutError as error:
        get_current_metrics().record_sse_transport_failure(reason="prepare_timeout")
        log_event(
            logger,
            logging.WARNING,
            "character.stream.prepare_timeout",
            role="owner" if owner_only else "viewer",
            timeoutSeconds=timeout_seconds,
        )
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "EVENT_STREAM_UNAVAILABLE",
            "The realtime stream could not be prepared in time.",
            headers={"Retry-After": str(max(1, retry_after_seconds))},
        ) from error


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
    since_revision: int | None = Query(
        default=None,
        ge=1,
        le=MAX_CHARACTER_SERVER_REVISION,
        alias="sinceRevision",
    ),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    require_character_sse(settings)
    retry_after_seconds = max(
        1,
        math.ceil(settings.character_event_retry_milliseconds / 1000),
    )
    ensure_character_stream_accepting(
        request,
        retry_after_seconds=retry_after_seconds,
    )
    position = parse_stream_position(
        character_id=character_id,
        since_revision=since_revision,
        last_event_id=last_event_id,
    )
    try:
        prepared = await prepare_character_event_stream_with_timeout(
            session,
            character_id=character_id,
            user_id=current_user.id,
            owner_only=False,
            position=position,
            batch_size=settings.character_event_replay_batch_size,
            timeout_seconds=settings.character_event_query_timeout_seconds,
            retry_after_seconds=retry_after_seconds,
        )
    finally:
        # FastAPI may keep yielded dependencies alive until a StreamingResponse
        # finishes. Explicitly end the read transaction before opening the long-lived
        # stream; the live loop uses short, independent sessions.
        await session.rollback()
    if isinstance(prepared, CharacterFullResyncRequiredEvent):
        record_full_resync_instruction(role="viewer", event=prepared)
        return full_resync_response(prepared)

    lease = await acquire_sse_connection_lease(
        request,
        user_id=current_user.id,
        character_id=character_id,
        settings=settings,
    )
    headers = dict(SSE_HEADERS)
    if lease.limit > 0:
        headers["RateLimit-Limit"] = str(lease.limit)
        headers["RateLimit-Remaining"] = str(lease.remaining)
    control = CharacterStreamConnectionControl()
    manager = get_character_stream_manager(request)
    return HardenedSseStreamingResponse(
        stream_with_rate_limit_lease(
            character_event_stream_body(
                request,
                role="viewer",
                prepared=prepared,
                batch_size=settings.character_event_replay_batch_size,
                poll_interval_seconds=settings.character_event_poll_interval_seconds,
                heartbeat_seconds=settings.character_event_heartbeat_seconds,
                access_recheck_seconds=settings.character_event_access_recheck_seconds,
                query_timeout_seconds=settings.character_event_query_timeout_seconds,
                retry_milliseconds=settings.character_event_retry_milliseconds,
                max_duration_seconds=(
                    settings.character_event_stream_max_duration_seconds
                ),
                rotation_jitter_seconds=(
                    settings.character_event_stream_rotation_jitter_seconds
                ),
                control=control,
                stream_manager=manager,
            ),
            lease=lease,
        ),
        media_type=SSE_MEDIA_TYPE,
        headers=headers,
        send_timeout_seconds=settings.character_event_send_timeout_seconds,
        control=control,
        cleanup=lease.release,
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
    since_revision: int | None = Query(
        default=None,
        ge=1,
        le=MAX_CHARACTER_SERVER_REVISION,
        alias="sinceRevision",
    ),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    require_character_sse(settings)
    retry_after_seconds = max(
        1,
        math.ceil(settings.character_event_retry_milliseconds / 1000),
    )
    ensure_character_stream_accepting(
        request,
        retry_after_seconds=retry_after_seconds,
    )
    position = parse_stream_position(
        character_id=character_id,
        since_revision=since_revision,
        last_event_id=last_event_id,
    )
    try:
        prepared = await prepare_character_event_stream_with_timeout(
            session,
            character_id=character_id,
            user_id=current_user.id,
            owner_only=True,
            position=position,
            batch_size=settings.character_event_replay_batch_size,
            timeout_seconds=settings.character_event_query_timeout_seconds,
            retry_after_seconds=retry_after_seconds,
        )
    finally:
        await session.rollback()
    if isinstance(prepared, CharacterFullResyncRequiredEvent):
        record_full_resync_instruction(role="owner", event=prepared)
        return full_resync_response(prepared)

    lease = await acquire_sse_connection_lease(
        request,
        user_id=current_user.id,
        character_id=character_id,
        settings=settings,
    )
    headers = dict(SSE_HEADERS)
    if lease.limit > 0:
        headers["RateLimit-Limit"] = str(lease.limit)
        headers["RateLimit-Remaining"] = str(lease.remaining)
    control = CharacterStreamConnectionControl()
    manager = get_character_stream_manager(request)
    return HardenedSseStreamingResponse(
        stream_with_rate_limit_lease(
            character_event_stream_body(
                request,
                role="owner",
                prepared=prepared,
                batch_size=settings.character_event_replay_batch_size,
                poll_interval_seconds=settings.character_event_poll_interval_seconds,
                heartbeat_seconds=settings.character_event_heartbeat_seconds,
                access_recheck_seconds=settings.character_event_access_recheck_seconds,
                query_timeout_seconds=settings.character_event_query_timeout_seconds,
                retry_milliseconds=settings.character_event_retry_milliseconds,
                max_duration_seconds=(
                    settings.character_event_stream_max_duration_seconds
                ),
                rotation_jitter_seconds=(
                    settings.character_event_stream_rotation_jitter_seconds
                ),
                control=control,
                stream_manager=manager,
            ),
            lease=lease,
        ),
        media_type=SSE_MEDIA_TYPE,
        headers=headers,
        send_timeout_seconds=settings.character_event_send_timeout_seconds,
        control=control,
        cleanup=lease.release,
    )
