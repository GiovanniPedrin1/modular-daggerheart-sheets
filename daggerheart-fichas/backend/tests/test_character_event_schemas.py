from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.models.character_event import CharacterEvent
from app.models.cloud_character import CloudCharacter
from app.schemas.character_events import (
    MAX_CHARACTER_EVENT_ID,
    CharacterDeletedEvent,
    CharacterDeletedEventCreate,
    CharacterEventPublic,
    CharacterEventStreamPosition,
    CharacterFullResyncRequiredEvent,
    CharacterRealtimeSnapshot,
    CharacterShareRevokedEvent,
    CharacterShareRevokedEventCreate,
    CharacterUpdatedEvent,
    CharacterUpdatedEventCreate,
    character_event_public_from_model,
)


def now() -> datetime:
    return datetime.now(UTC)


def updated_payload() -> dict:
    timestamp = now()
    return {
        "eventId": "1042",
        "characterId": uuid4(),
        "eventType": "updated",
        "serverRevision": 4,
        "snapshot": {
            "name": " Lyra ",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "data": {"hp_current": "4"},
            "schemaVersion": 1,
            "updatedAt": timestamp,
        },
        "createdAt": timestamp,
    }


def cloud_character(*, deleted: bool = False) -> CloudCharacter:
    timestamp = now()
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=uuid4(),
        local_character_id="local-1",
        name=" Lyra ",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "4"},
        server_revision=4,
        content_hash="a" * 64,
        schema_version=1,
        created_at=timestamp,
        updated_at=timestamp,
        deleted_at=timestamp if deleted else None,
        updated_by_device_id="device-owner",
    )


def persisted_event(
    event_type: str,
    *,
    audience_user_id: UUID | None = None,
) -> CharacterEvent:
    timestamp = now()
    event = CharacterEvent(
        character_id=uuid4(),
        server_revision=5,
        event_type=event_type,
        actor_user_id=uuid4(),
        audience_user_id=audience_user_id,
        device_id="owner-device",
        created_at=timestamp,
    )
    event.id = 1042
    if event_type == "updated":
        event.snapshot = CharacterRealtimeSnapshot.from_character(cloud_character()).model_dump(
            by_alias=True, mode="json"
        )
        event.changed_paths = ["/data/hp_current"]
    elif event_type == "deleted":
        event.deleted_at = timestamp
    elif event_type == "share_revoked":
        event.revoked_at = timestamp
    return event


def test_updated_event_serializes_complete_public_snapshot_in_camel_case() -> None:
    event = CharacterUpdatedEvent.model_validate(updated_payload())
    serialized = event.model_dump(by_alias=True, mode="json")

    assert serialized["eventId"] == "1042"
    assert serialized["eventType"] == "updated"
    assert serialized["snapshot"]["name"] == "Lyra"
    assert serialized["snapshot"]["data"] == {"hp_current": "4"}
    assert "ownerUserId" not in serialized["snapshot"]
    assert "contentHash" not in serialized["snapshot"]
    assert "permission" not in serialized["snapshot"]


def test_event_union_uses_event_type_discriminator() -> None:
    adapter = TypeAdapter(CharacterEventPublic)
    updated = adapter.validate_python(updated_payload())
    deleted = adapter.validate_python(
        {
            "eventId": "1043",
            "characterId": uuid4(),
            "eventType": "deleted",
            "serverRevision": 5,
            "deletedAt": now(),
            "createdAt": now(),
        }
    )
    revoked = adapter.validate_python(
        {
            "eventId": "1044",
            "characterId": uuid4(),
            "eventType": "share_revoked",
            "serverRevision": 5,
            "revokedAt": now(),
            "createdAt": now(),
        }
    )

    assert isinstance(updated, CharacterUpdatedEvent)
    assert isinstance(deleted, CharacterDeletedEvent)
    assert isinstance(revoked, CharacterShareRevokedEvent)


