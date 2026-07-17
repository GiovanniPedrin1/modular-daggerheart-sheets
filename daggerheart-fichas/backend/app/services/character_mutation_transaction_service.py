from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit_actions
from app.core.config import Settings
from app.core.database_concurrency import (
    POSTGRES_UNIQUE_VIOLATION,
    extract_postgres_constraint_name,
    extract_postgres_sqlstate,
    is_retryable_character_write_error,
)
from app.core.observability import Stopwatch, get_current_metrics, log_event
from app.models.character_mutation import CharacterMutation
from app.models.cloud_character import CloudCharacter
from app.schemas.character_sync import CharacterMutationRequest
from app.services import audit_service
from app.services import character_event_service as event_service
from app.services import character_mutation_service as mutation_service

MUTATION_IDEMPOTENCY_CONSTRAINT = "uq_character_mutations_character_device_mutation"
CONTENT_EVENT_REVISION_CONSTRAINT = "uq_character_events_character_content_revision"

SleepFunction = Callable[[float], Awaitable[None]]

logger = logging.getLogger(__name__)


class CharacterMutationTransactionError(Exception):
    """Base error for transaction-level character mutation failures."""


@dataclass(frozen=True, slots=True)
class CharacterWriteBusyError(CharacterMutationTransactionError):
    attempts: int
    retry_after_seconds: int = 1

    def __str__(self) -> str:
        return "The character is temporarily busy because concurrent writes could not settle."


def _retry_delay_seconds(attempt: int, *, settings: Settings) -> float:
    delay_ms = settings.character_write_retry_base_delay_ms * (2 ** max(0, attempt - 1))
    return min(delay_ms, settings.character_write_retry_max_delay_ms) / 1000


def _retry_reason(error: DBAPIError, *, constraint: str | None) -> str:
    sqlstate = extract_postgres_sqlstate(error)
    if constraint == MUTATION_IDEMPOTENCY_CONSTRAINT:
        return "idempotency_race"
    if constraint == CONTENT_EVENT_REVISION_CONSTRAINT:
        return "content_revision_race"
    return {
        "40001": "serialization_failure",
        "40P01": "deadlock",
        "55P03": "lock_unavailable",
    }.get(sqlstate or "", "connection_or_commit")


def _record_mutation_result(
    result: mutation_service.CharacterMutationServiceResult,
    *,
    stopwatch: Stopwatch,
) -> None:
    merged = (
        bool(result.mutation.merged)
        if isinstance(result, mutation_service.CharacterMutationAppliedResult)
        else False
    )
    metrics = get_current_metrics()
    metrics.record_character_mutation(
        outcome=result.outcome,
        duplicate=result.duplicate,
        merged=merged,
        duration_seconds=stopwatch.elapsed(),
    )
    log_event(
        logger,
        logging.INFO if result.outcome == "applied" else logging.WARNING,
        "character.mutation.completed",
        outcome=result.outcome,
        duplicate=result.duplicate,
        merged=merged,
        unchanged=bool(getattr(result.mutation, "unchanged", False)),
        baseRevision=result.mutation.base_revision,
        serverRevision=(
            result.mutation.applied_revision
            or result.mutation.conflict_server_revision
            or result.character.server_revision
        ),
        changedPathCount=len(result.mutation.changed_paths),
        conflictPathCount=len(result.mutation.conflict_paths or []),
        rejectionCode=result.mutation.rejection_code,
        durationMs=round(stopwatch.elapsed() * 1000, 3),
    )


async def _rollback_quietly(session: AsyncSession) -> None:
    # rollback() is required after failed COMMIT/flush before the session can be reused.
    await session.rollback()


async def _load_duplicate_result(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
    input_data: CharacterMutationRequest,
) -> mutation_service.CharacterMutationServiceResult | None:
    """Recover the winner after a concurrent idempotency-key INSERT."""

    query = (
        select(CloudCharacter, CharacterMutation)
        .join(CharacterMutation, CharacterMutation.character_id == CloudCharacter.id)
        .where(
            CloudCharacter.id == character_id,
            CloudCharacter.owner_user_id == owner_user_id,
            CharacterMutation.device_id == input_data.device_id,
            CharacterMutation.mutation_id == input_data.mutation_id,
        )
    )
    result = await session.execute(query)
    row = result.one_or_none()
    if row is None:
        return None
    character, mutation = row
    return mutation_service.resolve_existing_character_mutation(
        character=character,
        mutation=mutation,
        input_data=input_data,
    )


