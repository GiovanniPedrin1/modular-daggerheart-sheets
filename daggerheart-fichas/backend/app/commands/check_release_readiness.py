from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.core.rate_limit import RateLimiter, create_rate_limiter
from app.db.session import engine

CheckStatus = Literal["pass", "fail", "warning", "skipped"]


@dataclass(frozen=True, slots=True)
class ReadinessCheck:
    name: str
    status: CheckStatus
    detail: str


@dataclass(frozen=True, slots=True)
class ReadinessReport:
    ready: bool
    environment: str
    api_version: str
    release_revision: str | None
    checks: tuple[ReadinessCheck, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "ready": self.ready,
            "environment": self.environment,
            "apiVersion": self.api_version,
            "releaseRevision": self.release_revision,
            "checks": [asdict(check) for check in self.checks],
        }


def configuration_checks(settings: Settings) -> list[ReadinessCheck]:
    checks = [
        ReadinessCheck("configuration", "pass", "settings contract is valid"),
        ReadinessCheck(
            "rollout.cloud_snapshot_writes",
            "pass" if settings.cloud_snapshot_writes_enabled else "warning",
            "enabled" if settings.cloud_snapshot_writes_enabled else "disabled by rollout switch",
        ),
        ReadinessCheck(
            "rollout.cloud_mutations",
            "pass" if settings.cloud_mutations_enabled else "warning",
            "enabled" if settings.cloud_mutations_enabled else "disabled by rollout switch",
        ),
        ReadinessCheck(
            "rollout.character_sharing_writes",
            "pass" if settings.character_sharing_writes_enabled else "warning",
            "enabled"
            if settings.character_sharing_writes_enabled
            else "disabled by rollout switch",
        ),
        ReadinessCheck(
            "rollout.character_sse",
            "pass" if settings.character_sse_enabled else "warning",
            "enabled" if settings.character_sse_enabled else "disabled by rollout switch",
        ),
    ]
    if settings.app_env not in {"staging", "production"}:
        checks.append(
            ReadinessCheck(
                "deployment_environment",
                "warning",
                "readiness was evaluated outside staging or production",
            )
        )
    else:
        checks.append(
            ReadinessCheck("deployment_environment", "pass", settings.app_env)
        )
    return checks


def expected_alembic_heads() -> tuple[str, ...]:
    backend_root = Path(__file__).resolve().parents[2]
    config = AlembicConfig(str(backend_root / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    return tuple(sorted(script.get_heads()))


async def database_checks() -> list[ReadinessCheck]:
    expected_heads = expected_alembic_heads()
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            rows = await connection.execute(text("SELECT version_num FROM alembic_version"))
            current_heads = tuple(sorted(str(row[0]) for row in rows))
    except Exception:  # noqa: BLE001 - public report must not expose connection details.
        return [
            ReadinessCheck("database.connection", "fail", "database is unavailable"),
            ReadinessCheck("database.migrations", "skipped", "database is unavailable"),
        ]

    migration_status: CheckStatus = "pass" if current_heads == expected_heads else "fail"
    migration_detail = (
        "database is at the Alembic head"
        if migration_status == "pass"
        else "database migration head does not match the application"
    )
    return [
        ReadinessCheck("database.connection", "pass", "database accepted a query"),
        ReadinessCheck("database.migrations", migration_status, migration_detail),
    ]


async def rate_limit_check(settings: Settings, limiter: RateLimiter) -> ReadinessCheck:
    if not settings.rate_limit_enabled:
        return ReadinessCheck("rate_limit.storage", "skipped", "rate limiting is disabled")
    try:
        await limiter.ping()
    except Exception:  # noqa: BLE001 - never expose the Redis URL or exception.
        return ReadinessCheck("rate_limit.storage", "fail", "shared storage is unavailable")
    return ReadinessCheck("rate_limit.storage", "pass", "shared storage accepted a ping")


async def build_readiness_report(
    settings: Settings,
    *,
    check_database: bool = True,
    check_rate_limit: bool = True,
) -> ReadinessReport:
    checks = configuration_checks(settings)
    if check_database:
        checks.extend(await database_checks())
    else:
        checks.append(ReadinessCheck("database", "skipped", "disabled by command option"))

    limiter = create_rate_limiter(settings)
    try:
        if check_rate_limit:
            checks.append(await rate_limit_check(settings, limiter))
        else:
            checks.append(
                ReadinessCheck("rate_limit.storage", "skipped", "disabled by command option")
            )
    finally:
        await limiter.close()

    ready = not any(check.status == "fail" for check in checks)
    return ReadinessReport(
        ready=ready,
        environment=settings.app_env,
        api_version=settings.api_version,
        release_revision=settings.release_revision,
        checks=tuple(checks),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate configuration, PostgreSQL migrations, Redis and rollout switches."
    )
    parser.add_argument("--skip-database", action="store_true")
    parser.add_argument("--skip-rate-limit", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    return parser


async def async_main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    report = await build_readiness_report(
        settings,
        check_database=not args.skip_database,
        check_rate_limit=not args.skip_rate_limit,
    )
    print(json.dumps(report.to_dict(), indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report.ready else 1


def main() -> None:
    raise SystemExit(asyncio.run(async_main(sys.argv[1:])))


if __name__ == "__main__":
    main()
