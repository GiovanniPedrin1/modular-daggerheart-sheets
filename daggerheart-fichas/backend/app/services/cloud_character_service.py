from __future__ import annotations

import hashlib
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.cloud_character import CloudCharacter
from app.schemas.characters import (
    CloudCharacterSnapshotInput,
    CreateCloudCharacterRequest,
    UpdateCloudCharacterRequest,
)
from app.services import character_event_service as event_service
from app.services.character_patch_service import (
    CharacterPatchError,
    create_character_mutation_diff,
)
from app.services.cloud_character_hash import serialize_cloud_character_snapshot

type CreateCloudCharacterReason = Literal["existing_identical_snapshot"]


class CloudCharacterServiceError(Exception):
    """Base class for domain errors raised by the Cloud Character service."""


class CloudCharacterNotFoundError(CloudCharacterServiceError):
    def __init__(self, character_id: UUID) -> None:
        self.character_id = character_id
        super().__init__(f"Cloud character {character_id} was not found")


class CloudCharacterAlreadyExistsError(CloudCharacterServiceError):
    def __init__(self, character: CloudCharacter) -> None:
        self.character = character
        super().__init__(
            "An active cloud character already exists for "
            f"local character {character.local_character_id}"
        )


class CloudCharacterRevisionMismatchError(CloudCharacterServiceError):
    def __init__(self, character: CloudCharacter, received_base_revision: int) -> None:
        self.character = character
        self.received_base_revision = received_base_revision
        super().__init__(
            f"Cloud character {character.id} is at revision "
            f"{character.server_revision}, received {received_base_revision}"
        )


class CloudCharacterTooLargeError(CloudCharacterServiceError):
    def __init__(self, *, max_bytes: int, actual_bytes: int) -> None:
        self.max_bytes = max_bytes
        self.actual_bytes = actual_bytes
        super().__init__(
            f"Cloud character snapshot is {actual_bytes} bytes; maximum is {max_bytes}"
        )


class UnsupportedCloudCharacterSchemaVersionError(CloudCharacterServiceError):
    def __init__(self, *, supported_version: int, received_version: int) -> None:
        self.supported_version = supported_version
        self.received_version = received_version
        super().__init__(
            f"Cloud character schema version {received_version} is not supported; "
            f"expected {supported_version}"
        )


@dataclass(frozen=True, slots=True)
class ValidatedCloudCharacterSnapshot:
    content_hash: str
    encoded_size: int


@dataclass(frozen=True, slots=True)
class CreateCloudCharacterResult:
    character: CloudCharacter
    created: bool
    reason: CreateCloudCharacterReason | None = None


@dataclass(frozen=True, slots=True)
class UpdateCloudCharacterResult:
    character: CloudCharacter
    unchanged: bool


@dataclass(frozen=True, slots=True)
class DeleteCloudCharacterResult:
    character_id: UUID
    deleted_at: datetime


def validate_cloud_character_snapshot(
    snapshot: CloudCharacterSnapshotInput,
    *,
    settings: Settings,
) -> ValidatedCloudCharacterSnapshot:
    """Validate service-level limits and calculate the server-owned content hash."""

    if snapshot.schema_version != settings.supported_cloud_character_schema_version:
        raise UnsupportedCloudCharacterSchemaVersionError(
            supported_version=settings.supported_cloud_character_schema_version,
            received_version=snapshot.schema_version,
        )

    canonical_snapshot = serialize_cloud_character_snapshot(snapshot)
    encoded_size = len(canonical_snapshot.encode("utf-8"))
    if encoded_size > settings.max_cloud_character_payload_bytes:
        raise CloudCharacterTooLargeError(
            max_bytes=settings.max_cloud_character_payload_bytes,
            actual_bytes=encoded_size,
        )

    return ValidatedCloudCharacterSnapshot(
        content_hash=hashlib.sha256(canonical_snapshot.encode("utf-8")).hexdigest(),
        encoded_size=encoded_size,
    )


