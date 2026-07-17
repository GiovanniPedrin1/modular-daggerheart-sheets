from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import status

from app.api.errors import api_error
from app.core.config import Settings
from app.core.observability import log_event

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RolloutFeature:
    key: str
    enabled: bool


def require_rollout_feature(
    feature: RolloutFeature,
    *,
    settings: Settings,
) -> None:
    if feature.enabled:
        return

    log_event(
        logger,
        logging.WARNING,
        "rollout.feature_blocked",
        feature=feature.key,
        retryAfterSeconds=settings.rollout_retry_after_seconds,
        releaseRevision=settings.release_revision,
    )
    raise api_error(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "FEATURE_TEMPORARILY_DISABLED",
        "This cloud feature is temporarily unavailable during a controlled rollout.",
        {"feature": feature.key},
        headers={"Retry-After": str(settings.rollout_retry_after_seconds)},
    )


def require_cloud_snapshot_writes(settings: Settings) -> None:
    require_rollout_feature(
        RolloutFeature(
            key="cloud_snapshot_writes",
            enabled=settings.cloud_snapshot_writes_enabled,
        ),
        settings=settings,
    )


def require_cloud_mutations(settings: Settings) -> None:
    require_rollout_feature(
        RolloutFeature(
            key="cloud_mutations",
            enabled=settings.cloud_mutations_enabled,
        ),
        settings=settings,
    )


def require_character_sharing_writes(settings: Settings) -> None:
    require_rollout_feature(
        RolloutFeature(
            key="character_sharing_writes",
            enabled=settings.character_sharing_writes_enabled,
        ),
        settings=settings,
    )


def require_character_sse(settings: Settings) -> None:
    require_rollout_feature(
        RolloutFeature(
            key="character_sse",
            enabled=settings.character_sse_enabled,
        ),
        settings=settings,
    )
