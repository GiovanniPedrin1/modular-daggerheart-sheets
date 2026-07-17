from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import characters as routes
from app.api import dependencies
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import app
from app.models.cloud_character import CloudCharacter
from app.services import cloud_character_service as service

FIXED_TIME = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)


def make_character(
    *,
    owner_user_id: UUID,
    server_revision: int = 1,
    data: dict | None = None,
) -> CloudCharacter:
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id,
        local_character_id="local-char-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data=data or {"hp_current": "5", "details": {"story": "A hero"}},
        server_revision=server_revision,
        content_hash="a" * 64,
        schema_version=1,
        created_at=FIXED_TIME,
        updated_at=FIXED_TIME,
        deleted_at=None,
        updated_by_device_id="device-1",
    )


def create_payload(**overrides) -> dict:
    payload = {
        "localCharacterId": "local-char-1",
        "deviceId": "device-1",
        "name": "Lyra",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "data": {"hp_current": "5"},
        "schemaVersion": 1,
    }
    payload.update(overrides)
    return payload


def update_payload(**overrides) -> dict:
    payload = {
        "baseRevision": 1,
        "deviceId": "device-2",
        "name": "Lyra Updated",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "data": {"hp_current": "4"},
        "schemaVersion": 1,
    }
    payload.update(overrides)
    return payload


@contextmanager
def authenticated_client(
    *,
    owner: SimpleNamespace,
    session: SimpleNamespace | None = None,
    settings: Settings | None = None,
) -> Iterator[TestClient]:
    test_session = session or SimpleNamespace(
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )
    test_settings = settings or Settings(app_env="test")

    async def override_db_session():
        yield test_session

    async def override_current_user():
        return owner

    def override_settings() -> Settings:
        return test_settings

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[dependencies.require_current_user] = override_current_user
    app.dependency_overrides[get_settings] = override_settings

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides = previous_overrides


def test_post_cloud_character_honors_http_contract(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id)
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
    create_mock = AsyncMock(
        return_value=service.CreateCloudCharacterResult(
            character=character,
            created=True,
        )
    )
    monkeypatch.setattr(routes.character_service, "create_cloud_character", create_mock)

    with authenticated_client(owner=owner, session=session) as client:
        response = client.post(
            "/characters/cloud",
            json=create_payload(
                localCharacterId="  local-char-1  ",
                deviceId="  device-1  ",
                name="  Lyra  ",
            ),
        )

    assert response.status_code == 201
    assert response.json() == {
        "character": {
            "id": str(character.id),
            "ownerUserId": str(owner.id),
            "localCharacterId": "local-char-1",
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "schemaVersion": 1,
            "serverRevision": 1,
            "contentHash": "a" * 64,
            "createdAt": "2026-07-09T12:00:00Z",
            "updatedAt": "2026-07-09T12:00:00Z",
            "data": character.data,
            "deletedAt": None,
        },
        "created": True,
        "reason": None,
    }
    input_data = create_mock.await_args.kwargs["input_data"]
    assert input_data.local_character_id == "local-char-1"
    assert input_data.device_id == "device-1"
    assert input_data.name == "Lyra"
    assert create_mock.await_args.kwargs["owner_user_id"] == owner.id
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited_once_with(character)


def test_post_idempotent_retry_returns_200_and_existing_reason(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id)
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
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

    with authenticated_client(owner=owner, session=session) as client:
        response = client.post("/characters/cloud", json=create_payload())

    assert response.status_code == 200
    assert response.json()["created"] is False
    assert response.json()["reason"] == "existing_identical_snapshot"
    session.commit.assert_not_awaited()
    session.refresh.assert_not_awaited()


def test_list_response_omits_snapshot_data_and_tombstone(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id)
    monkeypatch.setattr(
        routes.character_service,
        "list_owner_cloud_characters",
        AsyncMock(return_value=[character]),
    )

    with authenticated_client(owner=owner) as client:
        response = client.get("/characters/cloud")

    assert response.status_code == 200
    item = response.json()["characters"][0]
    assert item["id"] == str(character.id)
    assert item["ownerUserId"] == str(owner.id)
    assert item["serverRevision"] == 1
    assert "data" not in item
    assert "deletedAt" not in item
    assert not any("_" in key for key in item)


