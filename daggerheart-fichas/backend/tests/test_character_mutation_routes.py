from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient

from app.api import characters as routes
from app.api import dependencies
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import app
from app.models.cloud_character import CloudCharacter
from app.schemas.character_sync import (
    CharacterMutationAppliedCreate,
    CharacterMutationConflictCreate,
    CharacterMutationRejectedCreate,
    CharacterMutationRequest,
)
from app.services import character_mutation_service as mutation_service

FIXED_TIME = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)


def make_character(
    *,
    owner_user_id: UUID | None = None,
    server_revision: int = 2,
) -> CloudCharacter:
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        local_character_id="local-character-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "4", "gold": "2"},
        server_revision=server_revision,
        content_hash="a" * 64,
        schema_version=1,
        created_at=FIXED_TIME,
        updated_at=FIXED_TIME,
        deleted_at=None,
        updated_by_device_id="device-mobile",
    )


def make_request(
    *,
    base_revision: int = 1,
    mutation_id: UUID | None = None,
    path: str = "/data/hp_current",
    value: object = "4",
) -> CharacterMutationRequest:
    return CharacterMutationRequest.model_validate(
        {
            "mode": "mutation",
            "baseRevision": base_revision,
            "deviceId": "device-mobile",
            "mutationId": str(mutation_id or uuid4()),
            "schemaVersion": 1,
            "changedPaths": [path],
            "operations": [{"op": "set", "path": path, "value": value}],
        }
    )


def make_session() -> SimpleNamespace:
    return SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())


@contextmanager
def authenticated_client(
    *,
    owner: SimpleNamespace,
    session: SimpleNamespace,
) -> Iterator[TestClient]:
    async def override_db_session():
        yield session

    async def override_current_user():
        return owner

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[dependencies.require_current_user] = override_current_user
    app.dependency_overrides[get_settings] = lambda: Settings(app_env="test")
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides = previous_overrides


@pytest.mark.asyncio
async def test_mutation_patch_emits_event_and_commits_applied_change(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=2)
    input_data = make_request(base_revision=1)
    mutation = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=owner.id,
        request=input_data,
        appliedRevision=2,
        merged=True,
        unchanged=False,
    ).to_model()
    result = mutation_service.CharacterMutationAppliedResult(
        character=character,
        mutation=mutation,
    )
    session = make_session()
    apply_mock = AsyncMock(return_value=result)
    append_mock = AsyncMock()
    monkeypatch.setattr(
        routes.mutation_service,
        "apply_owner_character_mutation",
        apply_mock,
    )
    monkeypatch.setattr(
        routes.mutation_transaction_service.event_service,
        "append_character_updated_event",
        append_mock,
    )

    response = await routes.update_cloud_character(
        character_id=character.id,
        input_data=input_data,
        session=session,
        settings=Settings(app_env="test"),
        current_user=owner,
        request=SimpleNamespace(state=SimpleNamespace(request_body_bytes=0)),
    )

    assert response.result == "applied"
    assert response.merged is True
    assert response.unchanged is False
    assert response.applied_revision == 2
    apply_mock.assert_awaited_once()
    assert apply_mock.await_args.kwargs["owner_user_id"] == owner.id
    append_mock.assert_awaited_once_with(
        session,
        character=character,
        actor_user_id=owner.id,
        changed_paths=["/data/hp_current"],
        device_id="device-mobile",
    )
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited_once_with(character)


