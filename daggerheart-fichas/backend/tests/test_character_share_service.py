from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.character_share import CharacterShare
from app.models.cloud_character import CloudCharacter
from app.models.user import User
from app.schemas.shares import CreateCharacterShareRequest
from app.services import character_share_service as service
from app.services.share_target_service import ResolvedShareTarget


def make_session() -> SimpleNamespace:
    return SimpleNamespace(
        add=Mock(),
        execute=AsyncMock(),
        flush=AsyncMock(),
        rollback=AsyncMock(),
    )


def scalar_result(value):
    return SimpleNamespace(scalar_one_or_none=Mock(return_value=value))


def scalar_list_result(values):
    return SimpleNamespace(
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=values)))
    )


def row_list_result(values):
    return SimpleNamespace(all=Mock(return_value=values))


def row_result(value):
    return SimpleNamespace(one_or_none=Mock(return_value=value))


def make_user(
    *,
    email: str = "owner@example.com",
    public_user_code: str = "OWNER-1234",
    display_name: str | None = "Owner",
) -> User:
    return User(
        id=uuid4(),
        email=email,
        public_user_code=public_user_code,
        password_hash="hashed",
        display_name=display_name,
    )


def make_character(*, owner_user_id=None) -> CloudCharacter:
    now = datetime.now(UTC)
    return CloudCharacter(
        id=uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        local_character_id="local-1",
        name="Lyra",
        system="daggerheart",
        class_key="wizard",
        language="pt-BR",
        data={"hp_current": "5"},
        server_revision=2,
        content_hash="a" * 64,
        schema_version=1,
        created_at=now,
        updated_at=now,
        deleted_at=None,
        updated_by_device_id="device-1",
    )


def make_share(
    *,
    character_id=None,
    owner_user_id=None,
    target_user_id=None,
    target_email: str | None = "viewer@example.com",
    target_public_user_code: str | None = None,
    status: str = "pending",
) -> CharacterShare:
    now = datetime.now(UTC)
    return CharacterShare(
        id=uuid4(),
        character_id=character_id or uuid4(),
        owner_user_id=owner_user_id or uuid4(),
        target_user_id=target_user_id,
        target_email=target_email,
        target_public_user_code=target_public_user_code,
        role="viewer",
        status=status,
        created_at=now,
        accepted_at=now if status == "active" else None,
        revoked_at=now if status == "revoked" else None,
    )


def email_target(*, user: User | None = None) -> ResolvedShareTarget:
    return ResolvedShareTarget(kind="email", label="viewer@example.com", user=user)


def code_target(*, user: User) -> ResolvedShareTarget:
    return ResolvedShareTarget(kind="publicUserCode", label=user.public_user_code, user=user)


def test_self_target_detection_uses_user_and_normalized_labels() -> None:
    owner = make_user(email=" Owner@Example.COM ", public_user_code="owner-1234")

    assert service._is_self_target(owner=owner, target=email_target(user=owner)) is True
    assert (
        service._is_self_target(
            owner=owner,
            target=ResolvedShareTarget(
                kind="email",
                label="owner@example.com",
                user=None,
            ),
        )
        is True
    )
    assert (
        service._is_self_target(
            owner=owner,
            target=ResolvedShareTarget(
                kind="publicUserCode",
                label="OWNER-1234",
                user=make_user(public_user_code="OTHER-1234"),
            ),
        )
        is True
    )


@pytest.mark.asyncio
async def test_find_current_share_matches_label_and_resolved_user() -> None:
    viewer = make_user(email="viewer@example.com", public_user_code="VIEWER-1234")
    existing = make_share(target_user_id=viewer.id, status="active")
    session = make_session()
    session.execute.return_value = scalar_result(existing)

    result = await service.find_current_character_share(
        session,
        character_id=existing.character_id,
        owner_user_id=existing.owner_user_id,
        target=email_target(user=viewer),
    )

    assert result is existing
    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "character_shares.status IN" in sql
    assert "character_shares.target_email =" in sql
    assert "character_shares.target_user_id =" in sql
    assert statement._limit_clause is not None


@pytest.mark.asyncio
async def test_create_pending_email_share(monkeypatch) -> None:
    owner = make_user()
    character = make_character(owner_user_id=owner.id)
    session = make_session()
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "resolve_share_target",
        AsyncMock(return_value=email_target()),
    )
    monkeypatch.setattr(
        service,
        "find_current_character_share",
        AsyncMock(return_value=None),
    )

    result = await service.create_character_share(
        session,
        owner=owner,
        character_id=character.id,
        input_data=CreateCharacterShareRequest(targetEmail="viewer@example.com"),
    )

    assert result.created is True
    assert result.reason is None
    assert result.share.status == "pending"
    assert result.share.target_user_id is None
    assert result.share.target_email == "viewer@example.com"
    assert result.share.accepted_at is None
    assert result.share.owner_user_id == owner.id
    session.add.assert_called_once_with(result.share)
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_active_share_for_existing_user(monkeypatch) -> None:
    owner = make_user()
    viewer = make_user(email="viewer@example.com", public_user_code="VIEWER-1234")
    character = make_character(owner_user_id=owner.id)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "resolve_share_target",
        AsyncMock(return_value=code_target(user=viewer)),
    )
    monkeypatch.setattr(
        service,
        "find_current_character_share",
        AsyncMock(return_value=None),
    )
    session = make_session()

    result = await service.create_character_share(
        session,
        owner=owner,
        character_id=character.id,
        input_data=CreateCharacterShareRequest(publicUserCode="VIEWER-1234"),
    )

    assert result.share.status == "active"
    assert result.share.target_user_id == viewer.id
    assert result.share.target_public_user_code == "VIEWER-1234"
    assert result.share.target_email is None
    assert result.share.accepted_at is not None