def test_get_non_owned_or_missing_character_returns_masked_404(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character_id = uuid4()
    monkeypatch.setattr(
        routes.character_service,
        "get_owner_cloud_character",
        AsyncMock(side_effect=service.CloudCharacterNotFoundError(character_id)),
    )

    with authenticated_client(owner=owner) as client:
        response = client.get(f"/characters/cloud/{character_id}")

    assert response.status_code == 404
    assert response.json() == {
        "code": "CLOUD_CHARACTER_NOT_FOUND",
        "message": "Cloud character was not found.",
        "detail": None,
    }


def test_patch_revision_mismatch_returns_reconciliation_details(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=3)
    monkeypatch.setattr(
        routes.character_service,
        "update_cloud_character",
        AsyncMock(
            side_effect=service.CloudCharacterRevisionMismatchError(
                character,
                received_base_revision=1,
            )
        ),
    )

    with authenticated_client(owner=owner) as client:
        response = client.patch(
            f"/characters/cloud/{character.id}",
            json=update_payload(baseRevision=1),
        )

    assert response.status_code == 409
    assert response.json() == {
        "code": "REVISION_MISMATCH",
        "message": "The cloud character changed after this snapshot was loaded.",
        "detail": {
            "characterId": str(character.id),
            "serverRevision": 3,
            "receivedBaseRevision": 1,
        },
    }


def test_patch_unchanged_snapshot_keeps_revision_and_serializes_flag(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=2)
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
    monkeypatch.setattr(
        routes.character_service,
        "update_cloud_character",
        AsyncMock(
            return_value=service.UpdateCloudCharacterResult(
                character=character,
                unchanged=True,
            )
        ),
    )

    with authenticated_client(owner=owner, session=session) as client:
        response = client.patch(
            f"/characters/cloud/{character.id}",
            json=update_payload(baseRevision=2),
        )

    assert response.status_code == 200
    assert response.json()["unchanged"] is True
    assert response.json()["character"]["serverRevision"] == 2
    session.commit.assert_awaited_once()
    session.refresh.assert_not_awaited()


def test_delete_response_uses_camel_case(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character_id = uuid4()
    deleted_at = FIXED_TIME
    monkeypatch.setattr(
        routes.character_service,
        "soft_delete_cloud_character",
        AsyncMock(
            return_value=service.DeleteCloudCharacterResult(
                character_id=character_id,
                deleted_at=deleted_at,
            )
        ),
    )

    with authenticated_client(owner=owner) as client:
        response = client.delete(f"/characters/cloud/{character_id}")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "characterId": str(character_id),
        "deletedAt": "2026-07-09T12:00:00Z",
    }


@pytest.mark.parametrize(
    "payload",
    [
        create_payload(unknownField=True),
        create_payload(system="daggerheart", classKey=None),
        create_payload(system="custom", classKey="wizard"),
        create_payload(data=[]),
    ],
)
def test_invalid_create_snapshots_are_rejected_before_service(monkeypatch, payload) -> None:
    owner = SimpleNamespace(id=uuid4())
    create_mock = AsyncMock()
    monkeypatch.setattr(routes.character_service, "create_cloud_character", create_mock)

    with authenticated_client(owner=owner) as client:
        response = client.post("/characters/cloud", json=payload)

    assert response.status_code == 422
    create_mock.assert_not_awaited()


def test_invalid_character_uuid_is_rejected_before_service(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    get_mock = AsyncMock()
    monkeypatch.setattr(routes.character_service, "get_owner_cloud_character", get_mock)

    with authenticated_client(owner=owner) as client:
        response = client.get("/characters/cloud/not-a-uuid")

    assert response.status_code == 422
    get_mock.assert_not_awaited()


def test_missing_session_returns_contract_error_and_expires_cookie(monkeypatch) -> None:
    settings = Settings(app_env="test")
    session = SimpleNamespace()

    async def override_db_session():
        yield session

    def override_settings() -> Settings:
        return settings

    monkeypatch.setattr(
        dependencies,
        "get_active_refresh_session",
        AsyncMock(return_value=None),
    )
    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[get_settings] = override_settings

    try:
        with TestClient(app) as client:
            response = client.get("/characters/cloud")
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 401
    assert response.json() == {
        "code": "SESSION_EXPIRED",
        "message": "Your session has expired. Please sign in again.",
        "detail": None,
    }
    set_cookie = response.headers.get("set-cookie", "")
    assert settings.effective_session_cookie_name in set_cookie
    assert "Max-Age=0" in set_cookie
