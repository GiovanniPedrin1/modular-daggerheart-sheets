from __future__ import annotations

import hashlib
import json
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.core.character_mutation_paths import (
    MAX_CHARACTER_MUTATION_OPERATIONS,
    MAX_CHARACTER_MUTATION_PATH_LENGTH,
    character_mutation_paths_intersect,
    find_intersecting_character_mutation_paths,
    is_character_metadata_mutation_path,
    normalize_character_mutation_path,
)
from app.models.character_mutation import CharacterMutation
from app.models.cloud_character import CloudCharacter
from app.schemas.characters import CloudCharacterPublic, CloudCharacterSchema

type CharacterMutationResult = Literal["applied", "duplicate"]
type CharacterMutationOperationType = Literal["set", "remove"]


class CharacterSyncSchema(CloudCharacterSchema):
    """Shared configuration for the Phase 4 owner-sync HTTP contract."""


def _canonical_json_bytes(value: object) -> bytes:
    """Serialize a validated mutation payload deterministically for idempotency."""
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


class CharacterMutationOperation(CharacterSyncSchema):
    op: CharacterMutationOperationType
    path: str = Field(min_length=1, max_length=MAX_CHARACTER_MUTATION_PATH_LENGTH)

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        return normalize_character_mutation_path(value)


class CharacterMutationSetOperation(CharacterMutationOperation):
    op: Literal["set"] = "set"
    value: Any

    @field_validator("value")
    @classmethod
    def require_json_compatible_value(cls, value: Any) -> Any:
        try:
            _canonical_json_bytes(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("value must contain only JSON-compatible data") from exc
        return value


class CharacterMutationRemoveOperation(CharacterMutationOperation):
    op: Literal["remove"] = "remove"

    @model_validator(mode="after")
    def reject_required_metadata_removal(self) -> Self:
        if is_character_metadata_mutation_path(self.path):
            raise ValueError("required character metadata cannot be removed; use a set operation")
        return self


CharacterMutationOperationPublic = Annotated[
    CharacterMutationSetOperation | CharacterMutationRemoveOperation,
    Field(discriminator="op"),
]


def _normalize_unique_paths(value: list[str], *, label: str) -> list[str]:
    normalized = [normalize_character_mutation_path(path) for path in value]
    if len(normalized) != len(set(normalized)):
        raise ValueError(f"{label} cannot contain duplicates")
    return normalized


def _validate_non_overlapping_paths(value: list[str], *, label: str) -> list[str]:
    intersecting_paths = find_intersecting_character_mutation_paths(value)
    if intersecting_paths:
        left, right = intersecting_paths[0]
        raise ValueError(
            f"{label} cannot contain overlapping parent/child paths: {left} and {right}"
        )
    return value


class CharacterMutationRequest(CharacterSyncSchema):
    mode: Literal["mutation"]
    base_revision: int = Field(ge=1, alias="baseRevision")
    device_id: str = Field(min_length=1, max_length=128, alias="deviceId")
    mutation_id: UUID = Field(alias="mutationId")
    schema_version: int = Field(default=1, ge=1, le=100, alias="schemaVersion")
    changed_paths: list[str] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="changedPaths",
    )
    operations: list[CharacterMutationOperationPublic] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
    )

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("deviceId cannot be empty")
        return normalized

    @field_validator("changed_paths")
    @classmethod
    def validate_changed_paths(cls, value: list[str]) -> list[str]:
        return _normalize_unique_paths(value, label="changedPaths")

    @model_validator(mode="after")
    def validate_operations_match_changed_paths(self) -> Self:
        operation_paths = [operation.path for operation in self.operations]
        _normalize_unique_paths(operation_paths, label="operations")
        _validate_non_overlapping_paths(operation_paths, label="operations")
        if operation_paths != self.changed_paths:
            raise ValueError("changedPaths must match operation paths in the same canonical order")
        return self

    def canonical_payload(self) -> dict[str, object]:
        """Return the exact normalized payload used to detect idempotency-key reuse."""
        return self.model_dump(by_alias=True, mode="json")

    def calculate_request_hash(self) -> str:
        """Calculate the lowercase SHA-256 stored with the mutation record."""
        return hashlib.sha256(_canonical_json_bytes(self.canonical_payload())).hexdigest()


