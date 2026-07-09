from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

type CloudCharacterSystem = Literal["daggerheart", "custom"]
type CloudCharacterLanguage = Literal["pt-BR", "en-US"]
type DaggerheartClassKey = Literal[
    "bard",
    "druid",
    "guardian",
    "ranger",
    "rogue",
    "seraph",
    "sorcerer",
    "warrior",
    "wizard",
]


class CloudCharacterSchema(BaseModel):
    """Shared configuration for the public Cloud Character HTTP contract."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class CloudCharacterSnapshotFields(CloudCharacterSchema):
    name: str = Field(min_length=1, max_length=120)
    system: CloudCharacterSystem
    class_key: DaggerheartClassKey | None = Field(default=None, alias="classKey")
    language: CloudCharacterLanguage
    schema_version: int = Field(default=1, ge=1, le=100, alias="schemaVersion")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name cannot be empty")
        return normalized

    @model_validator(mode="after")
    def validate_class_for_system(self) -> CloudCharacterSnapshotFields:
        if self.system == "daggerheart" and self.class_key is None:
            raise ValueError("classKey is required for daggerheart characters")

        if self.system == "custom" and self.class_key is not None:
            raise ValueError("classKey must be null for custom characters")

        return self


class CloudCharacterSnapshotInput(CloudCharacterSnapshotFields):
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def require_json_compatible_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(
                value,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            )
        except (TypeError, ValueError) as exc:
            raise ValueError("data must contain only JSON-compatible values") from exc
        return value


class CreateCloudCharacterRequest(CloudCharacterSnapshotInput):
    local_character_id: str = Field(min_length=1, max_length=128, alias="localCharacterId")
    device_id: str = Field(min_length=1, max_length=128, alias="deviceId")

    @field_validator("local_character_id", "device_id")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("identifier cannot be empty")
        return normalized


class UpdateCloudCharacterRequest(CloudCharacterSnapshotInput):
    base_revision: int = Field(ge=1, alias="baseRevision")
    device_id: str = Field(min_length=1, max_length=128, alias="deviceId")

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("deviceId cannot be empty")
        return normalized


class CloudCharacterSummary(CloudCharacterSnapshotFields):
    id: UUID
    owner_user_id: UUID = Field(alias="ownerUserId")
    local_character_id: str | None = Field(default=None, alias="localCharacterId")
    server_revision: int = Field(ge=1, alias="serverRevision")
    content_hash: str = Field(min_length=64, max_length=64, alias="contentHash")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    @field_validator("content_hash")
    @classmethod
    def normalize_content_hash(cls, value: str) -> str:
        normalized = value.strip().lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("contentHash must be a 64-character hexadecimal sha-256 digest")
        return normalized


class CloudCharacterPublic(CloudCharacterSummary):
    data: dict[str, Any]
    deleted_at: datetime | None = Field(default=None, alias="deletedAt")

    @field_validator("data")
    @classmethod
    def require_json_compatible_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        return CloudCharacterSnapshotInput.require_json_compatible_data(value)


class CloudCharacterListItem(CloudCharacterSummary):
    pass


class CreateCloudCharacterResponse(CloudCharacterSchema):
    character: CloudCharacterPublic
    created: bool = True
    reason: Literal["existing_identical_snapshot"] | None = None

    @model_validator(mode="after")
    def validate_created_reason(self) -> CreateCloudCharacterResponse:
        if self.created and self.reason is not None:
            raise ValueError("reason must be null when created is true")
        if not self.created and self.reason != "existing_identical_snapshot":
            raise ValueError(
                "reason must be existing_identical_snapshot when created is false"
            )
        return self


class ListCloudCharactersResponse(CloudCharacterSchema):
    characters: list[CloudCharacterListItem]


class GetCloudCharacterResponse(CloudCharacterSchema):
    character: CloudCharacterPublic


class UpdateCloudCharacterResponse(CloudCharacterSchema):
    character: CloudCharacterPublic
    unchanged: bool = False


class DeleteCloudCharacterResponse(CloudCharacterSchema):
    ok: Literal[True] = True
    character_id: UUID = Field(alias="characterId")
    deleted_at: datetime = Field(alias="deletedAt")


class RevisionMismatchDetail(CloudCharacterSchema):
    character_id: UUID = Field(alias="characterId")
    server_revision: int = Field(ge=1, alias="serverRevision")
    received_base_revision: int = Field(ge=1, alias="receivedBaseRevision")


class ExistingCloudCharacterDetail(CloudCharacterSchema):
    character_id: UUID = Field(alias="characterId")
    local_character_id: str = Field(min_length=1, max_length=128, alias="localCharacterId")
    server_revision: int = Field(ge=1, alias="serverRevision")


class CharacterTooLargeDetail(CloudCharacterSchema):
    max_bytes: int = Field(gt=0, alias="maxBytes")
    actual_bytes: int = Field(gt=0, alias="actualBytes")


class UnsupportedCharacterSchemaVersionDetail(CloudCharacterSchema):
    supported_version: int = Field(ge=1, alias="supportedVersion")
    received_version: int = Field(ge=1, alias="receivedVersion")
