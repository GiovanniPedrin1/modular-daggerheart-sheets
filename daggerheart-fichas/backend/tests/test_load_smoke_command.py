from __future__ import annotations

import httpx
import pytest

from app.commands.load_smoke_test import parse_headers, percentile, run_load_smoke

pytestmark = pytest.mark.load


def test_percentile_uses_nearest_rank() -> None:
    assert percentile([10, 20, 30, 40], 0.50) == 20
    assert percentile([10, 20, 30, 40], 0.95) == 40
    assert percentile([], 0.95) == 0


def test_parse_headers_rejects_invalid_values() -> None:
    assert parse_headers(["Authorization: Bearer token"]) == {
        "Authorization": "Bearer token"
    }
    with pytest.raises(ValueError, match="Name: value"):
        parse_headers(["invalid"])


@pytest.mark.asyncio
async def test_load_smoke_reports_threshold_success() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "ok"})

    report = await run_load_smoke(
        base_url="https://api.example.test",
        path="/health",
        request_count=20,
        concurrency=4,
        timeout_seconds=1,
        max_error_rate=0,
        max_p95_ms=1_000,
        min_requests_per_second=1,
        transport=httpx.MockTransport(handler),
    )

    assert report.passed is True
    assert report.successes == 20
    assert report.failures == 0
    assert report.status_counts == {"200": 20}


@pytest.mark.asyncio
async def test_load_smoke_fails_on_http_errors() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    report = await run_load_smoke(
        base_url="https://api.example.test",
        path="/health",
        request_count=4,
        concurrency=2,
        timeout_seconds=1,
        max_error_rate=0,
        max_p95_ms=1_000,
        min_requests_per_second=0,
        transport=httpx.MockTransport(handler),
    )

    assert report.passed is False
    assert report.failures == 4
    assert report.status_counts == {"503": 4}
