from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Any
from uuid import UUID

from fastapi import Request, Response, status

from app.api.errors import api_error
from app.core.config import Settings
from app.core.observability import get_current_metrics, log_event
from app.core.rate_limit import (
    NoopRateLimitLease,
    RateLimitBucket,
    RateLimitDecision,
    RateLimiter,
    RateLimitExceededError,
    RateLimitLease,
    RateLimitUnavailableError,
)

logger = logging.getLogger(__name__)

RATE_LIMIT_RESPONSE_HEADERS = (
    "RateLimit-Limit",
    "RateLimit-Remaining",
    "RateLimit-Reset",
    "Retry-After",
)


def get_request_rate_limiter(request: Request) -> RateLimiter | None:
    app = request.scope.get("app")
    if app is None:
        return None
    return getattr(app.state, "rate_limiter", None)


def get_request_client_ip(request: Request) -> str:
    if request.client is None or not request.client.host:
        return "unknown"
    return request.client.host


def apply_rate_limit_headers(response: Response, decision: RateLimitDecision | None) -> None:
    if decision is None:
        return
    response.headers["RateLimit-Limit"] = str(decision.limit)
    response.headers["RateLimit-Remaining"] = str(decision.remaining)
    response.headers["RateLimit-Reset"] = str(decision.retry_after_seconds)


def raise_rate_limit_error(error: RateLimitExceededError) -> None:
    decision = error.decision
    raise api_error(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "RATE_LIMITED",
        "Too many requests. Please retry later.",
        {
            "policy": error.policy,
            "limit": decision.limit,
            "retryAfterSeconds": decision.retry_after_seconds,
        },
        headers={
            "Retry-After": str(decision.retry_after_seconds),
            "RateLimit-Limit": str(decision.limit),
            "RateLimit-Remaining": "0",
            "RateLimit-Reset": str(decision.retry_after_seconds),
        },
    ) from error


def raise_rate_limit_unavailable(error: RateLimitUnavailableError) -> None:
    raise api_error(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "RATE_LIMIT_UNAVAILABLE",
        "Request throttling is temporarily unavailable.",
        headers={"Retry-After": "5"},
    ) from error


async def enforce_rate_limit_buckets(
    request: Request,
    response: Response,
    buckets: tuple[RateLimitBucket, ...],
) -> None:
    limiter = get_request_rate_limiter(request)
    if limiter is None:
        return
    metrics = get_current_metrics()
    try:
        decision = await limiter.enforce(buckets)
    except RateLimitExceededError as error:
        request.state.rate_limit_policy = error.policy
        request.state.rate_limit_outcome = "blocked"
        metrics.record_rate_limit(policy=error.policy, outcome="blocked")
        log_event(
            logger,
            logging.WARNING,
            "security.rate_limit.blocked",
            policy=error.policy,
            retryAfterSeconds=error.decision.retry_after_seconds,
            limit=error.decision.limit,
        )
        raise_rate_limit_error(error)
    except RateLimitUnavailableError as error:
        request.state.rate_limit_policy = "storage"
        request.state.rate_limit_outcome = "unavailable"
        metrics.record_rate_limit(policy="storage", outcome="unavailable")
        log_event(
            logger,
            logging.ERROR,
            "security.rate_limit.unavailable",
            failOpen=False,
        )
        raise_rate_limit_unavailable(error)

    if limiter.enabled:
        outcome = "allowed" if decision is not None else "bypassed"
        for bucket in buckets:
            metrics.record_rate_limit(policy=bucket.policy, outcome=outcome)
        if decision is None:
            log_event(
                logger,
                logging.WARNING,
                "security.rate_limit.bypassed",
                failOpen=True,
                policyCount=len(buckets),
            )
    apply_rate_limit_headers(response, decision)


