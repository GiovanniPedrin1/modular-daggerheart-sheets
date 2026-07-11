from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.character_share import CharacterShare
from app.models.cloud_character import CloudCharacter
from app.schemas.shares import (
    CharacterSharePublic,
    CreateCharacterShareRequest,
    CreateCharacterShareResponse,
    GetSharedCharacterResponse,
    ListCharacterSharesResponse,
    ListSharedCharactersResponse,
    RevokeCharacterShareResponse,
    SharedCharacterListItem,
    SharedCharacterPublic,
)


def make_share(*, target: dict | None = None) -> dict:
    return {
        "id": uuid4(),
        "characterId": uuid4(),
        "target": target or {"type": "email", "label": "viewer@example.com"},
        "role": "viewer",
        "status": "shared",
        "createdAt": datetime.now(UTC),
    }


def make_shared_character(*, include_data: bool) -> dict:
    character = {
        "id": uuid4(),
        "ownerDisplayName": "Game Master",
        "name": "Lyra",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "serverRevision": 3,
        "schemaVersion": 1,
        "permission": "viewer",
        "updatedAt": datetime.now(UTC),
    }
    if include_data:
        character["data"] = {"hp_current": "5"}
    return character


def test_share_request_normalizes_email_and_accepts_only_email() -> None:
    request = CreateCharacterShareRequest.model_validate(
        {"targetEmail": " Viewer@Example.COM "}
    )

    assert str(request.target_email) == "viewer@example.com"
    assert request.public_user_code is None
    assert request.model_dump(by_alias=True, mode="json") == {
        "targetEmail": "viewer@example.com",
        "publicUserCode": None,
    }


def test_share_request_normalizes_public_user_code() -> None:
    request = CreateCharacterShareRequest.model_validate(
        {"publicUserCode": " abcd-1234 "}
    )

    assert request.target_email is None
    assert request.public_user_code == "ABCD-1234"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {
            "targetEmail": "viewer@example.com",
            "publicUserCode": "ABCD-1234",
        },
    ],
)
def test_share_request_requires_exactly_one_target(payload: dict) -> None:
    with pytest.raises(ValidationError, match="exactly one"):
        CreateCharacterShareRequest.model_validate(payload)


@pytest.mark.parametrize(
    "public_user_code",
    ["short", "HAS SPACE", "invalid_code", "-STARTS-WITH-DASH"],
)
def test_share_request_rejects_invalid_public_user_code(public_user_code: str) -> None:
    with pytest.raises(ValidationError):
        CreateCharacterShareRequest.model_validate(
            {"publicUserCode": public_user_code}
        )


def test_share_request_forbids_client_controlled_role_and_status() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        CreateCharacterShareRequest.model_validate(
            {
                "targetEmail": "viewer@example.com",
                "role": "owner",
                "status": "active",
            }
        )


def test_share_public_contract_hides_internal_target_state() -> None:
    share = CharacterSharePublic.model_validate(make_share())
    serialized = share.model_dump(by_alias=True, mode="json")

    assert serialized["target"] == {
        "type": "email",
        "label": "viewer@example.com",
    }
    assert serialized["status"] == "shared"
    assert "targetUserId" not in serialized
    assert "acceptedAt" not in serialized
    assert "revokedAt" not in serialized


def test_share_public_supports_public_code_target() -> None:
    share = CharacterSharePublic.model_validate(
        make_share(
            target={"type": "publicUserCode", "label": "abcd-1234"},
        )
    )

    assert share.target.type == "publicUserCode"
    assert share.target.label == "ABCD-1234"


def test_create_share_response_requires_reason_for_idempotent_retry() -> None:
    share = CharacterSharePublic.model_validate(make_share())

    with pytest.raises(ValidationError, match="existing_share"):
        CreateCharacterShareResponse(share=share, created=False)

    response = CreateCharacterShareResponse(
        share=share,
        created=False,
        reason="existing_share",
    )

    assert response.created is False


