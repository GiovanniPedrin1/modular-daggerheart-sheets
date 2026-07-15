from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.cloud_character import CloudCharacter
from app.schemas.character_sync import (
    CharacterMutationAppliedCreate,
    CharacterMutationAppliedResponse,
    CharacterMutationConflictCreate,
    CharacterMutationRejectedCreate,
    CharacterMutationRejectedDetail,
    CharacterMutationRequest,
    CharacterMutationTooLargeDetail,
    CharacterRevisionNotAvailableDetail,
    CharacterSyncClientAheadDetail,
    CharacterSyncConflictDetail,
    InvalidCharacterMutationDetail,
    character_mutation_paths_intersect,
    normalize_character_mutation_path,
)
from app.schemas.characters import CloudCharacterPublic


def make_character(*, revision: int = 4) -> CloudCharacterPublic:
    now = datetime.now(UTC)
    return CloudCharacterPublic.model_validate(
        {
            "id": uuid4(),
            "ownerUserId": uuid4(),
            "localCharacterId": "local-1",
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "data": {"hp_current": "5", "detailsPage": {"story": "Before"}},
            "serverRevision": revision,
            "contentHash": "a" * 64,
            "schemaVersion": 1,
            "createdAt": now,
            "updatedAt": now,
            "deletedAt": None,
        }
    )


def make_request() -> dict:
    return {
        "mode": "mutation",
        "baseRevision": 3,
        "deviceId": " device-mobile ",
        "mutationId": str(uuid4()),
        "schemaVersion": 1,
        "changedPaths": ["/data/hp_current", "/data/inventory"],
        "operations": [
            {"op": "set", "path": "/data/hp_current", "value": "4"},
            {"op": "remove", "path": "/data/inventory"},
        ],
    }


def test_mutation_request_uses_explicit_mode_and_normalizes_device_id() -> None:
    request = CharacterMutationRequest.model_validate(make_request())

    assert request.mode == "mutation"
    assert request.device_id == "device-mobile"
    assert request.changed_paths == ["/data/hp_current", "/data/inventory"]
    assert request.model_dump(by_alias=True, mode="json")["mutationId"]


def test_mutation_request_requires_operations_to_match_changed_paths_in_order() -> None:
    payload = make_request()
    payload["changedPaths"] = list(reversed(payload["changedPaths"]))

    with pytest.raises(ValidationError, match="same canonical order"):
        CharacterMutationRequest.model_validate(payload)


def test_mutation_request_rejects_duplicate_paths() -> None:
    payload = make_request()
    payload["changedPaths"] = ["/data/hp_current", "/data/hp_current"]
    payload["operations"] = [
        {"op": "set", "path": "/data/hp_current", "value": "4"},
        {"op": "set", "path": "/data/hp_current", "value": "3"},
    ]

    with pytest.raises(ValidationError, match="duplicates"):
        CharacterMutationRequest.model_validate(payload)


@pytest.mark.parametrize(
    "path",
    [
        "data/hp_current",
        "/data",
        "/schemaVersion",
        "/data/__proto__/polluted",
        "/data/items/0",
        "/data/items/-",
        "/data/bad~2escape",
        "/name/value",
        "/data//story",
        " /data/story",
    ],
)
def test_mutation_path_rejects_unsafe_or_coarse_paths(path: str) -> None:
    with pytest.raises(ValueError):
        normalize_character_mutation_path(path)


def test_mutation_request_rejects_overlapping_parent_and_child_paths() -> None:
    payload = make_request()
    payload["changedPaths"] = ["/data/detailsPage", "/data/detailsPage/story"]
    payload["operations"] = [
        {"op": "set", "path": "/data/detailsPage", "value": {}},
        {"op": "set", "path": "/data/detailsPage/story", "value": "Local"},
    ]

    with pytest.raises(ValidationError, match="overlapping parent/child paths"):
        CharacterMutationRequest.model_validate(payload)


def test_remove_operation_rejects_required_metadata_paths() -> None:
    for path in ["/name", "/system", "/classKey", "/language"]:
        payload = make_request()
        payload["changedPaths"] = [path]
        payload["operations"] = [{"op": "remove", "path": path}]

        with pytest.raises(ValidationError, match="metadata cannot be removed"):
            CharacterMutationRequest.model_validate(payload)


def test_remove_operation_allows_missing_data_field_semantics() -> None:
    payload = make_request()
    payload["changedPaths"] = ["/data/optionalNote"]
    payload["operations"] = [{"op": "remove", "path": "/data/optionalNote"}]

    request = CharacterMutationRequest.model_validate(payload)
    assert request.operations[0].path == "/data/optionalNote"