async def enforce_auth_attempt_rate_limit(
    request: Request,
    response: Response,
    *,
    identity: str,
    settings: Settings,
) -> None:
    ip = get_request_client_ip(request)
    normalized_identity = identity.strip().lower() or "unknown"
    await enforce_rate_limit_buckets(
        request,
        response,
        (
            RateLimitBucket(
                policy="auth_ip",
                identity_parts=(ip,),
                limit=settings.rate_limit_login_per_minute,
            ),
            RateLimitBucket(
                policy="auth_identity",
                identity_parts=(normalized_identity,),
                limit=settings.rate_limit_login_per_minute,
            ),
        ),
    )


async def enforce_read_rate_limit_for_user(
    request: Request,
    response: Response,
    *,
    user_id: UUID,
    settings: Settings,
) -> None:
    await enforce_rate_limit_buckets(
        request,
        response,
        (
            RateLimitBucket(
                policy="read_user",
                identity_parts=(str(user_id),),
                limit=settings.rate_limit_read_per_minute,
            ),
        ),
    )


async def request_device_id(request: Request) -> str:
    try:
        payload: Any = await request.json()
    except Exception:
        return "unknown"
    if isinstance(payload, dict):
        device_id = payload.get("deviceId")
        if isinstance(device_id, str) and device_id.strip():
            return device_id.strip()
    return "unknown"


async def acquire_sse_connection_lease(
    request: Request,
    *,
    user_id: UUID,
    character_id: UUID,
    settings: Settings,
) -> RateLimitLease:
    limiter = get_request_rate_limiter(request)
    if limiter is None:
        return NoopRateLimitLease()
    metrics = get_current_metrics()
    try:
        lease = await limiter.acquire_sse_lease(
            user_id=str(user_id),
            character_id=str(character_id),
            per_user_limit=settings.rate_limit_sse_connections_per_user,
            per_character_limit=settings.rate_limit_sse_connections_per_character,
        )
    except RateLimitExceededError as error:
        request.state.rate_limit_policy = error.policy
        request.state.rate_limit_outcome = "blocked"
        metrics.record_rate_limit(policy=error.policy, outcome="blocked")
        log_event(
            logger,
            logging.WARNING,
            "security.rate_limit.blocked",
            policy=error.policy,
            retryAfterSeconds=error.decision.retry_after_seconds,
            limit=error.decision.limit,
        )
        raise_rate_limit_error(error)
    except RateLimitUnavailableError as error:
        request.state.rate_limit_policy = "sse_connections"
        request.state.rate_limit_outcome = "unavailable"
        metrics.record_rate_limit(policy="sse_connections", outcome="unavailable")
        log_event(
            logger,
            logging.ERROR,
            "security.rate_limit.unavailable",
            failOpen=False,
            policy="sse_connections",
        )
        raise_rate_limit_unavailable(error)

    if limiter.enabled:
        outcome = "allowed" if lease.limit > 0 else "bypassed"
        metrics.record_rate_limit(policy="sse_connections", outcome=outcome)
    return lease


async def stream_with_rate_limit_lease[T](
    stream: AsyncIterator[T],
    *,
    lease: RateLimitLease,
) -> AsyncIterator[T]:
    """Keep a connection lease alive independently from SSE frame production.

    Refreshing only after a yielded frame can let the lease expire while a database
    query, proxy write, or unusually long heartbeat interval is in progress. A small
    background task keeps the distributed lease current; TTL expiry remains the
    cleanup fallback if Redis becomes unavailable or the process is terminated.
    """

    async def refresh_lease() -> None:
        while True:
            await asyncio.sleep(lease.refresh_interval_seconds)
            try:
                await lease.refresh()
            except asyncio.CancelledError:
                raise
            except Exception:
                get_current_metrics().record_sse_transport_failure(
                    reason="lease_refresh_failed"
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "character.stream.lease_refresh_failed",
                )

    refresh_task = asyncio.create_task(
        refresh_lease(),
        name="character-sse-rate-limit-lease-refresh",
    )
    try:
        async for item in stream:
            yield item
    finally:
        refresh_task.cancel()
        with suppress(asyncio.CancelledError):
            await refresh_task
        with suppress(Exception):
            await lease.release()