def test_list_and_revoke_share_responses_use_camel_case() -> None:
    share = CharacterSharePublic.model_validate(make_share())
    listed = ListCharacterSharesResponse(shares=[share])
    revoked = RevokeCharacterShareResponse(
        shareId=share.id,
        characterId=share.character_id,
        revokedAt=datetime.now(UTC),
    )

    assert listed.model_dump(by_alias=True, mode="json")["shares"][0]["characterId"]
    assert revoked.model_dump(by_alias=True, mode="json")["ok"] is True
    assert revoked.model_dump(by_alias=True, mode="json")["shareId"] == str(share.id)


def test_shared_character_list_omits_data_and_private_owner_metadata() -> None:
    character = SharedCharacterListItem.model_validate(
        make_shared_character(include_data=False)
    )
    serialized = character.model_dump(by_alias=True, mode="json")

    assert serialized["permission"] == "viewer"
    assert "data" not in serialized
    assert "ownerUserId" not in serialized
    assert "localCharacterId" not in serialized
    assert "contentHash" not in serialized


def test_shared_character_detail_contains_snapshot_without_private_metadata() -> None:
    character = SharedCharacterPublic.model_validate(
        make_shared_character(include_data=True)
    )
    response = GetSharedCharacterResponse(character=character)
    serialized = response.model_dump(by_alias=True, mode="json")["character"]

    assert serialized["data"] == {"hp_current": "5"}
    assert serialized["ownerDisplayName"] == "Game Master"
    assert serialized["serverRevision"] == 3
    assert "ownerUserId" not in serialized
    assert "contentHash" not in serialized


def test_shared_character_responses_validate_list_and_json_data() -> None:
    list_item = SharedCharacterListItem.model_validate(
        make_shared_character(include_data=False)
    )
    response = ListSharedCharactersResponse(characters=[list_item])

    assert response.characters[0].permission == "viewer"

    invalid = make_shared_character(include_data=True)
    invalid["data"] = {"tags": {"not", "json"}}
    with pytest.raises(ValidationError, match="JSON-compatible"):
        SharedCharacterPublic.model_validate(invalid)


def make_share_model(
    *,
    status: str = "pending",
    target_email: str | None = "viewer@example.com",
    target_public_user_code: str | None = None,
) -> CharacterShare:
    now = datetime.now(UTC)
    return CharacterShare(
        id=uuid4(),
        character_id=uuid4(),
        owner_user_id=uuid4(),
        target_user_id=uuid4() if status == "active" else None,
        target_email=target_email,
        target_public_user_code=target_public_user_code,
        role="viewer",
        status=status,
        created_at=now,
        accepted_at=now if status == "active" else None,
        revoked_at=now if status == "revoked" else None,
    )


def make_cloud_character_model(*, deleted: bool = False) -> CloudCharacter:
    now = datetime.now(UTC)
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=uuid4(),
        local_character_id="local-1",
        name="  Lyra  ",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5", "notes": ["A", "B"]},
        server_revision=4,
        content_hash="a" * 64,
        schema_version=1,
        created_at=now,
        updated_at=now,
        deleted_at=now if deleted else None,
        updated_by_device_id="device-1",
    )


def test_share_request_exposes_normalized_target_helpers() -> None:
    email_request = CreateCharacterShareRequest.model_validate(
        {"targetEmail": " Viewer@Example.com "}
    )
    code_request = CreateCharacterShareRequest.model_validate(
        {"publicUserCode": " abcd-1234 "}
    )

    assert email_request.target_kind == "email"
    assert email_request.normalized_target == "viewer@example.com"
    assert code_request.target_kind == "publicUserCode"
    assert code_request.normalized_target == "ABCD-1234"


