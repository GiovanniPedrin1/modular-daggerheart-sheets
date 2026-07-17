from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, Response, status
from fastapi.testclient import TestClient

from app.api import characters as routes
from app.api import dependencies
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import app
from app.models.character_share import CharacterShare
from app.schemas.shares import CreateCharacterShareRequest
from app.services import character_share_service as share_service
from app.services import cloud_character_service as character_service
from app.services import share_target_service

FIXED_TIME = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)


def make_owner() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        email="owner@example.com",
        public_user_code="OWNER-1234",
        display_name="Owner",
    )


def make_share(
    *,
    character_id: UUID,
    owner_user_id: UUID,
    target_email: str | None = "viewer@example.com",
    target_public_user_code: str | None = None,
    status_value: str = "pending",
) -> CharacterShare:
    return CharacterShare(
        id=uuid4(),
        character_id=character_id,
        owner_user_id=owner_user_id,
        target_user_id=uuid4() if status_value == "active" else None,
        target_email=target_email,
        target_public_user_code=target_public_user_code,
        role="viewer",
        status=status_value,
        created_at=FIXED_TIME,
        accepted_at=FIXED_TIME if status_value == "active" else None,
        revoked_at=None,
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())


@contextmanager
def authenticated_client(
    *,
    owner: SimpleNamespace,
    session: SimpleNamespace | None = None,
) -> Iterator[TestClient]:
    test_session = session or make_session()

    async def override_db_session():
        yield test_session

    async def override_current_user():
        return owner

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


def test_owner_share_routes_are_registered() -> None:
    with TestClient(app) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    share_collection = "/characters/cloud/{character_id}/shares"
    share_item = "/characters/cloud/{character_id}/shares/{share_id}"
    assert set(paths[share_collection]) >= {"get", "post"}
    assert set(paths[share_item]) >= {"delete"}


