from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.backups import validate_backup_payload
from app.core.config import Settings
from app.schemas.backups import CloudBackupPayload
from app.schemas.character_sync import CharacterMutationRequest
from app.schemas.characters import CreateCloudCharacterRequest
from app.services import character_mutation_service as mutation_service
from app.services import cloud_character_service as character_service
from tests.test_character_mutation_service import make_character


def make_cloud_character_request(*, data: dict | None = None, device_id: str = "device-web"):
    return CreateCloudCharacterRequest.model_validate(
        {
            "localCharacterId": "local-1",
            "deviceId": device_id,
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "data": data or {"hp_current": "4"},
            "schemaVersion": 1,
        }
    )


def make_backup(*, value: object = "ok", device_id: str = "device-web") -> CloudBackupPayload:
    import hashlib
    import json

    inner = {
        "app": "rpg-sheets-local-first",
        "formatVersion": 1,
        "exportedAt": "2026-07-15T12:00:00Z",
        "characters": [{"value": value}],
        "settings": [],
    }
    checksum = hashlib.sha256(
        json.dumps(
            inner,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return CloudBackupPayload.model_validate(
        {
            "app": "daggerheart-fichas",
            "cloudFormatVersion": 1,
            "sourceAppVersion": "1.3.5",
            "exportedAt": "2026-07-15T12:00:00Z",
            "deviceId": device_id,
            "checksum": checksum,
            "payload": inner,
        }
    )


def make_mutation(*, paths: list[str], values: list[object], device_id: str = "device-mobile"):
    return CharacterMutationRequest.model_validate(
        {
            "mode": "mutation",
            "baseRevision": 2,
            "deviceId": device_id,
            "mutationId": str(uuid4()),
            "schemaVersion": 1,
            "changedPaths": paths,
            "operations": [
                {"op": "set", "path": path, "value": value}
                for path, value in zip(paths, values, strict=True)
            ],
        }
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(add=Mock(), execute=AsyncMock(), flush=AsyncMock())


def test_cloud_character_rejects_configured_json_depth() -> None:
    request = make_cloud_character_request(data={"one": {"two": {"three": {"four": True}}}})

    with pytest.raises(character_service.InvalidCloudCharacterPayloadError) as exc_info:
        character_service.validate_cloud_character_snapshot(
            request,
            settings=Settings(app_env="test", max_json_depth=4),
        )

    # Snapshot envelope is depth 1 and data is depth 2.
    assert exc_info.value.validation_error.path == "/data/one/two/three"
    assert exc_info.value.validation_error.reason == "nesting is too deep"


def test_cloud_character_rejects_configured_utf8_string_limit() -> None:
    request = make_cloud_character_request(data={"story": "é" * 33})

    with pytest.raises(character_service.InvalidCloudCharacterPayloadError) as exc_info:
        character_service.validate_cloud_character_snapshot(
            request,
            settings=Settings(app_env="test", max_json_string_length=64),
        )

    assert exc_info.value.validation_error.path == "/data/story"
    assert exc_info.value.validation_error.actual == 66


@pytest.mark.asyncio
async def test_cloud_character_rejects_device_id_above_deployment_limit(monkeypatch) -> None:
    request = make_cloud_character_request(device_id="d" * 17)
    session = make_session()

    with pytest.raises(character_service.CloudCharacterIdentifierTooLongError) as exc_info:
        await character_service.create_cloud_character(
            session,
            owner_user_id=uuid4(),
            input_data=request,
            settings=Settings(app_env="test", max_device_id_length=16),
        )

    assert exc_info.value.field == "deviceId"
    assert exc_info.value.actual_length == 17


def test_backup_rejects_excessive_json_structure() -> None:
    backup = make_backup(value={"one": {"two": {"three": True}}})

    with pytest.raises(HTTPException) as exc_info:
        validate_backup_payload(
            backup,
            settings=Settings(app_env="test", max_json_depth=5),
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "INVALID_BACKUP_PAYLOAD"
    assert exc_info.value.detail["detail"]["reason"] == "nesting is too deep"


@pytest.mark.asyncio
async def test_mutation_persists_rejection_for_configured_operation_count(monkeypatch) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id, server_revision=2)
    request = make_mutation(
        paths=["/data/hp_current", "/data/gold"],
        values=["5", "3"],
    )
    session = make_session()
    monkeypatch.setattr(
        mutation_service.character_service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        mutation_service,
        "find_character_mutation",
        AsyncMock(return_value=None),
    )

    result = await mutation_service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=request,
        settings=Settings(
            app_env="test",
            max_character_mutation_operations=1,
            max_character_mutation_changed_paths=1,
        ),
    )

    assert isinstance(result, mutation_service.CharacterMutationRejectedResult)
    assert result.code == "INVALID_MUTATION"
    assert result.path == "/operations"
    assert character.server_revision == 2


@pytest.mark.asyncio
async def test_mutation_persists_rejection_for_deep_or_large_set_value(monkeypatch) -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id, server_revision=2)
    request = make_mutation(paths=["/data/story"], values=["é" * 33])
    session = make_session()
    monkeypatch.setattr(
        mutation_service.character_service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        mutation_service,
        "find_character_mutation",
        AsyncMock(return_value=None),
    )

    result = await mutation_service.apply_owner_character_mutation(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        input_data=request,
        settings=Settings(app_env="test", max_json_string_length=64),
    )

    assert isinstance(result, mutation_service.CharacterMutationRejectedResult)
    assert result.code == "INVALID_MUTATION"
    assert result.path == "/operations/0/value"
    assert character.server_revision == 2


def test_auth_device_id_uses_configured_limit() -> None:
    from app.api.auth import validate_auth_device_id

    with pytest.raises(HTTPException) as exc_info:
        validate_auth_device_id(
            "d" * 17,
            settings=Settings(app_env="test", max_device_id_length=16),
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "INVALID_DEVICE_ID"
    assert exc_info.value.detail["detail"] == {
        "maxLength": 16,
        "actualLength": 17,
    }


def test_auth_user_agent_is_truncated_by_centralized_limit() -> None:
    from starlette.requests import Request

    from app.api.auth import get_user_agent

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/auth/login",
            "headers": [(b"user-agent", b"browser-agent-with-extra-data")],
        }
    )

    assert get_user_agent(request, max_length=13) == "browser-agent"