class CharacterMutationCreateSchema(CharacterSyncSchema):
    """Validated internal input shared by mutation-writing services."""

    character_id: UUID = Field(alias="characterId")
    owner_user_id: UUID = Field(alias="ownerUserId")
    request: CharacterMutationRequest

    def _base_model_fields(self) -> dict[str, object]:
        return {
            "character_id": self.character_id,
            "owner_user_id": self.owner_user_id,
            "mutation_id": self.request.mutation_id,
            "device_id": self.request.device_id,
            "base_revision": self.request.base_revision,
            "schema_version": self.request.schema_version,
            "changed_paths": list(self.request.changed_paths),
            "operations": [
                operation.model_dump(by_alias=True, mode="json")
                for operation in self.request.operations
            ],
            "request_hash": self.request.calculate_request_hash(),
        }


class CharacterMutationAppliedCreate(CharacterMutationCreateSchema):
    applied_revision: int = Field(ge=1, alias="appliedRevision")
    merged: bool = False
    unchanged: bool = False

    @model_validator(mode="after")
    def validate_applied_state(self) -> Self:
        if self.applied_revision < self.request.base_revision:
            raise ValueError("appliedRevision cannot be older than baseRevision")
        if self.merged and self.unchanged:
            raise ValueError("an unchanged mutation cannot be stored as merged")
        return self

    def to_model(self) -> CharacterMutation:
        return CharacterMutation(
            **self._base_model_fields(),
            status="applied",
            applied_revision=self.applied_revision,
            merged=self.merged,
            unchanged=self.unchanged,
        )


class CharacterMutationConflictCreate(CharacterMutationCreateSchema):
    server_revision: int = Field(ge=1, alias="serverRevision")
    conflicting_paths: list[str] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="conflictingPaths",
    )
    server_changed_paths: list[str] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="serverChangedPaths",
    )
    server_character: CloudCharacterPublic = Field(alias="serverCharacter")

    @field_validator("conflicting_paths", "server_changed_paths")
    @classmethod
    def validate_path_list(cls, value: list[str]) -> list[str]:
        return _normalize_unique_paths(value, label="path lists")

    @model_validator(mode="after")
    def validate_conflict_state(self) -> Self:
        if self.server_revision <= self.request.base_revision:
            raise ValueError("serverRevision must be newer than baseRevision for a conflict")
        if self.server_character.id != self.character_id:
            raise ValueError("serverCharacter must match characterId")
        if self.server_character.owner_user_id != self.owner_user_id:
            raise ValueError("serverCharacter must belong to ownerUserId")
        if self.server_character.server_revision != self.server_revision:
            raise ValueError("serverCharacter revision must match serverRevision")

        local_paths = [operation.path for operation in self.request.operations]
        for conflict_path in self.conflicting_paths:
            has_local_intersection = any(
                character_mutation_paths_intersect(conflict_path, local_path)
                for local_path in local_paths
            )
            has_server_intersection = any(
                character_mutation_paths_intersect(conflict_path, server_path)
                for server_path in self.server_changed_paths
            )
            if not has_local_intersection or not has_server_intersection:
                raise ValueError("each conflicting path must intersect local and server changes")
        return self

    def to_model(self) -> CharacterMutation:
        return CharacterMutation(
            **self._base_model_fields(),
            status="conflict",
            merged=False,
            unchanged=False,
            conflict_paths=list(self.conflicting_paths),
            server_changed_paths=list(self.server_changed_paths),
            conflict_server_revision=self.server_revision,
            conflict_server_character=self.server_character.model_dump(
                by_alias=True,
                mode="json",
            ),
        )


