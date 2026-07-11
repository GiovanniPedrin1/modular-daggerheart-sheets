from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.api import characters as character_routes
from app.api import dependencies
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import app
from app.models.character_share import CharacterShare
from app.models.cloud_character import CloudCharacter
from app.schemas.shares import CharacterSharePublic
from app.services import character_share_service as share_service
from app.services import cloud_character_service as character_service

FIXED_TIME = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)


def compile_postgres(statement) -> str:
    compiled = statement.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    )
    return " ".join(str(compiled).split())


def make_user(*, email: str = "viewer@example.com") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        email=email,
        public_user_code="VIEWER-1234",
        display_name="Viewer",
    )


def make_share(
    *,
    share_id: UUID | None = None,
    character_id: UUID | None = None,
    owner_user_id: UUID | None = None,
    status: str = "pending",
) -> CharacterShare:
    return CharacterShare(
        id=share_id or uuid4(),
        character_id=character_id or uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        target_user_id=uuid4() if status == "active" else None,
        target_email="viewer@example.com",
        target_public_user_code=None,
        role="viewer",
        status=status,
        created_at=FIXED_TIME,
        accepted_at=FIXED_TIME if status == "active" else None,
        revoked_at=None,
    )


def make_character(*, character_id: UUID, owner_user_id: UUID) -> CloudCharacter:
    return CloudCharacter(
        id=character_id,
        owner_user_id=owner_user_id,
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


def scalar_result(value):
    return SimpleNamespace(scalar_one_or_none=lambda: value)


def scalar_list_result(values):
    return SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: values),
    )


class CapturingSession:
    def __init__(self, results) -> None:
        self.results = iter(results)
        self.statements = []
        self.added = []
        self.flush = AsyncMock()

    async def execute(self, statement):
        self.statements.append(statement)
        return next(self.results)

    def add(self, value) -> None:
        self.added.append(value)


@contextmanager
def authenticated_client(
    *,
    current_user: SimpleNamespace,
    session: SimpleNamespace | None = None,
) -> Iterator[TestClient]:
    test_session = session or SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    async def override_db_session():
        yield test_session

    async def override_current_user():
        return current_user

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


def valid_update_payload() -> dict[str, object]:
    return {
        "name": "Lyra",
        "system": "daggerheart",
        "classKey": "wizard",
        "language": "pt-BR",
        "data": {"hp_current": "5"},
        "schemaVersion": 1,
        "baseRevision": 3,
        "deviceId": "viewer-device",
    }


def test_pending_and_active_email_shares_are_publicly_indistinguishable() -> None:
    share_id = uuid4()
    character_id = uuid4()
    owner_user_id = uuid4()
    pending = make_share(
        share_id=share_id,
        character_id=character_id,
        owner_user_id=owner_user_id,
        status="pending",
    )
    active = make_share(
        share_id=share_id,
        character_id=character_id,
        owner_user_id=owner_user_id,
        status="active",
    )

    pending_public = CharacterSharePublic.from_share(pending).model_dump(
        by_alias=True,
        mode="json",
    )
    active_public = CharacterSharePublic.from_share(active).model_dump(
        by_alias=True,
        mode="json",
    )

    assert pending_public == active_public
    assert pending_public["status"] == "shared"
    serialized = str(pending_public)
    for forbidden in ("pending", "active", "targetUserId", "acceptedAt"):
        assert forbidden not in serialized


@pytest.mark.asyncio
async def test_owner_share_list_query_is_scoped_and_excludes_revoked(monkeypatch) -> None:
    owner_id = uuid4()
    character_id = uuid4()
    character = make_character(character_id=character_id, owner_user_id=owner_id)
    session = CapturingSession([scalar_list_result([])])
    monkeypatch.setattr(
        share_service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )

    result = await share_service.list_character_shares(
        session,
        owner_user_id=owner_id,
        character_id=character_id,
    )

    assert result == []
    sql = compile_postgres(session.statements[0])
    assert f"character_shares.character_id = '{character_id}'" in sql
    assert f"character_shares.owner_user_id = '{owner_id}'" in sql
    assert "character_shares.status IN ('pending', 'active')" in sql
    assert "ORDER BY character_shares.created_at ASC, character_shares.id ASC" in sql


@pytest.mark.asyncio
async def test_revoke_query_is_scoped_to_current_owner_share_and_locked(monkeypatch) -> None:
    owner_id = uuid4()
    character_id = uuid4()
    share_id = uuid4()
    character = make_character(character_id=character_id, owner_user_id=owner_id)
    session = CapturingSession([scalar_result(None)])
    monkeypatch.setattr(
        share_service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )

    with pytest.raises(share_service.CharacterShareNotFoundError):
        await share_service.revoke_character_share(
            session,
            owner_user_id=owner_id,
            character_id=character_id,
            share_id=share_id,
        )

    sql = compile_postgres(session.statements[0])
    assert f"character_shares.id = '{share_id}'" in sql
    assert f"character_shares.character_id = '{character_id}'" in sql
    assert f"character_shares.owner_user_id = '{owner_id}'" in sql
    assert "character_shares.status IN ('pending', 'active')" in sql
    assert sql.endswith("FOR UPDATE")


