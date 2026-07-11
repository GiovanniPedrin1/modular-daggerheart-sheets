from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import (
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.core.user_codes import PUBLIC_USER_CODE_PATTERN
from app.schemas.characters import (
    CloudCharacterSchema,
    CloudCharacterSnapshotFields,
    CloudCharacterSnapshotInput,
)

if TYPE_CHECKING:
    from app.models.character_share import CharacterShare
    from app.models.cloud_character import CloudCharacter

type CharacterShareRole = Literal["viewer"]
type CharacterSharePublicStatus = Literal["shared"]
type ShareTargetKind = Literal["email", "publicUserCode"]


class CharacterShareSchema(CloudCharacterSchema):
    """Shared configuration for the Character Share HTTP contract."""


class CreateCharacterShareRequest(CharacterShareSchema):
    target_email: EmailStr | None = Field(default=None, alias="targetEmail")
    public_user_code: str | None = Field(
        default=None,
        min_length=6,
        max_length=32,
        alias="publicUserCode",
    )

    @field_validator("target_email", mode="before")
    @classmethod
    def normalize_target_email(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip().lower()
        return normalized or None

    @field_validator("public_user_code", mode="before")
    @classmethod
    def normalize_public_user_code(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip().upper()
        return normalized or None

    @field_validator("public_user_code")
    @classmethod
    def validate_public_user_code(cls, value: str | None) -> str | None:
        if value is not None and not PUBLIC_USER_CODE_PATTERN.fullmatch(value):
            raise ValueError(
                "publicUserCode must contain only uppercase letters, digits, and hyphens"
            )
        return value

    @model_validator(mode="after")
    def require_exactly_one_target(self) -> Self:
        target_count = sum(
            target is not None for target in (self.target_email, self.public_user_code)
        )
        if target_count != 1:
            raise ValueError("exactly one of targetEmail or publicUserCode is required")
        return self

    @property
    def target_kind(self) -> ShareTargetKind:
        return "email" if self.target_email is not None else "publicUserCode"

    @property
    def normalized_target(self) -> str:
        if self.target_email is not None:
            return str(self.target_email)
        if self.public_user_code is None:  # pragma: no cover - protected by validation
            raise ValueError("share target is missing")
        return self.public_user_code


class EmailCharacterShareTargetPublic(CharacterShareSchema):
    type: Literal["email"] = "email"
    label: EmailStr

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.strip().lower()


class PublicCodeCharacterShareTargetPublic(CharacterShareSchema):
    type: Literal["publicUserCode"] = "publicUserCode"
    label: str = Field(min_length=6, max_length=32)

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not PUBLIC_USER_CODE_PATTERN.fullmatch(normalized):
            raise ValueError(
                "label must contain only uppercase letters, digits, and hyphens"
            )
        return normalized


type CharacterShareTargetPublic = Annotated[
    EmailCharacterShareTargetPublic | PublicCodeCharacterShareTargetPublic,
    Field(discriminator="type"),
]


class CharacterSharePublic(CharacterShareSchema):
    id: UUID
    character_id: UUID = Field(alias="characterId")
    target: CharacterShareTargetPublic
    role: CharacterShareRole = "viewer"
    status: CharacterSharePublicStatus = "shared"
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    @classmethod
    def from_share(cls, share: CharacterShare) -> Self:
        """Build the privacy-preserving owner response from an ORM share.

        Pending and active records intentionally produce the same public status. A
        revoked record must not be serialized through owner-facing list/create APIs.
        """
        if share.status not in {"pending", "active"}:
            raise ValueError("only pending or active shares can be exposed publicly")
        if share.role != "viewer":
            raise ValueError("only viewer shares are supported")

        if share.target_email is not None:
            target: CharacterShareTargetPublic = EmailCharacterShareTargetPublic(
                label=share.target_email
            )
        elif share.target_public_user_code is not None:
            target = PublicCodeCharacterShareTargetPublic(
                label=share.target_public_user_code
            )
        else:
            raise ValueError("share does not contain a public target label")

        return cls(
            id=share.id,
            characterId=share.character_id,
            target=target,
            role="viewer",
            status="shared",
            createdAt=share.created_at,
        )


class CreateCharacterShareResponse(CharacterShareSchema):
    share: CharacterSharePublic
    created: bool = True
    reason: Literal["existing_share"] | None = None

    @model_validator(mode="after")
    def validate_created_reason(self) -> Self:
        if self.created and self.reason is not None:
            raise ValueError("reason must be null when created is true")
        if not self.created and self.reason != "existing_share":
            raise ValueError("reason must be existing_share when created is false")
        return self


class ListCharacterSharesResponse(CharacterShareSchema):
    shares: list[CharacterSharePublic]


class RevokeCharacterShareResponse(CharacterShareSchema):
    ok: Literal[True] = True
    share_id: UUID = Field(alias="shareId")
    character_id: UUID = Field(alias="characterId")
    revoked_at: datetime = Field(alias="revokedAt")


class SharedCharacterSummary(CloudCharacterSnapshotFields):
    id: UUID
    owner_display_name: str | None = Field(
        default=None,
        max_length=120,
        alias="ownerDisplayName",
    )
    server_revision: int = Field(ge=1, alias="serverRevision")
    permission: Literal["viewer"] = "viewer"
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    @field_validator("owner_display_name", mode="before")
    @classmethod
    def normalize_owner_display_name(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

    @classmethod
    def _summary_payload(
        cls,
        character: CloudCharacter,
        *,
        owner_display_name: str | None,
    ) -> dict[str, object]:
        if character.deleted_at is not None:
            raise ValueError("deleted characters cannot be exposed as shared")
        return {
            "id": character.id,
            "ownerDisplayName": owner_display_name,
            "name": character.name,
            "system": character.system,
            "classKey": character.class_key,
            "language": character.language,
            "serverRevision": character.server_revision,
            "schemaVersion": character.schema_version,
            "permission": "viewer",
            "updatedAt": character.updated_at,
        }


class SharedCharacterPublic(SharedCharacterSummary):
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def require_json_compatible_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        return CloudCharacterSnapshotInput.require_json_compatible_data(value)

    @classmethod
    def from_character(
        cls,
        character: CloudCharacter,
        *,
        owner_display_name: str | None,
    ) -> Self:
        payload = cls._summary_payload(
            character,
            owner_display_name=owner_display_name,
        )
        payload["data"] = character.data
        return cls.model_validate(payload)


class SharedCharacterListItem(SharedCharacterSummary):
    @classmethod
    def from_character(
        cls,
        character: CloudCharacter,
        *,
        owner_display_name: str | None,
    ) -> Self:
        return cls.model_validate(
            cls._summary_payload(
                character,
                owner_display_name=owner_display_name,
            )
        )


class ListSharedCharactersResponse(CharacterShareSchema):
    characters: list[SharedCharacterListItem]


class GetSharedCharacterResponse(CharacterShareSchema):
    character: SharedCharacterPublic


class CannotShareWithSelfDetail(CharacterShareSchema):
    character_id: UUID = Field(alias="characterId")


class InvalidShareTargetDetail(CharacterShareSchema):
    target_type: ShareTargetKind = Field(alias="targetType")


class CharacterShareNotFoundDetail(CharacterShareSchema):
    character_id: UUID = Field(alias="characterId")
    share_id: UUID = Field(alias="shareId")


class SharedCharacterNotFoundDetail(CharacterShareSchema):
    character_id: UUID = Field(alias="characterId")
