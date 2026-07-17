from __future__ import annotations

import argparse
import asyncio
import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.db.session import AsyncSessionLocal, engine
from app.services.character_event_service import (
    CharacterEventRetentionResult,
    prune_character_events,
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
            "Compact replay-expired character snapshots and delete event history "
            "after its configured retention windows."
        )
    )
    parser.add_argument(
        "--character-id",
        type=UUID,
        default=None,
        help="Optionally prune only one cloud character UUID.",
    )
    parser.add_argument(
        "--now",
        type=_parse_timestamp,
        default=None,
        help="Override the current time (ISO-8601 with timezone) for maintenance/testing.",
    )
    return parser


def retention_result_payload(result: CharacterEventRetentionResult) -> dict[str, Any]:
    return {
        "compactedCount": result.compacted_count,
        "deletedCount": result.deleted_count,
        "replayCutoff": result.cutoff.isoformat(),
        "replayRetentionDays": result.retention_days,
        "retainedReplayRevisions": result.retained_content_revisions,
        "compactionCutoff": result.compaction_cutoff.isoformat(),
        "compactionRetentionDays": result.compaction_retention_days,
        "retainedCompactedRevisions": result.retained_compacted_revisions,
        "characterId": str(result.character_id) if result.character_id else None,
    }


async def run_retention(
    *,
    character_id: UUID | None = None,
    now: datetime | None = None,
    settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
) -> CharacterEventRetentionResult:
    """Run one retention transaction and commit only after a successful prune."""

    active_settings = settings or get_settings()
    async with session_factory() as session:
        try:
            result = await prune_character_events(
                session,
                settings=active_settings,
                now=now,
                character_id=character_id,
            )
            await session.commit()
        except Exception:
            await session.rollback()
            raise
    return result


async def _async_main(args: argparse.Namespace) -> int:
    try:
        result = await run_retention(
            character_id=args.character_id,
            now=args.now,
        )
        print(json.dumps(retention_result_payload(result), ensure_ascii=False, sort_keys=True))
        return 0
    finally:
        await engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
