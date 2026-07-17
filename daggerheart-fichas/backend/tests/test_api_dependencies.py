from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.api import dependencies
from app.core.config import Settings


def make_request(*, cookie_name: str, token: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if token is not None:
        headers.append((b"cookie", f"{cookie_name}={token}".encode()))

    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/protected",
            "headers": headers,
        }
    )


@pytest.mark.asyncio
async def test_require_current_user_returns_authenticated_user(monkeypatch) -> None:
    settings = Settings(app_env="test")
    request = make_request(cookie_name=settings.effective_session_cookie_name, token="valid-token")
    response = Response()
    session = object()
    user = SimpleNamespace(id="user-id")
    active_session = SimpleNamespace(user=user)
    get_active_refresh_session = AsyncMock(return_value=active_session)
    monkeypatch.setattr(dependencies, "get_active_refresh_session", get_active_refresh_session)

    result = await dependencies.require_current_user(
        request=request,
        response=response,
        session=session,
        settings=settings,
    )

    assert result is user
    get_active_refresh_session.assert_awaited_once_with(
        session,
        settings=settings,
        token="valid-token",
    )


@pytest.mark.asyncio
async def test_require_current_user_clears_cookie_and_rejects_expired_session(monkeypatch) -> None:
    settings = Settings(app_env="test")
    request = make_request(
        cookie_name=settings.effective_session_cookie_name,
        token="expired-token",
    )
    response = Response()
    monkeypatch.setattr(
        dependencies,
        "get_active_refresh_session",
        AsyncMock(return_value=None),
    )

    with pytest.raises(HTTPException) as exc_info:
        await dependencies.require_current_user(
            request=request,
            response=response,
            session=object(),
            settings=settings,
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "SESSION_EXPIRED"
    set_cookie = response.headers.get("set-cookie", "")
    assert settings.effective_session_cookie_name in set_cookie
    assert "Max-Age=0" in set_cookie
