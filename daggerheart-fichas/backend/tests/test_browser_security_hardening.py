from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.auth import clear_refresh_cookie, set_refresh_cookie
from app.core.config import Settings
from app.core.csrf import set_csrf_cookie
from app.core.security import utc_now
from app.middleware.security_headers import SecurityHeadersMiddleware


def build_browser_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://app.example.test"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
        max_age=900,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["api.example.test", "testserver"])
    app.add_middleware(SecurityHeadersMiddleware, hsts_enabled=True, hsts_preload=True)

    @app.get("/ok")
    async def ok() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/docs")
    async def docs() -> Response:
        return Response("docs", media_type="text/html")

    return app


def test_security_headers_apply_to_normal_and_error_responses() -> None:
    client = TestClient(build_browser_app(), base_url="https://api.example.test")

    response = client.get("/ok")
    missing = client.get("/missing")

    for current in (response, missing):
        assert current.headers["x-content-type-options"] == "nosniff"
        assert current.headers["x-frame-options"] == "DENY"
        assert current.headers["referrer-policy"] == "no-referrer"
        assert "camera=()" in current.headers["permissions-policy"]
        assert current.headers["content-security-policy"].startswith("default-src 'none'")
        assert current.headers["strict-transport-security"] == (
            "max-age=31536000; includeSubDomains; preload"
        )


def test_interactive_docs_are_csp_exempt_only_on_the_exact_docs_tree() -> None:
    client = TestClient(build_browser_app(), base_url="https://api.example.test")

    docs = client.get("/docs")
    similar = client.get("/docsevil")

    assert "content-security-policy" not in docs.headers
    assert "content-security-policy" in similar.headers


def test_trusted_host_rejects_host_header_attacks_with_security_headers() -> None:
    client = TestClient(build_browser_app(), base_url="https://api.example.test")

    response = client.get("/ok", headers={"Host": "attacker.example"})

    assert response.status_code == 400
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_cors_preflight_allows_only_reviewed_headers_and_origins() -> None:
    client = TestClient(build_browser_app(), base_url="https://api.example.test")
    base_headers = {
        "Origin": "https://app.example.test",
        "Access-Control-Request-Method": "POST",
    }

    allowed = client.options(
        "/ok",
        headers={
            **base_headers,
            "Access-Control-Request-Headers": "content-type,x-csrf-token,x-request-id",
        },
    )
    forbidden_header = client.options(
        "/ok",
        headers={**base_headers, "Access-Control-Request-Headers": "x-unreviewed-header"},
    )
    forbidden_origin = client.options(
        "/ok",
        headers={
            **base_headers,
            "Origin": "https://attacker.example",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://app.example.test"
    assert allowed.headers["access-control-max-age"] == "900"
    assert forbidden_header.status_code == 400
    assert forbidden_origin.status_code == 400
    assert "access-control-allow-origin" not in forbidden_origin.headers


def test_production_cookie_contract_uses_host_prefix_and_full_attributes() -> None:
    settings = Settings(
        app_env="production",
        session_secret="production-secret-with-sufficient-entropy",
        cors_allowed_origins=["https://app.example.com"],
        trusted_hosts=["api.example.com"],
        csrf_enabled=True,
        audit_enabled=True,
    )
    expires_at = utc_now() + timedelta(days=1)
    response = Response()

    set_refresh_cookie(response, settings=settings, token="refresh-token", expires_at=expires_at)
    set_csrf_cookie(response, settings=settings, token="csrf-token", expires_at=expires_at)

    cookies = response.headers.getlist("set-cookie")
    assert len(cookies) == 2
    assert all("__Host-" in cookie for cookie in cookies)
    assert all("HttpOnly" in cookie for cookie in cookies)
    assert all("Secure" in cookie for cookie in cookies)
    assert all("SameSite=lax" in cookie for cookie in cookies)
    assert all("Path=/" in cookie for cookie in cookies)
    assert all("Domain=" not in cookie for cookie in cookies)

    clear_refresh_cookie(response, settings=settings)
    assert "Max-Age=0" in response.headers.getlist("set-cookie")[-1]
    assert settings.effective_session_cookie_name in response.headers.getlist("set-cookie")[-1]


def test_cookie_and_cors_configuration_rejects_unsafe_combinations() -> None:
    with pytest.raises(ValidationError, match="COOKIE_SAMESITE=none"):
        Settings(app_env="test", cookie_samesite="none", session_cookie_secure=False)

    with pytest.raises(ValidationError, match="COOKIE_HOST_PREFIX requires COOKIE_DOMAIN"):
        Settings(
            app_env="test",
            cookie_host_prefix=True,
            session_cookie_secure=True,
            cookie_domain="example.com",
        )

    with pytest.raises(ValidationError, match="CORS_ALLOWED_HEADERS cannot contain a wildcard"):
        Settings(app_env="test", cors_allowed_headers=["*"])

    with pytest.raises(ValidationError, match="TRUSTED_HOSTS"):
        Settings(app_env="test", trusted_hosts=["bad host"])