async def _run_once(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
    input_data: CharacterMutationRequest,
    settings: Settings,
) -> mutation_service.CharacterMutationServiceResult:
    result = await mutation_service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_user_id,
        character_id=character_id,
        input_data=input_data,
        settings=settings,
    )

    if (
        isinstance(result, mutation_service.CharacterMutationAppliedResult)
        and result.should_emit_updated_event
    ):
        await event_service.append_character_updated_event(
            session,
            character=result.character,
            actor_user_id=owner_user_id,
            changed_paths=result.mutation.changed_paths,
            device_id=result.mutation.device_id,
        )

    if not result.duplicate:
        if isinstance(result, mutation_service.CharacterMutationAppliedResult):
            action = audit_actions.CHARACTER_MUTATION_APPLIED
            metadata = {
                "baseRevision": result.mutation.base_revision,
                "serverRevision": result.mutation.applied_revision,
                "changedPathCount": len(result.mutation.changed_paths),
                "operationCount": len(result.mutation.operations),
                "merged": result.mutation.merged,
                "unchanged": result.mutation.unchanged,
            }
        elif isinstance(result, mutation_service.CharacterMutationConflictResult):
            action = audit_actions.CHARACTER_MUTATION_CONFLICT
            metadata = {
                "baseRevision": result.mutation.base_revision,
                "serverRevision": result.mutation.conflict_server_revision,
                "changedPathCount": len(result.mutation.changed_paths),
                "conflictPathCount": len(result.mutation.conflict_paths or []),
            }
        else:
            action = audit_actions.CHARACTER_MUTATION_REJECTED
            metadata = {
                "baseRevision": result.mutation.base_revision,
                "changedPathCount": len(result.mutation.changed_paths),
                "rejectionCode": result.mutation.rejection_code,
            }

        await audit_service.append_audit_event(
            session,
            action=action,
            actor_user_id=owner_user_id,
            character_id=character_id,
            resource_type="character_mutation",
            resource_id=result.mutation.id,
            device_id=result.mutation.device_id,
            metadata=metadata,
            settings=settings,
        )

    await session.commit()
    if (
        isinstance(result, mutation_service.CharacterMutationAppliedResult)
        and result.should_emit_updated_event
    ):
        await session.refresh(result.character)
    return result


async def execute_owner_character_mutation(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
    input_data: CharacterMutationRequest,
    settings: Settings,
    sleep: SleepFunction = asyncio.sleep,
) -> mutation_service.CharacterMutationServiceResult:
    """Apply and commit one mutation with bounded, idempotent concurrency retries.

    Character, mutation and content event remain in the same database transaction.
    The character row lock serializes normal writers. SQLSTATE retries cover
    deadlocks, serialization failures, lock timeouts and ambiguous connection loss.
    """

    stopwatch = Stopwatch.start()
    attempts = settings.character_write_retry_attempts
    for attempt in range(1, attempts + 1):
        try:
            result = await _run_once(
                session,
                owner_user_id=owner_user_id,
                character_id=character_id,
                input_data=input_data,
                settings=settings,
            )
            _record_mutation_result(result, stopwatch=stopwatch)
            return result
        except IntegrityError as error:
            constraint = extract_postgres_constraint_name(error)
            sqlstate = extract_postgres_sqlstate(error)
            await _rollback_quietly(session)

            if (
                sqlstate == POSTGRES_UNIQUE_VIOLATION
                and constraint == MUTATION_IDEMPOTENCY_CONSTRAINT
            ):
                duplicate = await _load_duplicate_result(
                    session,
                    owner_user_id=owner_user_id,
                    character_id=character_id,
                    input_data=input_data,
                )
                if duplicate is not None:
                    await session.commit()
                    _record_mutation_result(duplicate, stopwatch=stopwatch)
                    return duplicate

            retryable = (
                is_retryable_character_write_error(error)
                or constraint == CONTENT_EVENT_REVISION_CONSTRAINT
                or (
                    sqlstate == POSTGRES_UNIQUE_VIOLATION
                    and constraint == MUTATION_IDEMPOTENCY_CONSTRAINT
                )
            )
            if not retryable:
                raise
            retry_reason = _retry_reason(error, constraint=constraint)
        except DBAPIError as error:
            await _rollback_quietly(session)
            if not is_retryable_character_write_error(error):
                raise
            retry_reason = _retry_reason(error, constraint=None)

        metrics = get_current_metrics()
        metrics.record_character_write_retry(reason=retry_reason)
        log_event(
            logger,
            logging.WARNING,
            "character.write.retry",
            attempt=attempt,
            maxAttempts=attempts,
            reason=retry_reason,
        )
        if attempt >= attempts:
            metrics.record_character_write_busy()
            log_event(
                logger,
                logging.ERROR,
                "character.write.busy",
                attempts=attempts,
                durationMs=round(stopwatch.elapsed() * 1000, 3),
            )
            raise CharacterWriteBusyError(attempts=attempts)
        await sleep(_retry_delay_seconds(attempt, settings=settings))

    raise AssertionError("character mutation retry loop exhausted unexpectedly")
