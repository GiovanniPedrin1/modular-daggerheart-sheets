from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.observability import Stopwatch, get_current_metrics, log_event
from app.models.character_event import CharacterEvent
from app.models.cloud_character import CloudCharacter
from app.schemas.character_events import (
    MAX_CHARACTER_EVENT_ID,
    CharacterDeletedEventCreate,
    CharacterRealtimeSnapshot,
    CharacterShareRevokedEventCreate,
    CharacterUpdatedEventCreate,
)

CONTENT_EVENT_TYPES = ("updated", "deleted")
COMPACTED_EVENT_PATCH_FORMAT = "changed_paths_v1"
COMPACTED_EVENT_PATCH = {"format": COMPACTED_EVENT_PATCH_FORMAT}

logger = logging.getLogger(__name__)


class CharacterEventServiceError(Exception):
    """Base class for domain errors raised by the character event service."""


class UnknownCharacterEventCursorError(CharacterEventServiceError):
    def __init__(self, *, character_id: UUID, event_id: int) -> None:
        self.character_id = character_id
        self.event_id = event_id
        super().__init__(
            f"Event cursor {event_id} is not available for cloud character {character_id}"
        )


class CharacterEventHistoryGapError(CharacterEventServiceError):
    def __init__(
        self,
        *,
        character_id: UUID,
        since_revision: int,
        current_server_revision: int,
        oldest_available_revision: int | None,
    ) -> None:
        self.character_id = character_id
        self.since_revision = since_revision
        self.current_server_revision = current_server_revision
        self.oldest_available_revision = oldest_available_revision
        super().__init__(
            "Incremental character history is incomplete for "
            f"{character_id}: requested revision {since_revision}, "
            f"current revision {current_server_revision}"
        )


class CharacterEventClientAheadError(CharacterEventServiceError):
    def __init__(
        self,
        *,
        character_id: UUID,
        since_revision: int,
        current_server_revision: int,
    ) -> None:
        self.character_id = character_id
        self.since_revision = since_revision
        self.current_server_revision = current_server_revision
        super().__init__(
            f"Client revision {since_revision} is newer than cloud character "
            f"{character_id} revision {current_server_revision}"
        )


@dataclass(frozen=True, slots=True)
class CharacterEventPage:
    events: list[CharacterEvent]
    has_more: bool

    @property
    def last_event_id(self) -> int | None:
        if not self.events:
            return None
        return self.events[-1].id


@dataclass(frozen=True, slots=True)
class CharacterEventHistoryState:
    oldest_available_revision: int | None
    newest_available_revision: int | None
    available_revision_count: int


@dataclass(frozen=True, slots=True)
class CharacterEventRetentionResult:
    """Summary returned by one committed retention/compaction run."""

    compacted_count: int
    deleted_count: int
    cutoff: datetime
    retention_days: int
    retained_content_revisions: int
    compaction_cutoff: datetime
    compaction_retention_days: int
    retained_compacted_revisions: int
    character_id: UUID | None


def _normalize_batch_size(limit: int) -> int:
    if limit < 1:
        raise ValueError("event replay limit must be greater than zero")
    return limit


def _content_event_predicate():
    """All content revisions, including path-only compacted updates."""

    return CharacterEvent.event_type.in_(CONTENT_EVENT_TYPES)


def _replayable_content_event_predicate():
    """Content rows that can be serialized to the public snapshot SSE contract."""

    return or_(
        and_(
            CharacterEvent.event_type == "updated",
            CharacterEvent.snapshot.is_not(None),
        ),
        CharacterEvent.event_type == "deleted",
    )


def _merge_history_event_predicate():
    """Update revisions with exact paths, whether snapshot or compacted."""

    return and_(
        CharacterEvent.event_type == "updated",
        CharacterEvent.changed_paths.is_not(None),
    )


def _compacted_content_event_predicate():
    return and_(
        CharacterEvent.event_type == "updated",
        CharacterEvent.snapshot.is_(None),
        CharacterEvent.patch.is_not(None),
        CharacterEvent.compacted_at.is_not(None),
        CharacterEvent.changed_paths.is_not(None),
    )


