from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.core.character_mutation_paths import (
    MAX_CHARACTER_MUTATION_OPERATIONS,
    CharacterMutationPathError,
    find_intersecting_character_mutation_paths,
    normalize_character_mutation_path,
)
from app.core.security_contracts import MAX_CHARACTER_SERVER_REVISION
from app.models.character_event import CharacterEvent
from app.models.cloud_character import CloudCharacter
from app.schemas.characters import (
    CloudCharacterSchema,
    CloudCharacterSnapshotInput,
)

type CharacterEventType = Literal[
    "updated",
    "deleted",
    "share_revoked",
    "full_resync_required",
]
type PersistedCharacterEventType = Literal[
    "updated",
    "deleted",
    "share_revoked",
]
type FullResyncReason = Literal[
    "history_gap",
    "unknown_cursor",
    "client_ahead",
]
type CharacterEventStreamPositionKind = Literal["cursor", "revision"]

MAX_CHARACTER_EVENT_ID = 9_223_372_036_854_775_807


class CharacterEventSchema(CloudCharacterSchema):
    """Shared configuration for the Phase 3 realtime event contract."""


class CharacterRealtimeSnapshot(CloudCharacterSnapshotInput):
    """Full public snapshot carried by an ``updated`` event.

    The event envelope already identifies the character and its server revision, so
    cloud ownership/link metadata is deliberately excluded from this representation.
    """

    updated_at: datetime = Field(alias="updatedAt")

    @field_validator("updated_at")
    @classmethod
    def require_timezone_aware_updated_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("updatedAt must include a timezone")
        return value

    @classmethod
    def from_character(cls, character: CloudCharacter) -> Self:
        """Build the viewer-safe event snapshot from a cloud character model."""
        if character.deleted_at is not None:
            raise ValueError("deleted characters cannot produce an updated snapshot")

        return cls.model_validate(
            {
                "name": character.name,
                "system": character.system,
                "classKey": character.class_key,
                "language": character.language,
                "data": character.data,
                "schemaVersion": character.schema_version,
                "updatedAt": character.updated_at,
            }
        )


def normalize_character_event_id(value: str) -> str:
    """Validate and canonicalize a PostgreSQL BIGINT event cursor."""
    normalized = value.strip()
    if not normalized or any(character not in "0123456789" for character in normalized):
        raise ValueError("eventId must be an opaque ASCII decimal cursor")

    numeric_value = int(normalized)
    if numeric_value < 1:
        raise ValueError("eventId must be greater than zero")
    if numeric_value > MAX_CHARACTER_EVENT_ID:
        raise ValueError("eventId exceeds the supported bigint range")

    return str(numeric_value)


class PersistedCharacterEvent(CharacterEventSchema):
    event_id: str = Field(min_length=1, max_length=19, alias="eventId")
    character_id: UUID = Field(alias="characterId")
    server_revision: int = Field(ge=1, alias="serverRevision")
    created_at: datetime = Field(alias="createdAt")

    @field_validator("event_id")
    @classmethod
    def validate_event_id(cls, value: str) -> str:
        return normalize_character_event_id(value)

    @field_validator("created_at")
    @classmethod
    def require_timezone_aware_created_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("createdAt must include a timezone")
        return value

    @classmethod
    def _base_payload(cls, event: CharacterEvent) -> dict[str, object]:
        if event.id is None or event.id < 1:
            raise ValueError("persisted event must have a positive database cursor")
        return {
            "eventId": str(event.id),
            "characterId": event.character_id,
            "serverRevision": event.server_revision,
            "createdAt": event.created_at,
        }


class CharacterUpdatedEvent(PersistedCharacterEvent):
    event_type: Literal["updated"] = Field(default="updated", alias="eventType")
    snapshot: CharacterRealtimeSnapshot

    @classmethod
    def from_event(cls, event: CharacterEvent) -> Self:
        if event.event_type != "updated":
            raise ValueError("event is not an updated event")
        if event.snapshot is None:
            raise ValueError("Phase 3 updated events require a complete snapshot")
        if event.patch is not None:
            raise ValueError("patch-only updated events are not public in Phase 3")

        return cls.model_validate(
            {
                **cls._base_payload(event),
                "eventType": "updated",
                "snapshot": event.snapshot,
            }
        )


