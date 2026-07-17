from __future__ import annotations

import json
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.character_mutation_paths import (
    MAX_CHARACTER_MUTATION_OPERATIONS,
    CharacterMutationPathError,
    find_conflicting_character_mutation_paths,
    normalize_character_mutation_path,
    parse_character_mutation_path,
)
from app.core.config import Settings
from app.core.payload_validation import JsonPayloadValidationError, validate_json_payload
from app.models.character_event import CharacterEvent
from app.models.character_mutation import CharacterMutation
from app.models.cloud_character import CloudCharacter
from app.schemas.character_sync import (
    CharacterMutationAppliedCreate,
    CharacterMutationConflictCreate,
    CharacterMutationRejectedCreate,
    CharacterMutationRequest,
)
from app.schemas.characters import CloudCharacterPublic, CloudCharacterSnapshotInput
from app.services import character_event_service as event_service
from app.services import cloud_character_service as character_service
from app.services.character_patch_service import (
    CharacterPatchError,
    apply_character_mutation_operations,
)

type CharacterMutationServiceOutcome = Literal["applied", "conflict", "rejected"]


class CharacterMutationServiceError(Exception):
    """Base class for errors that cannot be represented as a persisted outcome."""


class CharacterMutationIdempotencyKeyReuseError(CharacterMutationServiceError):
    """Raised when the same mutation key is reused with different request content."""

    def __init__(
        self,
        *,
        mutation: CharacterMutation,
        received_request_hash: str,
    ) -> None:
        self.mutation = mutation
        self.received_request_hash = received_request_hash
        super().__init__("The mutation idempotency key was already used with a different payload")


@dataclass(frozen=True, slots=True)
class CharacterMutationAppliedResult:
    character: CloudCharacter
    mutation: CharacterMutation
    duplicate: bool = False
    outcome: Literal["applied"] = "applied"

    @property
    def should_emit_updated_event(self) -> bool:
        """Whether the caller must append one update event before committing.

        Event path persistence is intentionally connected in the next implementation
        step. Keeping this explicit prevents an endpoint from silently committing a
        changed character without the matching revision event.
        """

        return not self.duplicate and not self.mutation.unchanged


@dataclass(frozen=True, slots=True)
class CharacterMutationConflictResult:
    character: CloudCharacter
    mutation: CharacterMutation
    duplicate: bool = False
    outcome: Literal["conflict"] = "conflict"


@dataclass(frozen=True, slots=True)
class CharacterMutationRejectedResult:
    character: CloudCharacter
    mutation: CharacterMutation
    duplicate: bool = False
    path: str | None = None
    max_bytes: int | None = None
    actual_bytes: int | None = None
    oldest_available_revision: int | None = None
    outcome: Literal["rejected"] = "rejected"

    @property
    def code(self) -> str:
        if self.mutation.rejection_code is None:  # pragma: no cover - model invariant
            raise ValueError("rejected mutation is missing rejection_code")
        return self.mutation.rejection_code

    @property
    def reason(self) -> str:
        if self.mutation.rejection_reason is None:  # pragma: no cover - model invariant
            raise ValueError("rejected mutation is missing rejection_reason")
        return self.mutation.rejection_reason


CharacterMutationServiceResult = (
    CharacterMutationAppliedResult
    | CharacterMutationConflictResult
    | CharacterMutationRejectedResult
)


@dataclass(frozen=True, slots=True)
class CharacterRemotePathHistory:
    changed_paths: tuple[str, ...]
    oldest_available_revision: int | None


class _CharacterMutationContractError(Exception):
    def __init__(self, *, reason: str, path: str | None = None) -> None:
        self.reason = reason
        self.path = path
        super().__init__(reason)


class _CharacterRemoteHistoryUnavailable(Exception):
    def __init__(
        self,
        *,
        oldest_available_revision: int | None,
        reason: str,
    ) -> None:
        self.oldest_available_revision = oldest_available_revision
        self.reason = reason
        super().__init__(reason)


def character_snapshot_from_model(character: CloudCharacter) -> CloudCharacterSnapshotInput:
    """Create the validated mutable snapshot represented by a cloud character row."""

    return CloudCharacterSnapshotInput.model_validate(
        {
            "name": character.name,
            "system": character.system,
            "classKey": character.class_key,
            "language": character.language,
            "data": character.data,
            "schemaVersion": character.schema_version,
        }
    )