def is_compacted_character_event(event: CharacterEvent) -> bool:
    return (
        event.event_type == "updated"
        and event.snapshot is None
        and event.patch == COMPACTED_EVENT_PATCH
        and event.compacted_at is not None
        and bool(event.changed_paths)
    )


def _viewer_visible_event_predicate(viewer_user_id: UUID):
    return or_(
        _replayable_content_event_predicate(),
        and_(
            CharacterEvent.event_type == "share_revoked",
            CharacterEvent.audience_user_id == viewer_user_id,
        ),
    )


async def append_character_updated_event(
    session: AsyncSession,
    *,
    character: CloudCharacter,
    actor_user_id: UUID | None,
    changed_paths: Sequence[str] | None = None,
    device_id: str | None = None,
) -> CharacterEvent:
    """Persist a snapshot update event with merge-safe path metadata."""

    event_input = CharacterUpdatedEventCreate(
        characterId=character.id,
        serverRevision=character.server_revision,
        actorUserId=actor_user_id,
        deviceId=(
            device_id if device_id is not None else character.updated_by_device_id
        ),
        snapshot=CharacterRealtimeSnapshot.from_character(character),
        changedPaths=list(changed_paths) if changed_paths is not None else None,
    )
    event = event_input.to_model()
    session.add(event)
    await session.flush()
    return event


async def append_character_deleted_event(
    session: AsyncSession,
    *,
    character: CloudCharacter,
    actor_user_id: UUID | None,
    device_id: str | None = None,
) -> CharacterEvent:
    """Persist a terminal deletion event in the caller's transaction."""

    if character.deleted_at is None:
        raise ValueError("deleted character event requires character.deleted_at")

    event_input = CharacterDeletedEventCreate(
        characterId=character.id,
        serverRevision=character.server_revision,
        actorUserId=actor_user_id,
        deviceId=(
            device_id if device_id is not None else character.updated_by_device_id
        ),
        deletedAt=character.deleted_at,
    )
    event = event_input.to_model()
    session.add(event)
    await session.flush()
    return event


async def append_share_revoked_event(
    session: AsyncSession,
    *,
    character_id: UUID,
    server_revision: int,
    audience_user_id: UUID,
    revoked_at: datetime,
    actor_user_id: UUID | None,
    device_id: str | None = None,
) -> CharacterEvent:
    """Persist a terminal event visible only to the revoked viewer."""

    event_input = CharacterShareRevokedEventCreate(
        characterId=character_id,
        serverRevision=server_revision,
        actorUserId=actor_user_id,
        audienceUserId=audience_user_id,
        deviceId=device_id,
        revokedAt=revoked_at,
    )
    event = event_input.to_model()
    session.add(event)
    await session.flush()
    return event


async def get_character_event_history_state(
    session: AsyncSession,
    *,
    character_id: UUID,
    after_revision: int | None = None,
    through_revision: int | None = None,
) -> CharacterEventHistoryState:
    """Return availability metadata for public replayable content events."""

    conditions = [
        CharacterEvent.character_id == character_id,
        _replayable_content_event_predicate(),
    ]
    if after_revision is not None:
        conditions.append(CharacterEvent.server_revision > after_revision)
    if through_revision is not None:
        conditions.append(CharacterEvent.server_revision <= through_revision)

    result = await session.execute(
        select(
            func.min(CharacterEvent.server_revision),
            func.max(CharacterEvent.server_revision),
            func.count(CharacterEvent.id),
        ).where(*conditions)
    )
    oldest, newest, count = result.one()
    return CharacterEventHistoryState(
        oldest_available_revision=oldest,
        newest_available_revision=newest,
        available_revision_count=int(count or 0),
    )


async def get_oldest_available_revision(
    session: AsyncSession,
    *,
    character_id: UUID,
) -> int | None:
    state = await get_character_event_history_state(
        session,
        character_id=character_id,
    )
    return state.oldest_available_revision