def test_mutation_path_supports_canonical_json_pointer_escapes() -> None:
    assert normalize_character_mutation_path("/data/a~1b/c~0d") == "/data/a~1b/c~0d"


def test_path_intersection_includes_equal_parent_and_child_paths() -> None:
    assert character_mutation_paths_intersect(
        "/data/detailsPage",
        "/data/detailsPage/story",
    )
    assert character_mutation_paths_intersect("/name", "/name")
    assert not character_mutation_paths_intersect("/data/hp", "/data/gold")


def test_set_operation_accepts_null_but_rejects_non_json_values() -> None:
    payload = make_request()
    payload["changedPaths"] = ["/data/note"]
    payload["operations"] = [{"op": "set", "path": "/data/note", "value": None}]
    assert CharacterMutationRequest.model_validate(payload).operations[0].value is None

    payload["operations"][0]["value"] = float("nan")
    with pytest.raises(ValidationError, match="JSON-compatible"):
        CharacterMutationRequest.model_validate(payload)


def test_remove_operation_forbids_a_value() -> None:
    payload = make_request()
    payload["changedPaths"] = ["/data/inventory"]
    payload["operations"] = [{"op": "remove", "path": "/data/inventory", "value": "ignored"}]

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        CharacterMutationRequest.model_validate(payload)


def test_applied_response_serializes_camel_case_and_validates_revision() -> None:
    character = make_character(revision=5)
    response = CharacterMutationAppliedResponse(
        result="applied",
        mutationId=uuid4(),
        deviceId="device-1",
        baseRevision=3,
        appliedRevision=5,
        merged=True,
        unchanged=False,
        changedPaths=["/data/hp_current"],
        character=character,
    )

    serialized = response.model_dump(by_alias=True, mode="json")
    assert serialized["appliedRevision"] == 5
    assert serialized["changedPaths"] == ["/data/hp_current"]

    with pytest.raises(ValidationError, match="newer than character"):
        CharacterMutationAppliedResponse(
            result="duplicate",
            mutationId=uuid4(),
            deviceId="device-1",
            baseRevision=3,
            appliedRevision=6,
            merged=False,
            unchanged=False,
            changedPaths=["/data/hp_current"],
            character=character,
        )


def test_conflict_detail_requires_real_intersection_and_current_snapshot() -> None:
    character = make_character(revision=4)
    detail = CharacterSyncConflictDetail(
        characterId=character.id,
        mutationId=uuid4(),
        baseRevision=2,
        serverRevision=4,
        conflictingPaths=["/data/detailsPage/story"],
        localOperations=[
            {
                "op": "set",
                "path": "/data/detailsPage/story",
                "value": "Local",
            }
        ],
        serverChangedPaths=["/data/detailsPage"],
        serverCharacter=character,
    )

    assert detail.conflicting_paths == ["/data/detailsPage/story"]

    invalid = detail.model_dump(by_alias=True, mode="python")
    invalid["conflictingPaths"] = ["/data/hp_current"]
    with pytest.raises(ValidationError, match="intersect local and server"):
        CharacterSyncConflictDetail.model_validate(invalid)


def test_conflict_requires_server_revision_newer_than_base_revision() -> None:
    character = make_character(revision=4)
    with pytest.raises(ValidationError, match="newer than baseRevision"):
        CharacterSyncConflictDetail(
            characterId=character.id,
            mutationId=uuid4(),
            baseRevision=4,
            serverRevision=4,
            conflictingPaths=["/data/hp_current"],
            localOperations=[{"op": "set", "path": "/data/hp_current", "value": "4"}],
            serverChangedPaths=["/data/hp_current"],
            serverCharacter=character,
        )


def test_revision_error_details_validate_direction() -> None:
    character_id = uuid4()
    mutation_id = uuid4()

    unavailable = CharacterRevisionNotAvailableDetail(
        characterId=character_id,
        mutationId=mutation_id,
        baseRevision=1,
        serverRevision=5,
        oldestAvailableRevision=3,
    )
    ahead = CharacterSyncClientAheadDetail(
        characterId=character_id,
        mutationId=mutation_id,
        baseRevision=8,
        serverRevision=5,
    )

    assert unavailable.oldest_available_revision == 3
    assert ahead.base_revision == 8

    with pytest.raises(ValidationError):
        CharacterSyncClientAheadDetail(
            characterId=character_id,
            mutationId=mutation_id,
            baseRevision=5,
            serverRevision=5,
        )