def test_shared_character_query_uses_account_id_not_mutable_email() -> None:
    viewer_id = uuid4()

    sql = compile_postgres(
        share_service._shared_character_statement(viewer_user_id=viewer_id)
    )

    assert f"character_shares.target_user_id = '{viewer_id}'" in sql
    assert "character_shares.status = 'active'" in sql
    assert "cloud_characters.deleted_at IS NULL" in sql
    assert "users.id = cloud_characters.owner_user_id" in sql
    assert "target_email" not in sql
    assert "users.email" not in sql


@pytest.mark.asyncio
async def test_shared_character_list_has_deterministic_freshest_first_order() -> None:
    viewer_id = uuid4()
    session = CapturingSession([SimpleNamespace(all=lambda: [])])

    result = await share_service.list_shared_characters(
        session,
        viewer_user_id=viewer_id,
    )

    assert result == []
    sql = compile_postgres(session.statements[0])
    assert (
        "ORDER BY cloud_characters.updated_at DESC, cloud_characters.id DESC" in sql
    )


@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("get", "/shared/characters", None),
        ("get", f"/shared/characters/{uuid4()}", None),
        ("get", f"/characters/cloud/{uuid4()}/shares", None),
        (
            "post",
            f"/characters/cloud/{uuid4()}/shares",
            {"targetEmail": "viewer@example.com"},
        ),
    ],
)
def test_all_sharing_endpoints_require_authentication(
    method: str,
    path: str,
    json_body: dict[str, str] | None,
) -> None:
    with TestClient(app) as client:
        response = client.request(method, path, json=json_body)

    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_EXPIRED"


def test_viewer_cannot_patch_an_owner_cloud_character(monkeypatch) -> None:
    viewer = make_user()
    character_id = uuid4()
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    async def reject_foreign_update(
        session_arg,
        *,
        owner_user_id,
        character_id: UUID,
        input_data,
        settings,
    ):
        assert session_arg is session
        assert owner_user_id == viewer.id
        raise character_service.CloudCharacterNotFoundError(character_id)

    monkeypatch.setattr(
        character_routes.character_service,
        "update_cloud_character",
        reject_foreign_update,
    )

    with authenticated_client(current_user=viewer, session=session) as client:
        response = client.patch(
            f"/characters/cloud/{character_id}",
            json=valid_update_payload(),
        )

    assert response.status_code == 404
    assert response.json()["code"] == "CLOUD_CHARACTER_NOT_FOUND"
    session.commit.assert_not_awaited()
    session.refresh.assert_not_awaited()


def test_viewer_cannot_delete_an_owner_cloud_character(monkeypatch) -> None:
    viewer = make_user()
    character_id = uuid4()
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    async def reject_foreign_delete(
        session_arg,
        *,
        owner_user_id,
        character_id: UUID,
    ):
        assert session_arg is session
        assert owner_user_id == viewer.id
        raise character_service.CloudCharacterNotFoundError(character_id)

    monkeypatch.setattr(
        character_routes.character_service,
        "soft_delete_cloud_character",
        reject_foreign_delete,
    )

    with authenticated_client(current_user=viewer, session=session) as client:
        response = client.delete(f"/characters/cloud/{character_id}")

    assert response.status_code == 404
    assert response.json()["code"] == "CLOUD_CHARACTER_NOT_FOUND"
    session.commit.assert_not_awaited()


def test_viewer_cannot_manage_an_owner_share(monkeypatch) -> None:
    viewer = make_user()
    character_id = uuid4()
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    async def reject_foreign_share(
        session_arg,
        *,
        owner,
        character_id: UUID,
        input_data,
    ):
        assert session_arg is session
        assert owner.id == viewer.id
        raise character_service.CloudCharacterNotFoundError(character_id)

    monkeypatch.setattr(
        character_routes.share_service,
        "create_character_share",
        reject_foreign_share,
    )

    with authenticated_client(current_user=viewer, session=session) as client:
        response = client.post(
            f"/characters/cloud/{character_id}/shares",
            json={"targetEmail": "another-viewer@example.com"},
        )

    assert response.status_code == 404
    assert response.json()["code"] == "CLOUD_CHARACTER_NOT_FOUND"
    session.commit.assert_not_awaited()
    session.refresh.assert_not_awaited()
