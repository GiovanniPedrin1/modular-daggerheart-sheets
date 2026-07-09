from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.characters import (
    CharacterTooLargeDetail,
    CloudCharacterListItem,
    CloudCharacterPublic,
    CreateCloudCharacterRequest,
    CreateCloudCharacterResponse,
    DeleteCloudCharacterResponse,
    ExistingCloudCharacterDetail,
    RevisionMismatchDetail,
    UnsupportedCharacterSchemaVersionDetail,
    UpdateCloudCharacterRequest,
)


def make_snapshot() -> dict:
    return {
        "name": "  Lyra  ",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "data": {"level": "1", "hp_current": "5"},
        "schemaVersion": 1,
    }


def make_public_character() -> dict:
    now = datetime.now(UTC)
    return {
        "id": uuid4(),
        "ownerUserId": uuid4(),
        "localCharacterId": "local-char-1",
        **make_snapshot(),
        "serverRevision": 1,
        "contentHash": "a" * 64,
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }


def test_create_cloud_character_contract_uses_camel_case_and_normalizes_ids() -> None:
    payload = CreateCloudCharacterRequest.model_validate(
        {
            **make_snapshot(),
            "localCharacterId": " local-char-1 ",
            "deviceId": " device-1 ",
        }
    )

    assert payload.name == "Lyra"
    assert payload.local_character_id == "local-char-1"
    assert payload.device_id == "device-1"
    assert payload.model_dump(by_alias=True)["schemaVersion"] == 1


def test_create_cloud_character_forbids_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        CreateCloudCharacterRequest.model_validate(
            {
                **make_snapshot(),
                "localCharacterId": "local-char-1",
                "deviceId": "device-1",
                "serverRevision": 99,
            }
        )


def test_create_cloud_character_requires_class_for_daggerheart() -> None:
    input_data = {
        **make_snapshot(),
        "classKey": None,
        "localCharacterId": "local-char-1",
        "deviceId": "device-1",
    }

    with pytest.raises(ValidationError, match="classKey is required"):
        CreateCloudCharacterRequest.model_validate(input_data)


def test_create_cloud_character_rejects_class_for_custom_system() -> None:
    input_data = {
        **make_snapshot(),
        "system": "custom",
        "localCharacterId": "local-char-1",
        "deviceId": "device-1",
    }

    with pytest.raises(ValidationError, match="classKey must be null"):
        CreateCloudCharacterRequest.model_validate(input_data)


@pytest.mark.parametrize(
    "invalid_data",
    [
        {"tags": {"not", "json"}},
        {"score": float("nan")},
        {"createdAt": datetime.now(UTC)},
    ],
)
def test_snapshot_rejects_non_json_compatible_data(invalid_data: dict) -> None:
    with pytest.raises(ValidationError, match="JSON-compatible"):
        CreateCloudCharacterRequest.model_validate(
            {
                **make_snapshot(),
                "data": invalid_data,
                "localCharacterId": "local-char-1",
                "deviceId": "device-1",
            }
        )


def test_update_cloud_character_requires_positive_base_revision() -> None:
    with pytest.raises(ValidationError):
        UpdateCloudCharacterRequest.model_validate(
            {
                **make_snapshot(),
                "baseRevision": 0,
                "deviceId": "device-1",
            }
        )


def test_cloud_character_response_serializes_public_aliases() -> None:
    character = CloudCharacterPublic.model_validate(make_public_character())

    serialized = character.model_dump(by_alias=True, mode="json")

    assert serialized["serverRevision"] == 1
    assert serialized["contentHash"] == "a" * 64
    assert serialized["classKey"] == "wizard"


def test_cloud_character_response_can_be_created_from_model_attributes() -> None:
    data = make_public_character()
    orm_character = SimpleNamespace(
        id=data["id"],
        owner_user_id=data["ownerUserId"],
        local_character_id=data["localCharacterId"],
        name=data["name"],
        system=data["system"],
        class_key=data["classKey"],
        language=data["language"],
        data=data["data"],
        server_revision=data["serverRevision"],
        content_hash=data["contentHash"],
        schema_version=data["schemaVersion"],
        created_at=data["createdAt"],
        updated_at=data["updatedAt"],
        deleted_at=data["deletedAt"],
    )

    character = CloudCharacterPublic.model_validate(orm_character)
    list_item = CloudCharacterListItem.model_validate(orm_character)

    assert character.local_character_id == "local-char-1"
    assert list_item.server_revision == 1
    assert not hasattr(list_item, "data")


def test_cloud_character_summary_rejects_invalid_content_hash() -> None:
    input_data = make_public_character()
    input_data.pop("data")
    input_data.pop("deletedAt")
    input_data["contentHash"] = "g" * 64

    with pytest.raises(ValidationError, match="64-character hexadecimal"):
        CloudCharacterListItem.model_validate(input_data)


def test_create_response_requires_reason_for_idempotent_retry() -> None:
    character = CloudCharacterPublic.model_validate(make_public_character())

    with pytest.raises(ValidationError, match="existing_identical_snapshot"):
        CreateCloudCharacterResponse(character=character, created=False)

    response = CreateCloudCharacterResponse(
        character=character,
        created=False,
        reason="existing_identical_snapshot",
    )

    assert response.created is False


def test_delete_response_requires_true_ok_and_uses_aliases() -> None:
    response = DeleteCloudCharacterResponse(
        characterId=uuid4(),
        deletedAt=datetime.now(UTC),
    )

    assert response.model_dump(by_alias=True, mode="json")["ok"] is True

    with pytest.raises(ValidationError):
        DeleteCloudCharacterResponse.model_validate(
            {
                "ok": False,
                "characterId": uuid4(),
                "deletedAt": datetime.now(UTC),
            }
        )


def test_error_detail_schemas_serialize_camel_case() -> None:
    character_id = uuid4()

    revision = RevisionMismatchDetail(
        characterId=character_id,
        serverRevision=3,
        receivedBaseRevision=1,
    )
    existing = ExistingCloudCharacterDetail(
        characterId=character_id,
        localCharacterId="local-char-1",
        serverRevision=3,
    )
    too_large = CharacterTooLargeDetail(maxBytes=1024, actualBytes=2048)
    unsupported = UnsupportedCharacterSchemaVersionDetail(
        supportedVersion=1,
        receivedVersion=2,
    )

    assert revision.model_dump(by_alias=True)["receivedBaseRevision"] == 1
    assert existing.model_dump(by_alias=True)["localCharacterId"] == "local-char-1"
    assert too_large.model_dump(by_alias=True) == {"maxBytes": 1024, "actualBytes": 2048}
    assert unsupported.model_dump(by_alias=True) == {
        "supportedVersion": 1,
        "receivedVersion": 2,
    }