def test_error_detail_schemas_use_camel_case() -> None:
    mutation_id = uuid4()
    invalid = InvalidCharacterMutationDetail(
        mutationId=mutation_id,
        reason="Path is not supported.",
        path=" /data/items/0 ",
    )
    too_large = CharacterMutationTooLargeDetail(maxBytes=1024, actualBytes=2048)

    serialized_invalid = invalid.model_dump(by_alias=True, mode="json")
    assert serialized_invalid["mutationId"] == str(mutation_id)
    assert serialized_invalid["path"] == "/data/items/0"
    assert too_large.model_dump(by_alias=True) == {
        "maxBytes": 1024,
        "actualBytes": 2048,
    }


def make_character_model(*, revision: int = 4) -> CloudCharacter:
    now = datetime.now(UTC)
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=uuid4(),
        local_character_id="local-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5", "detailsPage": {"story": "Before"}},
        server_revision=revision,
        content_hash="a" * 64,
        schema_version=1,
        created_at=now,
        updated_at=now,
        deleted_at=None,
        updated_by_device_id="device-1",
    )


def test_mutation_request_hash_is_stable_and_uses_normalized_payload() -> None:
    payload = make_request()
    payload["mutationId"] = "11111111-1111-4111-8111-111111111111"
    request = CharacterMutationRequest.model_validate(payload)

    assert request.calculate_request_hash() == (
        "84a9e362023d26bc80d16c79fb9d648520dd771dca0be6d8c5c29991fa762764"
    )
    assert request.canonical_payload()["deviceId"] == "device-mobile"

    reordered = {
        "operations": payload["operations"],
        "changedPaths": payload["changedPaths"],
        "schemaVersion": 1,
        "mutationId": payload["mutationId"],
        "deviceId": "device-mobile",
        "baseRevision": 3,
        "mode": "mutation",
    }
    assert (
        CharacterMutationRequest.model_validate(reordered).calculate_request_hash()
        == request.calculate_request_hash()
    )


def test_mutation_request_hash_changes_when_content_changes() -> None:
    request = CharacterMutationRequest.model_validate(make_request())
    changed = make_request()
    changed["mutationId"] = str(request.mutation_id)
    changed["operations"][0]["value"] = "3"

    assert (
        CharacterMutationRequest.model_validate(changed).calculate_request_hash()
        != request.calculate_request_hash()
    )


def test_applied_create_builds_consistent_model() -> None:
    character_id = uuid4()
    owner_id = uuid4()
    request = CharacterMutationRequest.model_validate(make_request())
    created = CharacterMutationAppliedCreate(
        characterId=character_id,
        ownerUserId=owner_id,
        request=request,
        appliedRevision=4,
        merged=False,
        unchanged=False,
    )

    mutation = created.to_model()

    assert mutation.character_id == character_id
    assert mutation.owner_user_id == owner_id
    assert mutation.status == "applied"
    assert mutation.applied_revision == 4
    assert mutation.changed_paths == request.changed_paths
    assert mutation.operations[0]["path"] == "/data/hp_current"
    assert mutation.request_hash == request.calculate_request_hash()


def test_applied_create_rejects_impossible_state() -> None:
    request = CharacterMutationRequest.model_validate(make_request())

    with pytest.raises(ValidationError, match="older than baseRevision"):
        CharacterMutationAppliedCreate(
            characterId=uuid4(),
            ownerUserId=uuid4(),
            request=request,
            appliedRevision=2,
        )

    with pytest.raises(ValidationError, match="cannot be stored as merged"):
        CharacterMutationAppliedCreate(
            characterId=uuid4(),
            ownerUserId=uuid4(),
            request=request,
            appliedRevision=3,
            merged=True,
            unchanged=True,
        )


def test_conflict_create_builds_persistable_model() -> None:
    character = make_character()
    request_payload = make_request()
    request_payload["changedPaths"] = ["/data/detailsPage/story"]
    request_payload["operations"] = [
        {"op": "set", "path": "/data/detailsPage/story", "value": "Local"}
    ]
    request = CharacterMutationRequest.model_validate(request_payload)
    created = CharacterMutationConflictCreate(
        characterId=character.id,
        ownerUserId=character.owner_user_id,
        request=request,
        serverRevision=character.server_revision,
        conflictingPaths=["/data/detailsPage/story"],
        serverChangedPaths=["/data/detailsPage"],
        serverCharacter=character,
    )

    mutation = created.to_model()

    assert mutation.status == "conflict"
    assert mutation.conflict_paths == ["/data/detailsPage/story"]
    assert mutation.server_changed_paths == ["/data/detailsPage"]
    assert mutation.conflict_server_revision == character.server_revision
    assert mutation.conflict_server_character["serverRevision"] == character.server_revision
    assert mutation.merged is False
    assert mutation.unchanged is False


