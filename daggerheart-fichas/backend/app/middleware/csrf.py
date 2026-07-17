from __future__ import annotations

import hmac
from collections.abc import Iterable
from http.cookies import SimpleCookie
from typing import Any

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.errors import build_api_error_payload
from app.core.csrf import normalize_origin, origin_from_referer, validate_csrf_token
from app.core.observability import mark_scope_api_error

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
DEFAULT_TOKEN_EXEMPT_PATHS = frozenset({"/auth/login", "/auth/register"})


class CsrfProtectionMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        enabled: bool,
        session_cookie_name: str,
        csrf_cookie_name: str,
        csrf_header_name: str,
        secret: str,
        trusted_origins: Iterable[str],
        request_id_header_name: str,
        token_exempt_paths: Iterable[str] = DEFAULT_TOKEN_EXEMPT_PATHS,
    ) -> None:
        self.app = app
        self.enabled = enabled
        self.session_cookie_name = session_cookie_name
        self.csrf_cookie_name = csrf_cookie_name
        self.csrf_header_name = csrf_header_name
        self.secret = secret
        self.trusted_origins = frozenset(
            origin
            for value in trusted_origins
            if (origin := normalize_origin(value)) is not None
        )
        self.request_id_header_name = request_id_header_name
        self.token_exempt_paths = frozenset(token_exempt_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method", "GET")).upper()
        if method in SAFE_METHODS:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_origin = self._request_origin(headers)
        if request_origin is None:
            await self._reject(scope, receive, send, reason="origin_missing")
            return
        if request_origin not in self.trusted_origins:
            await self._reject(scope, receive, send, reason="origin_forbidden")
            return

        path = str(scope.get("path", ""))
        if path in self.token_exempt_paths:
            await self.app(scope, receive, send)
            return

        cookies = self._parse_cookies(headers.get("cookie"))
        session_token = cookies.get(self.session_cookie_name)
        if not session_token:
            # Authentication will reject protected endpoints. CSRF tokens are
            # session-bound and therefore cannot be required without a session.
            await self.app(scope, receive, send)
            return

        cookie_token = cookies.get(self.csrf_cookie_name)
        header_token = headers.get(self.csrf_header_name)
        if not cookie_token or not header_token:
            await self._reject(scope, receive, send, reason="token_missing")
            return
        if not hmac.compare_digest(cookie_token, header_token):
            await self._reject(scope, receive, send, reason="token_mismatch")
            return
        if not validate_csrf_token(
            token=header_token,
            session_token=session_token,
            secret=self.secret,
        ):
            await self._reject(scope, receive, send, reason="token_invalid")
            return

        await self.app(scope, receive, send)

    @staticmethod
    def _parse_cookies(value: str | None) -> dict[str, str]:
        if not value:
            return {}
        cookie = SimpleCookie()
        try:
            cookie.load(value)
        except Exception:
            return {}
        return {key: morsel.value for key, morsel in cookie.items()}

    @staticmethod
    def _request_origin(headers: Headers) -> str | None:
        origin = headers.get("origin")
        if origin is not None:
            return normalize_origin(origin)
        referer = headers.get("referer")
        if referer is not None:
            return origin_from_referer(referer)
        return None

    async def _reject(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        *,
        reason: str,
    ) -> None:
        response_headers: dict[str, str] = {
            "Cache-Control": "no-store",
        }
        mark_scope_api_error(scope, code="CSRF_FAILED")
        state: dict[str, Any] = scope.setdefault("state", {})
        state["csrf_failure_reason"] = reason
        request_id = state.get("request_id")
        if isinstance(request_id, str) and request_id:
            response_headers[self.request_id_header_name] = request_id

        response = JSONResponse(
            status_code=403,
            content=build_api_error_payload(
                "CSRF_FAILED",
                "The request could not be verified.",
                {"reason": reason},
            ),
            headers=response_headers,
        )
        await response(scope, receive, send)