class CharacterMutationRejectedCreate(CharacterMutationCreateSchema):
    rejection_code: str = Field(min_length=1, max_length=64, alias="rejectionCode")
    rejection_reason: str = Field(min_length=1, max_length=240, alias="rejectionReason")

    @field_validator("rejection_code", "rejection_reason")
    @classmethod
    def normalize_rejection_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("rejection fields cannot be empty")
        return normalized

    def to_model(self) -> CharacterMutation:
        return CharacterMutation(
            **self._base_model_fields(),
            status="rejected",
            merged=False,
            unchanged=False,
            rejection_code=self.rejection_code,
            rejection_reason=self.rejection_reason,
        )


class CharacterMutationAppliedResponse(CharacterSyncSchema):
    result: CharacterMutationResult
    mutation_id: UUID = Field(alias="mutationId")
    device_id: str = Field(min_length=1, max_length=128, alias="deviceId")
    base_revision: int = Field(ge=1, alias="baseRevision")
    applied_revision: int = Field(ge=1, alias="appliedRevision")
    merged: bool
    unchanged: bool
    changed_paths: list[str] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="changedPaths",
    )
    character: CloudCharacterPublic

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("deviceId cannot be empty")
        return normalized

    @field_validator("changed_paths")
    @classmethod
    def validate_changed_paths(cls, value: list[str]) -> list[str]:
        normalized = _normalize_unique_paths(value, label="changedPaths")
        return _validate_non_overlapping_paths(normalized, label="changedPaths")

    @model_validator(mode="after")
    def validate_revision_relationship(self) -> Self:
        if self.applied_revision < self.base_revision:
            raise ValueError("appliedRevision cannot be older than baseRevision")
        if self.applied_revision > self.character.server_revision:
            raise ValueError("appliedRevision cannot be newer than character.serverRevision")
        if self.unchanged and self.merged:
            raise ValueError("an unchanged mutation cannot be reported as merged")
        return self

    @classmethod
    def from_mutation(
        cls,
        mutation: CharacterMutation,
        character: CloudCharacter,
        *,
        duplicate: bool = False,
    ) -> Self:
        if mutation.status != "applied" or mutation.applied_revision is None:
            raise ValueError("only applied mutations can produce a success response")
        if mutation.character_id != character.id:
            raise ValueError("mutation and character IDs do not match")
        if mutation.owner_user_id != character.owner_user_id:
            raise ValueError("mutation and character owners do not match")

        return cls.model_validate(
            {
                "result": "duplicate" if duplicate else "applied",
                "mutationId": mutation.mutation_id,
                "deviceId": mutation.device_id,
                "baseRevision": mutation.base_revision,
                "appliedRevision": mutation.applied_revision,
                "merged": mutation.merged,
                "unchanged": mutation.unchanged,
                "changedPaths": mutation.changed_paths,
                "character": CloudCharacterPublic.model_validate(character),
            }
        )


class CharacterSyncConflictDetail(CharacterSyncSchema):
    character_id: UUID = Field(alias="characterId")
    mutation_id: UUID = Field(alias="mutationId")
    base_revision: int = Field(ge=1, alias="baseRevision")
    server_revision: int = Field(ge=1, alias="serverRevision")
    conflicting_paths: list[str] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="conflictingPaths",
    )
    local_operations: list[CharacterMutationOperationPublic] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="localOperations",
    )
    server_changed_paths: list[str] = Field(
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="serverChangedPaths",
    )
    server_character: CloudCharacterPublic = Field(alias="serverCharacter")

    @field_validator("conflicting_paths", "server_changed_paths")
    @classmethod
    def validate_path_list(cls, value: list[str]) -> list[str]:
        return _normalize_unique_paths(value, label="path lists")

    @model_validator(mode="after")
    def validate_conflict_evidence(self) -> Self:
        local_paths = [operation.path for operation in self.local_operations]
        for conflict_path in self.conflicting_paths:
            has_local_intersection = any(
                character_mutation_paths_intersect(conflict_path, local_path)
                for local_path in local_paths
            )
            has_server_intersection = any(
                character_mutation_paths_intersect(conflict_path, server_path)
                for server_path in self.server_changed_paths
            )
            if not has_local_intersection or not has_server_intersection:
                raise ValueError("each conflicting path must intersect local and server changes")

        if self.server_revision <= self.base_revision:
            raise ValueError("serverRevision must be newer than baseRevision for a conflict")
        if self.server_character.id != self.character_id:
            raise ValueError("serverCharacter must match characterId")
        if self.server_character.server_revision != self.server_revision:
            raise ValueError("serverCharacter revision must match serverRevision")
        return self

    @classmethod
    def from_mutation(cls, mutation: CharacterMutation) -> Self:
        if mutation.status != "conflict":
            raise ValueError("only conflict mutations can produce a conflict detail")
        if (
            mutation.conflict_paths is None
            or mutation.server_changed_paths is None
            or mutation.conflict_server_revision is None
            or mutation.conflict_server_character is None
        ):
            raise ValueError("conflict mutation is missing persisted conflict evidence")

        return cls.model_validate(
            {
                "characterId": mutation.character_id,
                "mutationId": mutation.mutation_id,
                "baseRevision": mutation.base_revision,
                "serverRevision": mutation.conflict_server_revision,
                "conflictingPaths": mutation.conflict_paths,
                "localOperations": mutation.operations,
                "serverChangedPaths": mutation.server_changed_paths,
                "serverCharacter": mutation.conflict_server_character,
            }
        )