class CharacterDeletedEvent(PersistedCharacterEvent):
    event_type: Literal["deleted"] = Field(default="deleted", alias="eventType")
    deleted_at: datetime = Field(alias="deletedAt")

    @field_validator("deleted_at")
    @classmethod
    def require_timezone_aware_deleted_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("deletedAt must include a timezone")
        return value

    @classmethod
    def from_event(cls, event: CharacterEvent) -> Self:
        if event.event_type != "deleted":
            raise ValueError("event is not a deleted event")
        if event.deleted_at is None:
            raise ValueError("deleted event is missing deletedAt")

        return cls.model_validate(
            {
                **cls._base_payload(event),
                "eventType": "deleted",
                "deletedAt": event.deleted_at,
            }
        )


class CharacterShareRevokedEvent(PersistedCharacterEvent):
    event_type: Literal["share_revoked"] = Field(
        default="share_revoked",
        alias="eventType",
    )
    revoked_at: datetime = Field(alias="revokedAt")

    @field_validator("revoked_at")
    @classmethod
    def require_timezone_aware_revoked_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("revokedAt must include a timezone")
        return value

    @classmethod
    def from_event(cls, event: CharacterEvent, *, viewer_user_id: UUID) -> Self:
        if event.event_type != "share_revoked":
            raise ValueError("event is not a share_revoked event")
        if event.audience_user_id is None:
            raise ValueError("share_revoked event is missing its audience")
        if event.audience_user_id != viewer_user_id:
            raise ValueError("share_revoked event belongs to another viewer")
        if event.revoked_at is None:
            raise ValueError("share_revoked event is missing revokedAt")

        return cls.model_validate(
            {
                **cls._base_payload(event),
                "eventType": "share_revoked",
                "revokedAt": event.revoked_at,
            }
        )


