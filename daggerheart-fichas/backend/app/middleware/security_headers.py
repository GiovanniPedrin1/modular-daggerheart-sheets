from __future__ import annotations

from collections.abc import Iterable

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_DEFAULT_CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"


class SecurityHeadersMiddleware:
    """Apply a conservative browser security baseline to every HTTP response."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        enabled: bool = True,
        content_security_policy: str = _DEFAULT_CSP,
        csp_exempt_paths: Iterable[str] = ("/docs", "/redoc"),
        referrer_policy: str = "no-referrer",
        permissions_policy: str = (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
            "magnetometer=(), microphone=(), payment=(), usb=()"
        ),
        hsts_enabled: bool = False,
        hsts_max_age_seconds: int = 31_536_000,
        hsts_include_subdomains: bool = True,
        hsts_preload: bool = False,
    ) -> None:
        self.app = app
        self.enabled = enabled
        self.content_security_policy = content_security_policy
        self.csp_exempt_paths = tuple(csp_exempt_paths)
        self.referrer_policy = referrer_policy
        self.permissions_policy = permissions_policy
        self.hsts_enabled = hsts_enabled
        directives = [f"max-age={hsts_max_age_seconds}"]
        if hsts_include_subdomains:
            directives.append("includeSubDomains")
        if hsts_preload:
            directives.append("preload")
        self.hsts_value = "; ".join(directives)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path", ""))

        async def send_hardened(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = self.referrer_policy
                headers["Permissions-Policy"] = self.permissions_policy
                headers["X-Permitted-Cross-Domain-Policies"] = "none"
                headers["X-DNS-Prefetch-Control"] = "off"
                headers["Origin-Agent-Cluster"] = "?1"

                if not self._is_csp_exempt(path):
                    headers["Content-Security-Policy"] = self.content_security_policy
                if self.hsts_enabled:
                    headers["Strict-Transport-Security"] = self.hsts_value
            await send(message)

        await self.app(scope, receive, send_hardened)

    def _is_csp_exempt(self, path: str) -> bool:
        return any(
            path == prefix or path.startswith(f"{prefix}/")
            for prefix in self.csp_exempt_paths
        )