async def get_oldest_mergeable_revision(
    session: AsyncSession,
    *,
    character_id: UUID,
) -> int | None:
    """Return the oldest update revision that still has exact path metadata."""

    result = await session.execute(
        select(func.min(CharacterEvent.server_revision)).where(
            CharacterEvent.character_id == character_id,
            _merge_history_event_predicate(),
        )
    )
    return result.scalar_one_or_none()


async def has_character_event_history_gap(
    session: AsyncSession,
    *,
    character_id: UUID,
    since_revision: int,
    current_server_revision: int,
) -> tuple[bool, int | None]:
    """Check whether every content revision after ``since_revision`` is replayable."""

    if since_revision > current_server_revision:
        raise CharacterEventClientAheadError(
            character_id=character_id,
            since_revision=since_revision,
            current_server_revision=current_server_revision,
        )
    if since_revision == current_server_revision:
        return False, None

    state = await get_character_event_history_state(
        session,
        character_id=character_id,
        after_revision=since_revision,
        through_revision=current_server_revision,
    )
    expected_count = current_server_revision - since_revision
    has_gap = (
        state.available_revision_count != expected_count
        or state.oldest_available_revision != since_revision + 1
        or state.newest_available_revision != current_server_revision
    )
    return has_gap, state.oldest_available_revision


async def list_character_content_events_since_revision(
    session: AsyncSession,
    *,
    character_id: UUID,
    since_revision: int,
    current_server_revision: int,
    limit: int = 100,
) -> CharacterEventPage:
    """Replay complete content events after a snapshot revision.

    Viewer-specific revocation events are deliberately not replayed by revision. An
    initial connection is authorized against the current share, while subsequent SSE
    reconnects use the precise event cursor and can therefore receive a targeted
    revocation without replaying an obsolete revocation from an earlier share.
    """

    batch_size = _normalize_batch_size(limit)
    has_gap, oldest_available_revision = await has_character_event_history_gap(
        session,
        character_id=character_id,
        since_revision=since_revision,
        current_server_revision=current_server_revision,
    )
    if has_gap:
        raise CharacterEventHistoryGapError(
            character_id=character_id,
            since_revision=since_revision,
            current_server_revision=current_server_revision,
            oldest_available_revision=oldest_available_revision,
        )
    if since_revision == current_server_revision:
        return CharacterEventPage(events=[], has_more=False)

    result = await session.execute(
        select(CharacterEvent)
        .where(
            CharacterEvent.character_id == character_id,
            _replayable_content_event_predicate(),
            CharacterEvent.server_revision > since_revision,
            CharacterEvent.server_revision <= current_server_revision,
        )
        .order_by(CharacterEvent.server_revision.asc(), CharacterEvent.id.asc())
        .limit(batch_size + 1)
    )
    events = list(result.scalars().all())
    return CharacterEventPage(
        events=events[:batch_size],
        has_more=len(events) > batch_size,
    )


async def get_latest_content_event_id(
    session: AsyncSession,
    *,
    character_id: UUID,
) -> int:
    """Return the latest content-event cursor for an owner stream baseline."""

    result = await session.execute(
        select(func.max(CharacterEvent.id)).where(
            CharacterEvent.character_id == character_id,
            _content_event_predicate(),
        )
    )
    return int(result.scalar_one_or_none() or 0)


async def list_character_content_events_after_position(
    session: AsyncSession,
    *,
    character_id: UUID,
    after_event_id: int,
    limit: int = 100,
) -> CharacterEventPage:
    """List owner-visible content events after a server-established cursor."""

    batch_size = _normalize_batch_size(limit)
    if after_event_id < 0:
        raise ValueError("event cursor position cannot be negative")
    if after_event_id > MAX_CHARACTER_EVENT_ID:
        raise ValueError("event cursor exceeds the supported bigint range")

    result = await session.execute(
        select(CharacterEvent)
        .where(
            CharacterEvent.character_id == character_id,
            CharacterEvent.id > after_event_id,
            _replayable_content_event_predicate(),
        )
        .order_by(CharacterEvent.id.asc())
        .limit(batch_size + 1)
    )
    events = list(result.scalars().all())
    return CharacterEventPage(
        events=events[:batch_size],
        has_more=len(events) > batch_size,
    )


