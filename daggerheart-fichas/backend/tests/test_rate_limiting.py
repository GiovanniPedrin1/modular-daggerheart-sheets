from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.rate_limit import (
    InMemoryRateLimitStore,
    RateLimitBucket,
    RateLimiter,
    RateLimitExceededError,
    RateLimitStoreError,
    RateLimitUnavailableError,
)
from app.services.rate_limit_service import enforce_auth_attempt_rate_limit


class FakeClock:
    def __init__(self) -> None:
        self.value = 100.0

    def __call__(self) -> float:
        return self.value


@pytest.mark.asyncio
async def test_in_memory_counter_allows_limit_then_resets_after_window() -> None:
    clock = FakeClock()
    store = InMemoryRateLimitStore(clock=clock)

    first = await store.consume("key", limit=2, window_seconds=60)
    second = await store.consume("key", limit=2, window_seconds=60)
    blocked = await store.consume("key", limit=2, window_seconds=60)

    assert first.allowed is True
    assert first.remaining == 1
    assert second.allowed is True
    assert second.remaining == 0
    assert blocked.allowed is False
    assert blocked.retry_after_seconds == 60

    clock.value += 60
    reset = await store.consume("key", limit=2, window_seconds=60)
    assert reset.allowed is True
    assert reset.remaining == 1


@pytest.mark.asyncio
async def test_rate_limiter_enforces_independent_buckets_without_storing_raw_identity() -> None:
    store = InMemoryRateLimitStore()
    limiter = RateLimiter(
        enabled=True,
        store=store,
        key_secret="test-secret",
        key_prefix="daggerheart",
        window_seconds=60,
        sse_lease_seconds=90,
        fail_open=False,
    )
    buckets = (
        RateLimitBucket("auth_ip", ("127.0.0.1",), 2),
        RateLimitBucket("auth_identity", ("127.0.0.1", "User@Example.com"), 2),
    )

    await limiter.enforce(buckets)
    await limiter.enforce(buckets)
    with pytest.raises(RateLimitExceededError) as error:
        await limiter.enforce(buckets)

    assert error.value.policy in {"auth_ip", "auth_identity"}
    assert all("user@example.com" not in key for key in store._counters)


@pytest.mark.asyncio
async def test_sse_connection_leases_limit_user_and_character_then_release() -> None:
    store = InMemoryRateLimitStore()
    limiter = RateLimiter(
        enabled=True,
        store=store,
        key_secret="test-secret",
        key_prefix="daggerheart",
        window_seconds=60,
        sse_lease_seconds=90,
        fail_open=False,
    )
    user_id = str(uuid4())
    character_id = str(uuid4())

    first = await limiter.acquire_sse_lease(
        user_id=user_id,
        character_id=character_id,
        per_user_limit=2,
        per_character_limit=1,
    )
    with pytest.raises(RateLimitExceededError) as error:
        await limiter.acquire_sse_lease(
            user_id=user_id,
            character_id=character_id,
            per_user_limit=2,
            per_character_limit=1,
        )
    assert error.value.decision.limit == 1

    await first.release()
    replacement = await limiter.acquire_sse_lease(
        user_id=user_id,
        character_id=character_id,
        per_user_limit=2,
        per_character_limit=1,
    )
    await replacement.release()


class FailingStore:
    async def consume(self, *_args, **_kwargs):
        raise RateLimitStoreError("unavailable")

    async def acquire_lease(self, *_args, **_kwargs):
        raise RateLimitStoreError("unavailable")

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_store_outage_respects_fail_open_and_fail_closed() -> None:
    bucket = RateLimitBucket("read", ("user",), 1)
    fail_open = RateLimiter(
        enabled=True,
        store=FailingStore(),
        key_secret="secret",
        key_prefix="app",
        window_seconds=60,
        sse_lease_seconds=90,
        fail_open=True,
    )
    fail_closed = RateLimiter(
        enabled=True,
        store=FailingStore(),
        key_secret="secret",
        key_prefix="app",
        window_seconds=60,
        sse_lease_seconds=90,
        fail_open=False,
    )

    assert await fail_open.enforce((bucket,)) is None
    with pytest.raises(RateLimitUnavailableError):
        await fail_closed.enforce((bucket,))


def build_auth_limit_app() -> FastAPI:
    settings = Settings(
        app_env="test",
        rate_limit_enabled=True,
        rate_limit_login_per_minute=2,
    )
    app = FastAPI()
    app.state.settings = settings
    app.state.rate_limiter = RateLimiter(
        enabled=True,
        store=InMemoryRateLimitStore(),
        key_secret=settings.session_secret,
        key_prefix=settings.rate_limit_key_prefix,
        window_seconds=settings.rate_limit_window_seconds,
        sse_lease_seconds=settings.rate_limit_sse_lease_seconds,
        fail_open=settings.rate_limit_fail_open,
    )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(_request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.detail,
            headers=exc.headers,
        )

    @app.post("/login")
    async def login(request: Request, response: Response) -> dict[str, bool]:
        payload = await request.json()
        await enforce_auth_attempt_rate_limit(
            request,
            response,
            identity=str(payload.get("email", "")),
            settings=settings,
        )
        return {"ok": True}

    return app


def test_auth_rate_limit_returns_stable_429_contract_and_retry_headers() -> None:
    with TestClient(build_auth_limit_app()) as client:
        first = client.post("/login", json={"email": "user@example.com"})
        second = client.post("/login", json={"email": "user@example.com"})
        blocked = client.post("/login", json={"email": "user@example.com"})

    assert first.status_code == 200
    assert first.headers["ratelimit-remaining"] == "1"
    assert second.headers["ratelimit-remaining"] == "0"
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "RATE_LIMITED"
    assert blocked.json()["detail"]["policy"] in {"auth_ip", "auth_identity"}
    assert blocked.headers["retry-after"] == blocked.headers["ratelimit-reset"]
    assert blocked.headers["ratelimit-remaining"] == "0"


def test_rate_limit_configuration_requires_shared_store_in_staging() -> None:
    with pytest.raises(ValidationError, match="RATE_LIMIT_STORAGE_URL"):
        Settings(app_env="staging", rate_limit_enabled=True)

    configured = Settings(
        app_env="staging",
        rate_limit_enabled=True,
        rate_limit_storage_url="rediss://redis.example.test:6380/0",
    )
    assert configured.rate_limit_storage_url.startswith("rediss://")

    with pytest.raises(ValidationError, match="redis:// or rediss://"):
        Settings(app_env="test", rate_limit_storage_url="https://redis.example.test")


def test_sse_lease_must_outlive_multiple_heartbeats() -> None:
    with pytest.raises(ValidationError, match="RATE_LIMIT_SSE_LEASE_SECONDS"):
        Settings(
            app_env="test",
            character_event_heartbeat_seconds=15,
            rate_limit_sse_lease_seconds=29,
        )