def test_http_patch_accepts_mutation_shape_and_serializes_camel_case(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=2)
    input_data = make_request(base_revision=2)
    mutation = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=owner.id,
        request=input_data,
        appliedRevision=2,
        merged=False,
        unchanged=True,
    ).to_model()
    session = make_session()
    apply_mock = AsyncMock(
        return_value=mutation_service.CharacterMutationAppliedResult(
            character=character,
            mutation=mutation,
        )
    )
    monkeypatch.setattr(
        routes.mutation_service,
        "apply_owner_character_mutation",
        apply_mock,
    )

    with authenticated_client(owner=owner, session=session) as client:
        response = client.patch(
            f"/characters/cloud/{character.id}",
            json=input_data.model_dump(by_alias=True, mode="json"),
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["result"] == "applied"
    assert response.json()["mutationId"] == str(input_data.mutation_id)
    assert response.json()["baseRevision"] == 2
    assert response.json()["appliedRevision"] == 2
    assert response.json()["changedPaths"] == ["/data/hp_current"]
    assert response.json()["character"]["serverRevision"] == 2
    assert isinstance(apply_mock.await_args.kwargs["input_data"], CharacterMutationRequest)


def test_http_patch_requires_explicit_mutation_mode(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=2)
    payload = make_request(base_revision=2).model_dump(by_alias=True, mode="json")
    payload.pop("mode")
    session = make_session()
    apply_mock = AsyncMock()
    monkeypatch.setattr(
        routes.mutation_service,
        "apply_owner_character_mutation",
        apply_mock,
    )

    with authenticated_client(owner=owner, session=session) as client:
        response = client.patch(
            f"/characters/cloud/{character.id}",
            json=payload,
        )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    apply_mock.assert_not_awaited()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("duplicate", "expected_result"),
    [(False, "applied"), (True, "duplicate")],
)
async def test_mutation_patch_does_not_emit_event_for_unchanged_or_duplicate(
    monkeypatch,
    duplicate: bool,
    expected_result: str,
) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=2)
    input_data = make_request(base_revision=2)
    mutation = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=owner.id,
        request=input_data,
        appliedRevision=2,
        merged=False,
        unchanged=not duplicate,
    ).to_model()
    result = mutation_service.CharacterMutationAppliedResult(
        character=character,
        mutation=mutation,
        duplicate=duplicate,
    )
    session = make_session()
    monkeypatch.setattr(
        routes.mutation_service,
        "apply_owner_character_mutation",
        AsyncMock(return_value=result),
    )
    append_mock = AsyncMock()
    monkeypatch.setattr(
        routes.mutation_transaction_service.event_service,
        "append_character_updated_event",
        append_mock,
    )

    response = await routes.update_cloud_character(
        character_id=character.id,
        input_data=input_data,
        session=session,
        settings=Settings(app_env="test"),
        current_user=owner,
        request=SimpleNamespace(state=SimpleNamespace(request_body_bytes=0)),
    )

    assert response.result == expected_result
    append_mock.assert_not_awaited()
    session.commit.assert_awaited_once()
    session.refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_mutation_patch_commits_conflict_record_before_returning_409(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=3)
    input_data = make_request(
        base_revision=1,
        path="/data/detailsPage/story",
        value="Local version",
    )
    mutation = CharacterMutationConflictCreate(
        characterId=character.id,
        ownerUserId=owner.id,
        request=input_data,
        serverRevision=3,
        conflictingPaths=["/data/detailsPage/story"],
        serverChangedPaths=["/data/detailsPage"],
        serverCharacter=character,
    ).to_model()
    session = make_session()
    monkeypatch.setattr(
        routes.mutation_service,
        "apply_owner_character_mutation",
        AsyncMock(
            return_value=mutation_service.CharacterMutationConflictResult(
                character=character,
                mutation=mutation,
            )
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        await routes.update_cloud_character(
            character_id=character.id,
            input_data=input_data,
            session=session,
            settings=Settings(app_env="test"),
            current_user=owner,
            request=SimpleNamespace(state=SimpleNamespace(request_body_bytes=0)),
        )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert exc_info.value.detail["code"] == "SYNC_CONFLICT"
    assert exc_info.value.detail["detail"]["conflictingPaths"] == ["/data/detailsPage/story"]
    session.commit.assert_awaited_once()
    session.refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_mutation_patch_translates_persisted_client_ahead_rejection(monkeypatch) -> None:
    owner = SimpleNamespace(id=uuid4())
    character = make_character(owner_user_id=owner.id, server_revision=2)
    input_data = make_request(base_revision=4)
    mutation = CharacterMutationRejectedCreate(
        characterId=character.id,
        ownerUserId=owner.id,
        request=input_data,
        rejectionCode="SYNC_CLIENT_AHEAD",
        rejectionReason="The mutation is based on a revision newer than the server.",
    ).to_model()
    session = make_session()
    monkeypatch.setattr(
        routes.mutation_service,
        "apply_owner_character_mutation",
        AsyncMock(
            return_value=mutation_service.CharacterMutationRejectedResult(
                character=character,
                mutation=mutation,
            )
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        await routes.update_cloud_character(
            character_id=character.id,
            input_data=input_data,
            session=session,
            settings=Settings(app_env="test"),
            current_user=owner,
            request=SimpleNamespace(state=SimpleNamespace(request_body_bytes=0)),
        )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert exc_info.value.detail == {
        "code": "SYNC_CLIENT_AHEAD",
        "message": "The mutation is based on a revision newer than the server.",
        "detail": {
            "characterId": str(character.id),
            "mutationId": str(input_data.mutation_id),
            "baseRevision": 4,
            "serverRevision": 2,
        },
    }
    session.commit.assert_awaited_once()


def test_idempotency_key_reuse_is_exposed_as_mutation_rejected() -> None:
    owner_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    input_data = make_request(base_revision=2)
    mutation = CharacterMutationAppliedCreate(
        characterId=character.id,
        ownerUserId=owner_id,
        request=input_data,
        appliedRevision=2,
        merged=False,
        unchanged=True,
    ).to_model()
    error = mutation_service.CharacterMutationIdempotencyKeyReuseError(
        mutation=mutation,
        received_request_hash="b" * 64,
    )

    with pytest.raises(HTTPException) as exc_info:
        routes.raise_character_mutation_service_error(error)

    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert exc_info.value.detail["code"] == "MUTATION_REJECTED"
    assert exc_info.value.detail["detail"]["mutationId"] == str(input_data.mutation_id)


def test_character_write_busy_is_exposed_as_retryable_503() -> None:
    error = routes.mutation_transaction_service.CharacterWriteBusyError(
        attempts=3,
        retry_after_seconds=2,
    )

    with pytest.raises(HTTPException) as exc_info:
        routes.raise_character_mutation_transaction_error(error)

    assert exc_info.value.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert exc_info.value.detail == {
        "code": "CHARACTER_WRITE_BUSY",
        "message": "The character is temporarily busy. Retry the same mutation shortly.",
        "detail": {"attempts": 3},
    }
    assert exc_info.value.headers == {"Retry-After": "2"}
