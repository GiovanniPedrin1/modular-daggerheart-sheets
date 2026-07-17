from __future__ import annotations

import argparse
import asyncio
import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.db.session import AsyncSessionLocal, engine
from app.services.data_lifecycle_service import (
    DataLifecycleRetentionResult,
    maintain_data_lifecycle,
)


def _parse_timestamp(value: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "--now must be an ISO-8601 timestamp with timezone"
        ) from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("--now must include a timezone")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Delete expired character tombstones, stale shares, old refresh sessions "
            "and audit events in bounded privacy-maintenance batches."
        )
    )
    parser.add_argument("--now", type=_parse_timestamp, default=None)
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Override the batch size up to DATA_LIFECYCLE_BATCH_SIZE.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report eligible rows without deleting them.",
    )
    return parser


def lifecycle_result_payload(result: DataLifecycleRetentionResult) -> dict[str, Any]:
    return {
        "now": result.now.isoformat(),
        "dryRun": result.dry_run,
        "batchSize": result.batch_size,
        "totalMatched": result.total_matched,
        "totalDeleted": result.total_deleted,
        "counts": result.counts(),
        "cutoffs": {
            "cloudCharacterTombstone": result.cloud_character_cutoff.isoformat(),
            "pendingShare": result.pending_share_cutoff.isoformat(),
            "revokedShare": result.revoked_share_cutoff.isoformat(),
            "refreshSession": result.refresh_session_cutoff.isoformat(),
            "auditEvent": result.audit_cutoff.isoformat(),
        },
        "batchLimitReached": list(result.batch_limit_reached),
    }


async def run_maintenance(
    *,
    now: datetime | None = None,
    dry_run: bool = False,
    batch_size: int | None = None,
    settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
) -> DataLifecycleRetentionResult:
    active_settings = settings or get_settings()
    async with session_factory() as session:
        try:
            result = await maintain_data_lifecycle(
                session,
                settings=active_settings,
                now=now,
                dry_run=dry_run,
                batch_size=batch_size,
            )
            if dry_run:
                await session.rollback()
            else:
                await session.commit()
        except Exception:
            await session.rollback()
            raise
    return result


async def _async_main(args: argparse.Namespace) -> int:
    try:
        result = await run_maintenance(
            now=args.now,
            dry_run=args.dry_run,
            batch_size=args.batch_size,
        )
        print(json.dumps(lifecycle_result_payload(result), ensure_ascii=False, sort_keys=True))
        return 0
    finally:
        await engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