def test_conflict_create_rejects_character_identity_mismatch() -> None:
    character = make_character()
    request_payload = make_request()
    request_payload["changedPaths"] = ["/data/hp_current"]
    request_payload["operations"] = [{"op": "set", "path": "/data/hp_current", "value": "4"}]

    with pytest.raises(ValidationError, match="must match characterId"):
        CharacterMutationConflictCreate(
            characterId=uuid4(),
            ownerUserId=character.owner_user_id,
            request=request_payload,
            serverRevision=character.server_revision,
            conflictingPaths=["/data/hp_current"],
            serverChangedPaths=["/data/hp_current"],
            serverCharacter=character,
        )


def test_rejected_create_and_detail_round_trip() -> None:
    request = CharacterMutationRequest.model_validate(make_request())
    created = CharacterMutationRejectedCreate(
        characterId=uuid4(),
        ownerUserId=uuid4(),
        request=request,
        rejectionCode="MUTATION_REJECTED",
        rejectionReason="The idempotency key was reused with different content.",
    )

    mutation = created.to_model()
    detail = CharacterMutationRejectedDetail.from_mutation(mutation)

    assert mutation.status == "rejected"
    assert mutation.rejection_code == "MUTATION_REJECTED"
    assert detail.model_dump(by_alias=True, mode="json") == {
        "mutationId": str(request.mutation_id),
        "rejectionCode": "MUTATION_REJECTED",
        "reason": "The idempotency key was reused with different content.",
    }


def test_applied_response_factory_supports_idempotent_duplicate() -> None:
    character = make_character_model(revision=5)
    request = CharacterMutationRequest.model_validate(make_request())
    mutation = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=character.owner_user_id,
        request=request,
        appliedRevision=4,
        merged=True,
        unchanged=False,
    ).to_model()

    response = CharacterMutationAppliedResponse.from_mutation(
        mutation,
        character,
        duplicate=True,
    )

    assert response.result == "duplicate"
    assert response.applied_revision == 4
    assert response.character.server_revision == 5


def test_applied_response_factory_rejects_non_applied_mutation() -> None:
    character = make_character_model(revision=5)
    request = CharacterMutationRequest.model_validate(make_request())
    mutation = CharacterMutationRejectedCreate(
        characterId=character.id,
        ownerUserId=character.owner_user_id,
        request=request,
        rejectionCode="INVALID_MUTATION",
        rejectionReason="Invalid mutation.",
    ).to_model()

    with pytest.raises(ValueError, match="only applied mutations"):
        CharacterMutationAppliedResponse.from_mutation(mutation, character)


def test_conflict_detail_factory_rehydrates_stored_operations_and_snapshot() -> None:
    character = make_character()
    request_payload = make_request()
    request_payload["changedPaths"] = ["/data/detailsPage/story"]
    request_payload["operations"] = [
        {"op": "set", "path": "/data/detailsPage/story", "value": "Local"}
    ]
    mutation = CharacterMutationConflictCreate(
        characterId=character.id,
        ownerUserId=character.owner_user_id,
        request=request_payload,
        serverRevision=character.server_revision,
        conflictingPaths=["/data/detailsPage/story"],
        serverChangedPaths=["/data/detailsPage"],
        serverCharacter=character,
    ).to_model()

    detail = CharacterSyncConflictDetail.from_mutation(mutation)

    assert detail.character_id == character.id
    assert detail.local_operations[0].path == "/data/detailsPage/story"
    assert detail.server_character.server_revision == character.server_revision


def test_factories_reject_incomplete_persisted_records() -> None:
    request = CharacterMutationRequest.model_validate(make_request())
    character = make_character(revision=4)
    conflict = CharacterMutationConflictCreate(
        characterId=character.id,
        ownerUserId=character.owner_user_id,
        request=request,
        serverRevision=4,
        conflictingPaths=["/data/hp_current"],
        serverChangedPaths=["/data/hp_current"],
        serverCharacter=character,
    )
    # Use a valid record first, then emulate corrupted persistence after construction.
    mutation = conflict.to_model()
    mutation.conflict_paths = None

    with pytest.raises(ValueError, match="missing persisted conflict evidence"):
        CharacterSyncConflictDetail.from_mutation(mutation)


def test_mutation_too_large_detail_requires_actual_size_to_exceed_limit() -> None:
    with pytest.raises(ValidationError, match="must exceed"):
        CharacterMutationTooLargeDetail(maxBytes=1024, actualBytes=1024)
