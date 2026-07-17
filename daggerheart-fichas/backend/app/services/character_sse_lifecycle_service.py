from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import Request, status

from app.api.errors import api_error


class CharacterStreamDrainingError(RuntimeError):
    """Raised when a new stream is attempted while the process is draining."""


@dataclass(slots=True, eq=False)
class CharacterStreamConnectionControl:
    """Mutable, per-connection close state shared by the body and transport."""

    close_reason: str | None = None

    def request_close(self, reason: str) -> None:
        normalized = reason.strip()
        if normalized and self.close_reason is None:
            self.close_reason = normalized


class CharacterStreamManager:
    """Tracks active SSE streams and coordinates process-local draining.

    The maximum stream lifetime remains the primary deploy-rotation mechanism because
    ASGI servers may start application lifespan shutdown only after HTTP tasks have
    already been asked to stop. The manager still gives tests, embedded deployments,
    and explicit drain hooks a deterministic way to reject new connections and signal
    existing generators.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._shutdown_event = asyncio.Event()
        self._drained_event = asyncio.Event()
        self._drained_event.set()
        self._accepting = True
        self._active_count = 0

    @property
    def accepting(self) -> bool:
        return self._accepting

    @property
    def active_count(self) -> int:
        return self._active_count

    @property
    def shutdown_event(self) -> asyncio.Event:
        return self._shutdown_event

    async def start_accepting(self) -> None:
        async with self._lock:
            if self._active_count:
                raise RuntimeError("cannot restart SSE manager while streams are active")
            self._accepting = True
            self._shutdown_event = asyncio.Event()
            self._drained_event.set()

    async def begin_shutdown(self) -> int:
        async with self._lock:
            self._accepting = False
            self._shutdown_event.set()
            if self._active_count == 0:
                self._drained_event.set()
            return self._active_count

    async def wait_for_drain(self, timeout_seconds: float) -> bool:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")
        try:
            async with asyncio.timeout(timeout_seconds):
                await self._drained_event.wait()
        except TimeoutError:
            return False
        return True

    @asynccontextmanager
    async def track(
        self,
        control: CharacterStreamConnectionControl,
    ) -> AsyncIterator[None]:
        async with self._lock:
            if not self._accepting:
                control.request_close("server_shutdown")
                raise CharacterStreamDrainingError("SSE manager is draining")
            self._active_count += 1
            self._drained_event.clear()

        try:
            yield
        finally:
            async with self._lock:
                self._active_count = max(0, self._active_count - 1)
                if self._active_count == 0:
                    self._drained_event.set()


def get_character_stream_manager(request: Request) -> CharacterStreamManager | None:
    app = request.scope.get("app")
    if app is None:
        return None
    manager = getattr(app.state, "character_stream_manager", None)
    return manager if isinstance(manager, CharacterStreamManager) else None


def ensure_character_stream_accepting(request: Request, *, retry_after_seconds: int) -> None:
    manager = get_character_stream_manager(request)
    if manager is None or manager.accepting:
        return
    raise api_error(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "EVENT_STREAM_DRAINING",
        "Realtime connections are temporarily draining for a server restart.",
        headers={"Retry-After": str(max(1, retry_after_seconds))},
    )
