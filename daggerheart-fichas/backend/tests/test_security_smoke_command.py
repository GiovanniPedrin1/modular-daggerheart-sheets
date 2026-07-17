from __future__ import annotations

import httpx
import pytest

from app.commands.security_smoke_test import run_security_smoke

pytestmark = pytest.mark.security


@pytest.mark.asyncio
async def test_security_smoke_accepts_hardened_deployment_contract() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        headers = {
            "X-Request-ID": "req_test",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Permitted-Cross-Domain-Policies": "none",
            "Strict-Transport-Security": "max-age=31536000",
        }
        if request.headers.get("host") == "invalid-host.example.invalid":
            return httpx.Response(400, headers=headers)
        if request.method == "OPTIONS":
            headers.update(
                {
                    "Access-Control-Allow-Origin": "https://app.example.test",
                    "Access-Control-Allow-Credentials": "true",
                }
            )
            return httpx.Response(200, headers=headers)
        if request.url.path == "/auth/login":
            return httpx.Response(
                403,
                headers=headers,
                json={"code": "CSRF_FAILED", "message": "failed", "detail": {}},
            )
        if request.url.path == "/openapi.json":
            return httpx.Response(404, headers=headers)
        if request.url.path == "/metrics":
            return httpx.Response(401, headers=headers)
        return httpx.Response(200, headers=headers, json={"status": "ok"})

    report = await run_security_smoke(
        base_url="https://api.example.test",
        trusted_origin="https://app.example.test",
        expected_host="api.example.test",
        require_hsts=True,
        expect_docs_disabled=True,
        metrics_token=None,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )

    assert report.passed is True
    assert all(check.status in {"pass", "skipped"} for check in report.checks)