@pytest.mark.asyncio
async def test_create_rejects_owner_as_target(monkeypatch) -> None:
    owner = make_user()
    character = make_character(owner_user_id=owner.id)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "resolve_share_target",
        AsyncMock(return_value=email_target(user=owner)),
    )
    finder = AsyncMock()
    monkeypatch.setattr(service, "find_current_character_share", finder)
    session = make_session()

    with pytest.raises(service.CannotShareWithSelfError) as exc_info:
        await service.create_character_share(
            session,
            owner=owner,
            character_id=character.id,
            input_data=CreateCharacterShareRequest(targetEmail=owner.email),
        )

    assert exc_info.value.character_id == character.id
    finder.assert_not_awaited()
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_create_is_idempotent_for_current_share(monkeypatch) -> None:
    owner = make_user()
    character = make_character(owner_user_id=owner.id)
    existing = make_share(character_id=character.id, owner_user_id=owner.id)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "resolve_share_target",
        AsyncMock(return_value=email_target()),
    )
    monkeypatch.setattr(
        service,
        "find_current_character_share",
        AsyncMock(return_value=existing),
    )
    session = make_session()

    result = await service.create_character_share(
        session,
        owner=owner,
        character_id=character.id,
        input_data=CreateCharacterShareRequest(targetEmail="viewer@example.com"),
    )

    assert result.share is existing
    assert result.created is False
    assert result.reason == "existing_share"
    session.add.assert_not_called()
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_recovers_from_concurrent_unique_insert(monkeypatch) -> None:
    owner = make_user()
    character = make_character(owner_user_id=owner.id)
    concurrent = make_share(character_id=character.id, owner_user_id=owner.id)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "resolve_share_target",
        AsyncMock(return_value=email_target()),
    )
    finder = AsyncMock(side_effect=[None, concurrent])
    monkeypatch.setattr(service, "find_current_character_share", finder)
    session = make_session()
    session.flush.side_effect = IntegrityError("insert", {}, Exception("unique"))

    result = await service.create_character_share(
        session,
        owner=owner,
        character_id=character.id,
        input_data=CreateCharacterShareRequest(targetEmail="viewer@example.com"),
    )

    assert result.share is concurrent
    assert result.created is False
    assert result.reason == "existing_share"
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_reraises_unexplained_integrity_error(monkeypatch) -> None:
    owner = make_user()
    character = make_character(owner_user_id=owner.id)
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service,
        "resolve_share_target",
        AsyncMock(return_value=email_target()),
    )
    monkeypatch.setattr(
        service,
        "find_current_character_share",
        AsyncMock(side_effect=[None, None]),
    )
    session = make_session()
    session.flush.side_effect = IntegrityError("insert", {}, Exception("other"))

    with pytest.raises(IntegrityError):
        await service.create_character_share(
            session,
            owner=owner,
            character_id=character.id,
            input_data=CreateCharacterShareRequest(targetEmail="viewer@example.com"),
        )


@pytest.mark.asyncio
async def test_list_owner_shares_checks_ownership_and_omits_revoked(monkeypatch) -> None:
    owner_id = uuid4()
    character_id = uuid4()
    shares = [make_share(character_id=character_id, owner_user_id=owner_id)]
    get_character = AsyncMock(return_value=make_character(owner_user_id=owner_id))
    monkeypatch.setattr(service, "get_owner_cloud_character", get_character)
    session = make_session()
    session.execute.return_value = scalar_list_result(shares)

    result = await service.list_character_shares(
        session,
        owner_user_id=owner_id,
        character_id=character_id,
    )

    assert result == shares
    get_character.assert_awaited_once_with(
        session,
        owner_user_id=owner_id,
        character_id=character_id,
    )
    statement = session.execute.await_args.args[0]
    assert "character_shares.status IN" in str(statement)