class CharacterFullResyncRequiredEvent(CharacterEventSchema):
    """Synthetic terminal event sent when incremental replay is unsafe.

    It is not persisted and intentionally has no ``eventId``/SSE ``id`` field, so a
    browser cannot retain it as a reconnect cursor.
    """

    event_type: Literal["full_resync_required"] = Field(
        default="full_resync_required",
        alias="eventType",
    )
    character_id: UUID = Field(alias="characterId")
    server_revision: int = Field(ge=1, alias="serverRevision")
    reason: FullResyncReason
    oldest_available_revision: int | None = Field(
        default=None,
        ge=1,
        alias="oldestAvailableRevision",
    )
    created_at: datetime = Field(alias="createdAt")

    @field_validator("created_at")
    @classmethod
    def require_timezone_aware_created_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("createdAt must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_oldest_available_revision(self) -> Self:
        if self.reason != "history_gap" and self.oldest_available_revision is not None:
            raise ValueError("oldestAvailableRevision is only valid for a history_gap resync")
        if (
            self.oldest_available_revision is not None
            and self.oldest_available_revision > self.server_revision
        ):
            raise ValueError("oldestAvailableRevision cannot be newer than serverRevision")
        return self

    @classmethod
    def create(
        cls,
        *,
        character_id: UUID,
        server_revision: int,
        reason: FullResyncReason,
        oldest_available_revision: int | None = None,
        created_at: datetime | None = None,
    ) -> Self:
        return cls(
            characterId=character_id,
            serverRevision=server_revision,
            reason=reason,
            oldestAvailableRevision=oldest_available_revision,
            createdAt=created_at or datetime.now(UTC),
        )


CharacterEventPublic = Annotated[
    CharacterUpdatedEvent
    | CharacterDeletedEvent
    | CharacterShareRevokedEvent
    | CharacterFullResyncRequiredEvent,
    Field(discriminator="event_type"),
]


def character_event_public_from_model(
    event: CharacterEvent,
    *,
    viewer_user_id: UUID,
) -> CharacterUpdatedEvent | CharacterDeletedEvent | CharacterShareRevokedEvent:
    """Convert a persisted event to the privacy-safe viewer representation."""
    if event.event_type == "updated":
        return CharacterUpdatedEvent.from_event(event)
    if event.event_type == "deleted":
        return CharacterDeletedEvent.from_event(event)
    if event.event_type == "share_revoked":
        return CharacterShareRevokedEvent.from_event(
            event,
            viewer_user_id=viewer_user_id,
        )
    raise ValueError(f"unsupported persisted event type: {event.event_type}")


class CharacterEventCreateSchema(CharacterEventSchema):
    """Validated input shared by event-writing services."""

    character_id: UUID = Field(alias="characterId")
    server_revision: int = Field(ge=1, alias="serverRevision")
    actor_user_id: UUID | None = Field(default=None, alias="actorUserId")
    device_id: str | None = Field(default=None, min_length=1, max_length=128, alias="deviceId")

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("deviceId cannot be empty")
        return normalized


class CharacterUpdatedEventCreate(CharacterEventCreateSchema):
    event_type: Literal["updated"] = Field(default="updated", alias="eventType")
    snapshot: CharacterRealtimeSnapshot
    changed_paths: list[str] | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_CHARACTER_MUTATION_OPERATIONS,
        alias="changedPaths",
    )

    @field_validator("changed_paths")
    @classmethod
    def normalize_changed_paths(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        try:
            normalized = [normalize_character_mutation_path(path) for path in value]
        except (CharacterMutationPathError, TypeError) as exc:
            raise ValueError(str(exc)) from exc

        if len(set(normalized)) != len(normalized):
            raise ValueError("changedPaths must contain unique canonical paths")

        intersections = find_intersecting_character_mutation_paths(normalized)
        if intersections:
            left, right = intersections[0]
            raise ValueError(f"changedPaths must not overlap: {left} intersects {right}")
        return normalized

    def to_model(self) -> CharacterEvent:
        return CharacterEvent(
            character_id=self.character_id,
            server_revision=self.server_revision,
            event_type="updated",
            snapshot=self.snapshot.model_dump(by_alias=True, mode="json"),
            changed_paths=(list(self.changed_paths) if self.changed_paths is not None else None),
            actor_user_id=self.actor_user_id,
            device_id=self.device_id,
        )


class CharacterDeletedEventCreate(CharacterEventCreateSchema):
    event_type: Literal["deleted"] = Field(default="deleted", alias="eventType")
    deleted_at: datetime = Field(alias="deletedAt")

    @field_validator("deleted_at")
    @classmethod
    def require_timezone_aware_deleted_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("deletedAt must include a timezone")
        return value

    def to_model(self) -> CharacterEvent:
        return CharacterEvent(
            character_id=self.character_id,
            server_revision=self.server_revision,
            event_type="deleted",
            actor_user_id=self.actor_user_id,
            device_id=self.device_id,
            deleted_at=self.deleted_at,
        )


class CharacterShareRevokedEventCreate(CharacterEventCreateSchema):
    event_type: Literal["share_revoked"] = Field(
        default="share_revoked",
        alias="eventType",
    )
    audience_user_id: UUID = Field(alias="audienceUserId")
    revoked_at: datetime = Field(alias="revokedAt")

    @field_validator("revoked_at")
    @classmethod
    def require_timezone_aware_revoked_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("revokedAt must include a timezone")
        return value

    def to_model(self) -> CharacterEvent:
        return CharacterEvent(
            character_id=self.character_id,
            server_revision=self.server_revision,
            event_type="share_revoked",
            actor_user_id=self.actor_user_id,
            audience_user_id=self.audience_user_id,
            device_id=self.device_id,
            revoked_at=self.revoked_at,
        )


class CharacterEventStreamPosition(CharacterEventSchema):
    """Validated stream start position with Last-Event-ID precedence."""

    since_revision: int | None = Field(
        default=None,
        ge=1,
        le=MAX_CHARACTER_SERVER_REVISION,
        alias="sinceRevision",
    )
    last_event_id: str | None = Field(default=None, alias="lastEventId")

    @field_validator("last_event_id")
    @classmethod
    def validate_last_event_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_character_event_id(value)

    @model_validator(mode="after")
    def require_position(self) -> Self:
        if self.last_event_id is None and self.since_revision is None:
            raise ValueError("Last-Event-ID or sinceRevision is required")
        return self

    @property
    def kind(self) -> CharacterEventStreamPositionKind:
        return "cursor" if self.last_event_id is not None else "revision"

    @property
    def value(self) -> str | int:
        if self.last_event_id is not None:
            return self.last_event_id
        if self.since_revision is None:  # pragma: no cover - protected by validation
            raise ValueError("stream position is missing")
        return self.since_revision


class EventStreamPositionRequiredDetail(CharacterEventSchema):
    character_id: UUID = Field(alias="characterId")
