from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, Response, status
from fastapi.testclient import TestClient

from app.api import characters as routes
from app.core.config import Settings
from app.main import app
from app.models.cloud_character import CloudCharacter
from app.schemas.characters import CreateCloudCharacterRequest, UpdateCloudCharacterRequest
from app.services import cloud_character_service as service


def make_character(
    *,
    owner_user_id: UUID | None = None,
    server_revision: int = 1,
) -> CloudCharacter:
    now = datetime.now(UTC)
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        local_character_id="local-char-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5"},
        server_revision=server_revision,
        content_hash="a" * 64,
        schema_version=1,
        created_at=now,
        updated_at=now,
        deleted_at=None,
        updated_by_device_id="device-1",
    )


def make_create_request() -> CreateCloudCharacterRequest:
    return CreateCloudCharacterRequest.model_validate(
        {
            "localCharacterId": "local-char-1",
            "deviceId": "device-1",
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "data": {"hp_current": "5"},
            "schemaVersion": 1,
        }
    )


def make_update_request(*, base_revision: int = 1) -> UpdateCloudCharacterRequest:
    return UpdateCloudCharacterRequest.model_validate(
        {
            "baseRevision": base_revision,
            "deviceId": "device-2",
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "data": {"hp_current": "4"},
            "schemaVersion": 1,
        }
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )


def test_cloud_character_routes_are_registered() -> None:
    client = TestClient(app)

    response = client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/characters/cloud" in paths
    assert "/characters/cloud/{character_id}" in paths
    assert set(paths["/characters/cloud"]) >= {"get", "post"}
    assert set(paths["/characters/cloud/{character_id}"]) >= {"get", "patch", "delete"}