def _canonical_request_size(input_data: CharacterMutationRequest) -> int:
    encoded = json.dumps(
        input_data.canonical_payload(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return len(encoded)


def _validate_configured_mutation_contract(
    input_data: CharacterMutationRequest,
    *,
    settings: Settings,
) -> None:
    if len(input_data.device_id) > settings.max_device_id_length:
        raise _CharacterMutationContractError(
            reason=(
                "deviceId exceeds the configured maximum length of "
                f"{settings.max_device_id_length}."
            ),
            path="/deviceId",
        )

    if len(input_data.operations) > settings.max_character_mutation_operations:
        raise _CharacterMutationContractError(
            reason=(
                "operations exceeds the configured maximum item count of "
                f"{settings.max_character_mutation_operations}."
            ),
            path="/operations",
        )

    if len(input_data.changed_paths) > settings.max_character_mutation_changed_paths:
        raise _CharacterMutationContractError(
            reason=(
                "changedPaths exceeds the configured maximum item count of "
                f"{settings.max_character_mutation_changed_paths}."
            ),
            path="/changedPaths",
        )

    for index, path in enumerate(input_data.changed_paths):
        if len(path) > settings.max_character_mutation_path_length:
            raise _CharacterMutationContractError(
                reason=(
                    "mutation path exceeds the configured maximum length of "
                    f"{settings.max_character_mutation_path_length}."
                ),
                path=f"/changedPaths/{index}",
            )
        segments = parse_character_mutation_path(path)
        if len(segments) > settings.max_character_mutation_path_segments:
            raise _CharacterMutationContractError(
                reason=(
                    "mutation path exceeds the configured maximum segment count of "
                    f"{settings.max_character_mutation_path_segments}."
                ),
                path=f"/changedPaths/{index}",
            )

    try:
        validate_json_payload(
            input_data.canonical_payload(),
            max_depth=settings.max_json_depth,
            max_string_bytes=settings.max_json_string_length,
        )
    except JsonPayloadValidationError as error:
        raise _CharacterMutationContractError(
            reason=str(error),
            path=error.path,
        ) from error


async def find_character_mutation(
    session: AsyncSession,
    *,
    character_id: UUID,
    device_id: str,
    mutation_id: UUID,
) -> CharacterMutation | None:
    result = await session.execute(
        select(CharacterMutation).where(
            CharacterMutation.character_id == character_id,
            CharacterMutation.device_id == device_id,
            CharacterMutation.mutation_id == mutation_id,
        )
    )
    return result.scalar_one_or_none()


def _deduplicate_paths(paths: Sequence[str]) -> tuple[str, ...]:
    unique: list[str] = []
    seen: set[str] = set()
    for path in paths:
        canonical = normalize_character_mutation_path(path)
        if canonical in seen:
            continue
        unique.append(canonical)
        seen.add(canonical)
    return tuple(unique)


async def load_remote_changed_paths(
    session: AsyncSession,
    *,
    character_id: UUID,
    base_revision: int,
    server_revision: int,
) -> CharacterRemotePathHistory:
    """Load a complete, merge-safe path history after ``base_revision``.

    Every content revision must have exactly one persisted event and every updated
    event must contain canonical path metadata. Existing Phase 3 snapshot-only events
    are deliberately treated as barriers instead of guessed as safe merges.
    """

    if base_revision >= server_revision:
        return CharacterRemotePathHistory(changed_paths=(), oldest_available_revision=None)

    result = await session.execute(
        select(CharacterEvent)
        .where(
            CharacterEvent.character_id == character_id,
            CharacterEvent.event_type.in_(("updated", "deleted")),
            CharacterEvent.server_revision > base_revision,
            CharacterEvent.server_revision <= server_revision,
        )
        .order_by(CharacterEvent.server_revision.asc(), CharacterEvent.id.asc())
    )
    events = list(result.scalars().all())
    oldest_available_revision = await event_service.get_oldest_mergeable_revision(
        session,
        character_id=character_id,
    )

    expected_revisions = list(range(base_revision + 1, server_revision + 1))
    actual_revisions = [event.server_revision for event in events]
    if actual_revisions != expected_revisions:
        raise _CharacterRemoteHistoryUnavailable(
            oldest_available_revision=oldest_available_revision,
            reason="The server no longer has a complete event for every required revision.",
        )

    collected_paths: list[str] = []
    for event in events:
        if event.event_type != "updated" or not event.changed_paths:
            raise _CharacterRemoteHistoryUnavailable(
                oldest_available_revision=oldest_available_revision,
                reason="A required revision does not contain mutation path metadata.",
            )
        try:
            collected_paths.extend(
                normalize_character_mutation_path(path) for path in event.changed_paths
            )
        except (CharacterMutationPathError, TypeError) as exc:
            raise _CharacterRemoteHistoryUnavailable(
                oldest_available_revision=oldest_available_revision,
                reason="A required revision contains invalid mutation path metadata.",
            ) from exc

    unique_paths = _deduplicate_paths(collected_paths)
    if len(unique_paths) > MAX_CHARACTER_MUTATION_OPERATIONS:
        raise _CharacterRemoteHistoryUnavailable(
            oldest_available_revision=oldest_available_revision,
            reason="The remote path history is too large to represent safely.",
        )

    return CharacterRemotePathHistory(
        changed_paths=unique_paths,
        oldest_available_revision=oldest_available_revision,
    )


def _make_rejected_mutation(
    *,
    character: CloudCharacter,
    input_data: CharacterMutationRequest,
    code: str,
    reason: str,
) -> CharacterMutation:
    return CharacterMutationRejectedCreate(
        characterId=character.id,
        ownerUserId=character.owner_user_id,
        request=input_data,
        rejectionCode=code,
        rejectionReason=reason,
    ).to_model()


async def _persist_rejection(
    session: AsyncSession,
    *,
    character: CloudCharacter,
    input_data: CharacterMutationRequest,
    code: str,
    reason: str,
    path: str | None = None,
    max_bytes: int | None = None,
    actual_bytes: int | None = None,
    oldest_available_revision: int | None = None,
) -> CharacterMutationRejectedResult:
    mutation = _make_rejected_mutation(
        character=character,
        input_data=input_data,
        code=code,
        reason=reason,
    )
    session.add(mutation)
    await session.flush()
    return CharacterMutationRejectedResult(
        character=character,
        mutation=mutation,
        path=path,
        max_bytes=max_bytes,
        actual_bytes=actual_bytes,
        oldest_available_revision=oldest_available_revision,
    )


def resolve_existing_character_mutation(
    *,
    character: CloudCharacter,
    mutation: CharacterMutation,
    input_data: CharacterMutationRequest,
) -> CharacterMutationServiceResult:
    request_hash = input_data.calculate_request_hash()
    if mutation.request_hash != request_hash:
        raise CharacterMutationIdempotencyKeyReuseError(
            mutation=mutation,
            received_request_hash=request_hash,
        )

    if mutation.status == "applied":
        return CharacterMutationAppliedResult(
            character=character,
            mutation=mutation,
            duplicate=True,
        )
    if mutation.status == "conflict":
        return CharacterMutationConflictResult(
            character=character,
            mutation=mutation,
            duplicate=True,
        )
    if mutation.status == "rejected":
        return CharacterMutationRejectedResult(
            character=character,
            mutation=mutation,
            duplicate=True,
        )
    raise ValueError(f"unsupported character mutation status: {mutation.status}")


def _apply_snapshot_to_character(
    character: CloudCharacter,
    *,
    snapshot: CloudCharacterSnapshotInput,
    content_hash: str,
    device_id: str,
) -> None:
    character.name = snapshot.name
    character.system = snapshot.system
    character.class_key = snapshot.class_key
    character.language = snapshot.language
    character.data = deepcopy(snapshot.data)
    character.schema_version = snapshot.schema_version
    character.content_hash = content_hash
    character.server_revision += 1
    character.updated_by_device_id = device_id
    character.updated_at = datetime.now(UTC)


async def apply_owner_character_mutation(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
    input_data: CharacterMutationRequest,
    settings: Settings,
) -> CharacterMutationServiceResult:
    """Validate, merge, and persist one owner's mutation without committing.

    The character row is locked first, serializing concurrent writes for the same
    character. A successful changed result exposes ``should_emit_updated_event``;
    the caller must append the matching event in the same transaction before
    committing.
    """

    character = await character_service.get_owner_cloud_character(
        session,
        owner_user_id=owner_user_id,
        character_id=character_id,
        for_update=True,
    )

    existing = await find_character_mutation(
        session,
        character_id=character.id,
        device_id=input_data.device_id,
        mutation_id=input_data.mutation_id,
    )
    if existing is not None:
        return resolve_existing_character_mutation(
            character=character,
            mutation=existing,
            input_data=input_data,
        )

    actual_request_bytes = _canonical_request_size(input_data)
    if actual_request_bytes > settings.max_character_mutation_payload_bytes:
        return await _persist_rejection(
            session,
            character=character,
            input_data=input_data,
            code="MUTATION_TOO_LARGE",
            reason="The encoded mutation exceeds the configured payload limit.",
            max_bytes=settings.max_character_mutation_payload_bytes,
            actual_bytes=actual_request_bytes,
        )

    try:
        _validate_configured_mutation_contract(input_data, settings=settings)
    except _CharacterMutationContractError as error:
        return await _persist_rejection(
            session,
            character=character,
            input_data=input_data,
            code="INVALID_MUTATION",
            reason=error.reason,
            path=error.path,
        )

    if (
        input_data.schema_version != character.schema_version
        or input_data.schema_version != settings.supported_cloud_character_schema_version
    ):
        return await _persist_rejection(
            session,
            character=character,
            input_data=input_data,
            code="UNSUPPORTED_CHARACTER_SCHEMA_VERSION",
            reason=(
                "The mutation schemaVersion must match the current character and "
                "the server-supported schema version."
            ),
        )

    if input_data.base_revision > character.server_revision:
        return await _persist_rejection(
            session,
            character=character,
            input_data=input_data,
            code="SYNC_CLIENT_AHEAD",
            reason="The mutation is based on a revision newer than the server.",
        )

    merged = input_data.base_revision < character.server_revision
    if merged:
        try:
            remote_history = await load_remote_changed_paths(
                session,
                character_id=character.id,
                base_revision=input_data.base_revision,
                server_revision=character.server_revision,
            )
        except _CharacterRemoteHistoryUnavailable as exc:
            return await _persist_rejection(
                session,
                character=character,
                input_data=input_data,
                code="REVISION_NOT_AVAILABLE",
                reason=exc.reason,
                oldest_available_revision=exc.oldest_available_revision,
            )

        conflicting_paths = find_conflicting_character_mutation_paths(
            input_data.changed_paths,
            remote_history.changed_paths,
        )
        if conflicting_paths:
            mutation = CharacterMutationConflictCreate(
                characterId=character.id,
                ownerUserId=owner_user_id,
                request=input_data,
                serverRevision=character.server_revision,
                conflictingPaths=list(conflicting_paths),
                serverChangedPaths=list(remote_history.changed_paths),
                serverCharacter=CloudCharacterPublic.model_validate(character),
            ).to_model()
            session.add(mutation)
            await session.flush()
            return CharacterMutationConflictResult(
                character=character,
                mutation=mutation,
            )

    current_snapshot = character_snapshot_from_model(character)
    try:
        applied_patch = apply_character_mutation_operations(
            current_snapshot,
            input_data.operations,
        )
    except CharacterPatchError as exc:
        return await _persist_rejection(
            session,
            character=character,
            input_data=input_data,
            code="INVALID_MUTATION",
            reason=str(exc),
            path=exc.path,
        )

    next_snapshot = CloudCharacterSnapshotInput.model_validate(applied_patch.snapshot)
    try:
        validated_snapshot = character_service.validate_cloud_character_snapshot(
            next_snapshot,
            settings=settings,
        )
    except character_service.CloudCharacterTooLargeError as exc:
        return await _persist_rejection(
            session,
            character=character,
            input_data=input_data,
            code="MUTATION_TOO_LARGE",
            reason="The resulting character snapshot exceeds the configured payload limit.",
            max_bytes=exc.max_bytes,
            actual_bytes=exc.actual_bytes,
        )
    except character_service.UnsupportedCloudCharacterSchemaVersionError:
        return await _persist_rejection(
            session,
            character=character,
            input_data=input_data,
            code="UNSUPPORTED_CHARACTER_SCHEMA_VERSION",
            reason="The resulting character schema version is not supported by the server.",
        )

    if not applied_patch.changed:
        mutation = CharacterMutationAppliedCreate(
            characterId=character.id,
            ownerUserId=owner_user_id,
            request=input_data,
            appliedRevision=character.server_revision,
            merged=False,
            unchanged=True,
        ).to_model()
        session.add(mutation)
        await session.flush()
        return CharacterMutationAppliedResult(
            character=character,
            mutation=mutation,
        )

    _apply_snapshot_to_character(
        character,
        snapshot=next_snapshot,
        content_hash=validated_snapshot.content_hash,
        device_id=input_data.device_id,
    )
    mutation = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=owner_user_id,
        request=input_data,
        appliedRevision=character.server_revision,
        merged=merged,
        unchanged=False,
    ).to_model()
    session.add(mutation)
    await session.flush()
    return CharacterMutationAppliedResult(
        character=character,
        mutation=mutation,
    )