@pytest.mark.asyncio
async def test_create_share_route_commits_and_refreshes_new_share(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    share = make_share(character_id=character_id, owner_user_id=owner.id)
    session = make_session()
    response = Response()
    create_mock = AsyncMock(
        return_value=share_service.CreateCharacterShareResult(
            share=share,
            created=True,
        )
    )
    monkeypatch.setattr(routes.share_service, "create_character_share", create_mock)
    input_data = CreateCharacterShareRequest(targetEmail="viewer@example.com")

    result = await routes.create_character_share(
        character_id=character_id,
        input_data=input_data,
        response=response,
        session=session,
        current_user=owner,
        settings=Settings(app_env="test"),
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert result.created is True
    assert result.reason is None
    assert result.share.status == "shared"
    assert result.share.target.type == "email"
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited_once_with(share)
    create_mock.assert_awaited_once_with(
        session,
        owner=owner,
        character_id=character_id,
        input_data=input_data,
    )


@pytest.mark.asyncio
async def test_create_share_route_returns_idempotent_200_without_commit(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    share = make_share(
        character_id=character_id,
        owner_user_id=owner.id,
        status_value="active",
    )
    session = make_session()
    response = Response()
    monkeypatch.setattr(
        routes.share_service,
        "create_character_share",
        AsyncMock(
            return_value=share_service.CreateCharacterShareResult(
                share=share,
                created=False,
                reason="existing_share",
            )
        ),
    )

    result = await routes.create_character_share(
        character_id=character_id,
        input_data=CreateCharacterShareRequest(targetEmail="viewer@example.com"),
        response=response,
        session=session,
        current_user=owner,
        settings=Settings(app_env="test"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert result.created is False
    assert result.reason == "existing_share"
    session.commit.assert_not_awaited()
    session.refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_share_route_serializes_only_current_public_fields(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    shares = [
        make_share(character_id=character_id, owner_user_id=owner.id),
        make_share(
            character_id=character_id,
            owner_user_id=owner.id,
            target_email=None,
            target_public_user_code="VIEWER-1234",
            status_value="active",
        ),
    ]
    session = make_session()
    list_mock = AsyncMock(return_value=shares)
    monkeypatch.setattr(routes.share_service, "list_character_shares", list_mock)

    result = await routes.list_character_shares(
        character_id=character_id,
        session=session,
        current_user=owner,
    )

    assert [item.status for item in result.shares] == ["shared", "shared"]
    assert result.shares[0].target.type == "email"
    assert result.shares[1].target.type == "publicUserCode"
    list_mock.assert_awaited_once_with(
        session,
        owner_user_id=owner.id,
        character_id=character_id,
    )
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_revoke_share_route_commits_soft_revocation(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    share_id = uuid4()
    session = make_session()
    revoke_mock = AsyncMock(
        return_value=share_service.RevokeCharacterShareResult(
            share_id=share_id,
            character_id=character_id,
            revoked_at=FIXED_TIME,
        )
    )
    monkeypatch.setattr(routes.share_service, "revoke_character_share", revoke_mock)

    result = await routes.revoke_character_share(
        character_id=character_id,
        share_id=share_id,
        session=session,
        settings=Settings(app_env="test"),
        current_user=owner,
    )

    assert result.ok is True
    assert result.share_id == share_id
    assert result.character_id == character_id
    assert result.revoked_at == FIXED_TIME
    session.commit.assert_awaited_once()
    revoke_mock.assert_awaited_once_with(
        session,
        owner_user_id=owner.id,
        character_id=character_id,
        share_id=share_id,
    )


@pytest.mark.parametrize(
    ("error", "status_code", "code", "detail"),
    [
        (
            share_service.CannotShareWithSelfError(uuid4()),
            409,
            "CANNOT_SHARE_WITH_SELF",
            "characterId",
        ),
        (
            share_target_service.InvalidShareTargetError("publicUserCode"),
            422,
            "INVALID_SHARE_TARGET",
            "targetType",
        ),
    ],
)
def test_share_error_mapper_returns_contract_details(
    error: Exception,
    status_code: int,
    code: str,
    detail: str,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        routes.raise_character_share_api_error(error)

    assert exc_info.value.status_code == status_code
    assert exc_info.value.detail["code"] == code
    assert detail in exc_info.value.detail["detail"]


def test_share_not_found_mapper_masks_current_share_state() -> None:
    character_id = uuid4()
    share_id = uuid4()

    with pytest.raises(HTTPException) as exc_info:
        routes.raise_character_share_api_error(
            share_service.CharacterShareNotFoundError(
                character_id=character_id,
                share_id=share_id,
            )
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == {
        "code": "CHARACTER_SHARE_NOT_FOUND",
        "message": "Character share was not found.",
        "detail": {
            "characterId": str(character_id),
            "shareId": str(share_id),
        },
    }


def test_create_share_http_contract_hides_pending_state(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    share = make_share(character_id=character_id, owner_user_id=owner.id)
    session = make_session()
    monkeypatch.setattr(
        routes.share_service,
        "create_character_share",
        AsyncMock(
            return_value=share_service.CreateCharacterShareResult(
                share=share,
                created=True,
            )
        ),
    )

    with authenticated_client(owner=owner, session=session) as client:
        response = client.post(
            f"/characters/cloud/{character_id}/shares",
            json={"targetEmail": " Viewer@Example.COM "},
        )

    assert response.status_code == 201
    assert response.json() == {
        "share": {
            "id": str(share.id),
            "characterId": str(character_id),
            "target": {
                "type": "email",
                "label": "viewer@example.com",
            },
            "role": "viewer",
            "status": "shared",
            "createdAt": "2026-07-09T12:00:00Z",
        },
        "created": True,
        "reason": None,
    }
    assert "targetUserId" not in response.text
    assert "acceptedAt" not in response.text
    assert "pending" not in response.text


@pytest.mark.parametrize("status_value", ["pending", "active"])
def test_list_share_http_contract_does_not_reveal_internal_status(
    monkeypatch,
    status_value: str,
) -> None:
    owner = make_owner()
    character_id = uuid4()
    share = make_share(
        character_id=character_id,
        owner_user_id=owner.id,
        status_value=status_value,
    )
    monkeypatch.setattr(
        routes.share_service,
        "list_character_shares",
        AsyncMock(return_value=[share]),
    )

    with authenticated_client(owner=owner) as client:
        response = client.get(f"/characters/cloud/{character_id}/shares")

    assert response.status_code == 200
    item = response.json()["shares"][0]
    assert item["status"] == "shared"
    assert "targetUserId" not in item
    assert "acceptedAt" not in item


def test_revoke_share_http_contract_uses_camel_case(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    share_id = uuid4()
    monkeypatch.setattr(
        routes.share_service,
        "revoke_character_share",
        AsyncMock(
            return_value=share_service.RevokeCharacterShareResult(
                share_id=share_id,
                character_id=character_id,
                revoked_at=FIXED_TIME,
            )
        ),
    )

    with authenticated_client(owner=owner) as client:
        response = client.delete(f"/characters/cloud/{character_id}/shares/{share_id}")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "shareId": str(share_id),
        "characterId": str(character_id),
        "revokedAt": "2026-07-09T12:00:00Z",
    }


def test_unknown_public_code_returns_typed_422(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    monkeypatch.setattr(
        routes.share_service,
        "create_character_share",
        AsyncMock(side_effect=share_target_service.InvalidShareTargetError("publicUserCode")),
    )

    with authenticated_client(owner=owner) as client:
        response = client.post(
            f"/characters/cloud/{character_id}/shares",
            json={"publicUserCode": "MISSING-1234"},
        )

    assert response.status_code == 422
    assert response.json() == {
        "code": "INVALID_SHARE_TARGET",
        "message": "The share target could not identify a recipient.",
        "detail": {"targetType": "publicUserCode"},
    }


def test_sharing_with_owner_returns_typed_409(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    monkeypatch.setattr(
        routes.share_service,
        "create_character_share",
        AsyncMock(side_effect=share_service.CannotShareWithSelfError(character_id)),
    )

    with authenticated_client(owner=owner) as client:
        response = client.post(
            f"/characters/cloud/{character_id}/shares",
            json={"targetEmail": owner.email},
        )

    assert response.status_code == 409
    assert response.json() == {
        "code": "CANNOT_SHARE_WITH_SELF",
        "message": "A cloud character cannot be shared with its owner.",
        "detail": {"characterId": str(character_id)},
    }


@pytest.mark.parametrize("method", ["post", "get", "delete"])
def test_non_owned_character_is_masked_as_cloud_character_not_found(
    monkeypatch,
    method: str,
) -> None:
    owner = make_owner()
    character_id = uuid4()
    share_id = uuid4()
    error = character_service.CloudCharacterNotFoundError(character_id)

    if method == "post":
        monkeypatch.setattr(
            routes.share_service,
            "create_character_share",
            AsyncMock(side_effect=error),
        )
    elif method == "get":
        monkeypatch.setattr(
            routes.share_service,
            "list_character_shares",
            AsyncMock(side_effect=error),
        )
    else:
        monkeypatch.setattr(
            routes.share_service,
            "revoke_character_share",
            AsyncMock(side_effect=error),
        )

    with authenticated_client(owner=owner) as client:
        if method == "post":
            response = client.post(
                f"/characters/cloud/{character_id}/shares",
                json={"targetEmail": "viewer@example.com"},
            )
        elif method == "get":
            response = client.get(f"/characters/cloud/{character_id}/shares")
        else:
            response = client.delete(f"/characters/cloud/{character_id}/shares/{share_id}")

    assert response.status_code == 404
    assert response.json() == {
        "code": "CLOUD_CHARACTER_NOT_FOUND",
        "message": "Cloud character was not found.",
        "detail": None,
    }


def test_repeated_or_foreign_revoke_returns_typed_404(monkeypatch) -> None:
    owner = make_owner()
    character_id = uuid4()
    share_id = uuid4()
    monkeypatch.setattr(
        routes.share_service,
        "revoke_character_share",
        AsyncMock(
            side_effect=share_service.CharacterShareNotFoundError(
                character_id=character_id,
                share_id=share_id,
            )
        ),
    )

    with authenticated_client(owner=owner) as client:
        response = client.delete(f"/characters/cloud/{character_id}/shares/{share_id}")

    assert response.status_code == 404
    assert response.json()["code"] == "CHARACTER_SHARE_NOT_FOUND"
    assert response.json()["detail"] == {
        "characterId": str(character_id),
        "shareId": str(share_id),
    }


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {
            "targetEmail": "viewer@example.com",
            "publicUserCode": "VIEWER-1234",
        },
        {"targetEmail": "not-an-email"},
        {"publicUserCode": "bad code"},
        {"targetEmail": "viewer@example.com", "role": "owner"},
    ],
)
def test_invalid_share_payload_is_rejected_before_service(
    monkeypatch,
    payload: dict,
) -> None:
    owner = make_owner()
    character_id = uuid4()
    create_mock = AsyncMock()
    monkeypatch.setattr(routes.share_service, "create_character_share", create_mock)

    with authenticated_client(owner=owner) as client:
        response = client.post(
            f"/characters/cloud/{character_id}/shares",
            json=payload,
        )

    assert response.status_code == 422
    create_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_share_rejects_target_above_configured_limit(monkeypatch) -> None:
    owner = make_owner()
    session = make_session()
    create_mock = AsyncMock()
    monkeypatch.setattr(routes.share_service, "create_character_share", create_mock)
    input_data = CreateCharacterShareRequest(targetEmail=f"{'a' * 60}@example.com")

    with pytest.raises(HTTPException) as exc_info:
        await routes.create_character_share(
            character_id=uuid4(),
            input_data=input_data,
            response=Response(),
            session=session,
            settings=Settings(app_env="test", max_share_target_length=64),
            current_user=owner,
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "INVALID_SHARE_TARGET"
    create_mock.assert_not_awaited()
