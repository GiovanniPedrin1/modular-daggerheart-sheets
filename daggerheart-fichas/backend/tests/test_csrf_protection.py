from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.api import auth
from app.core.config import Settings
from app.core.csrf import generate_csrf_token, validate_csrf_token
from app.core.security import utc_now
from app.middleware.csrf import CsrfProtectionMiddleware
from app.middleware.request_id import RequestIdMiddleware

TRUSTED_ORIGIN = "https://app.example.test"
SESSION_TOKEN = "session-token-a"
SECRET = "test-session-secret-with-enough-entropy"


def build_csrf_app() -> FastAPI:
    test_app = FastAPI()
    test_app.add_middleware(
        CsrfProtectionMiddleware,
        enabled=True,
        session_cookie_name="session",
        csrf_cookie_name="csrf",
        csrf_header_name="X-CSRF-Token",
        secret=SECRET,
        trusted_origins=[TRUSTED_ORIGIN],
        request_id_header_name="X-Request-ID",
    )
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=[TRUSTED_ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-CSRF-Token"],
    )
    test_app.add_middleware(
        RequestIdMiddleware,
        header_name="X-Request-ID",
        max_length=96,
        accept_incoming=True,
    )

    @test_app.get("/read")
    async def read() -> dict[str, bool]:
        return {"ok": True}

    @test_app.post("/mutate")
    async def mutate() -> dict[str, bool]:
        return {"ok": True}

    @test_app.post("/auth/login")
    async def login() -> dict[str, bool]:
        return {"ok": True}

    return test_app


def make_token(session_token: str = SESSION_TOKEN) -> str:
    return generate_csrf_token(
        session_token=session_token,
        secret=SECRET,
        token_bytes=32,
    )


def test_csrf_token_is_bound_to_the_refresh_session() -> None:
    token = make_token()

    assert validate_csrf_token(token=token, session_token=SESSION_TOKEN, secret=SECRET)
    assert not validate_csrf_token(
        token=token,
        session_token="another-session",
        secret=SECRET,
    )
    assert not validate_csrf_token(
        token=f"{token}tampered",
        session_token=SESSION_TOKEN,
        secret=SECRET,
    )


def test_safe_requests_do_not_require_origin_or_token() -> None:
    with TestClient(build_csrf_app()) as client:
        response = client.get("/read")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_unsafe_request_requires_a_trusted_origin_even_without_a_session() -> None:
    with TestClient(build_csrf_app()) as client:
        missing = client.post("/mutate")
        forbidden = client.post(
            "/mutate",
            headers={"Origin": "https://attacker.example"},
        )
        trusted = client.post(
            "/mutate",
            headers={"Origin": TRUSTED_ORIGIN},
        )

    assert missing.status_code == 403
    assert missing.json()["code"] == "CSRF_FAILED"
    assert missing.json()["detail"] == {"reason": "origin_missing"}
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == {"reason": "origin_forbidden"}
    assert trusted.status_code == 200


def test_login_is_token_exempt_but_not_origin_exempt() -> None:
    with TestClient(build_csrf_app()) as client:
        client.cookies.set("session", SESSION_TOKEN)
        trusted = client.post("/auth/login", headers={"Origin": TRUSTED_ORIGIN})
        missing_origin = client.post("/auth/login")

    assert trusted.status_code == 200
    assert missing_origin.status_code == 403


def test_authenticated_mutation_requires_matching_valid_cookie_and_header() -> None:
    valid_token = make_token()
    other_session_token = make_token("other-session")

    with TestClient(build_csrf_app()) as client:
        client.cookies.set("session", SESSION_TOKEN)

        missing = client.post("/mutate", headers={"Origin": TRUSTED_ORIGIN})

        client.cookies.set("csrf", valid_token)
        mismatch = client.post(
            "/mutate",
            headers={"Origin": TRUSTED_ORIGIN, "X-CSRF-Token": "different"},
        )

        client.cookies.set("csrf", other_session_token)
        wrong_session = client.post(
            "/mutate",
            headers={"Origin": TRUSTED_ORIGIN, "X-CSRF-Token": other_session_token},
        )

        client.cookies.set("csrf", valid_token)
        accepted = client.post(
            "/mutate",
            headers={"Origin": TRUSTED_ORIGIN, "X-CSRF-Token": valid_token},
        )

    assert missing.status_code == 403
    assert missing.json()["detail"] == {"reason": "token_missing"}
    assert mismatch.status_code == 403
    assert mismatch.json()["detail"] == {"reason": "token_mismatch"}
    assert wrong_session.status_code == 403
    assert wrong_session.json()["detail"] == {"reason": "token_invalid"}
    assert accepted.status_code == 200


def test_csrf_failure_keeps_request_id_and_cors_headers() -> None:
    with TestClient(build_csrf_app()) as client:
        client.cookies.set("session", SESSION_TOKEN)
        response = client.post(
            "/mutate",
            headers={
                "Origin": TRUSTED_ORIGIN,
                "X-Request-ID": "csrf-request-123",
            },
        )

    assert response.status_code == 403
    assert response.headers["x-request-id"] == "csrf-request-123"
    assert response.headers["access-control-allow-origin"] == TRUSTED_ORIGIN
    exposed = response.headers["access-control-expose-headers"]
    assert "X-Request-ID" in exposed
    assert "X-CSRF-Token" in exposed


@pytest.mark.asyncio
async def test_auth_csrf_endpoint_rotates_token_for_active_session(monkeypatch) -> None:
    settings = Settings(
        app_env="test",
        session_secret=SECRET,
        csrf_enabled=True,
    )
    active_session = SimpleNamespace(expires_at=utc_now() + timedelta(hours=1))
    monkeypatch.setattr(
        auth,
        "get_active_refresh_session",
        AsyncMock(return_value=active_session),
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/auth/csrf",
            "headers": [
                (
                    b"cookie",
                    f"{settings.effective_session_cookie_name}={SESSION_TOKEN}".encode(),
                )
            ],
        }
    )
    response = Response()

    result = await auth.get_csrf_token(
        request=request,
        response=response,
        session=object(),
        settings=settings,
    )

    assert result.csrf_token == response.headers[settings.csrf_header_name]
    assert validate_csrf_token(
        token=result.csrf_token,
        session_token=SESSION_TOKEN,
        secret=SECRET,
    )
    cookie_header = response.headers.get("set-cookie", "")
    assert settings.effective_csrf_cookie_name in cookie_header
    assert "HttpOnly" in cookie_header
    assert response.headers["cache-control"] == "no-store"
