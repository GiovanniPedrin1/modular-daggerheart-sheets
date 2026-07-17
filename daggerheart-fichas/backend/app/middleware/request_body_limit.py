from __future__ import annotations

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.errors import build_api_error_payload
from app.core.observability import mark_scope_api_error


class _RequestBodyTooLarge(Exception):
    def __init__(self, actual_bytes: int) -> None:
        self.actual_bytes = actual_bytes
        super().__init__(f"request body exceeded limit at {actual_bytes} bytes")


class RequestBodyLimitMiddleware:
    """Reject oversized bodies from Content-Length or streamed ASGI chunks."""

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def _send_error(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        *,
        status_code: int,
        code: str,
        message: str,
        detail: dict[str, object],
    ) -> None:
        mark_scope_api_error(scope, code=code)
        response = JSONResponse(
            status_code=status_code,
            content=build_api_error_payload(code, message, detail),
        )
        await response(scope, receive, send)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_content_length = Headers(scope=scope).get("content-length")
        if raw_content_length is not None:
            try:
                content_length = int(raw_content_length)
            except ValueError:
                await self._send_error(
                    scope,
                    receive,
                    send,
                    status_code=400,
                    code="INVALID_CONTENT_LENGTH",
                    message="The Content-Length header is invalid.",
                    detail={},
                )
                return
            if content_length < 0:
                await self._send_error(
                    scope,
                    receive,
                    send,
                    status_code=400,
                    code="INVALID_CONTENT_LENGTH",
                    message="The Content-Length header is invalid.",
                    detail={},
                )
                return
            if content_length > self.max_bytes:
                await self._send_error(
                    scope,
                    receive,
                    send,
                    status_code=413,
                    code="REQUEST_BODY_TOO_LARGE",
                    message="The request body exceeds the configured size limit.",
                    detail={"maxBytes": self.max_bytes, "actualBytes": content_length},
                )
                return

        received_bytes = 0
        scope.setdefault("state", {})["request_body_bytes"] = 0

        async def limited_receive() -> Message:
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                scope["state"]["request_body_bytes"] = received_bytes
                if received_bytes > self.max_bytes:
                    raise _RequestBodyTooLarge(received_bytes)
            return message

        response_started = False

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except _RequestBodyTooLarge as error:
            if response_started:
                raise
            await self._send_error(
                scope,
                receive,
                send,
                status_code=413,
                code="REQUEST_BODY_TOO_LARGE",
                message="The request body exceeds the configured size limit.",
                detail={"maxBytes": self.max_bytes, "actualBytes": error.actual_bytes},
            )