@pytest.mark.asyncio
async def test_create_route_commits_new_character_and_returns_created(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id)
    session = make_session()
    response = Response()
    create_mock = AsyncMock(
        return_value=service.CreateCloudCharacterResult(
            character=character,
            created=True,
        )
    )
    monkeypatch.setattr(routes.character_service, "create_cloud_character", create_mock)

    result = await routes.create_cloud_character(
        input_data=make_create_request(),
        response=response,
        session=session,
        settings=Settings(app_env="test"),
        current_user=owner,
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert result.created is True
    assert result.character.id == character.id
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited_once_with(character)
    create_mock.assert_awaited_once()
    assert create_mock.await_args.kwargs["owner_user_id"] == owner.id


@pytest.mark.asyncio
async def test_create_route_returns_200_for_idempotent_retry_without_commit(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id)
    session = make_session()
    response = Response()
    monkeypatch.setattr(
        routes.character_service,
        "create_cloud_character",
        AsyncMock(
            return_value=service.CreateCloudCharacterResult(
                character=character,
                created=False,
                reason="existing_identical_snapshot",
            )
        ),
    )

    result = await routes.create_cloud_character(
        input_data=make_create_request(),
        response=response,
        session=session,
        settings=Settings(app_env="test"),
        current_user=owner,
    )

    assert response.status_code == status.HTTP_200_OK
    assert result.created is False
    assert result.reason == "existing_identical_snapshot"
    session.commit.assert_not_awaited()
    session.refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_and_get_routes_return_only_service_results(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id)
    session = make_session()
    list_mock = AsyncMock(return_value=[character])
    get_mock = AsyncMock(return_value=character)
    monkeypatch.setattr(routes.character_service, "list_owner_cloud_characters", list_mock)
    monkeypatch.setattr(routes.character_service, "get_owner_cloud_character", get_mock)

    listed = await routes.list_cloud_characters(session=session, current_user=owner)
    fetched = await routes.get_cloud_character(
        character_id=character.id,
        session=session,
        current_user=owner,
    )

    assert [item.id for item in listed.characters] == [character.id]
    assert fetched.character.id == character.id
    list_mock.assert_awaited_once_with(session, owner_user_id=owner.id)
    get_mock.assert_awaited_once_with(
        session,
        owner_user_id=owner.id,
        character_id=character.id,
    )


@pytest.mark.asyncio
async def test_update_route_commits_each_locked_update_and_refreshes_changed_snapshot(
    monkeypatch,
) -> None:
    owner = SimpleNamespace(id=uuid4())
    changed_character = make_character(owner_user_id=owner.id, server_revision=2)
    unchanged_character = make_character(owner_user_id=owner.id)
    session = make_session()
    update_mock = AsyncMock(
        side_effect=[
            service.UpdateCloudCharacterResult(
                character=changed_character,
                unchanged=False,
            ),
            service.UpdateCloudCharacterResult(
                character=unchanged_character,
                unchanged=True,
            ),
        ]
    )
    monkeypatch.setattr(routes.character_service, "update_cloud_character", update_mock)

    changed = await routes.update_cloud_character(
        character_id=changed_character.id,
        input_data=make_update_request(),
        session=session,
        settings=Settings(app_env="test"),
        current_user=owner,
    )
    unchanged = await routes.update_cloud_character(
        character_id=unchanged_character.id,
        input_data=make_update_request(),
        session=session,
        settings=Settings(app_env="test"),
        current_user=owner,
    )

    assert changed.unchanged is False
    assert changed.character.server_revision == 2
    assert unchanged.unchanged is True
    assert session.commit.await_count == 2
    session.refresh.assert_awaited_once_with(changed_character)


@pytest.mark.asyncio
async def test_delete_route_commits_soft_delete(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character_id = uuid4()
    deleted_at = datetime.now(UTC)
    session = make_session()
    delete_mock = AsyncMock(
        return_value=service.DeleteCloudCharacterResult(
            character_id=character_id,
            deleted_at=deleted_at,
        )
    )
    monkeypatch.setattr(routes.character_service, "soft_delete_cloud_character", delete_mock)

    result = await routes.delete_cloud_character(
        character_id=character_id,
        session=session,
        current_user=owner,
    )

    assert result.ok is True
    assert result.character_id == character_id
    assert result.deleted_at == deleted_at
    session.commit.assert_awaited_once()
    delete_mock.assert_awaited_once_with(
        session,
        owner_user_id=owner.id,
        character_id=character_id,
    )


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code", "expected_detail"),
    [
        (
            service.CloudCharacterNotFoundError(uuid4()),
            status.HTTP_404_NOT_FOUND,
            "CLOUD_CHARACTER_NOT_FOUND",
            None,
        ),
        (
            service.CloudCharacterTooLargeError(max_bytes=100, actual_bytes=101),
            status.HTTP_413_CONTENT_TOO_LARGE,
            "CHARACTER_TOO_LARGE",
            {"maxBytes": 100, "actualBytes": 101},
        ),
        (
            service.UnsupportedCloudCharacterSchemaVersionError(
                supported_version=1,
                received_version=2,
            ),
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "UNSUPPORTED_CHARACTER_SCHEMA_VERSION",
            {"supportedVersion": 1, "receivedVersion": 2},
        ),
    ],
)
def test_service_errors_are_translated_to_api_errors(
    error,
    expected_status: int,
    expected_code: str,
    expected_detail: dict | None,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        routes.raise_cloud_character_api_error(error)

    assert exc_info.value.status_code == expected_status
    assert exc_info.value.detail["code"] == expected_code
    assert exc_info.value.detail["detail"] == expected_detail


def test_existing_character_and_revision_errors_include_reconciliation_details() -> None:
    character = make_character(server_revision=3)

    with pytest.raises(HTTPException) as existing_exc:
        routes.raise_cloud_character_api_error(
            service.CloudCharacterAlreadyExistsError(character)
        )

    assert existing_exc.value.status_code == status.HTTP_409_CONFLICT
    assert existing_exc.value.detail == {
        "code": "CLOUD_CHARACTER_ALREADY_EXISTS",
        "message": "This local character is already linked to a different cloud snapshot.",
        "detail": {
            "characterId": str(character.id),
            "localCharacterId": "local-char-1",
            "serverRevision": 3,
        },
    }

    with pytest.raises(HTTPException) as revision_exc:
        routes.raise_cloud_character_api_error(
            service.CloudCharacterRevisionMismatchError(
                character,
                received_base_revision=1,
            )
        )

    assert revision_exc.value.status_code == status.HTTP_409_CONFLICT
    assert revision_exc.value.detail["code"] == "REVISION_MISMATCH"
    assert revision_exc.value.detail["detail"] == {
        "characterId": str(character.id),
        "serverRevision": 3,
        "receivedBaseRevision": 1,
    }
