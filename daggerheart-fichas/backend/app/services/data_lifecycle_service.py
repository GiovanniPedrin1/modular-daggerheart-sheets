from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Any

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.observability import get_current_metrics, log_event
from app.models.audit_event import AuditEvent
from app.models.character_share import CharacterShare
from app.models.cloud_character import CloudCharacter
from app.models.refresh_session import RefreshSession

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class DataLifecycleRetentionResult:
    """Operational summary for one bounded privacy maintenance run."""

    now: datetime
    dry_run: bool
    batch_size: int
    cloud_character_cutoff: datetime
    pending_share_cutoff: datetime
    revoked_share_cutoff: datetime
    refresh_session_cutoff: datetime
    audit_cutoff: datetime
    cloud_characters_deleted: int
    pending_shares_deleted: int
    revoked_shares_deleted: int
    refresh_sessions_deleted: int
    audit_events_deleted: int
    batch_limit_reached: tuple[str, ...]

    @property
    def total_matched(self) -> int:
        return (
            self.cloud_characters_deleted
            + self.pending_shares_deleted
            + self.revoked_shares_deleted
            + self.refresh_sessions_deleted
            + self.audit_events_deleted
        )

    @property
    def total_deleted(self) -> int:
        return 0 if self.dry_run else self.total_matched

    def counts(self) -> dict[str, int]:
        return {
            "cloud_character_tombstones": self.cloud_characters_deleted,
            "pending_character_shares": self.pending_shares_deleted,
            "revoked_character_shares": self.revoked_shares_deleted,
            "refresh_sessions": self.refresh_sessions_deleted,
            "audit_events": self.audit_events_deleted,
        }


async def _select_ids(
    session: AsyncSession,
    *,
    model: type[Any],
    predicate: Any,
    order_by: tuple[Any, ...],
    batch_size: int,
) -> list[Any]:
    result = await session.execute(
        select(model.id)
        .where(predicate)
        .order_by(*order_by)
        .limit(batch_size)
    )
    return list(result.scalars().all())


async def _delete_selected_ids(
    session: AsyncSession,
    *,
    model: type[Any],
    ids: list[Any],
    dry_run: bool,
) -> int:
    if not ids or dry_run:
        return len(ids)
    result = await session.execute(delete(model).where(model.id.in_(ids)))
    rowcount = getattr(result, "rowcount", None)
    if isinstance(rowcount, int) and rowcount >= 0:
        return rowcount
    return len(ids)


