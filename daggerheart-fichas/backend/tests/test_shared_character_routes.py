from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import dependencies
from app.api import shared_characters as routes
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import app
from app.models.cloud_character import CloudCharacter
from app.services import character_share_service as share_service

FIXED_TIME = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)


def make_viewer() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        email="viewer@example.com",
        public_user_code="VIEWER-1234",
        display_name="Viewer",
    )


def make_character(
    *,
    character_id: UUID | None = None,
    owner_user_id: UUID | None = None,
) -> CloudCharacter:
    return CloudCharacter(
        id=character_id or uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        local_character_id="owner-local-character",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5"},
        server_revision=3,
        content_hash="a" * 64,
        schema_version=1,
        created_at=FIXED_TIME,
        updated_at=FIXED_TIME,
        deleted_at=None,
        updated_by_device_id="owner-device",
    )


def make_access(
    *,
    character: CloudCharacter | None = None,
    owner_display_name: str | None = "Game Master",
) -> share_service.SharedCharacterAccess:
    return share_service.SharedCharacterAccess(
        character=character or make_character(),
        owner_display_name=owner_display_name,
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())


@contextmanager
def authenticated_client(
    *,
    viewer: SimpleNamespace,
    session: SimpleNamespace | None = None,
) -> Iterator[TestClient]:
    test_session = session or make_session()

    async def override_db_session():
        yield test_session

    async def override_current_user():
        return viewer

    def override_settings() -> Settings:
        return Settings(app_env="test")

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[dependencies.require_current_user] = override_current_user
    app.dependency_overrides[get_settings] = override_settings

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides = previous_overrides


def test_viewer_routes_are_registered() -> None:
    with TestClient(app) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert set(paths["/shared/characters"]) >= {"get"}
    assert set(paths["/shared/characters/{character_id}"]) >= {"get"}


@pytest.mark.asyncio
async def test_list_shared_characters_serializes_summary_only(monkeypatch) -> None:
    viewer = make_viewer()
    session = make_session()
    accesses = [make_access(), make_access(owner_display_name=None)]
    list_mock = AsyncMock(return_value=accesses)
    monkeypatch.setattr(routes.share_service, "list_shared_characters", list_mock)

    result = await routes.list_shared_characters(
        session=session,
        current_user=viewer,
    )

    assert len(result.characters) == 2
    assert result.characters[0].permission == "viewer"
    assert result.characters[0].owner_display_name == "Game Master"
    assert result.characters[1].owner_display_name is None
    assert not hasattr(result.characters[0], "data")
    list_mock.assert_awaited_once_with(
        session,
        viewer_user_id=viewer.id,
    )
    session.commit.assert_not_awaited()
    session.refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_shared_character_serializes_complete_readonly_snapshot(
    monkeypatch,
) -> None:
    viewer = make_viewer()
    session = make_session()
    character = make_character()
    access = make_access(character=character)
    get_mock = AsyncMock(return_value=access)
    monkeypatch.setattr(routes.share_service, "get_shared_character", get_mock)

    result = await routes.get_shared_character(
        character_id=character.id,
        session=session,
        current_user=viewer,
    )

    assert result.character.id == character.id
    assert result.character.permission == "viewer"
    assert result.character.data == {"hp_current": "5"}
    assert result.character.owner_display_name == "Game Master"
    get_mock.assert_awaited_once_with(
        session,
        viewer_user_id=viewer.id,
        character_id=character.id,
    )
    session.commit.assert_not_awaited()
    session.refresh.assert_not_awaited()


def test_shared_character_not_found_maps_to_masked_404() -> None:
    character_id = uuid4()

    with pytest.raises(HTTPException) as exc_info:
        routes.raise_shared_character_api_error(
            share_service.SharedCharacterNotFoundError(character_id)
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == {
        "code": "SHARED_CHARACTER_NOT_FOUND",
        "message": "Shared character was not found.",
        "detail": {"characterId": str(character_id)},
    }


def test_list_shared_characters_http_contract_omits_snapshot_and_owner_internals(
    monkeypatch,
) -> None:
    viewer = make_viewer()
    character = make_character()
    monkeypatch.setattr(
        routes.share_service,
        "list_shared_characters",
        AsyncMock(return_value=[make_access(character=character)]),
    )

    with authenticated_client(viewer=viewer) as client:
        response = client.get("/shared/characters")

    assert response.status_code == 200
    assert response.json() == {
        "characters": [
            {
                "id": str(character.id),
                "ownerDisplayName": "Game Master",
                "name": "Lyra",
                "system": "daggerheart",
                "classKey": "wizard",
                "language": "pt-BR",
                "serverRevision": 3,
                "schemaVersion": 1,
                "permission": "viewer",
                "updatedAt": "2026-07-09T12:00:00Z",
            }
        ]
    }
    for forbidden in (
        "data",
        "ownerUserId",
        "localCharacterId",
        "contentHash",
        "updatedByDeviceId",
        "deletedAt",
    ):
        assert forbidden not in response.text


def test_get_shared_character_http_contract_returns_readonly_snapshot(monkeypatch) -> None:
    viewer = make_viewer()
    character = make_character()
    monkeypatch.setattr(
        routes.share_service,
        "get_shared_character",
        AsyncMock(return_value=make_access(character=character)),
    )

    with authenticated_client(viewer=viewer) as client:
        response = client.get(f"/shared/characters/{character.id}")

    assert response.status_code == 200
    assert response.json() == {
        "character": {
            "id": str(character.id),
            "ownerDisplayName": "Game Master",
            "name": "Lyra",
            "system": "daggerheart",
            "classKey": "wizard",
            "language": "pt-BR",
            "serverRevision": 3,
            "schemaVersion": 1,
            "permission": "viewer",
            "updatedAt": "2026-07-09T12:00:00Z",
            "data": {"hp_current": "5"},
        }
    }
    for forbidden in (
        "ownerUserId",
        "localCharacterId",
        "contentHash",
        "updatedByDeviceId",
        "deletedAt",
    ):
        assert forbidden not in response.text


def test_get_shared_character_http_contract_masks_all_inaccessible_states(
    monkeypatch,
) -> None:
    viewer = make_viewer()
    character_id = uuid4()
    monkeypatch.setattr(
        routes.share_service,
        "get_shared_character",
        AsyncMock(side_effect=share_service.SharedCharacterNotFoundError(character_id)),
    )

    with authenticated_client(viewer=viewer) as client:
        response = client.get(f"/shared/characters/{character_id}")

    assert response.status_code == 404
    assert response.json() == {
        "code": "SHARED_CHARACTER_NOT_FOUND",
        "message": "Shared character was not found.",
        "detail": {"characterId": str(character_id)},
    }


def test_get_shared_character_rejects_invalid_uuid_before_service(monkeypatch) -> None:
    viewer = make_viewer()
    get_mock = AsyncMock()
    monkeypatch.setattr(routes.share_service, "get_shared_character", get_mock)

    with authenticated_client(viewer=viewer) as client:
        response = client.get("/shared/characters/not-a-uuid")

    assert response.status_code == 422
    get_mock.assert_not_awaited()
