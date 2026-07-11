from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from app.models.character_share import CharacterShare
from app.models.user import User
from app.schemas.shares import CreateCharacterShareRequest
from app.services import share_target_service as service


def make_session() -> SimpleNamespace:
    return SimpleNamespace(
        add=Mock(),
        execute=AsyncMock(),
        flush=AsyncMock(),
    )


def scalar_result(value):
    return SimpleNamespace(scalar_one_or_none=Mock(return_value=value))


def scalar_list_result(values):
    return SimpleNamespace(
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=values)))
    )


def make_user(*, email: str = "viewer@example.com") -> User:
    return User(
        id=uuid4(),
        email=email,
        public_user_code="ABCDEF0123456789ABCDEF0123456789",
        password_hash="hashed",
    )


def make_share(
    *,
    character_id=None,
    target_email: str = "viewer@example.com",
    status: str = "pending",
    target_user_id=None,
) -> CharacterShare:
    now = datetime.now(UTC)
    return CharacterShare(
        id=uuid4(),
        character_id=character_id or uuid4(),
        owner_user_id=uuid4(),
        target_user_id=target_user_id,
        target_email=target_email,
        target_public_user_code=None,
        role="viewer",
        status=status,
        created_at=now,
        accepted_at=now if status == "active" else None,
        revoked_at=now if status == "revoked" else None,
    )


def test_normalizers_are_stable() -> None:
    assert service.normalize_target_email(" Viewer@Example.COM ") == "viewer@example.com"
    assert service.normalize_public_user_code(" abcd-1234 ") == "ABCD-1234"


@pytest.mark.asyncio
async def test_find_user_by_email_queries_normalized_value() -> None:
    user = make_user()
    session = make_session()
    session.execute.return_value = scalar_result(user)

    result = await service.find_user_by_email(session, " Viewer@Example.COM ")

    assert result is user
    statement = session.execute.await_args.args[0]
    assert "users.email =" in str(statement)
    assert statement.compile().params == {"email_1": "viewer@example.com"}


@pytest.mark.asyncio
async def test_find_user_by_public_code_queries_normalized_value() -> None:
    user = make_user()
    session = make_session()
    session.execute.return_value = scalar_result(user)

    result = await service.find_user_by_public_code(session, " abcdef0123456789abcdef0123456789 ")

    assert result is user
    statement = session.execute.await_args.args[0]
    assert "users.public_user_code =" in str(statement)
    assert statement.compile().params == {
        "public_user_code_1": "ABCDEF0123456789ABCDEF0123456789"
    }


@pytest.mark.asyncio
async def test_resolve_email_target_is_pending_when_account_does_not_exist(
    monkeypatch,
) -> None:
    finder = AsyncMock(return_value=None)
    monkeypatch.setattr(service, "find_user_by_email", finder)
    request = CreateCharacterShareRequest(targetEmail=" Viewer@Example.COM ")

    result = await service.resolve_share_target(make_session(), request)

    assert result.kind == "email"
    assert result.label == "viewer@example.com"
    assert result.user is None
    assert result.is_pending is True
    assert result.target_email == "viewer@example.com"
    assert result.target_public_user_code is None
    finder.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolve_email_target_links_existing_account(monkeypatch) -> None:
    user = make_user()
    monkeypatch.setattr(service, "find_user_by_email", AsyncMock(return_value=user))

    result = await service.resolve_share_target(
        make_session(),
        CreateCharacterShareRequest(targetEmail="viewer@example.com"),
    )

    assert result.user is user
    assert result.is_pending is False


@pytest.mark.asyncio
async def test_resolve_public_code_requires_existing_account(monkeypatch) -> None:
    monkeypatch.setattr(
        service,
        "find_user_by_public_code",
        AsyncMock(return_value=None),
    )

    with pytest.raises(service.InvalidShareTargetError) as exc_info:
        await service.resolve_share_target(
            make_session(),
            CreateCharacterShareRequest(publicUserCode="ABCD-1234"),
        )

    assert exc_info.value.target_kind == "publicUserCode"


@pytest.mark.asyncio
async def test_resolve_public_code_returns_normalized_label_and_user(monkeypatch) -> None:
    user = make_user()
    finder = AsyncMock(return_value=user)
    monkeypatch.setattr(service, "find_user_by_public_code", finder)

    result = await service.resolve_share_target(
        make_session(),
        CreateCharacterShareRequest(publicUserCode="abcd-1234"),
    )

    assert result.kind == "publicUserCode"
    assert result.label == "ABCD-1234"
    assert result.user is user
    assert result.target_email is None
    assert result.target_public_user_code == "ABCD-1234"


@pytest.mark.asyncio
async def test_activate_pending_shares_is_idempotent_when_none_exist() -> None:
    session = make_session()
    session.execute.return_value = scalar_list_result([])

    result = await service.activate_pending_shares_for_user(
        session,
        user=make_user(),
    )

    assert result.activated == ()
    assert result.superseded == ()
    assert result.changed_count == 0
    session.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_activate_pending_shares_links_user_and_sets_acceptance_time() -> None:
    user = make_user(email=" Viewer@Example.COM ")
    pending = make_share()
    session = make_session()
    session.execute.side_effect = [
        scalar_list_result([pending]),
        scalar_list_result([]),
    ]
    accepted_at = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)

    result = await service.activate_pending_shares_for_user(
        session,
        user=user,
        accepted_at=accepted_at,
    )

    assert result.activated == (pending,)
    assert result.superseded == ()
    assert result.changed_count == 1
    assert pending.target_user_id == user.id
    assert pending.status == "active"
    assert pending.accepted_at == accepted_at
    assert pending.revoked_at is None
    session.add.assert_called_once_with(pending)
    session.flush.assert_awaited_once()

    pending_statement = session.execute.await_args_list[0].args[0]
    assert "character_shares.target_email =" in str(pending_statement)
    assert pending_statement.compile().params["target_email_1"] == "viewer@example.com"
    assert pending_statement._for_update_arg is not None


@pytest.mark.asyncio
async def test_activation_revokes_redundant_pending_share_when_access_already_exists() -> None:
    user = make_user()
    character_id = uuid4()
    pending = make_share(character_id=character_id)
    active = make_share(
        character_id=character_id,
        target_email="other-label@example.com",
        status="active",
        target_user_id=user.id,
    )
    session = make_session()
    session.execute.side_effect = [
        scalar_list_result([pending]),
        scalar_list_result([active]),
    ]
    accepted_at = datetime(2026, 7, 9, 12, 30, tzinfo=UTC)

    result = await service.activate_pending_shares_for_user(
        session,
        user=user,
        accepted_at=accepted_at,
    )

    assert result.activated == ()
    assert result.superseded == (pending,)
    assert pending.target_user_id is None
    assert pending.status == "revoked"
    assert pending.revoked_at == accepted_at
    assert pending.accepted_at is None
    session.flush.assert_awaited_once()
