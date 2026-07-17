from __future__ import annotations

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.request_context import (
    RequestAuditSource,
    choose_request_id,
    reset_request_audit_source,
    reset_request_id,
    set_request_audit_source,
    set_request_id,
)


class RequestIdMiddleware:
    """Attach one correlation ID to every HTTP request and response.

    A syntactically safe client/proxy value is preserved. Invalid, oversized,
    or missing values are replaced, preventing response splitting and avoiding
    unbounded identifiers in future logs/audit records.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        header_name: str,
        max_length: int,
        accept_incoming: bool = True,
    ) -> None:
        self.app = app
        self.header_name = header_name
        self.max_length = max_length
        self.accept_incoming = accept_incoming

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        candidate = headers.get(self.header_name) if self.accept_incoming else None
        request_id = choose_request_id(candidate, max_length=self.max_length)
        scope.setdefault("state", {})["request_id"] = request_id
        token = set_request_id(request_id)
        client = scope.get("client")
        client_host = client[0] if client else None
        audit_source_token = set_request_audit_source(
            RequestAuditSource(
                request_id=request_id,
                client_host=client_host,
                user_agent=headers.get("user-agent"),
            )
        )

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                mutable_headers = MutableHeaders(scope=message)
                mutable_headers[self.header_name] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            reset_request_audit_source(audit_source_token)
            reset_request_id(token)