@pytest.mark.asyncio
async def test_revoke_current_share_sets_tombstone_and_locks(monkeypatch) -> None:
    owner_id = uuid4()
    character_id = uuid4()
    share = make_share(character_id=character_id, owner_user_id=owner_id)
    get_character = AsyncMock(return_value=make_character(owner_user_id=owner_id))
    monkeypatch.setattr(service, "get_owner_cloud_character", get_character)
    append_event = AsyncMock()
    monkeypatch.setattr(
        service.event_service,
        "append_share_revoked_event",
        append_event,
    )
    session = make_session()
    session.execute.return_value = scalar_result(share)
    revoked_at = datetime(2026, 7, 9, 15, 0, tzinfo=UTC)

    result = await service.revoke_character_share(
        session,
        owner_user_id=owner_id,
        character_id=character_id,
        share_id=share.id,
        revoked_at=revoked_at,
    )

    assert result.share_id == share.id
    assert result.character_id == character_id
    assert result.revoked_at == revoked_at
    assert share.status == "revoked"
    assert share.revoked_at == revoked_at
    get_character.assert_awaited_once_with(
        session,
        owner_user_id=owner_id,
        character_id=character_id,
        for_update=True,
    )
    statement = session.execute.await_args.args[0]
    assert statement._for_update_arg is not None
    session.add.assert_called_once_with(share)
    append_event.assert_not_awaited()
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_revoke_active_share_emits_targeted_event_in_same_transaction(
    monkeypatch,
) -> None:
    owner_id = uuid4()
    viewer_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    share = make_share(
        character_id=character.id,
        owner_user_id=owner_id,
        target_user_id=viewer_id,
        target_email="viewer@example.com",
        status="active",
    )
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    append_event = AsyncMock()
    monkeypatch.setattr(
        service.event_service,
        "append_share_revoked_event",
        append_event,
    )
    session = make_session()
    session.execute.return_value = scalar_result(share)
    revoked_at = datetime(2026, 7, 9, 15, 0, tzinfo=UTC)

    result = await service.revoke_character_share(
        session,
        owner_user_id=owner_id,
        character_id=character.id,
        share_id=share.id,
        revoked_at=revoked_at,
    )

    assert result.revoked_at == revoked_at
    append_event.assert_awaited_once_with(
        session,
        character_id=character.id,
        server_revision=character.server_revision,
        audience_user_id=viewer_id,
        revoked_at=revoked_at,
        actor_user_id=owner_id,
    )
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_revoke_active_share_propagates_event_failure(monkeypatch) -> None:
    owner_id = uuid4()
    viewer_id = uuid4()
    character = make_character(owner_user_id=owner_id)
    share = make_share(
        character_id=character.id,
        owner_user_id=owner_id,
        target_user_id=viewer_id,
        status="active",
    )
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=character),
    )
    monkeypatch.setattr(
        service.event_service,
        "append_share_revoked_event",
        AsyncMock(side_effect=RuntimeError("event insert failed")),
    )
    session = make_session()
    session.execute.return_value = scalar_result(share)

    with pytest.raises(RuntimeError, match="event insert failed"):
        await service.revoke_character_share(
            session,
            owner_user_id=owner_id,
            character_id=character.id,
            share_id=share.id,
        )

    assert share.status == "revoked"
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_revoke_masks_unknown_revoked_or_foreign_share(monkeypatch) -> None:
    owner_id = uuid4()
    character_id = uuid4()
    share_id = uuid4()
    monkeypatch.setattr(
        service,
        "get_owner_cloud_character",
        AsyncMock(return_value=make_character(owner_user_id=owner_id)),
    )
    session = make_session()
    session.execute.return_value = scalar_result(None)

    with pytest.raises(service.CharacterShareNotFoundError) as exc_info:
        await service.revoke_character_share(
            session,
            owner_user_id=owner_id,
            character_id=character_id,
            share_id=share_id,
        )

    assert exc_info.value.character_id == character_id
    assert exc_info.value.share_id == share_id
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_shared_characters_returns_owner_display_names() -> None:
    viewer_id = uuid4()
    first = make_character()
    second = make_character()
    session = make_session()
    session.execute.return_value = row_list_result(
        [(first, "Game Master"), (second, None)]
    )

    result = await service.list_shared_characters(
        session,
        viewer_user_id=viewer_id,
    )

    assert result == [
        service.SharedCharacterAccess(first, "Game Master"),
        service.SharedCharacterAccess(second, None),
    ]
    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "character_shares.target_user_id =" in sql
    assert "character_shares.status =" in sql
    assert "cloud_characters.deleted_at IS NULL" in sql


@pytest.mark.asyncio
async def test_get_shared_character_returns_active_access() -> None:
    viewer_id = uuid4()
    character = make_character()
    session = make_session()
    session.execute.return_value = row_result((character, "Game Master"))

    result = await service.get_shared_character(
        session,
        viewer_user_id=viewer_id,
        character_id=character.id,
    )

    assert result.character is character
    assert result.owner_display_name == "Game Master"
    statement = session.execute.await_args.args[0]
    assert "cloud_characters.id =" in str(statement)


@pytest.mark.asyncio
async def test_get_shared_character_masks_missing_pending_revoked_or_deleted() -> None:
    viewer_id = uuid4()
    character_id = uuid4()
    session = make_session()
    session.execute.return_value = row_result(None)

    with pytest.raises(service.SharedCharacterNotFoundError) as exc_info:
        await service.get_shared_character(
            session,
            viewer_user_id=viewer_id,
            character_id=character_id,
        )

    assert exc_info.value.character_id == character_id