def test_full_resync_event_is_synthetic_and_has_no_event_id() -> None:
    event = CharacterFullResyncRequiredEvent.create(
        character_id=uuid4(),
        server_revision=50,
        reason="history_gap",
        oldest_available_revision=30,
    )
    serialized = event.model_dump(by_alias=True, mode="json")

    assert serialized["reason"] == "history_gap"
    assert serialized["oldestAvailableRevision"] == 30
    assert "eventId" not in serialized


@pytest.mark.parametrize(
    "event_id",
    [
        "",
        "0",
        "-1",
        "abc",
        "1.5",
        "  ",
        "١٢",
        str(MAX_CHARACTER_EVENT_ID + 1),
    ],
)
def test_persisted_events_reject_invalid_event_cursors(event_id: str) -> None:
    payload = updated_payload()
    payload["eventId"] = event_id

    with pytest.raises(ValidationError, match="eventId"):
        CharacterUpdatedEvent.model_validate(payload)


def test_persisted_event_canonicalizes_decimal_cursor() -> None:
    payload = updated_payload()
    payload["eventId"] = " 00042 "

    event = CharacterUpdatedEvent.model_validate(payload)

    assert event.event_id == "42"


def test_updated_event_rejects_non_json_snapshot_data() -> None:
    payload = updated_payload()
    payload["snapshot"]["data"] = {"tags": {"not", "json"}}

    with pytest.raises(ValidationError, match="JSON-compatible"):
        CharacterUpdatedEvent.model_validate(payload)


def test_full_resync_rejects_unknown_reason_and_extra_event_id() -> None:
    payload = {
        "eventId": "1045",
        "characterId": uuid4(),
        "eventType": "full_resync_required",
        "serverRevision": 50,
        "reason": "something_else",
        "oldestAvailableRevision": None,
        "createdAt": now(),
    }

    with pytest.raises(ValidationError):
        CharacterFullResyncRequiredEvent.model_validate(payload)


def test_full_resync_rejects_history_metadata_for_other_reasons() -> None:
    with pytest.raises(ValidationError, match="only valid for a history_gap"):
        CharacterFullResyncRequiredEvent.create(
            character_id=uuid4(),
            server_revision=50,
            reason="client_ahead",
            oldest_available_revision=30,
        )


def test_event_timestamps_must_be_timezone_aware() -> None:
    payload = updated_payload()
    payload["createdAt"] = datetime(2026, 7, 11, 12, 0, 0)

    with pytest.raises(ValidationError, match="timezone"):
        CharacterUpdatedEvent.model_validate(payload)


def test_realtime_snapshot_factory_excludes_internal_cloud_metadata() -> None:
    snapshot = CharacterRealtimeSnapshot.from_character(cloud_character())
    serialized = snapshot.model_dump(by_alias=True, mode="json")

    assert serialized == {
        "name": "Lyra",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "schemaVersion": 1,
        "data": {"hp_current": "4"},
        "updatedAt": serialized["updatedAt"],
    }
    assert "id" not in serialized
    assert "ownerUserId" not in serialized
    assert "localCharacterId" not in serialized
    assert "contentHash" not in serialized
    assert "updatedByDeviceId" not in serialized


def test_realtime_snapshot_factory_rejects_deleted_character() -> None:
    with pytest.raises(ValueError, match="deleted"):
        CharacterRealtimeSnapshot.from_character(cloud_character(deleted=True))


def test_updated_event_create_builds_json_safe_database_model() -> None:
    character_id = uuid4()
    actor_user_id = uuid4()
    snapshot = CharacterRealtimeSnapshot.from_character(cloud_character())
    event_input = CharacterUpdatedEventCreate(
        characterId=character_id,
        serverRevision=4,
        actorUserId=actor_user_id,
        deviceId=" owner-device ",
        snapshot=snapshot,
        changedPaths=["/data/hp_current"],
    )

    event = event_input.to_model()

    assert event.character_id == character_id
    assert event.server_revision == 4
    assert event.event_type == "updated"
    assert event.snapshot is not None
    assert event.snapshot["updatedAt"].endswith("Z")
    assert event.actor_user_id == actor_user_id
    assert event.device_id == "owner-device"
    assert event.patch is None
    assert event.changed_paths == ["/data/hp_current"]