class CharacterRevisionNotAvailableDetail(CharacterSyncSchema):
    character_id: UUID = Field(alias="characterId")
    mutation_id: UUID = Field(alias="mutationId")
    base_revision: int = Field(ge=1, alias="baseRevision")
    server_revision: int = Field(ge=1, alias="serverRevision")
    oldest_available_revision: int | None = Field(
        default=None,
        ge=1,
        alias="oldestAvailableRevision",
    )

    @model_validator(mode="after")
    def validate_revision_range(self) -> Self:
        if self.base_revision >= self.server_revision:
            raise ValueError("baseRevision must be older than serverRevision")
        if (
            self.oldest_available_revision is not None
            and self.oldest_available_revision > self.server_revision
        ):
            raise ValueError("oldestAvailableRevision cannot exceed serverRevision")
        return self


class CharacterSyncClientAheadDetail(CharacterSyncSchema):
    character_id: UUID = Field(alias="characterId")
    mutation_id: UUID = Field(alias="mutationId")
    base_revision: int = Field(ge=1, alias="baseRevision")
    server_revision: int = Field(ge=1, alias="serverRevision")

    @model_validator(mode="after")
    def validate_client_is_ahead(self) -> Self:
        if self.base_revision <= self.server_revision:
            raise ValueError("baseRevision must be newer than serverRevision")
        return self


class InvalidCharacterMutationDetail(CharacterSyncSchema):
    mutation_id: UUID | None = Field(default=None, alias="mutationId")
    reason: str = Field(min_length=1, max_length=240)
    path: str | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_PATH_LENGTH,
    )

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("reason cannot be empty")
        return normalized

    @field_validator("path")
    @classmethod
    def normalize_optional_path_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("path cannot be empty")
        return normalized


class CharacterMutationRejectedDetail(CharacterSyncSchema):
    mutation_id: UUID = Field(alias="mutationId")
    rejection_code: str = Field(min_length=1, max_length=64, alias="rejectionCode")
    reason: str = Field(min_length=1, max_length=240)

    @field_validator("rejection_code", "reason")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("rejection fields cannot be empty")
        return normalized

    @classmethod
    def from_mutation(cls, mutation: CharacterMutation) -> Self:
        if mutation.status != "rejected":
            raise ValueError("only rejected mutations can produce a rejection detail")
        if mutation.rejection_code is None or mutation.rejection_reason is None:
            raise ValueError("rejected mutation is missing rejection metadata")
        return cls(
            mutationId=mutation.mutation_id,
            rejectionCode=mutation.rejection_code,
            reason=mutation.rejection_reason,
        )


class CharacterMutationTooLargeDetail(CharacterSyncSchema):
    max_bytes: int = Field(gt=0, alias="maxBytes")
    actual_bytes: int = Field(gt=0, alias="actualBytes")

    @model_validator(mode="after")
    def validate_size_relationship(self) -> Self:
        if self.actual_bytes <= self.max_bytes:
            raise ValueError("actualBytes must exceed maxBytes")
        return self
