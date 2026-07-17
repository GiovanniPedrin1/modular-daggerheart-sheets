from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_PRIVATE_PREFIXES = ("/auth", "/backups", "/characters", "/shared")


class PrivateResponseHeadersMiddleware:
    """Prevent browser/proxy persistence of authenticated or character data."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not str(scope.get("path", "")).startswith(
            _PRIVATE_PREFIXES
        ):
            await self.app(scope, receive, send)
            return

        async def send_private(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store, private"
                if "pragma" not in headers:
                    headers["Pragma"] = "no-cache"
                if "expires" not in headers:
                    headers["Expires"] = "0"
                if "x-robots-tag" not in headers:
                    headers["X-Robots-Tag"] = "noindex, noarchive"
            await send(message)

        await self.app(scope, receive, send_private)
