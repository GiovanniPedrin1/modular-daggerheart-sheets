from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from typing import Literal
from urllib.parse import urlsplit

import httpx

SmokeStatus = Literal["pass", "fail", "skipped"]


@dataclass(frozen=True, slots=True)
class SmokeCheck:
    name: str
    status: SmokeStatus
    detail: str


@dataclass(frozen=True, slots=True)
class SmokeReport:
    passed: bool
    base_url: str
    checks: tuple[SmokeCheck, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "passed": self.passed,
            "baseUrl": self.base_url,
            "checks": [asdict(check) for check in self.checks],
        }


def _has_security_headers(response: httpx.Response, *, require_hsts: bool) -> bool:
    required = {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "x-permitted-cross-domain-policies": "none",
    }
    if any(response.headers.get(name) != value for name, value in required.items()):
        return False
    if "frame-ancestors 'none'" not in response.headers.get("content-security-policy", ""):
        return False
    return not (require_hsts and not response.headers.get("strict-transport-security"))


async def run_security_smoke(
    *,
    base_url: str,
    trusted_origin: str,
    expected_host: str,
    require_hsts: bool,
    expect_docs_disabled: bool,
    metrics_token: str | None,
    timeout_seconds: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SmokeReport:
    checks: list[SmokeCheck] = []
    async with httpx.AsyncClient(
        base_url=base_url.rstrip("/"),
        timeout=timeout_seconds,
        follow_redirects=False,
        transport=transport,
    ) as client:
        try:
            health = await client.get("/health", headers={"Host": expected_host})
        except httpx.HTTPError:
            return SmokeReport(
                passed=False,
                base_url=base_url,
                checks=(SmokeCheck("health", "fail", "request failed"),),
            )

        checks.append(
            SmokeCheck(
                "health",
                "pass" if health.status_code == 200 else "fail",
                f"HTTP {health.status_code}",
            )
        )
        request_id = health.headers.get("x-request-id")
        checks.append(
            SmokeCheck(
                "request_id",
                "pass" if request_id else "fail",
                "response contains X-Request-ID" if request_id else "header is missing",
            )
        )
        headers_ok = _has_security_headers(health, require_hsts=require_hsts)
        checks.append(
            SmokeCheck(
                "security_headers",
                "pass" if headers_ok else "fail",
                "required browser security headers are present"
                if headers_ok
                else "one or more required headers are missing",
            )
        )

        invalid_host = await client.get(
            "/health",
            headers={"Host": "invalid-host.example.invalid"},
        )
        checks.append(
            SmokeCheck(
                "trusted_host",
                "pass" if invalid_host.status_code == 400 else "fail",
                f"invalid Host returned HTTP {invalid_host.status_code}",
            )
        )

        preflight = await client.options(
            "/auth/login",
            headers={
                "Host": expected_host,
                "Origin": trusted_origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type,X-CSRF-Token",
            },
        )
        cors_ok = (
            preflight.status_code == 200
            and preflight.headers.get("access-control-allow-origin") == trusted_origin
            and preflight.headers.get("access-control-allow-credentials") == "true"
        )
        checks.append(
            SmokeCheck(
                "cors_preflight",
                "pass" if cors_ok else "fail",
                f"HTTP {preflight.status_code}",
            )
        )

        untrusted = await client.post(
            "/auth/login",
            headers={
                "Host": expected_host,
                "Origin": "https://untrusted.example.invalid",
                "Content-Type": "application/json",
            },
            json={"email": "nobody@example.invalid", "password": "not-a-real-password"},
        )
        csrf_ok = (
            untrusted.status_code == 403
            and untrusted.headers.get("content-type", "").startswith("application/json")
            and untrusted.json().get("code") == "CSRF_FAILED"
        )
        checks.append(
            SmokeCheck(
                "csrf_origin_rejection",
                "pass" if csrf_ok else "fail",
                f"HTTP {untrusted.status_code}",
            )
        )

        if expect_docs_disabled:
            docs = await client.get("/openapi.json", headers={"Host": expected_host})
            checks.append(
                SmokeCheck(
                    "api_docs_disabled",
                    "pass" if docs.status_code == 404 else "fail",
                    f"HTTP {docs.status_code}",
                )
            )
        else:
            checks.append(SmokeCheck("api_docs_disabled", "skipped", "not requested"))

        metrics_headers = {"Host": expected_host}
        if metrics_token:
            metrics_headers["Authorization"] = f"Bearer {metrics_token}"
        metrics = await client.get("/metrics", headers=metrics_headers)
        if metrics_token:
            metrics_ok = metrics.status_code == 200 and "text/plain" in metrics.headers.get(
                "content-type", ""
            )
            detail = f"authorized scrape returned HTTP {metrics.status_code}"
        else:
            metrics_ok = metrics.status_code in {401, 404}
            detail = f"unauthenticated scrape returned HTTP {metrics.status_code}"
        checks.append(
            SmokeCheck(
                "metrics_access",
                "pass" if metrics_ok else "fail",
                detail,
            )
        )

    return SmokeReport(
        passed=not any(check.status == "fail" for check in checks),
        base_url=base_url,
        checks=tuple(checks),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run non-destructive security checks against a deployed API."
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--trusted-origin", required=True)
    parser.add_argument("--expected-host")
    parser.add_argument("--require-hsts", action="store_true")
    parser.add_argument("--expect-docs-disabled", action="store_true")
    parser.add_argument("--metrics-token")
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--pretty", action="store_true")
    return parser


async def async_main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    parsed = urlsplit(args.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("--base-url must be an absolute HTTP(S) URL")
    expected_host = args.expected_host or parsed.netloc
    report = await run_security_smoke(
        base_url=args.base_url,
        trusted_origin=args.trusted_origin,
        expected_host=expected_host,
        require_hsts=args.require_hsts,
        expect_docs_disabled=args.expect_docs_disabled,
        metrics_token=args.metrics_token,
        timeout_seconds=args.timeout_seconds,
    )
    print(json.dumps(report.to_dict(), indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report.passed else 1


def main() -> None:
    raise SystemExit(asyncio.run(async_main(sys.argv[1:])))


if __name__ == "__main__":
    main()
