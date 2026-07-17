from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
import time
from dataclasses import asdict, dataclass
from statistics import mean
from urllib.parse import urlsplit

import httpx


@dataclass(frozen=True, slots=True)
class LoadResult:
    passed: bool
    requests: int
    successes: int
    failures: int
    error_rate: float
    duration_seconds: float
    requests_per_second: float
    mean_latency_ms: float
    p50_latency_ms: float
    p95_latency_ms: float
    p99_latency_ms: float
    status_counts: dict[str, int]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * quantile) - 1))
    return ordered[index]


async def run_load_smoke(
    *,
    base_url: str,
    path: str,
    request_count: int,
    concurrency: int,
    timeout_seconds: float,
    max_error_rate: float,
    max_p95_ms: float,
    min_requests_per_second: float,
    headers: dict[str, str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> LoadResult:
    queue: asyncio.Queue[int] = asyncio.Queue()
    for index in range(request_count):
        queue.put_nowait(index)

    latencies: list[float] = []
    statuses: dict[str, int] = {}
    failures = 0
    lock = asyncio.Lock()

    async with httpx.AsyncClient(
        base_url=base_url.rstrip("/"),
        timeout=timeout_seconds,
        limits=httpx.Limits(
            max_connections=concurrency,
            max_keepalive_connections=concurrency,
        ),
        headers=headers,
        transport=transport,
    ) as client:

        async def worker() -> None:
            nonlocal failures
            while True:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    return
                started = time.perf_counter()
                status_key: str
                failed = False
                try:
                    response = await client.get(path)
                    status_key = str(response.status_code)
                    failed = response.status_code < 200 or response.status_code >= 400
                except httpx.HTTPError:
                    status_key = "network_error"
                    failed = True
                latency_ms = (time.perf_counter() - started) * 1000
                async with lock:
                    latencies.append(latency_ms)
                    statuses[status_key] = statuses.get(status_key, 0) + 1
                    if failed:
                        failures += 1
                queue.task_done()

        started = time.perf_counter()
        await asyncio.gather(*(worker() for _ in range(concurrency)))
        duration = max(time.perf_counter() - started, 1e-9)

    successes = request_count - failures
    error_rate = failures / request_count
    rps = request_count / duration
    p95 = percentile(latencies, 0.95)
    passed = (
        error_rate <= max_error_rate
        and p95 <= max_p95_ms
        and rps >= min_requests_per_second
    )
    return LoadResult(
        passed=passed,
        requests=request_count,
        successes=successes,
        failures=failures,
        error_rate=error_rate,
        duration_seconds=duration,
        requests_per_second=rps,
        mean_latency_ms=mean(latencies) if latencies else 0.0,
        p50_latency_ms=percentile(latencies, 0.50),
        p95_latency_ms=p95,
        p99_latency_ms=percentile(latencies, 0.99),
        status_counts=dict(sorted(statuses.items())),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a bounded read-only HTTP load smoke test."
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--path", default="/health")
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--max-error-rate", type=float, default=0.01)
    parser.add_argument("--max-p95-ms", type=float, default=500.0)
    parser.add_argument("--min-rps", type=float, default=1.0)
    parser.add_argument("--header", action="append", default=[])
    parser.add_argument("--pretty", action="store_true")
    return parser


def parse_headers(values: list[str]) -> dict[str, str]:
    headers: dict[str, str] = {}
    for value in values:
        if ":" not in value:
            raise ValueError("--header values must use 'Name: value'")
        name, header_value = value.split(":", 1)
        name = name.strip()
        header_value = header_value.strip()
        if not name or not header_value:
            raise ValueError("--header name and value cannot be empty")
        headers[name] = header_value
    return headers


async def async_main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    parsed = urlsplit(args.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("--base-url must be an absolute HTTP(S) URL")
    if args.requests < 1 or args.requests > 100_000:
        raise SystemExit("--requests must be between 1 and 100000")
    if args.concurrency < 1 or args.concurrency > 1_000:
        raise SystemExit("--concurrency must be between 1 and 1000")
    if args.concurrency > args.requests:
        raise SystemExit("--concurrency cannot exceed --requests")
    if not 0 <= args.max_error_rate <= 1:
        raise SystemExit("--max-error-rate must be between 0 and 1")
    try:
        headers = parse_headers(args.header)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    report = await run_load_smoke(
        base_url=args.base_url,
        path=args.path,
        request_count=args.requests,
        concurrency=args.concurrency,
        timeout_seconds=args.timeout_seconds,
        max_error_rate=args.max_error_rate,
        max_p95_ms=args.max_p95_ms,
        min_requests_per_second=args.min_rps,
        headers=headers,
    )
    print(json.dumps(report.to_dict(), indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report.passed else 1


def main() -> None:
    raise SystemExit(asyncio.run(async_main(sys.argv[1:])))


if __name__ == "__main__":
    main()