async def find_active_cloud_character_by_local_id(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    local_character_id: str,
) -> CloudCharacter | None:
    result = await session.execute(
        select(CloudCharacter).where(
            CloudCharacter.owner_user_id == owner_user_id,
            CloudCharacter.local_character_id == local_character_id,
            CloudCharacter.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def list_owner_cloud_characters(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
) -> list[CloudCharacter]:
    result = await session.execute(
        select(CloudCharacter)
        .where(
            CloudCharacter.owner_user_id == owner_user_id,
            CloudCharacter.deleted_at.is_(None),
        )
        .order_by(CloudCharacter.updated_at.desc(), CloudCharacter.id.desc())
    )
    return list(result.scalars().all())


async def get_owner_cloud_character(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
    for_update: bool = False,
) -> CloudCharacter:
    statement = select(CloudCharacter).where(
        CloudCharacter.id == character_id,
        CloudCharacter.owner_user_id == owner_user_id,
        CloudCharacter.deleted_at.is_(None),
    )
    if for_update:
        statement = statement.with_for_update()

    result = await session.execute(statement)
    character = result.scalar_one_or_none()
    if character is None:
        raise CloudCharacterNotFoundError(character_id)
    return character


async def create_cloud_character(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    input_data: CreateCloudCharacterRequest,
    settings: Settings,
) -> CreateCloudCharacterResult:
    validated = validate_cloud_character_snapshot(input_data, settings=settings)
    existing = await find_active_cloud_character_by_local_id(
        session,
        owner_user_id=owner_user_id,
        local_character_id=input_data.local_character_id,
    )

    if existing is not None:
        if existing.content_hash == validated.content_hash:
            return CreateCloudCharacterResult(
                character=existing,
                created=False,
                reason="existing_identical_snapshot",
            )
        raise CloudCharacterAlreadyExistsError(existing)

    character = CloudCharacter(
        owner_user_id=owner_user_id,
        local_character_id=input_data.local_character_id,
        name=input_data.name,
        system=input_data.system,
        class_key=input_data.class_key,
        language=input_data.language,
        data=deepcopy(input_data.data),
        server_revision=1,
        content_hash=validated.content_hash,
        schema_version=input_data.schema_version,
        updated_by_device_id=input_data.device_id,
    )
    session.add(character)

    try:
        await session.flush()
    except IntegrityError:
        # A concurrent publish can win after the initial lookup. Roll back the
        # failed INSERT, then resolve the active unique record deterministically.
        await session.rollback()
        concurrent = await find_active_cloud_character_by_local_id(
            session,
            owner_user_id=owner_user_id,
            local_character_id=input_data.local_character_id,
        )
        if concurrent is None:
            raise
        if concurrent.content_hash == validated.content_hash:
            return CreateCloudCharacterResult(
                character=concurrent,
                created=False,
                reason="existing_identical_snapshot",
            )
        raise CloudCharacterAlreadyExistsError(concurrent) from None

    return CreateCloudCharacterResult(character=character, created=True)


async def update_cloud_character(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
    input_data: UpdateCloudCharacterRequest,
    settings: Settings,
) -> UpdateCloudCharacterResult:
    character = await get_owner_cloud_character(
        session,
        owner_user_id=owner_user_id,
        character_id=character_id,
        for_update=True,
    )

    if input_data.base_revision != character.server_revision:
        raise CloudCharacterRevisionMismatchError(
            character,
            received_base_revision=input_data.base_revision,
        )

    validated = validate_cloud_character_snapshot(input_data, settings=settings)
    if character.content_hash == validated.content_hash:
        return UpdateCloudCharacterResult(character=character, unchanged=True)

    previous_snapshot = CloudCharacterSnapshotInput.model_validate(
        {
            "name": character.name,
            "system": character.system,
            "classKey": character.class_key,
            "language": character.language,
            "data": character.data,
            "schemaVersion": character.schema_version,
        }
    )
    try:
        diff = create_character_mutation_diff(previous_snapshot, input_data)
    except CharacterPatchError:
        # The temporary full-snapshot PATCH may represent a schema migration or more
        # than the mutation path limit. Preserve compatibility by writing a safe
        # history barrier instead of failing or inventing incomplete path metadata.
        changed_paths: tuple[str, ...] | None = None
    else:
        if diff.is_empty:
            return UpdateCloudCharacterResult(character=character, unchanged=True)
        changed_paths = diff.changed_paths

    character.name = input_data.name
    character.system = input_data.system
    character.class_key = input_data.class_key
    character.language = input_data.language
    character.data = deepcopy(input_data.data)
    character.schema_version = input_data.schema_version
    character.content_hash = validated.content_hash
    character.server_revision += 1
    character.updated_by_device_id = input_data.device_id
    character.updated_at = datetime.now(UTC)

    await event_service.append_character_updated_event(
        session,
        character=character,
        actor_user_id=owner_user_id,
        changed_paths=changed_paths,
        device_id=input_data.device_id,
    )
    return UpdateCloudCharacterResult(character=character, unchanged=False)


async def soft_delete_cloud_character(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    character_id: UUID,
) -> DeleteCloudCharacterResult:
    character = await get_owner_cloud_character(
        session,
        owner_user_id=owner_user_id,
        character_id=character_id,
        for_update=True,
    )
    deleted_at = datetime.now(UTC)
    character.server_revision += 1
    character.deleted_at = deleted_at
    character.updated_at = deleted_at
    await event_service.append_character_deleted_event(
        session,
        character=character,
        actor_user_id=owner_user_id,
    )

    return DeleteCloudCharacterResult(
        character_id=character.id,
        deleted_at=deleted_at,
    )