def test_share_public_factory_hides_pending_vs_active_state() -> None:
    pending = CharacterSharePublic.from_share(make_share_model(status="pending"))
    active = CharacterSharePublic.from_share(make_share_model(status="active"))

    pending_json = pending.model_dump(by_alias=True, mode="json")
    active_json = active.model_dump(by_alias=True, mode="json")

    assert pending_json["status"] == "shared"
    assert active_json["status"] == "shared"
    assert set(pending_json) == set(active_json)
    assert "acceptedAt" not in pending_json
    assert "acceptedAt" not in active_json
    assert "targetUserId" not in active_json


def test_share_public_factory_supports_public_code_without_internal_user_id() -> None:
    share = make_share_model(
        status="active",
        target_email=None,
        target_public_user_code="ABCD-1234",
    )

    serialized = CharacterSharePublic.from_share(share).model_dump(
        by_alias=True,
        mode="json",
    )

    assert serialized["target"] == {
        "type": "publicUserCode",
        "label": "ABCD-1234",
    }
    assert "targetUserId" not in serialized


def test_share_public_factory_rejects_revoked_or_malformed_records() -> None:
    with pytest.raises(ValueError, match="pending or active"):
        CharacterSharePublic.from_share(make_share_model(status="revoked"))

    malformed = make_share_model(status="pending", target_email=None)
    with pytest.raises(ValueError, match="public target label"):
        CharacterSharePublic.from_share(malformed)


def test_shared_character_factories_strip_private_cloud_metadata() -> None:
    cloud_character = make_cloud_character_model()

    list_item = SharedCharacterListItem.from_character(
        cloud_character,
        owner_display_name="  Game Master  ",
    )
    detail = SharedCharacterPublic.from_character(
        cloud_character,
        owner_display_name="  Game Master  ",
    )

    list_json = list_item.model_dump(by_alias=True, mode="json")
    detail_json = detail.model_dump(by_alias=True, mode="json")

    assert list_json["name"] == "Lyra"
    assert list_json["ownerDisplayName"] == "Game Master"
    assert list_json["permission"] == "viewer"
    assert "data" not in list_json
    assert detail_json["data"] == {"hp_current": "5", "notes": ["A", "B"]}

    for private_field in (
        "ownerUserId",
        "localCharacterId",
        "contentHash",
        "deletedAt",
        "updatedByDeviceId",
        "createdAt",
    ):
        assert private_field not in list_json
        assert private_field not in detail_json


def test_shared_character_factory_normalizes_empty_owner_name_to_null() -> None:
    item = SharedCharacterListItem.from_character(
        make_cloud_character_model(),
        owner_display_name="   ",
    )

    assert item.owner_display_name is None


def test_shared_character_factory_rejects_deleted_character() -> None:
    with pytest.raises(ValueError, match="deleted characters"):
        SharedCharacterPublic.from_character(
            make_cloud_character_model(deleted=True),
            owner_display_name=None,
        )


def test_share_error_details_use_camel_case_and_do_not_accept_extra_fields() -> None:
    from app.schemas.shares import (
        CannotShareWithSelfDetail,
        CharacterShareNotFoundDetail,
        InvalidShareTargetDetail,
        SharedCharacterNotFoundDetail,
    )

    character_id = uuid4()
    share_id = uuid4()

    assert CannotShareWithSelfDetail(characterId=character_id).model_dump(
        by_alias=True,
        mode="json",
    ) == {"characterId": str(character_id)}
    assert InvalidShareTargetDetail(targetType="publicUserCode").model_dump(
        by_alias=True,
        mode="json",
    ) == {"targetType": "publicUserCode"}
    assert CharacterShareNotFoundDetail(
        characterId=character_id,
        shareId=share_id,
    ).model_dump(by_alias=True, mode="json") == {
        "characterId": str(character_id),
        "shareId": str(share_id),
    }
    assert SharedCharacterNotFoundDetail(characterId=character_id).character_id == character_id

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        InvalidShareTargetDetail.model_validate(
            {"targetType": "email", "targetEmail": "private@example.com"}
        )