async def maintain_data_lifecycle(
    session: AsyncSession,
    *,
    settings: Settings | None = None,
    now: datetime | None = None,
    dry_run: bool = False,
    batch_size: int | None = None,
) -> DataLifecycleRetentionResult:
    """Delete expired personal/operational data in bounded batches.

    The function intentionally does not commit. The caller owns the transaction so
    scheduled jobs can roll back the whole maintenance pass on failure. Active shares,
    live characters and manual backups are never selected by this routine.
    """

    active_settings = settings or get_settings()
    current_time = now or datetime.now(UTC)
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("data lifecycle maintenance time must include a timezone")

    effective_batch_size = batch_size or active_settings.data_lifecycle_batch_size
    if not 1 <= effective_batch_size <= active_settings.data_lifecycle_batch_size:
        raise ValueError(
            "data lifecycle batch size must be between 1 and the configured maximum"
        )

    started = perf_counter()
    character_cutoff = current_time - timedelta(
        days=active_settings.cloud_character_tombstone_retention_days
    )
    pending_share_cutoff = current_time - timedelta(
        days=active_settings.pending_share_retention_days
    )
    revoked_share_cutoff = current_time - timedelta(
        days=active_settings.revoked_share_retention_days
    )
    refresh_session_cutoff = current_time - timedelta(
        days=active_settings.refresh_session_retention_days
    )
    audit_cutoff = current_time - timedelta(days=active_settings.audit_retention_days)

    # Purge character tombstones first. Their children use ON DELETE CASCADE and
    # audit references use ON DELETE SET NULL, preserving minimized security history.
    character_ids = await _select_ids(
        session,
        model=CloudCharacter,
        predicate=and_(
            CloudCharacter.deleted_at.is_not(None),
            CloudCharacter.deleted_at <= character_cutoff,
        ),
        order_by=(CloudCharacter.deleted_at.asc(), CloudCharacter.id.asc()),
        batch_size=effective_batch_size,
    )
    character_count = await _delete_selected_ids(
        session,
        model=CloudCharacter,
        ids=character_ids,
        dry_run=dry_run,
    )

    pending_share_ids = await _select_ids(
        session,
        model=CharacterShare,
        predicate=and_(
            CharacterShare.status == "pending",
            CharacterShare.created_at <= pending_share_cutoff,
        ),
        order_by=(CharacterShare.created_at.asc(), CharacterShare.id.asc()),
        batch_size=effective_batch_size,
    )
    pending_share_count = await _delete_selected_ids(
        session,
        model=CharacterShare,
        ids=pending_share_ids,
        dry_run=dry_run,
    )

    revoked_share_ids = await _select_ids(
        session,
        model=CharacterShare,
        predicate=and_(
            CharacterShare.status == "revoked",
            CharacterShare.revoked_at.is_not(None),
            CharacterShare.revoked_at <= revoked_share_cutoff,
        ),
        order_by=(CharacterShare.revoked_at.asc(), CharacterShare.id.asc()),
        batch_size=effective_batch_size,
    )
    revoked_share_count = await _delete_selected_ids(
        session,
        model=CharacterShare,
        ids=revoked_share_ids,
        dry_run=dry_run,
    )

    refresh_session_ids = await _select_ids(
        session,
        model=RefreshSession,
        predicate=or_(
            RefreshSession.expires_at <= refresh_session_cutoff,
            and_(
                RefreshSession.revoked_at.is_not(None),
                RefreshSession.revoked_at <= refresh_session_cutoff,
            ),
        ),
        order_by=(RefreshSession.expires_at.asc(), RefreshSession.id.asc()),
        batch_size=effective_batch_size,
    )
    refresh_session_count = await _delete_selected_ids(
        session,
        model=RefreshSession,
        ids=refresh_session_ids,
        dry_run=dry_run,
    )

    audit_event_ids = await _select_ids(
        session,
        model=AuditEvent,
        predicate=AuditEvent.created_at <= audit_cutoff,
        order_by=(AuditEvent.created_at.asc(), AuditEvent.id.asc()),
        batch_size=effective_batch_size,
    )
    audit_event_count = await _delete_selected_ids(
        session,
        model=AuditEvent,
        ids=audit_event_ids,
        dry_run=dry_run,
    )

    selected = {
        "cloud_character_tombstones": character_ids,
        "pending_character_shares": pending_share_ids,
        "revoked_character_shares": revoked_share_ids,
        "refresh_sessions": refresh_session_ids,
        "audit_events": audit_event_ids,
    }
    batch_limit_reached = tuple(
        name for name, ids in selected.items() if len(ids) == effective_batch_size
    )
    result = DataLifecycleRetentionResult(
        now=current_time,
        dry_run=dry_run,
        batch_size=effective_batch_size,
        cloud_character_cutoff=character_cutoff,
        pending_share_cutoff=pending_share_cutoff,
        revoked_share_cutoff=revoked_share_cutoff,
        refresh_session_cutoff=refresh_session_cutoff,
        audit_cutoff=audit_cutoff,
        cloud_characters_deleted=character_count,
        pending_shares_deleted=pending_share_count,
        revoked_shares_deleted=revoked_share_count,
        refresh_sessions_deleted=refresh_session_count,
        audit_events_deleted=audit_event_count,
        batch_limit_reached=batch_limit_reached,
    )
    duration = perf_counter() - started
    metrics = get_current_metrics()
    metrics.record_data_lifecycle_maintenance(
        counts=result.counts(),
        dry_run=dry_run,
        duration_seconds=duration,
    )
    log_event(
        logger,
        logging.INFO,
        "privacy.data_lifecycle.completed",
        dryRun=dry_run,
        batchSize=effective_batch_size,
        totalMatched=result.total_matched,
        totalDeleted=result.total_deleted,
        counts=result.counts(),
        batchLimitReached=list(batch_limit_reached),
        durationSeconds=round(duration, 6),
    )
    return result
