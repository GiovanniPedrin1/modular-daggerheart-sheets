from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable, Awaitable, Callable
from contextlib import suppress
from typing import Any

from starlette.responses import StreamingResponse
from starlette.types import Send

from app.core.observability import get_current_metrics, log_event
from app.services.character_sse_lifecycle_service import CharacterStreamConnectionControl

logger = logging.getLogger(__name__)


class HardenedSseStreamingResponse(StreamingResponse):
    """StreamingResponse with a bounded ASGI write time.

    A disconnected or extremely slow downstream proxy can otherwise leave a task
    suspended in ``send`` indefinitely. Timing out the transport closes the async
    generator, which releases the SSE rate-limit lease and decrements active-stream
    metrics in its ``finally`` blocks.
    """

    def __init__(
        self,
        content: AsyncIterable[str | bytes | memoryview],
        *,
        send_timeout_seconds: float,
        control: CharacterStreamConnectionControl,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        media_type: str | None = None,
        cleanup: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        if send_timeout_seconds <= 0:
            raise ValueError("send_timeout_seconds must be greater than zero")
        super().__init__(
            content,
            status_code=status_code,
            headers=headers,
            media_type=media_type,
        )
        self._send_timeout_seconds = send_timeout_seconds
        self._control = control
        self._cleanup = cleanup

    async def _send_with_timeout(self, send: Send, message: dict[str, Any]) -> None:
        async with asyncio.timeout(self._send_timeout_seconds):
            await send(message)

    async def stream_response(self, send: Send) -> None:
        try:
            await self._send_with_timeout(
                send,
                {
                    "type": "http.response.start",
                    "status": self.status_code,
                    "headers": self.raw_headers,
                },
            )
            async for chunk in self.body_iterator:
                if not isinstance(chunk, bytes | memoryview):
                    chunk = chunk.encode(self.charset)
                await self._send_with_timeout(
                    send,
                    {
                        "type": "http.response.body",
                        "body": chunk,
                        "more_body": True,
                    },
                )

            await self._send_with_timeout(
                send,
                {"type": "http.response.body", "body": b"", "more_body": False},
            )
        except TimeoutError as error:
            self._control.request_close("slow_client")
            get_current_metrics().record_sse_transport_failure(reason="send_timeout")
            log_event(
                logger,
                logging.WARNING,
                "character.stream.send_timeout",
                timeoutSeconds=self._send_timeout_seconds,
            )
            # StreamingResponse translates OSError into Starlette's ClientDisconnect
            # for ASGI 2.4+, matching a real downstream socket failure.
            raise OSError("SSE downstream send timed out") from error
        finally:
            close = getattr(self.body_iterator, "aclose", None)
            if close is not None:
                with suppress(Exception):
                    await close()
            if self._cleanup is not None:
                with suppress(Exception):
                    await self._cleanup()