def test_updated_event_create_validates_and_canonicalizes_changed_paths() -> None:
    snapshot = CharacterRealtimeSnapshot.from_character(cloud_character())

    event_input = CharacterUpdatedEventCreate(
        characterId=uuid4(),
        serverRevision=4,
        snapshot=snapshot,
        changedPaths=["/data/a~1b", "/name"],
    )

    assert event_input.changed_paths == ["/data/a~1b", "/name"]

    with pytest.raises(ValidationError, match="must not overlap"):
        CharacterUpdatedEventCreate(
            characterId=uuid4(),
            serverRevision=4,
            snapshot=snapshot,
            changedPaths=["/data/detailsPage", "/data/detailsPage/story"],
        )


def test_deleted_and_revoked_create_schemas_build_matching_models() -> None:
    character_id = uuid4()
    actor_user_id = uuid4()
    viewer_user_id = uuid4()
    timestamp = now()

    deleted = CharacterDeletedEventCreate(
        characterId=character_id,
        serverRevision=6,
        actorUserId=actor_user_id,
        deletedAt=timestamp,
    ).to_model()
    revoked = CharacterShareRevokedEventCreate(
        characterId=character_id,
        serverRevision=6,
        actorUserId=actor_user_id,
        audienceUserId=viewer_user_id,
        revokedAt=timestamp,
    ).to_model()

    assert deleted.event_type == "deleted"
    assert deleted.deleted_at == timestamp
    assert deleted.audience_user_id is None
    assert revoked.event_type == "share_revoked"
    assert revoked.audience_user_id == viewer_user_id
    assert revoked.revoked_at == timestamp


def test_public_factory_converts_persisted_updated_and_deleted_events() -> None:
    viewer_user_id = uuid4()

    updated = character_event_public_from_model(
        persisted_event("updated"),
        viewer_user_id=viewer_user_id,
    )
    deleted = character_event_public_from_model(
        persisted_event("deleted"),
        viewer_user_id=viewer_user_id,
    )

    assert isinstance(updated, CharacterUpdatedEvent)
    assert updated.event_id == "1042"
    assert isinstance(deleted, CharacterDeletedEvent)
    assert deleted.event_id == "1042"


def test_share_revoked_factory_requires_matching_viewer_audience() -> None:
    viewer_user_id = uuid4()
    event = persisted_event("share_revoked", audience_user_id=viewer_user_id)

    public = character_event_public_from_model(
        event,
        viewer_user_id=viewer_user_id,
    )

    assert isinstance(public, CharacterShareRevokedEvent)
    assert public.revoked_at == event.revoked_at

    with pytest.raises(ValueError, match="another viewer"):
        character_event_public_from_model(event, viewer_user_id=uuid4())


def test_updated_factory_rejects_future_patch_only_event() -> None:
    event = persisted_event("updated")
    event.snapshot = None
    event.patch = {"hp_current": "5"}
    event.changed_paths = ["/data/hp_current"]

    with pytest.raises(ValueError, match="complete snapshot"):
        CharacterUpdatedEvent.from_event(event)


def test_stream_position_requires_revision_or_cursor_and_prefers_cursor() -> None:
    with pytest.raises(ValidationError, match="required"):
        CharacterEventStreamPosition()

    by_revision = CharacterEventStreamPosition(sinceRevision=4)
    assert by_revision.kind == "revision"
    assert by_revision.value == 4

    by_cursor = CharacterEventStreamPosition(
        sinceRevision=4,
        lastEventId=" 001042 ",
    )
    assert by_cursor.kind == "cursor"
    assert by_cursor.value == "1042"
