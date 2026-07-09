from copy import deepcopy

from app.schemas.characters import (
    CreateCloudCharacterRequest,
    UpdateCloudCharacterRequest,
)
from app.services.cloud_character_hash import (
    calculate_cloud_character_content_hash,
    cloud_character_hash_payload,
    serialize_cloud_character_snapshot,
)


def make_snapshot() -> dict:
    return {
        "name": "Lyra",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "data": {
            "hp_current": "5",
            "detailsPage": {
                "story": "Uma história com acentuação.",
                "physical": {"height": "1,70 m", "age": "24"},
            },
        },
        "schemaVersion": 1,
    }


def make_create_request(**overrides) -> CreateCloudCharacterRequest:
    payload = {
        **make_snapshot(),
        "localCharacterId": "local-char-1",
        "deviceId": "device-a",
        **overrides,
    }
    return CreateCloudCharacterRequest.model_validate(payload)


def test_snapshot_serialization_is_canonical_and_has_known_digest() -> None:
    snapshot = make_create_request()

    serialized = serialize_cloud_character_snapshot(snapshot)

    assert serialized == (
        '{"classKey":"wizard","data":{"detailsPage":{"physical":{"age":"24",'
        '"height":"1,70 m"},"story":"Uma história com acentuação."},'
        '"hp_current":"5"},"language":"pt-BR","name":"Lyra",'
        '"schemaVersion":1,"system":"daggerheart"}'
    )
    assert calculate_cloud_character_content_hash(snapshot) == (
        "b6e52d0ca72efe7a060efdf337954be031b5925aed9eac2c1937c54a31899b13"
    )


def test_hash_is_stable_when_nested_object_key_order_changes() -> None:
    first = make_create_request()
    reordered_data = {
        "detailsPage": {
            "physical": {"age": "24", "height": "1,70 m"},
            "story": "Uma história com acentuação.",
        },
        "hp_current": "5",
    }
    second = make_create_request(data=reordered_data)

    assert serialize_cloud_character_snapshot(first) == serialize_cloud_character_snapshot(
        second
    )
    assert calculate_cloud_character_content_hash(
        first
    ) == calculate_cloud_character_content_hash(second)


def test_hash_ignores_transport_metadata() -> None:
    create_request = make_create_request(
        localCharacterId="local-char-a",
        deviceId="device-a",
    )
    update_request = UpdateCloudCharacterRequest.model_validate(
        {
            **make_snapshot(),
            "baseRevision": 42,
            "deviceId": "device-b",
        }
    )

    assert cloud_character_hash_payload(create_request) == cloud_character_hash_payload(
        update_request
    )
    assert calculate_cloud_character_content_hash(
        create_request
    ) == calculate_cloud_character_content_hash(update_request)


def test_hash_changes_when_functional_snapshot_changes() -> None:
    original = make_create_request()
    original_hash = calculate_cloud_character_content_hash(original)

    changed_payloads = []

    changed_name = make_snapshot()
    changed_name["name"] = "Lyra II"
    changed_payloads.append(changed_name)

    changed_class = make_snapshot()
    changed_class["classKey"] = "sorcerer"
    changed_payloads.append(changed_class)

    changed_language = make_snapshot()
    changed_language["language"] = "en-US"
    changed_payloads.append(changed_language)

    changed_data = deepcopy(make_snapshot())
    changed_data["data"]["hp_current"] = "4"
    changed_payloads.append(changed_data)

    changed_schema = make_snapshot()
    changed_schema["schemaVersion"] = 2
    changed_payloads.append(changed_schema)

    for payload in changed_payloads:
        changed = CreateCloudCharacterRequest.model_validate(
            {
                **payload,
                "localCharacterId": "local-char-1",
                "deviceId": "device-a",
            }
        )
        assert calculate_cloud_character_content_hash(changed) != original_hash
