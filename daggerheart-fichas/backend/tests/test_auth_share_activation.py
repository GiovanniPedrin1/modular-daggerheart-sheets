from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.exc import SQLAlchemyError
from starlette.requests import Request
from starlette.responses import Response

from app.api import auth
from app.core.config import Settings
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest
from app.services.share_target_service import PendingShareActivationResult

FIXED_TIME = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
SESSION_EXPIRES_AT = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
PUBLIC_USER_CODE = "ABCDEF0123456789ABCDEF0123456789"


def make_request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [(b"user-agent", b"pytest")],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
    )


def make_user(*, email: str = "viewer@example.com") -> User:
    return User(
        id=uuid4(),
        email=email,
        public_user_code=PUBLIC_USER_CODE,
        password_hash="hashed-password",
        display_name="Viewer",
        created_at=FIXED_TIME,
        updated_at=FIXED_TIME,
    )


class NestedTransaction:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, exc_type, exc, traceback) -> bool:
        return False


class NestedSession:
    def __init__(self) -> None:
        self.begin_nested = Mock(return_value=NestedTransaction())


@pytest.mark.asyncio
async def test_activation_helper_uses_nested_transaction(monkeypatch) -> None:
    user = make_user()
    session = NestedSession()
    expected = PendingShareActivationResult(activated=(), superseded=())
    activate = AsyncMock(return_value=expected)
    monkeypatch.setattr(auth, "activate_pending_shares_for_user", activate)

    result = await auth.activate_pending_shares_after_auth(session, user=user)

    assert result is expected
    session.begin_nested.assert_called_once_with()
    activate.assert_awaited_once_with(session, user=user)


@pytest.mark.asyncio
async def test_activation_failure_does_not_block_authentication(monkeypatch) -> None:
    user = make_user()
    session = NestedSession()
    monkeypatch.setattr(
        auth,
        "activate_pending_shares_for_user",
        AsyncMock(side_effect=SQLAlchemyError("sharing temporarily unavailable")),
    )

    result = await auth.activate_pending_shares_after_auth(session, user=user)

    assert result is None
    session.begin_nested.assert_called_once_with()


@pytest.mark.asyncio
async def test_register_activates_pending_shares_before_commit(monkeypatch) -> None:
    events: list[str] = []
    added: list[object] = []

    def add(value: object) -> None:
        added.append(value)

    async def flush() -> None:
        user = next(value for value in added if isinstance(value, User))
        user.id = uuid4()
        user.public_user_code = PUBLIC_USER_CODE
        user.created_at = FIXED_TIME
        user.updated_at = FIXED_TIME

    async def commit() -> None:
        events.append("commit")

    async def activate(session, *, user) -> PendingShareActivationResult:
        events.append("activate")
        assert user.id is not None
        assert user.email == "viewer@example.com"
        return PendingShareActivationResult(activated=(), superseded=())

    session = SimpleNamespace(
        add=Mock(side_effect=add),
        flush=AsyncMock(side_effect=flush),
        commit=AsyncMock(side_effect=commit),
        rollback=AsyncMock(),
        refresh=AsyncMock(),
    )
    monkeypatch.setattr(auth, "find_user_by_email", AsyncMock(return_value=None))
    monkeypatch.setattr(auth, "hash_password", Mock(return_value="hashed-password"))
    monkeypatch.setattr(auth, "generate_session_token", Mock(return_value="raw-token"))
    monkeypatch.setattr(
        auth,
        "create_refresh_session",
        AsyncMock(return_value=SimpleNamespace(expires_at=SESSION_EXPIRES_AT)),
    )
    monkeypatch.setattr(auth, "activate_pending_shares_after_auth", AsyncMock(side_effect=activate))

    result = await auth.register(
        RegisterRequest(
            email=" Viewer@Example.COM ",
            password="strong-password",
            displayName="Viewer",
            deviceId="device-1",
        ),
        make_request("/auth/register"),
        Response(),
        session,
        Settings(app_env="test"),
    )

    assert events == ["activate", "commit"]
    assert result.user.email == "viewer@example.com"
    assert result.user.public_user_code == PUBLIC_USER_CODE
    auth.activate_pending_shares_after_auth.assert_awaited_once()
    session.commit.assert_awaited_once()
    session.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_login_activates_pending_shares_before_commit(monkeypatch) -> None:
    events: list[str] = []
    user = make_user()

    async def commit() -> None:
        events.append("commit")

    async def activate(session, *, user) -> PendingShareActivationResult:
        events.append("activate")
        return PendingShareActivationResult(activated=(), superseded=())

    session = SimpleNamespace(
        add=Mock(),
        commit=AsyncMock(side_effect=commit),
        refresh=AsyncMock(),
    )
    monkeypatch.setattr(auth, "find_user_by_email", AsyncMock(return_value=user))
    monkeypatch.setattr(auth, "verify_password", Mock(return_value=True))
    monkeypatch.setattr(auth, "password_hash_needs_rehash", Mock(return_value=False))
    monkeypatch.setattr(auth, "generate_session_token", Mock(return_value="raw-token"))
    monkeypatch.setattr(
        auth,
        "create_refresh_session",
        AsyncMock(return_value=SimpleNamespace(expires_at=SESSION_EXPIRES_AT)),
    )
    monkeypatch.setattr(auth, "activate_pending_shares_after_auth", AsyncMock(side_effect=activate))

    result = await auth.login(
        LoginRequest(
            email="viewer@example.com",
            password="strong-password",
            deviceId="device-1",
        ),
        make_request("/auth/login"),
        Response(),
        session,
        Settings(app_env="test"),
    )

    assert events == ["activate", "commit"]
    assert result.user.id == user.id
    auth.activate_pending_shares_after_auth.assert_awaited_once_with(session, user=user)
    session.commit.assert_awaited_once()
