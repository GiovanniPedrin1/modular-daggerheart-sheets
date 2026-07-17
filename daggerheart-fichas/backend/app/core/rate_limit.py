from __future__ import annotations

import asyncio
import hashlib
import hmac
import math
import secrets
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: int


@dataclass(frozen=True, slots=True)
class RateLimitBucket:
    policy: str
    identity_parts: tuple[str, ...]
    limit: int


class RateLimitStoreError(RuntimeError):
    pass


class RateLimitExceededError(RuntimeError):
    def __init__(self, *, policy: str, decision: RateLimitDecision) -> None:
        super().__init__(f"Rate limit exceeded for {policy}")
        self.policy = policy
        self.decision = decision


class RateLimitUnavailableError(RuntimeError):
    pass


class RateLimitLease(Protocol):
    limit: int
    remaining: int
    refresh_interval_seconds: float

    async def refresh(self) -> None: ...

    async def release(self) -> None: ...


class RateLimitStore(Protocol):
    async def consume(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision: ...

    async def acquire_lease(
        self,
        keys_and_limits: Sequence[tuple[str, int]],
        *,
        lease_seconds: int,
    ) -> RateLimitLease: ...

    async def ping(self) -> None: ...

    async def close(self) -> None: ...


@dataclass(slots=True)
class _MemoryCounter:
    count: int
    expires_at: float


class _InMemoryRateLimitLease:
    def __init__(
        self,
        *,
        store: InMemoryRateLimitStore,
        keys: tuple[str, ...],
        lease_id: str,
        lease_seconds: int,
        limit: int,
        remaining: int,
    ) -> None:
        self._store = store
        self._keys = keys
        self._lease_id = lease_id
        self._lease_seconds = lease_seconds
        self._released = False
        self.limit = limit
        self.remaining = remaining
        self.refresh_interval_seconds = max(1.0, lease_seconds / 3)

    async def refresh(self) -> None:
        if self._released:
            return
        await self._store._refresh_lease(
            self._keys,
            lease_id=self._lease_id,
            lease_seconds=self._lease_seconds,
        )

    async def release(self) -> None:
        if self._released:
            return
        self._released = True
        await self._store._release_lease(self._keys, lease_id=self._lease_id)


class InMemoryRateLimitStore:
    """Single-process store for development and tests.

    Production and multi-replica deployments use Redis so every process observes
    the same counters and connection leases.
    """

    def __init__(self, *, clock=time.monotonic) -> None:
        self._clock = clock
        self._lock = asyncio.Lock()
        self._counters: dict[str, _MemoryCounter] = {}
        self._leases: dict[str, dict[str, float]] = {}

    async def consume(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        now = self._clock()
        async with self._lock:
            counter = self._counters.get(key)
            if counter is None or counter.expires_at <= now:
                counter = _MemoryCounter(count=0, expires_at=now + window_seconds)
                self._counters[key] = counter

            counter.count += 1
            retry_after = max(1, math.ceil(counter.expires_at - now))
            return RateLimitDecision(
                allowed=counter.count <= limit,
                limit=limit,
                remaining=max(0, limit - counter.count),
                retry_after_seconds=retry_after,
            )

    def _purge_expired_leases(self, key: str, *, now: float) -> dict[str, float]:
        leases = self._leases.setdefault(key, {})
        expired = [lease_id for lease_id, expires_at in leases.items() if expires_at <= now]
        for lease_id in expired:
            leases.pop(lease_id, None)
        if not leases:
            self._leases.pop(key, None)
            return {}
        return leases

    async def acquire_lease(
        self,
        keys_and_limits: Sequence[tuple[str, int]],
        *,
        lease_seconds: int,
    ) -> RateLimitLease:
        if not keys_and_limits:
            return NoopRateLimitLease()

        now = self._clock()
        lease_id = secrets.token_urlsafe(18)
        async with self._lock:
            snapshots: list[tuple[str, int, int]] = []
            for key, limit in keys_and_limits:
                leases = self._purge_expired_leases(key, now=now)
                count = len(leases)
                if count >= limit:
                    retry_after = max(
                        1,
                        math.ceil(min(leases.values(), default=now + lease_seconds) - now),
                    )
                    raise RateLimitExceededError(
                        policy="sse_connections",
                        decision=RateLimitDecision(
                            allowed=False,
                            limit=limit,
                            remaining=0,
                            retry_after_seconds=retry_after,
                        ),
                    )
                snapshots.append((key, limit, count))

            expires_at = now + lease_seconds
            for key, _limit, _count in snapshots:
                self._leases.setdefault(key, {})[lease_id] = expires_at

            tightest = min(snapshots, key=lambda item: item[1] - item[2])
            return _InMemoryRateLimitLease(
                store=self,
                keys=tuple(item[0] for item in snapshots),
                lease_id=lease_id,
                lease_seconds=lease_seconds,
                limit=tightest[1],
                remaining=max(0, tightest[1] - tightest[2] - 1),
            )

    async def _refresh_lease(
        self,
        keys: Sequence[str],
        *,
        lease_id: str,
        lease_seconds: int,
    ) -> None:
        now = self._clock()
        async with self._lock:
            expires_at = now + lease_seconds
            for key in keys:
                leases = self._purge_expired_leases(key, now=now)
                if lease_id in leases:
                    leases[lease_id] = expires_at

    async def _release_lease(self, keys: Sequence[str], *, lease_id: str) -> None:
        async with self._lock:
            for key in keys:
                leases = self._leases.get(key)
                if leases is None:
                    continue
                leases.pop(lease_id, None)
                if not leases:
                    self._leases.pop(key, None)

    async def ping(self) -> None:
        return None

    async def close(self) -> None:
        async with self._lock:
            self._counters.clear()
            self._leases.clear()


class _RedisRateLimitLease:
    def __init__(
        self,
        *,
        store: RedisRateLimitStore,
        keys: tuple[str, ...],
        lease_id: str,
        lease_seconds: int,
        limit: int,
        remaining: int,
    ) -> None:
        self._store = store
        self._keys = keys
        self._lease_id = lease_id
        self._lease_seconds = lease_seconds
        self._released = False
        self.limit = limit
        self.remaining = remaining
        self.refresh_interval_seconds = max(1.0, lease_seconds / 3)

    async def refresh(self) -> None:
        if self._released:
            return
        await self._store._refresh_lease(
            self._keys,
            lease_id=self._lease_id,
            lease_seconds=self._lease_seconds,
        )

    async def release(self) -> None:
        if self._released:
            return
        self._released = True
        await self._store._release_lease(self._keys, lease_id=self._lease_id)


class RedisRateLimitStore:
    _CONSUME_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
"""

    _ACQUIRE_LEASE_SCRIPT = """
local now = tonumber(ARGV[1])
local expiry = tonumber(ARGV[2])
local lease_id = ARGV[3]
for i, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
  local count = redis.call('ZCARD', key)
  local limit = tonumber(ARGV[3 + i])
  if count >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry = 1000
    if oldest[2] then
      retry = math.max(1, tonumber(oldest[2]) - now)
    end
    return {0, i, count, retry}
  end
end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, expiry, lease_id)
  redis.call('PEXPIRE', key, math.max(1000, expiry - now + 1000))
end
return {1, 0, 0, 0}
"""

    _REFRESH_LEASE_SCRIPT = """
local expiry = tonumber(ARGV[1])
local lease_id = ARGV[2]
for i, key in ipairs(KEYS) do
  if redis.call('ZSCORE', key, lease_id) then
    redis.call('ZADD', key, 'XX', expiry, lease_id)
    redis.call('PEXPIRE', key, tonumber(ARGV[3]))
  end
end
return 1
"""

    _RELEASE_LEASE_SCRIPT = """
for i, key in ipairs(KEYS) do
  redis.call('ZREM', key, ARGV[1])
end
return 1
"""

    def __init__(self, storage_url: str) -> None:
        try:
            from redis.asyncio import Redis
        except ImportError as exc:  # pragma: no cover - guarded by deployment dependency
            raise RateLimitStoreError(
                "The redis package is required for shared rate limiting"
            ) from exc
        self._client = Redis.from_url(storage_url, decode_responses=True)

    async def consume(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        try:
            count, ttl_ms = await self._client.eval(
                self._CONSUME_SCRIPT,
                1,
                key,
                window_seconds * 1000,
            )
        except Exception as exc:  # redis exceptions are intentionally kept behind this boundary
            raise RateLimitStoreError("Redis rate-limit consume failed") from exc

        retry_after = max(1, math.ceil(max(1, int(ttl_ms)) / 1000))
        current = int(count)
        return RateLimitDecision(
            allowed=current <= limit,
            limit=limit,
            remaining=max(0, limit - current),
            retry_after_seconds=retry_after,
        )

    async def acquire_lease(
        self,
        keys_and_limits: Sequence[tuple[str, int]],
        *,
        lease_seconds: int,
    ) -> RateLimitLease:
        if not keys_and_limits:
            return NoopRateLimitLease()

        now_ms = int(time.time() * 1000)
        expiry_ms = now_ms + lease_seconds * 1000
        lease_id = secrets.token_urlsafe(18)
        keys = tuple(key for key, _limit in keys_and_limits)
        limits = tuple(limit for _key, limit in keys_and_limits)
        try:
            result = await self._client.eval(
                self._ACQUIRE_LEASE_SCRIPT,
                len(keys),
                *keys,
                now_ms,
                expiry_ms,
                lease_id,
                *limits,
            )
        except Exception as exc:
            raise RateLimitStoreError("Redis SSE lease acquisition failed") from exc

        allowed, blocked_index, count, retry_ms = (int(value) for value in result)
        if not allowed:
            index = max(1, blocked_index) - 1
            limit = limits[index]
            raise RateLimitExceededError(
                policy="sse_connections",
                decision=RateLimitDecision(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    retry_after_seconds=max(1, math.ceil(retry_ms / 1000)),
                ),
            )

        tightest_limit = min(limits)
        # Exact per-key remaining counts would require a second distributed read.
        # The lease limit is still useful while the rejection response remains exact.
        return _RedisRateLimitLease(
            store=self,
            keys=keys,
            lease_id=lease_id,
            lease_seconds=lease_seconds,
            limit=tightest_limit,
            remaining=max(0, tightest_limit - int(count) - 1),
        )

    async def _refresh_lease(
        self,
        keys: Sequence[str],
        *,
        lease_id: str,
        lease_seconds: int,
    ) -> None:
        expiry_ms = int(time.time() * 1000) + lease_seconds * 1000
        try:
            await self._client.eval(
                self._REFRESH_LEASE_SCRIPT,
                len(keys),
                *keys,
                expiry_ms,
                lease_id,
                (lease_seconds + 1) * 1000,
            )
        except Exception as exc:
            raise RateLimitStoreError("Redis SSE lease refresh failed") from exc

    async def _release_lease(self, keys: Sequence[str], *, lease_id: str) -> None:
        try:
            await self._client.eval(
                self._RELEASE_LEASE_SCRIPT,
                len(keys),
                *keys,
                lease_id,
            )
        except Exception as exc:
            raise RateLimitStoreError("Redis SSE lease release failed") from exc

    async def ping(self) -> None:
        try:
            await self._client.ping()
        except Exception as exc:
            raise RateLimitStoreError("Redis rate-limit ping failed") from exc

    async def close(self) -> None:
        await self._client.aclose()


class NoopRateLimitLease:
    limit = 0
    remaining = 0
    refresh_interval_seconds = 3600.0

    async def refresh(self) -> None:
        return None

    async def release(self) -> None:
        return None


class RateLimiter:
    def __init__(
        self,
        *,
        enabled: bool,
        store: RateLimitStore,
        key_secret: str,
        key_prefix: str,
        window_seconds: int,
        sse_lease_seconds: int,
        fail_open: bool,
    ) -> None:
        self.enabled = enabled
        self._store = store
        self._key_secret = key_secret.encode("utf-8")
        self._key_prefix = key_prefix
        self.window_seconds = window_seconds
        self.sse_lease_seconds = sse_lease_seconds
        self.fail_open = fail_open

    def _key(self, policy: str, identity_parts: Sequence[str]) -> str:
        canonical = "\x1f".join(part.strip().lower() for part in identity_parts)
        digest = hmac.new(
            self._key_secret,
            f"{policy}\x1e{canonical}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"{self._key_prefix}:rate:{policy}:{digest}"

    async def enforce(self, buckets: Sequence[RateLimitBucket]) -> RateLimitDecision | None:
        if not self.enabled or not buckets:
            return None

        decisions: list[tuple[str, RateLimitDecision]] = []
        try:
            for bucket in buckets:
                decision = await self._store.consume(
                    self._key(bucket.policy, bucket.identity_parts),
                    limit=bucket.limit,
                    window_seconds=self.window_seconds,
                )
                decisions.append((bucket.policy, decision))
        except RateLimitStoreError as exc:
            if self.fail_open:
                return None
            raise RateLimitUnavailableError("Rate-limit storage is unavailable") from exc

        rejected = [(policy, decision) for policy, decision in decisions if not decision.allowed]
        if rejected:
            policy, decision = max(
                rejected,
                key=lambda item: item[1].retry_after_seconds,
            )
            raise RateLimitExceededError(policy=policy, decision=decision)

        return min(
            (decision for _policy, decision in decisions),
            key=lambda decision: decision.remaining,
        )

    async def acquire_sse_lease(
        self,
        *,
        user_id: str,
        character_id: str,
        per_user_limit: int,
        per_character_limit: int,
    ) -> RateLimitLease:
        if not self.enabled:
            return NoopRateLimitLease()

        keys_and_limits = (
            (self._key("sse_user", (user_id,)), per_user_limit),
            (
                self._key("sse_character", (character_id,)),
                per_character_limit,
            ),
        )
        try:
            return await self._store.acquire_lease(
                keys_and_limits,
                lease_seconds=self.sse_lease_seconds,
            )
        except RateLimitExceededError:
            raise
        except RateLimitStoreError as exc:
            if self.fail_open:
                return NoopRateLimitLease()
            raise RateLimitUnavailableError("Rate-limit storage is unavailable") from exc

    async def ping(self) -> None:
        if not self.enabled:
            return
        try:
            await self._store.ping()
        except RateLimitStoreError as exc:
            raise RateLimitUnavailableError("Rate-limit storage is unavailable") from exc

    async def close(self) -> None:
        await self._store.close()


def create_rate_limiter(settings: Settings) -> RateLimiter:
    store: RateLimitStore
    if settings.rate_limit_storage_url:
        store = RedisRateLimitStore(settings.rate_limit_storage_url)
    else:
        store = InMemoryRateLimitStore()

    return RateLimiter(
        enabled=settings.rate_limit_enabled,
        store=store,
        key_secret=settings.session_secret,
        key_prefix=settings.rate_limit_key_prefix,
        window_seconds=settings.rate_limit_window_seconds,
        sse_lease_seconds=settings.rate_limit_sse_lease_seconds,
        fail_open=settings.rate_limit_fail_open,
    )
