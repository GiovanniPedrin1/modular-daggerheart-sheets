from __future__ import annotations

import logging
from time import perf_counter
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.observability import (
    ObservabilityMetrics,
    log_event,
    reset_current_metrics,
    set_current_metrics,
)

logger = logging.getLogger(__name__)

_PAYLOAD_ERROR_CODES = frozenset(
    {
        "REQUEST_BODY_TOO_LARGE",
        "INVALID_CONTENT_LENGTH",
        "BACKUP_TOO_LARGE",
        "CHARACTER_TOO_LARGE",
        "MUTATION_TOO_LARGE",
        "INVALID_BACKUP_PAYLOAD",
        "INVALID_CHARACTER_PAYLOAD",
        "INVALID_MUTATION",
    }
)


def _route_template(scope: Scope) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path.startswith("/"):
        return path
    return "unmatched"


class RequestObservabilityMiddleware:
    """Record one low-cardinality metric and structured log per HTTP response.

    The middleware wraps the entire response body, so SSE duration is measured until
    the stream closes rather than only until headers are produced.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        metrics: ObservabilityMetrics,
        log_successful_requests: bool,
        metrics_path: str,
    ) -> None:
        self.app = app
        self.metrics = metrics
        self.log_successful_requests = log_successful_requests
        self.metrics_path = metrics_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = perf_counter()
        status_code = 500
        response_bytes = 0
        response_started = False
        metrics_token = set_current_metrics(self.metrics)

        async def observed_send(message: Message) -> None:
            nonlocal status_code, response_bytes, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = int(message["status"])
            elif message["type"] == "http.response.body":
                response_bytes += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive, observed_send)
        except BaseException:
            if not response_started:
                status_code = 500
            raise
        finally:
            try:
                path = str(scope.get("path", ""))
                route = _route_template(scope)
                duration = max(0.0, perf_counter() - started)
                method = str(scope.get("method", "GET")).upper()
                state: dict[str, Any] = scope.get("state", {})
                error_code = state.get("api_error_code")
                if not isinstance(error_code, str):
                    error_code = None

                if path != self.metrics_path:
                    self.metrics.record_http_request(
                        method=method,
                        route=route,
                        status_code=status_code,
                        duration_seconds=duration,
                    )
                    if error_code:
                        self.metrics.record_api_error(code=error_code, status_code=status_code)
                        if error_code in _PAYLOAD_ERROR_CODES:
                            self.metrics.record_payload_rejection(code=error_code)
                    csrf_reason = state.get("csrf_failure_reason")
                    if isinstance(csrf_reason, str):
                        self.metrics.record_csrf_failure(reason=csrf_reason)

                should_log = (
                    status_code >= 400
                    or (path != self.metrics_path and self.log_successful_requests)
                )
                if should_log:
                    level = (
                        logging.ERROR
                        if status_code >= 500
                        else logging.WARNING
                        if status_code >= 400
                        else logging.INFO
                    )
                    csrf_reason = state.get("csrf_failure_reason")
                    rate_limit_policy = state.get("rate_limit_policy")
                    rate_limit_outcome = state.get("rate_limit_outcome")
                    event = "http.request.completed"
                    if isinstance(csrf_reason, str):
                        event = "security.csrf.rejected"
                    elif error_code in _PAYLOAD_ERROR_CODES:
                        event = "security.payload.rejected"
                    elif rate_limit_outcome == "blocked":
                        event = "security.rate_limit.rejected"
                    elif path == self.metrics_path and status_code in {401, 403}:
                        event = "observability.metrics.denied"
                    log_event(
                        logger,
                        level,
                        event,
                        method=method,
                        route=route,
                        statusCode=status_code,
                        durationMs=round(duration * 1000, 3),
                        requestBytes=int(state.get("request_body_bytes") or 0),
                        responseBytes=response_bytes,
                        errorCode=error_code,
                        csrfReason=csrf_reason,
                        rateLimitPolicy=rate_limit_policy,
                        rateLimitOutcome=rate_limit_outcome,
                    )
            finally:
                reset_current_metrics(metrics_token)