async def is_character_content_event_cursor_available(
    session: AsyncSession,
    *,
    character_id: UUID,
    event_id: int,
) -> bool:
    result = await session.execute(
        select(CharacterEvent.id)
        .where(
            CharacterEvent.id == event_id,
            CharacterEvent.character_id == character_id,
            _replayable_content_event_predicate(),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def list_character_content_events_after_cursor(
    session: AsyncSession,
    *,
    character_id: UUID,
    after_event_id: int,
    limit: int = 100,
) -> CharacterEventPage:
    """Replay owner-visible content events after a validated opaque SSE cursor."""

    batch_size = _normalize_batch_size(limit)
    if after_event_id < 1:
        raise ValueError("event cursor must be greater than zero")
    if after_event_id > MAX_CHARACTER_EVENT_ID:
        raise ValueError("event cursor exceeds the supported bigint range")
    if not await is_character_content_event_cursor_available(
        session,
        character_id=character_id,
        event_id=after_event_id,
    ):
        raise UnknownCharacterEventCursorError(
            character_id=character_id,
            event_id=after_event_id,
        )

    return await list_character_content_events_after_position(
        session,
        character_id=character_id,
        after_event_id=after_event_id,
        limit=batch_size,
    )


async def get_latest_viewer_visible_event_id(
    session: AsyncSession,
    *,
    character_id: UUID,
    viewer_user_id: UUID,
) -> int:
    """Return the latest cursor visible to a viewer, or zero when none exists.

    This establishes a server-owned live-stream baseline. Unlike a client-supplied
    cursor, zero is safe here because the endpoint records it before authorizing the
    current share and never exposes it as an SSE event ID.
    """

    result = await session.execute(
        select(func.max(CharacterEvent.id)).where(
            CharacterEvent.character_id == character_id,
            _viewer_visible_event_predicate(viewer_user_id),
        )
    )
    return int(result.scalar_one_or_none() or 0)


async def list_character_events_after_position(
    session: AsyncSession,
    *,
    character_id: UUID,
    viewer_user_id: UUID,
    after_event_id: int,
    limit: int = 100,
) -> CharacterEventPage:
    """List viewer-visible events after a server-established cursor position.

    The position may be zero when no event existed at stream creation. Client cursors
    must still use :func:`list_character_events_after_cursor`, which validates that
    the opaque cursor belongs to this character and viewer.
    """

    batch_size = _normalize_batch_size(limit)
    if after_event_id < 0:
        raise ValueError("event cursor position cannot be negative")
    if after_event_id > MAX_CHARACTER_EVENT_ID:
        raise ValueError("event cursor exceeds the supported bigint range")

    result = await session.execute(
        select(CharacterEvent)
        .where(
            CharacterEvent.character_id == character_id,
            CharacterEvent.id > after_event_id,
            _viewer_visible_event_predicate(viewer_user_id),
        )
        .order_by(CharacterEvent.id.asc())
        .limit(batch_size + 1)
    )
    events = list(result.scalars().all())
    return CharacterEventPage(
        events=events[:batch_size],
        has_more=len(events) > batch_size,
    )


async def is_character_event_cursor_available(
    session: AsyncSession,
    *,
    character_id: UUID,
    viewer_user_id: UUID,
    event_id: int,
) -> bool:
    result = await session.execute(
        select(CharacterEvent.id)
        .where(
            CharacterEvent.id == event_id,
            CharacterEvent.character_id == character_id,
            _viewer_visible_event_predicate(viewer_user_id),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def list_character_events_after_cursor(
    session: AsyncSession,
    *,
    character_id: UUID,
    viewer_user_id: UUID,
    after_event_id: int,
    limit: int = 100,
) -> CharacterEventPage:
    """Replay viewer-visible events after a validated opaque SSE cursor."""

    batch_size = _normalize_batch_size(limit)
    if after_event_id < 1:
        raise ValueError("event cursor must be greater than zero")
    if after_event_id > MAX_CHARACTER_EVENT_ID:
        raise ValueError("event cursor exceeds the supported bigint range")
    if not await is_character_event_cursor_available(
        session,
        character_id=character_id,
        viewer_user_id=viewer_user_id,
        event_id=after_event_id,
    ):
        raise UnknownCharacterEventCursorError(
            character_id=character_id,
            event_id=after_event_id,
        )

    result = await session.execute(
        select(CharacterEvent)
        .where(
            CharacterEvent.character_id == character_id,
            CharacterEvent.id > after_event_id,
            _viewer_visible_event_predicate(viewer_user_id),
        )
        .order_by(CharacterEvent.id.asc())
        .limit(batch_size + 1)
    )
    events = list(result.scalars().all())
    return CharacterEventPage(
        events=events[:batch_size],
        has_more=len(events) > batch_size,
    )


async def compact_expired_character_events(
    session: AsyncSession,
    *,
    settings: Settings,
    now: datetime | None = None,
    character_id: UUID | None = None,
) -> int:
    """Replace expired replay snapshots with small, merge-safe path summaries.

    Only update rows with validated ``changed_paths`` can be compacted. Legacy
    snapshot-only barriers and deletion events remain replay rows until the deletion
    phase removes them. The caller owns the transaction.
    """

    current_time = now or datetime.now(UTC)
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("retention time must include a timezone")

    cutoff = current_time - timedelta(days=settings.character_event_retention_days)
    ranked_conditions = [_replayable_content_event_predicate()]
    if character_id is not None:
        ranked_conditions.append(CharacterEvent.character_id == character_id)

    ranked_replay_events = (
        select(
            CharacterEvent.id.label("event_id"),
            func.row_number()
            .over(
                partition_by=CharacterEvent.character_id,
                order_by=(
                    CharacterEvent.server_revision.desc(),
                    CharacterEvent.id.desc(),
                ),
            )
            .label("retention_rank"),
        )
        .where(*ranked_conditions)
        .subquery()
    )
    expired_replay_ids = select(ranked_replay_events.c.event_id).where(
        ranked_replay_events.c.retention_rank
        > settings.character_event_retention_revisions
    )

    conditions = [
        CharacterEvent.id.in_(expired_replay_ids),
        CharacterEvent.created_at < cutoff,
        CharacterEvent.event_type == "updated",
        CharacterEvent.snapshot.is_not(None),
        CharacterEvent.patch.is_(None),
        CharacterEvent.changed_paths.is_not(None),
    ]
    if character_id is not None:
        conditions.append(CharacterEvent.character_id == character_id)

    result = await session.execute(
        update(CharacterEvent)
        .where(*conditions)
        .values(
            snapshot=None,
            patch=COMPACTED_EVENT_PATCH,
            compacted_at=current_time,
        )
    )
    return int(result.rowcount or 0)


async def delete_expired_character_events(
    session: AsyncSession,
    *,
    settings: Settings,
    now: datetime | None = None,
    character_id: UUID | None = None,
) -> int:
    """Delete events after their replay or compacted-history window expires.

    Public snapshots and deletion/revocation events use the shorter replay window.
    Path-only compacted updates use the longer merge-history window, preserving exact
    per-revision ``changed_paths`` without retaining full character snapshots.
    """

    current_time = now or datetime.now(UTC)
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("retention time must include a timezone")

    replay_cutoff = current_time - timedelta(days=settings.character_event_retention_days)
    compaction_cutoff = current_time - timedelta(
        days=settings.character_event_compaction_retention_days
    )

    replay_rank_conditions = [_replayable_content_event_predicate()]
    merge_rank_conditions = [_merge_history_event_predicate()]
    if character_id is not None:
        character_filter = CharacterEvent.character_id == character_id
        replay_rank_conditions.append(character_filter)
        merge_rank_conditions.append(character_filter)

    ranked_replay_events = (
        select(
            CharacterEvent.id.label("event_id"),
            func.row_number()
            .over(
                partition_by=CharacterEvent.character_id,
                order_by=(
                    CharacterEvent.server_revision.desc(),
                    CharacterEvent.id.desc(),
                ),
            )
            .label("retention_rank"),
        )
        .where(*replay_rank_conditions)
        .subquery()
    )
    expired_replay_ids = select(ranked_replay_events.c.event_id).where(
        ranked_replay_events.c.retention_rank
        > settings.character_event_retention_revisions
    )

    ranked_merge_events = (
        select(
            CharacterEvent.id.label("event_id"),
            func.row_number()
            .over(
                partition_by=CharacterEvent.character_id,
                order_by=(
                    CharacterEvent.server_revision.desc(),
                    CharacterEvent.id.desc(),
                ),
            )
            .label("retention_rank"),
        )
        .where(*merge_rank_conditions)
        .subquery()
    )
    retained_merge_ids = select(ranked_merge_events.c.event_id).where(
        ranked_merge_events.c.retention_rank
        <= settings.character_event_compaction_retention_revisions
    )

    expired_targeted_event = and_(
        CharacterEvent.event_type == "share_revoked",
        CharacterEvent.created_at < replay_cutoff,
    )
    expired_uncompactable_replay_event = and_(
        CharacterEvent.id.in_(expired_replay_ids),
        CharacterEvent.created_at < replay_cutoff,
        or_(
            CharacterEvent.event_type == "deleted",
            and_(
                CharacterEvent.event_type == "updated",
                CharacterEvent.snapshot.is_not(None),
                CharacterEvent.changed_paths.is_(None),
            ),
        ),
    )
    expired_compacted_event = and_(
        _compacted_content_event_predicate(),
        CharacterEvent.created_at < compaction_cutoff,
        CharacterEvent.id.not_in(retained_merge_ids),
    )

    conditions = [
        or_(
            expired_targeted_event,
            expired_uncompactable_replay_event,
            expired_compacted_event,
        )
    ]
    if character_id is not None:
        conditions.append(CharacterEvent.character_id == character_id)

    result = await session.execute(delete(CharacterEvent).where(*conditions))
    return int(result.rowcount or 0)


async def prune_character_events(
    session: AsyncSession,
    *,
    settings: Settings,
    now: datetime | None = None,
    character_id: UUID | None = None,
) -> CharacterEventRetentionResult:
    """Compact replay-expired snapshots, then prune expired compacted rows.

    The operation is idempotent and runs entirely in the caller's transaction. A
    concurrent long replay either completes from still-replayable rows or detects a
    gap and receives ``full_resync_required``; patch-only rows are never exposed over
    SSE. Owner mutation merge checks can continue using compacted path metadata until
    the longer compaction window also expires.
    """

    current_time = now or datetime.now(UTC)
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("retention time must include a timezone")

    stopwatch = Stopwatch.start()
    compacted_count = await compact_expired_character_events(
        session,
        settings=settings,
        now=current_time,
        character_id=character_id,
    )
    deleted_count = await delete_expired_character_events(
        session,
        settings=settings,
        now=current_time,
        character_id=character_id,
    )
    result = CharacterEventRetentionResult(
        compacted_count=compacted_count,
        deleted_count=deleted_count,
        cutoff=current_time - timedelta(days=settings.character_event_retention_days),
        retention_days=settings.character_event_retention_days,
        retained_content_revisions=settings.character_event_retention_revisions,
        compaction_cutoff=current_time
        - timedelta(days=settings.character_event_compaction_retention_days),
        compaction_retention_days=settings.character_event_compaction_retention_days,
        retained_compacted_revisions=(
            settings.character_event_compaction_retention_revisions
        ),
        character_id=character_id,
    )

    duration_seconds = stopwatch.elapsed()
    metrics = get_current_metrics()
    metrics.record_character_event_maintenance(
        compacted_count=compacted_count,
        deleted_count=deleted_count,
        duration_seconds=duration_seconds,
    )
    log_event(
        logger,
        logging.INFO,
        "character.events.maintenance.completed",
        compactedCount=compacted_count,
        deletedCount=deleted_count,
        targeted=character_id is not None,
        durationMs=round(duration_seconds * 1000, 3),
    )
    return result

